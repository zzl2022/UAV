import {physicsDefaults} from './physics.js';
// Equipment values transcribed from 创意二文件/创意二数据集/装备参数.doc.
// All fields absent from that document remain explicitly marked modeling assumptions.
export const EQUIPMENT_SOURCE='创意二文件/创意二数据集/装备参数.doc';
export const TYPES={radar:'雷达',optical:'光电',radio:'无线电',acoustic:'声学'};
const f=(label,unit,min,max,step,value,source='假设')=>({label,unit,min,max,step,value,source});
export const COMMON_FIELDS={
 maxRange:f('标称距离上限','m',1,30000,10,8000),minRange:f('近距盲区','m',0,30000,1,50),
 heading:f('方位指向（北为 0°）','°',0,360,1,0),pitch:f('俯仰指向','°',-90,90,1,0),
 azimuthFov:f('方位覆盖角','°',0.1,360,1,360),elevationMin:f('相对最低俯仰','°',-90,90,1,0),elevationMax:f('相对最高俯仰','°',-90,90,1,40),
 thresholdDb:f('判定所需信噪比','dB',-20,60,0.5,13),capacity:f('模型并发容量','个',1,10000,1,500),updateSeconds:f('更新周期','s',0.01,60,0.1,3),
};
export const TYPE_FIELDS={
 radar:{referenceSnrDb:f('标称距离参考信噪比','dB',-20,80,0.5,13),frequencyGHz:f('工作频率','GHz',0.1,100,0.1,10),referenceRcs:f('标称距离参考 RCS','m²',0.0001,100,0.001,0.01),rainCoefficient:f('雨衰系数 k','dB/km',0,1,0.001,0.01),rainExponent:f('雨衰指数 α','',0.1,3,0.1,1.2),reflection:f('地面反射幅度系数','',0,0.99,0.05,0.4),clutterDb:f('城市杂波附加损耗','dB',0,60,0.5,3),rangeAccuracy:f('参考距离误差','m',0.1,1000,0.1,8),azimuthAccuracy:f('参考方位误差','°',0.01,45,0.1,0.6),elevationAccuracy:f('参考俯仰误差','°',0.01,45,0.1,0.4)},
 optical:{wideHfov:f('宽视场水平角','°',0.1,170,0.1,60),narrowHfov:f('窄视场水平角','°',0.1,170,0.1,2),imageWidth:f('可见光图像宽度','px',16,16384,1,1920,'文档'),imageHeight:f('可见光图像高度','px',16,16384,1,1080,'文档'),thermalWidth:f('热成像图像宽度','px',16,16384,1,640,'文档'),thermalHeight:f('热成像图像高度','px',16,16384,1,512,'文档'),thermalHfov:f('热成像水平视场','°',0.1,170,0.1,9),minLux:f('可见光最低照度','lux',0.0001,1000,0.01,0.1),requiredPixels:f('识别所需有效像素','px',1,200,1,8),rainDbKm:f('降雨每 mm/h 附加消光','dB/km',0,10,0.01,0.03)},
 radio:{referenceSnrDb:f('标称距离参考信噪比','dB',-20,80,0.5,13),bandMinGHz:f('最低接收频率','GHz',0.001,100,0.001,0.1,'文档'),bandMaxGHz:f('最高接收频率','GHz',0.001,100,0.001,6,'文档'),pathExponent:f('参考路径损耗指数','',1,6,0.1,2.7),wallLossDb:f('每栋建筑穿透损耗','dB',0,100,1,15),referenceEirpDbm:f('标称距离参考发射 EIRP','dBm',-40,80,1,20),reflection:f('地面反射幅度系数','',0,0.99,0.05,0.4),networkAccuracy:f('参考 TDOA 网络定位误差','m',0.1,1000,1,20,'文档'),bandToleranceMHz:f('离散频点接收半带宽','MHz',0.01,500,0.1,20),bearingAccuracy:f('参考测向误差','°',0.01,45,0.1,2)},
 acoustic:{minSoundDb:f('最低输入声压','dB SPL',0,160,1,28,'文档'),maxSoundDb:f('最高输入声压','dB SPL',0,180,1,132,'文档'),dynamicRangeDb:f('动态范围','dB',1,100,1,40,'文档'),referenceNoiseDb:f('参考背景声压','dB SPL',0,140,1,35),absorptionDbKm:f('空气吸收','dB/km',0,100,0.1,3),wallLossDb:f('每栋建筑额外损耗','dB',0,100,1,6),reflection:f('地面反射幅度系数','',0,0.99,0.05,0.3),bearingAccuracy:f('参考方位误差','°',0.01,45,0.1,3),elevationAccuracy:f('参考俯仰误差','°',0.01,45,0.1,4)},
};
export const ENV_FIELDS={
 rainMmH:f('降雨强度','mm/h',0,200,1,0),visibilityKm:f('气象能见度','km',0.05,100,0.1,20),illuminanceLux:f('环境照度','lux',0,150000,1,500),
 emNoiseDb:f('电磁底噪抬升','dB',0,80,1,0),cloudDbKm:f('雷达云雾比衰减','dB/km',0,20,0.01,0),cochannelDb:f('同频干扰损耗','dB',0,80,1,0),crosstalkDb:f('设备串扰损耗','dB',0,80,1,0),
 trafficDb:f('交通噪声','dB SPL',0,140,1,35),constructionDb:f('施工噪声','dB SPL',0,140,1,20),crowdDb:f('人群噪声','dB SPL',0,140,1,25),windNoiseDb:f('风噪','dB SPL',0,140,1,20),rainNoiseDb:f('雨噪','dB SPL',0,140,1,20),
 windSpeed:f('风速（沿传播方向）','m/s',-40,40,0.5,0),temperatureC:f('空气温度','°C',-40,60,1,20),refractionDb:f('折射附加损耗','dB',0,40,0.5,0),
 rfStations:f('参与 TDOA 的站数','个',1,32,1,4),gdop:f('网络几何误差系数','',1,20,0.1,1),
};
export const TARGET_FIELDS={
 rcs:f('目标雷达截面积','m²',0.0001,100,0.001,0.01),size:f('目标可见尺寸','m',0.01,20,0.01,0.35),frequencyGHz:f('目标发射频率','GHz',0.001,100,0.001,2.4),eirpDbm:f('目标发射 EIRP','dBm',-40,80,1,20),sourceDb:f('目标声压 / 1 m','dB SPL',0,160,1,100),thermalContrast:f('热对比系数','',0,1,0.05,0.8),speed:f('目标速度','m/s',0,200,1,10),count:f('同时目标数','个',1,10000,1,1),
};
export const fieldsFor=type=>Object.fromEntries(Object.entries({...COMMON_FIELDS,...TYPE_FIELDS[type]}).filter(([key])=>type!=='optical'||!['thresholdDb','azimuthFov','elevationMin','elevationMax'].includes(key)));
const values=fields=>Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value]));
function preset(id,type,name,overrides,documentFields,notes){
 const fields=fieldsFor(type);
 const parameters={...values(fields),...overrides};
 const provenance=Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,documentFields.includes(key)?'文档':field.source]));
 return {id,type,name,parameters,provenance,notes,source:EQUIPMENT_SOURCE};
}
export const PRESETS=[
 preset('radar-02c','radar','02C 三坐标雷达',{frequencyGHz:9.4},['maxRange','azimuthFov','elevationMin','elevationMax','capacity','updateSeconds','rangeAccuracy','azimuthAccuracy','elevationAccuracy'],'文档距离 ≥8 km，模型保守取 8 km；新建设备接入 MATLAB 能量方程，脉冲盲区约 450 m，功率与收发参数为假设。'),
 preset('radar-03d','radar','03D 三坐标雷达',{frequencyGHz:15,elevationMax:60,updateSeconds:2,rangeAccuracy:6,azimuthAccuracy:0.3,elevationAccuracy:0.3},['maxRange','azimuthFov','elevationMin','elevationMax','capacity','updateSeconds','rangeAccuracy','azimuthAccuracy','elevationAccuracy'],'文档距离 ≥8 km；Ku 波段具体频率及噪声、雨衰参数需标定。'),
 preset('radio-tdoa','radio','TDOA-X1B',{maxRange:4000,minRange:0,elevationMin:-90,elevationMax:90,capacity:35,updateSeconds:1},['bandMinGHz','bandMaxGHz','networkAccuracy'],'文档城市半径 2–6 km，默认取中值 4 km；并发 >35，保守取 35。定位误差 <20 m 属于 TDOA 网络，单站不输出三维定位误差。'),
 preset('radio-mini','radio','OA-X1Bmini',{maxRange:1250,minRange:0,elevationMin:-90,elevationMax:90,capacity:30,updateSeconds:1},['bandMinGHz','bandMaxGHz','networkAccuracy'],'文档城市半径 0.5–2 km，默认取中值 1.25 km；并发 >30，保守取 30。'),
 preset('radio-x1c','radio','X1C 侦测设备',{maxRange:3500,minRange:0,elevationMin:-90,elevationMax:90,capacity:15,updateSeconds:1,bandMinGHz:0.9,bandMaxGHz:5.8,networkAccuracy:10},['networkAccuracy'],'文档城市半径 2–5 km，默认取中值 3.5 km。仅接收列出的 0.9/1.2/2.4/5.2/5.8 GHz，带宽容差为模型假设。'),
 preset('optical-nvt','optical','NVT-951 双光谱光电',{maxRange:2000,minRange:0,elevationMin:-90,elevationMax:90,thresholdDb:0,capacity:1,updateSeconds:0.1},['imageWidth','imageHeight','thermalWidth','thermalHeight'],'文档提供 1920×1080、640×512、48×光学变焦及 ≥35 cm 目标识别；未给最大识别距离、实际视场及最低照度，默认值均为假设。云台转动范围不等于瞬时视场。'),
 preset('acoustic-cry','acoustic','CRY8500 声学相机',{maxRange:500,minRange:0.01,azimuthFov:360,elevationMin:-90,elevationMax:90,thresholdDb:6,capacity:1,updateSeconds:0.2},['maxRange','minRange'],'文档距离区间 0.01–500 m、110 cm阵列频带20 Hz–20 kHz。仿真假设全向接收；94°×76°不作为声学波束边界。声源、传播系数及误差尺度采用可调整假设。'),
];
export const DEFAULT_ENV=values(ENV_FIELDS);
export const DEFAULT_TARGET={position:[0,150,-200],emitting:true,opticalMode:'wide',acousticFrequencyHz:2000,...values(TARGET_FIELDS)};
export function createDevice(presetId,id,position=[0,110,0]){
 const p=PRESETS.find(p=>p.id===presetId);if(!p)throw Error('未知装备预设');
 return {id,presetId,type:p.type,name:p.name,parameters:{...p.parameters},...(physicsDefaults(presetId,p.type)?{physics:physicsDefaults(presetId,p.type)}:{}),position:[...position]};
}
