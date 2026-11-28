import {PRESETS,DEFAULT_ENV,DEFAULT_TARGET,ENV_FIELDS,TARGET_FIELDS} from '../../src/sensors/presets.js';
import {catalogFields,defaultProfile} from '../../src/sensors/equipment-catalog.js';
import {CATALOG_MODELS} from '../../src/sensors/equipment-models.js';
import {METRIC_WEIGHTS,DEFAULT_THREAT_CONFIGS,THREAT_CONFIG_LIMITS} from '../../src/task3/constants.js';
import {DEFAULT_SETTINGS} from '../../src/planning/optimizer.js';

export const STUDY_SCHEMA='cross-map-study/1';
export const MAPS=[
 {id:'recon',name:'河南博物院',base:null},
 {id:'beijing',name:'北京故宫',base:'data/beijing/beijing-gba'},
 ...[['wuxi','无锡市民中心'],['shenzhen','深圳国际交流中心'],['daxing','北京大兴机场'],['hangzhou','杭州萧山机场'],['nuclear','房山核设施'],['changjiang','海南昌江核电厂'],['railway','北京站至通州铁路走廊']].map(([id,name])=>({id,name,base:`data/sites/${id}/${id}-gba`})),
];
export const BASE_SETTINGS={...DEFAULT_SETTINGS,scope:'custom',scopeWidthM:2400,scopeDepthM:2400,spacing:600,heights:[20,45,90],siteSpacing:500,maxSites:32,maxDevices:24,budget:360,installationHeightM:2,radarPitchesDeg:[0,-15,-30],headingOffsetDeg:0,typeLimits:{radar:12,radio:12,optical:12,acoustic:12},threatConfigs:structuredClone(DEFAULT_THREAT_CONFIGS)};
const config=(id,label,group,overrides={})=>({id,label,group,...overrides});
// 在运行前冻结设计；OFAT 表示只改变一个数值/一个设备选型因素，多参数组合单列。
export const CONFIGURATIONS=[
 config('B00','标准基线','baseline'),
 config('G01','网格加密至400米','ofat',{settings:{spacing:400}}),
 config('G02','网格放宽至800米','ofat',{settings:{spacing:800}}),
 config('H01','表面上方0.5米架设','ofat',{settings:{installationHeightM:.5}}),
 config('H02','表面上方8米架设','ofat',{settings:{installationHeightM:8}}),
 config('A01','雷达仅水平俯仰候选','ofat',{settings:{radarPitchesDeg:[0]}}),
 config('A02','光电声学方位偏置90度','ofat',{settings:{headingOffsetDeg:90}}),
 config('E01','电磁底噪增加15分贝','ofat',{environment:{emNoiseDb:15}}),
 config('E02','交通噪声升至70分贝','ofat',{environment:{trafficDb:70}}),
 config('E03','能见度降至0.5公里','ofat',{environment:{visibilityKm:.5}}),
 config('T01','目标雷达截面积0.001平方米','ofat',{target:{rcs:.001}}),
 config('T02','目标尺寸0.2米','ofat',{target:{size:.2}}),
 config('T03','目标声源强度85分贝','ofat',{target:{sourceDb:85}}),
 config('T04','目标射频5.8GHz','ofat',{target:{frequencyGHz:5.8}}),
 config('D01','雷达改选02C','ofat',{presetIds:['radar-02c','radio-tdoa','optical-nvt','acoustic-cry']}),
 config('D02','无线电改选小型OA-X1Bmini','ofat',{presetIds:['radar-03d','radio-mini','optical-nvt','acoustic-cry']}),
 config('D03','仅使用03D雷达','selection',{presetIds:['radar-03d']}),
 config('D04','仅使用X1C无线电','selection',{presetIds:['radio-x1c']}),
 config('D05','仅使用光电与声学','selection',{presetIds:['optical-nvt','acoustic-cry']}),
 config('N01','无线电数量上限1台','ofat',{settings:{typeLimits:{radar:12,radio:1,optical:12,acoustic:12}}}),
 config('N02','总设备上限8台','ofat',{settings:{maxDevices:8}}),
 config('N03','相对预算100单位','ofat',{settings:{budget:100}}),
 config('S01','范围扩展至4乘4公里','scope',{settings:{scopeWidthM:4000,scopeDepthM:4000}}),
 config('W01','核心区域需求权重增至6','ofat',{settings:{coreWeight:6}}),
 config('L01','低空目标高度10/20/40米','target-distribution',{settings:{heights:[10,20,40]},threatAglM:[15,20,30]}),
 config('X01','核心建筑禁部署','exclusion',{excludeCore:true}),
 config('C01','夜间雨雾高干扰小目标','combined',{environment:{rainMmH:45,visibilityKm:.5,illuminanceLux:.05,trafficDb:70,emNoiseDb:15},target:{rcs:.001,size:.2,sourceDb:85},settings:{installationHeightM:8,maxDevices:32,budget:500}}),
 config('C02','70目标多来向高速蜂群','combined',{threatOverride:{single:{azimuthsDeg:[125],speedMps:20},multi:{azimuthsDeg:[45,135,225,315],speedMps:20},swarm:{count:70,directions:7,azimuthsDeg:[0,50,100,150,200,250,300],aglM:[20,45,90],speedMps:20}}}),
];
export function resolveConfiguration(definition,coreIds=[]){
 const settings={...structuredClone(BASE_SETTINGS),...structuredClone(definition.settings??{})};
 if(definition.excludeCore)settings.buildingExclusions={sceneKey:'research',buildingIds:[...coreIds]};
 if(definition.threatAglM)for(const [index,key] of ['single','multi','swarm'].entries())settings.threatConfigs[key].aglM=key==='single'?[definition.threatAglM[0]]:[...definition.threatAglM];
 for(const [key,value] of Object.entries(definition.threatOverride??{}))Object.assign(settings.threatConfigs[key],value);
 const presetIds=definition.presetIds??['radar-03d','radio-tdoa','optical-nvt','acoustic-cry'];
 return {id:definition.id,label:definition.label,group:definition.group,settings,environment:{...DEFAULT_ENV,...definition.environment},target:{...DEFAULT_TARGET,...definition.target},weights:{...METRIC_WEIGHTS},presetIds:[...presetIds],equipmentSnapshot:{profiles:presetIds.map(defaultProfile)},planTypes:['economy','balanced','enhanced']};
}
export function parameterDictionary(){
 const module1=[
  {key:'mapId',label:'独立地图',values:MAPS.map(m=>m.id),source:'当前平台9张地图；几何不人为缩放或改写'},
  {key:'scopeWidthM/scopeDepthM',label:'部署范围宽/深',unit:'m',baseline:2400,studyValues:[2400,4000],source:'研究配置；保留地图裁切记录'},
  ...Object.entries(ENV_FIELDS).map(([key,spec])=>({key:`environment.${key}`,group:'环境工况',...spec})),
  ...Object.entries(TARGET_FIELDS).map(([key,spec])=>({key:`target.${key}`,group:'目标属性',...spec})),
  {key:'target.emitting',label:'无线电发射状态',values:[true,false],source:'每轮内置发射/静默对照；场景覆盖时 count 固定1，动态目标数另计'},
  {key:'target.opticalMode',label:'光电观测通道',values:['wide','narrow','thermal'],baseline:DEFAULT_TARGET.opticalMode,source:'模型观测模式；研究固定默认，变化则须重算'},
  {key:'target.acousticFrequencyHz',label:'目标声频',unit:'Hz',min:20,max:20000,baseline:DEFAULT_TARGET.acousticFrequencyHz,source:'模型假设；非厂家无人机谱实测'},
  {key:'geometry/terrain/buildings',label:'建筑与地形',source:'地图几何为锁定输入；记录数量、密度、高度分位、近邻间距、地形起伏与来源哈希'},
  {key:'render/camera/imagery',label:'模型显示、底图和视角',source:'仅影响显示，不作为探测性能参数；不参与规则回归'},
 ];
 const module2=CATALOG_MODELS.map(model=>({id:model.id,name:model.name,type:model.type,eligibleForDeployment:PRESETS.some(p=>p.id===model.id),fields:catalogFields(model.id),source:PRESETS.find(p=>p.id===model.id)?.source??'补充目录；未接入当前四类优化内核',note:PRESETS.find(p=>p.id===model.id)?.notes??'本轮不以缺失文档的目录参数替代原始装备依据'}));
 const module3={settings:structuredClone(BASE_SETTINGS),scoreWeights:METRIC_WEIGHTS,threatLimits:THREAT_CONFIG_LIMITS,controls:{spacing:{unit:'m',range:[150,1000]},heights:{unit:'m AGL',range:[10,500],layers:[1,5]},siteSpacing:{unit:'m',range:[300,1500]},maxSites:{range:[4,256]},maxDevices:{range:[1,64]},budget:{unit:'相对单位',range:[1,1000]},typeLimits:{range:[0,64],meaning:'上限，不强制凑足数量'},installationHeightM:{unit:'m above surface',range:[.5,20]},radarPitchesDeg:{unit:'deg',range:[-60,0],meaning:'机械指向候选，不改变厂家俯仰扫描跨度'},headingOffsetDeg:{unit:'deg',range:[-180,180],meaning:'光电与声学相对核心的方位偏置'},coreRadius:{unit:'m',range:[100,3000]},coreWeight:{range:[1,10]},marginReserveDb:{unit:'dB',range:[0,20]},costs:{unit:'相对单位',range:[0,100],source:'厂家未给价格；为优化代理'},buildingExclusions:{meaning:'连通建筑单元禁止落设备，仍保留遮挡与覆盖需求'},planTypes:{values:['economy','balanced','enhanced']},mobileRepair:{meaning:'独立派生计算；本轮主实验未启用，避免道路未知条件混入屋顶部署对照'},playbackSpeed:{meaning:'只改变演示快慢，不改变物理飞行速度'}}};
 return {schema:STUDY_SCHEMA,module1,module2,module3};
}
