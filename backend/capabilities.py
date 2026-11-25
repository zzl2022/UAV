"""Dataset-first API. No weather collection or invented device capabilities."""
from copy import deepcopy
import hashlib
import json
from math import atan2, degrees, dist, hypot, isfinite, radians, tan
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT/'equipment_models'
for kind in ('optical', 'acoustic'):
    sys.path.insert(0, str(MODELS/kind/'src'))
from optical_model import load_device as load_optical, Pose, Target
from optical_model.model import field_of_view, camera_components
from acoustic_model import load_device as load_acoustic, AcousticSensor, SensorPosition, SoundSource, AcousticConditions
from acoustic_model.config import ENV_UNITS

VERSION = 'student-capabilities-1'
FRAME = 'platform-local-ENU'
HEIGHT_NOTE = '建筑网格按 high 字段与 DEM 构建；源高度字段语义及 DEM 垂直基准的核验状态见模型方法文档。'
STATUSES = {'provided':'资料提供', 'derived':'由输入计算', 'assumed':'用户假设', 'missing':'缺失', 'not_evaluated':'本阶段未评估', 'conditional':'按平台几何解释'}

def metric(value, unit, status, source):
    return {'value':value, 'unit':unit, 'status':status, 'source':source}

def scalar(x, name, low=None, high=None):
    if isinstance(x, bool) or not isinstance(x, (float, int)) or not isfinite(x):
        raise ValueError(name+' 必须是有限数值')
    if low is not None and x < low or high is not None and x > high:
        raise ValueError(name+' 超出允许范围')
    return float(x)

def position(value):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError('平台坐标必须为 [东, 上, -北] 三个米制数值')
    return [scalar(x, '坐标', -20000 if i == 1 else -30000, 20000 if i == 1 else 30000) for i,x in enumerate(value)]

def to_enu(p):
    """Three.js E,U,-N -> original Python E,N,U. No UTM relabeling."""
    x,y,z = position(p)
    return (x,-z,y)

def record(label, m):
    return {'label':label, **deepcopy(m), 'status_label':STATUSES.get(m['status'],m['status'])}

def geometry_context(context):
    if context is None:
        return {'state':'unknown','blocked':None,'status':'missing','source':'没有平台场景查询结果'}
    if not isinstance(context, dict) or type(context.get('known')) is not bool or type(context.get('blocked')) is not bool:
        raise ValueError('平台路径必须包含布尔 known / blocked')
    count = context.get('buildingCount',0)
    if isinstance(count,bool) or not isinstance(count,int) or not 0 <= count <= 100000:
        raise ValueError('遮挡建筑数无效')
    state = 'blocked' if context['blocked'] else 'clear' if context['known'] else 'unknown'
    return {'state':state,'blocked':context['blocked'] if state != 'unknown' else None,
            'building_count':count,'coverage_complete':context['known'],'status':'conditional',
            'source':'当前三维场景建筑与地形网格的直达路径查询', 'limitation':HEIGHT_NOTE}

class CapabilityService:
    def __init__(self, city_path=None):
        city_path = Path(city_path or ROOT/'public/data/city.json')
        raw = city_path.read_bytes()
        self.metadata = json.loads(raw)['metadata']
        self.scene_hash = hashlib.sha256(raw).hexdigest()
        self.paths = {'optical':MODELS/'optical/config/optical_nvt951.yaml',
                      'acoustic':MODELS/'acoustic/config/acoustic_sensor.yaml'}

    def devices(self):
        # Re-read on each request: edits to YAML take effect without hidden cache.
        return {'optical':load_optical(self.paths['optical']), 'acoustic':load_acoustic(self.paths['acoustic'])}

    def catalog(self):
        return {'version':VERSION,'mode':'dataset_only','devices':self.devices(),
                'scene':{'origin':self.metadata['origin'],'hash':self.scene_hash,
                         'building_count':self.metadata['sourceFeatures'],'coordinate_system':FRAME,
                         'height_note':HEIGHT_NOTE,'source_hashes':self.metadata.get('sources',{})},
                'configuration_files':{k:str(p.relative_to(ROOT)) for k,p in self.paths.items()},
                'configuration_hashes':{k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in self.paths.items()}}

    def evaluate(self, request):
        if not isinstance(request, dict) or request.get('version') != VERSION or request.get('mode') != 'dataset_only':
            raise ValueError('需要当前版本、dataset_only 模式请求')
        origin = request.get('origin')
        if not isinstance(origin, list) or len(origin) != 3 or any(abs(scalar(x,'原点')-y)>1e-7 for x,y in zip(origin,self.metadata['origin'])):
            raise ValueError('设备方案原点与当前城市不同')
        if request.get('scene_hash') != self.scene_hash:
            raise ValueError('城市场景版本不同，请刷新页面重新计算')
        devices = request.get('devices')
        if not isinstance(devices,list) or not 1 <= len(devices) <= 64:
            raise ValueError('需要1至64个光电或声学设备')
        if request.get('environment') not in (None, {}):
            raise ValueError('资料基础模式不接收外界环境参数')
        target = request.get('target')
        if not isinstance(target,dict):
            raise ValueError('需要目标位置')
        tp = to_enu(target.get('position'))
        configs, rows, ids = self.devices(), [], set()
        for d in devices:
            if not isinstance(d,dict) or d.get('type') not in configs:
                raise ValueError('仅支持 optical / acoustic')
            if not isinstance(d.get('id'),str) or not 1 <= len(d['id']) <= 64 or d['id'] in ids:
                raise ValueError('设备ID缺失或重复')
            ids.add(d['id'])
            sp = to_enu(d.get('position'))
            if dist(sp,tp) <= 0:
                raise ValueError('设备与目标位置不能重合')
            context = geometry_context(d.get('context'))
            common = {'id':d['id'],'type':d['type'],'device':configs[d['type']]['device'],
                      'geometry':context,'coordinate_frame':FRAME,
                      'coordinate_mapping':'Three.js [E,U,-N] -> Python [E,N,U]；共享原点，不转成UTM',
                      'inputs':{'device':deepcopy(d),'target':deepcopy(target)},
                      'notes':[HEIGHT_NOTE,'设备和目标位置为仿真场景设定。'],
                      'metrics':[], 'configuration':deepcopy(configs[d['type']])}
            if d['type'] == 'optical':
                self.optical(common,d,target,sp,tp,configs['optical'])
            else:
                self.acoustic(common,d,target,sp,tp,configs['acoustic'])
            rows.append(common)
        return {'version':VERSION,'mode':'dataset_only','scene_hash':self.scene_hash,
                'origin':origin,'results':rows,'warning':'资料基础能力与条件比较；无实测探测概率、识别率或定位精度。',
                'configuration_hashes':{k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in self.paths.items()}}

    def optical(self, out, d, target, sp, tp, config):
        yaw = scalar(d.get('heading_deg',0),'方位',0,360)
        pitch = scalar(d.get('pitch_deg',0),'俯仰',-90,90)
        pose = Pose(sp,yaw,pitch)
        width, height = target.get('width_m'),target.get('height_m')
        obj = Target(tp,width,height,source='平台用户设定目标')
        if d.get('channel','visible') not in ('visible','thermal'):
            raise ValueError('光电通道无效')
        name = d.get('channel','visible')
        ch = deepcopy(config['channels'][name])
        direct = d.get('direct_fov_deg')
        if direct is not None:
            if not isinstance(direct,list) or len(direct)!=2:
                raise ValueError('补充视场需要水平和垂直两个角度')
            direct = [scalar(x,'用户补充视场',0.001,179.999) for x in direct]
            ch['direct_fov'] = metric(direct,'deg','assumed','用户显式补充，不是原设备参数')
            ch['sensor_size'] = metric(None,'mm','missing','采用用户固定视场，不推测传感器尺寸')
        fov = field_of_view(ch,d.get('focal_mm'))
        x,y,z = camera_components(pose,tp)
        inside = None if fov['value'] is None else z>0 and abs(degrees(atan2(x,z))) <= fov['value'][0]/2+1e-10 and abs(degrees(atan2(y,z))) <= fov['value'][1]/2+1e-10
        pixels = None
        if fov['value'] is not None and width is not None and height is not None and z>0:
            pixels = [n*v/(2*z*tan(radians(a/2))) for n,v,a in zip(ch['resolution']['value'],[width,height],fov['value'])]
        mech = config['mechanical']
        mechanical = mech['yaw_range']['value'][0]<=yaw<=mech['yaw_range']['value'][1] and mech['pitch_range']['value'][0]<=pitch<=mech['pitch_range']['value'][1]
        result = {'distance':metric(dist(sp,tp),'m','derived','用户输入位置的欧氏距离'),
                  'geometric_azimuth':metric(degrees(atan2(tp[0]-sp[0],tp[1]-sp[1])) % 360,'deg','derived','由已知位置计算目标方位'),
                  'geometric_elevation':metric(degrees(atan2(tp[2]-sp[2],hypot(tp[0]-sp[0],tp[1]-sp[1]))),'deg','derived','由已知位置计算目标俯仰'),
                  'mechanical_orientation_valid':metric(mechanical,'boolean','derived','原模型云台范围约束'),
                  'channel':name,'fov':fov,'target_in_fov':metric(inside,'boolean','missing' if inside is None else fov['status'],'原模型目标中心矩形视场判断'),
                  'projected_target_size':metric(pixels,'px','missing' if pixels is None else 'assumed','原模型针孔投影；目标正对且与图像轴对齐'),
                  'recognition_probability':metric(None,'1','not_evaluated','资料未提供标定数据'),
                  'environment_effect':metric(None,'1','not_evaluated','资料基础评估模式不引入外界光照、雨雾或对比度假设')}
        out['raw_result'] = result
        out['metrics'] = [record(label,result[key]) for label,key in [('目标距离','distance'),('目标几何方位角','geometric_azimuth'),('目标几何俯仰角','geometric_elevation'),('云台姿态满足机械范围','mechanical_orientation_valid'),('水平 × 垂直视场','fov'),('目标中心在当前视场内','target_in_fov'),('目标投影尺寸','projected_target_size')]]
        out['metrics'] += [record(label,ch[key]) for label,key in [('通道分辨率','resolution'),('镜头焦距范围','focal_range'),('有效识别距离','effective_range'),('最低照度资料值','minimum_illuminance')]]
        out['metrics'].append(record('当前焦距',metric(fov['focal_mm'],'mm','assumed','用户选择的工作焦距；范围来自资料')))
        out['state'] = 'insufficient_data' if inside is None else 'scenario_geometry_only'
        out['notes'] += ['云台机械转动范围与瞬时光学视场分别处理。',
                         '50 m距离、切向15 m/s是资料中的跟踪条件，不能当作最大识别距离。']
        if direct is not None:
            out['notes'].append('当前采用用户固定视场假设，改变焦距不会自动改变该固定视场。')
        if context_blocked(out):
            out['notes'].append('按平台网格直视路径被挡；本阶段不据此生成识别成功率。')

    def acoustic(self, out, d, target, sp, tp, config):
        device = deepcopy(config)
        array = scalar(d.get('array_diameter_m',device['parameters']['array_diameter']['value']),'阵列直径')
        if array not in config['reported_claims']['array_options']['value']:
            raise ValueError('阵列只能选择资料提供的30、70、110 cm')
        device['parameters']['array_diameter'] = metric(array,'m','provided','用户选择资料列出的阵列规格')
        # Unknown environment is explicit. No assumed noise or propagation coefficients enter this mode.
        env = {'schema_version':1,'parameters':{key:metric(None,unit,'missing','资料基础模式未提供此参数') for key,unit in ENV_UNITS.items()}}
        sensor = SensorPosition(sp,vertical_datum=FRAME,source='平台用户设定设备位置')
        source = SoundSource(tp,band_hz=target.get('band_hz'),vertical_datum=FRAME,source='平台用户设定目标；声源声级未知')
        conditions = AcousticConditions(noise=None,wind_speed_m_s=None,rain_mm_h=None,generate_weather_noise=False,source='本阶段不输入外界环境数据')
        raw = AcousticSensor(device,env).evaluate(sensor,source,conditions)
        out['raw_result'] = raw
        out['configuration'] = device
        out['metrics'] = [record(label,raw[key]) for label,key in [('目标距离','distance'),('资料标称距离区间','nominal_range'),('处于标称距离区间（不是检出结论）','within_nominal_range'),('目标频带与阵列资料匹配','frequency_supported')]]
        out['metrics'] += [record('方位角（由已知位置计算）',raw['geometric_direction']['azimuth']), record('俯仰角（由已知位置计算）',raw['geometric_direction']['elevation'])]
        out['metrics'] += [record(label,device['parameters'][key]) for label,key in [('当前阵列直径','array_diameter'),('资料频率范围（仅110 cm）','frequency_range'),('资料方位测角精度','azimuth_error'),('资料俯仰测角精度','elevation_error')]]
        out['state'] = 'reference_comparison_only'
        out['notes'] += ['基础评估使用设备资料中的标称条件与输入位置。',
                         '资料中的94°×76°含义未确认，不将其当作声学波束来裁切目标。',
                         '28–132 dB的计权和测试条件缺失，不当作检测门限；标称500 m不保证此处可探测。',
                         '建筑遮挡只表示直达路径受影响；没有声源和传播参数，不判定声学能力为零。',
                         '资料未给目标声级、背景噪声及定位标定，本阶段不输出信噪差、真实探测概率和定位误差。']

def context_blocked(out):
    return out['geometry']['state'] == 'blocked'
