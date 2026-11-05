import {PRESETS,TYPES} from './presets.js';

// Catalog entries describe equipment specifications. Only PRESETS defines simulation devices.
export const CATALOG_TYPES={...TYPES,fivega:'5G-A',electrostatic:'静电'};
const spec=(label,unit,value=null,extra={})=>({label,unit,value,min:0,max:1e9,step:'any',nullable:true,source:'未公开',placeholder:'',...extra});
const reported=(label,unit,value,extra={})=>spec(label,unit,value,{source:'部署报道',sourceId:'guangzhou-2024',...extra});
const published=(label,unit,value,extra={})=>spec(label,unit,value,{source:'厂商标称',sourceId:'crsc-er-1',...extra});

const additions=[{
 id:'fivega-zte-a9650-s49',type:'fivega',name:'A9650 S49 大张角通感设备',manufacturer:'中兴通讯',catalogOnly:true,
 evidenceLevel:'公开部署报道',
 summary:'通过自发自收通感一体设备同时提供通信与目标感知能力，面向低空飞行监测和安防业务。',
 features:['128 通道自发自收，一台设备完成通感信号发射与接收。','提供低空目标感知、航路监测及通信保障。','配合监管平台实现电子围栏监测、黑飞预警与管理联动。'],
 conditions:[
  '数值来自 2024 年广州九龙湖部署报道，覆盖距离与业务高度保留“以上”的原意；它们是报道门槛，不是最大量程。',
  '65°为总垂直覆盖波束张角，未公开俯仰上下限。10 Gbps+ 为小区峰值吞吐，不是单目标保证速率。',
  '该型号的工作频率、带宽、近距盲区、定位精度、并发目标数和更新周期未在所引型号报道中公开。其他机型或试点的数值不作为本型号默认值。',
  '黑飞判决、身份关联及反制联动需要网络、平台或其他设备协同；基站本体的通感能力与整套系统功能分别理解。',
 ],
 sources:[
  {id:'guangzhou-2024',title:'广州移动联合中兴通讯发布全球首个5G-A通感大张角地空通感一体覆盖网络',publisher:'C114 通信网',date:'2024-05-16',kind:'部署报道',url:'https://www.c114.com.cn/news/127/a1262771.html',scope:'明确列出 A9650 S49 型号及本目录采用的覆盖、通道和通信数值。'},
  {id:'zte-isac',title:'通感算智一体化解决方案',publisher:'中兴通讯官网',date:null,kind:'厂商方案',url:'https://www.zte.com.cn/china/solutions_latest/5g-advanced/synaesthesia.html',scope:'核对通感原理与方案功能；方案族的最新数值不直接作为 A9650 S49 的型号参数。'},
 ],
 fields:{
  'parameters.coverageDistance':reported('单站覆盖距离','m',1500,{qualifier:'以上',statement:'原文为 1.5 km 以上；1500 m 为报道门槛。'}),
  'parameters.minRange':spec('近距盲区','m'),
  'parameters.capacity':spec('并发目标数','个',null,{integer:true,step:1}),
  'parameters.updateSeconds':spec('更新周期','s'),
  'parameters.verticalBeamAngle':reported('垂直覆盖张角','°',65,{max:180,statement:'总垂直覆盖波束张角，不代表俯仰上下限。'}),
  'parameters.coverageHeight':reported('业务覆盖高度','m',600,{qualifier:'以上',statement:'原文为业务高度 600 m 以上。'}),
  'parameters.rangeAccuracy':spec('测距误差','m'),
  'parameters.bearingAccuracy':spec('测角误差','°',null,{max:180}),
  'parameters.channelCount':reported('收发通道数','通道',128,{integer:true,step:1,statement:'128 通道自发自收通感一体设备。'}),
  'parameters.frequencyGHz':spec('工作频率','GHz'),
  'parameters.bandwidthMHz':spec('工作带宽','MHz'),
  'parameters.uplinkStreams':reported('上行空间流','流',12,{integer:true,step:1}),
  'parameters.downlinkStreams':reported('下行空间流','流',32,{integer:true,step:1}),
  'parameters.cellPeakGbps':reported('小区峰值吞吐','Gbps',10,{qualifier:'+',statement:'原文为 10 Gbps+；属于小区峰值能力。'}),
 },
 groups:[
  ['基础参数',['coverageDistance','minRange','capacity','updateSeconds']],
  ['覆盖参数',['verticalBeamAngle','coverageHeight','rangeAccuracy','bearingAccuracy']],
  ['通感配置',['channelCount','frequencyGHz','bandwidthMHz']],
  ['通信性能',['uplinkStreams','downlinkStreams','cellPeakGbps']],
 ],
},{
 id:'electrostatic-crsc-er1',type:'electrostatic',name:'CRSC-ER-1 静电探测设备',manufacturer:'通号低空智能科技有限公司',catalogOnly:true,
 evidenceLevel:'厂商公开参数',
 summary:'以非接触方式采集目标表面静电信号，提供静电量化分析和异常预警，用于低空场景静电监测。',
 features:['非接触式采集目标表面静电信号。','单机集成静电探测、量化分析和异常预警功能。','面向低空作业区域、户外设备及特殊环境的静电风险监测。'],
 conditions:[
  '≥100 m 为厂商标称静电监测距离；产品页未披露测试目标电荷、目标尺寸和环境条件，不能作为任意无人机的检出保证，也不是最大量程 100 m。',
  '≤80 ms 为响应时间，更新周期和采样频率未公开，不能用响应时间反推更新率。',
  '≤50 mW 为静态功耗，整机工作功耗未公开。场强量程、灵敏度、测量精度和并发目标数同样待补充。',
  '厂商另有静电组网系统用于低空补盲的技术说明；多节点方向研判、区域定位及多源联动属于系统能力，本型号的单机定位精度和组网接口未公开。',
 ],
 sources:[
  {id:'crsc-er-1',title:'CRSC-ER-1 型静电探测设备',publisher:'通号低空官网',date:'2026-05-13',kind:'厂商产品页',url:'https://dk.crsc.cn/thdk/zyyw/znkjcp/wrj/2026/4/I1491750685232857088.html',scope:'型号、非接触探测功能、距离、响应时间、静态功耗和工作温度的原始依据。'},
  {id:'crsc-network',title:'捕捉静电“脚印”，让“黑飞”无处遁形！',publisher:'中国通号官网',date:'2026-09-23',kind:'厂商技术说明',url:'https://www.crsc.cn/news/tsi_2746_6255_101276.html',scope:'说明静电组网、目标事件记录、区域定位及与其他感知设备协同；未给出本型号的独立无人机实测指标。'},
  {id:'xiongan-2025',title:'静电探测技术护航低空飞行安全',publisher:'北京国际科技创新中心（来源：科技日报）',date:'2025-03-20',kind:'部署报道',url:'https://www.ncsti.gov.cn/kjdt/kjrd/qtrd_kjrd/202503/t20250320_198734.html',scope:'核实通号低空融合系统在雄安的部署及静电技术应用，不将系统接管时间作为本设备响应或更新参数。'},
 ],
 fields:{
  'parameters.detectionDistance':published('标称探测距离','m',100,{qualifier:'≥',statement:'厂商标称静电监测距离；目标与环境测试条件未公开。'}),
  'parameters.responseTimeMs':published('响应时间','ms',80,{qualifier:'≤',statement:'信号响应时间，不等于更新周期。'}),
  'parameters.capacity':spec('并发目标数','个',null,{integer:true,step:1}),
  'parameters.updateSeconds':spec('更新周期','s'),
  'parameters.minRange':spec('近距盲区','m'),
  'parameters.fieldMinVpm':spec('场强量程下限','V/m',null,{min:-1e9}),
  'parameters.fieldMaxVpm':spec('场强量程上限','V/m',null,{min:-1e9}),
  'parameters.sensitivityVpm':spec('场强灵敏度','V/m'),
  'parameters.fieldAccuracyVpm':spec('场强测量误差','V/m'),
  'parameters.samplingHz':spec('采样频率','Hz'),
  'parameters.stationCount':spec('组网节点数','个',null,{integer:true,step:1,min:1}),
  'parameters.nodeSpacingMeters':spec('节点间距','m'),
  'parameters.staticPowerMw':published('静态功耗','mW',50,{qualifier:'≤',statement:'静态功耗，不代表整机工作功耗。'}),
  'parameters.operatingPowerW':spec('整机工作功耗','W'),
  'parameters.temperatureMin':published('工作温度下限','℃',-25,{min:-273.15,max:1000}),
  'parameters.temperatureMax':published('工作温度上限','℃',60,{min:-273.15,max:1000}),
 },
 groups:[
  ['基础参数',['detectionDistance','responseTimeMs','capacity','updateSeconds']],
  ['电场参数',['minRange','fieldMinVpm','fieldMaxVpm','sensitivityVpm','fieldAccuracyVpm','samplingHz']],
  ['组网配置',['stationCount','nodeSpacingMeters']],
  ['环境功耗',['staticPowerMw','operatingPowerW','temperatureMin','temperatureMax']],
 ],
}];

export const CATALOG_MODELS=[...PRESETS,...additions];
export function catalogModel(presetId){
 const model=CATALOG_MODELS.find(p=>p.id===presetId);if(!model)throw Error('装备型号无效');return model;
}
