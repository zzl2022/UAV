import {PRESETS,fieldsFor,ENV_FIELDS,TARGET_FIELDS} from './presets.js';
export const MODEL_VERSION='sensors-1.0';
const DEG=Math.PI/180;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const log=x=>Math.log10(Math.max(x,1e-12));
export function powerSumDb(levels){const max=Math.max(...levels);return max+10*log(levels.reduce((sum,x)=>sum+10**((x-max)/10),0));}
export function validateNumber(value,field,name){if(typeof value!=='number'||!Number.isFinite(value)||value<field.min||value>field.max)throw Error(`${name} 必须在 ${field.min}–${field.max} ${field.unit} 范围内`);}
function validateFields(values,fields){for(const [key,field] of Object.entries(fields)){validateNumber(values?.[key],field,field.label);if(['capacity','imageWidth','imageHeight','thermalWidth','thermalHeight','rfStations','count'].includes(key)&&!Number.isInteger(values[key]))throw Error(`${field.label} 必须为整数`);}}
export function validatePosition(p){if(!Array.isArray(p)||p.length!==3||p.some((x,i)=>typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>(i===1?20000:30000)))throw Error('位置需要米制 [东, 上, -北]，水平范围 ±30 km，高度 ±20 km');}
export function validateDevice(device){
 const preset=PRESETS.find(p=>p.id===device?.presetId);
 if(!preset||device.type!==preset.type)throw Error('装备类型或预设无效');
 if(typeof device.name!=='string'||!device.name.length||device.name.length>120)throw Error('装备名称无效');
 if(typeof device.id!=='string'||!device.id.length||device.id.length>64)throw Error('装备 ID 无效');
 validateFields(device.parameters,fieldsFor(device.type));validatePosition(device.position);
 const p=device.parameters;
 if(p.minRange>=p.maxRange||p.elevationMin>=p.elevationMax)throw Error('距离上下限或俯仰上下限顺序无效');
 if(device.type==='radio'&&p.bandMinGHz>=p.bandMaxGHz)throw Error('无线电频段上下限顺序无效');
 if(device.type==='acoustic'&&p.minSoundDb>=p.maxSoundDb)throw Error('输入声压上下限顺序无效');
 if(device.type==='optical'&&p.narrowHfov>p.wideHfov)throw Error('窄视场不能大于宽视场');
}
export function validateTarget(target){validatePosition(target?.position);validateFields(target,TARGET_FIELDS);if(typeof target.emitting!=='boolean'||!['wide','narrow','thermal'].includes(target.opticalMode))throw Error('目标发射状态或光电模式无效');validateNumber(target.acousticFrequencyHz,{min:20,max:20000,unit:'Hz'},'目标声频');}
export function validateEnvironment(env){validateFields(env,ENV_FIELDS);}
export function angles(from,to){const [x,y,z]=to.map((v,i)=>v-from[i]);return {distance:Math.hypot(x,y,z),horizontal:Math.hypot(x,z),azimuth:(Math.atan2(x,-z)/DEG+360)%360,elevation:Math.atan2(y,Math.hypot(x,z))/DEG};}
export function angularDifference(a,b){return ((a-b+540)%360)-180;}
export function opticalFov(p,mode){const horizontal=mode==='wide'?p.wideHfov:mode==='narrow'?p.narrowHfov:p.thermalHfov;const width=mode==='thermal'?p.thermalWidth:p.imageWidth;const height=mode==='thermal'?p.thermalHeight:p.imageHeight;return {horizontal,vertical:2*Math.atan(Math.tan(horizontal*DEG/2)*height/width)/DEG,width};}
export function knifeEdgeLoss(clearance,d1,d2,frequencyHz,speed=299792458){
 const wavelength=speed/frequencyHz;
 const v=clearance*Math.sqrt(2*(d1+d2)/(wavelength*Math.max(1,d1)*Math.max(1,d2)));
 return v<=-0.78?0:6.9+20*log(Math.sqrt((v-0.1)**2+1)+v-0.1);
}
// A coherent ground two-ray proxy, not a traced multi-bounce solver. The result is bounded ±30 dB.
export function twoRayLoss(horizontal,sensorHeight,targetHeight,frequencyHz,reflection,speed=299792458,roundTrip=false){
 const direct=Math.hypot(horizontal,targetHeight-sensorHeight),reflected=Math.hypot(horizontal,targetHeight+sensorHeight);
 const phase=2*Math.PI*(reflected-direct)*frequencyHz/speed*(roundTrip?2:1);
 const ratio=reflection*direct/Math.max(1,reflected);
 const power=1+ratio*ratio-2*ratio*Math.cos(phase);
 return clamp(-10*log(power),-30,30);
}
function sceneMultipath(device,target,env,context,direction,frequencyHz,speed,roundTrip){
 const p=device.parameters;
 if(!Number.isFinite(context.sensorGround)||!Number.isFinite(context.targetGround))return 0;
 return twoRayLoss(direction.horizontal,Math.max(0.1,device.position[1]-context.sensorGround),Math.max(0.1,target.position[1]-context.targetGround),frequencyHz,p.reflection,speed,roundTrip);
}
export function evaluate(device,target,environment,context={}){
 validateDevice(device);validateTarget(target);validateEnvironment(environment);
 const p=device.parameters,e=environment,t=target,direction=angles(device.position,t.position),d=Math.max(1,direction.distance),km=d/1000;
 const fov=device.type==='optical'?opticalFov(p,t.opticalMode):null;
 const h=fov?.horizontal??p.azimuthFov;
 const elevation=direction.elevation-p.pitch;
 const reasons=[],warnings=[];
 if(direction.distance<p.minRange)reasons.push('近距盲区');
 if(direction.distance>p.maxRange)reasons.push('超出标称距离');
 if(Math.abs(angularDifference(direction.azimuth,p.heading))>h/2+1e-9)reasons.push('超出方位视场');
 if(fov?Math.abs(elevation)>fov.vertical/2+1e-9:elevation<p.elevationMin-1e-9||elevation>p.elevationMax+1e-9)reasons.push('超出俯仰视场');
 if(t.count>p.capacity)reasons.push('超出模型并发容量');
 const buildingCount=context.buildingCount??0,blocked=context.blocked??false;
 const losses={};let marginDb=0,snrDb=null,rangeExponent=20,effectiveRange=p.maxRange,errors={},extras={};
 if(context.known!==true)warnings.push('路径存在 DEM 覆盖空缺或超出建模范围，遮挡结论不完整');
 if(!Number.isFinite(context.sensorGround)||!Number.isFinite(context.targetGround))warnings.push('缺少端点地面高程，未计算地面双径');
 const diffraction=(frequency,speed=299792458)=>blocked?knifeEdgeLoss(Math.max(0,context.clearance??0),context.obstacleDistance??d/2,Math.max(1,d-(context.obstacleDistance??d/2)),frequency,speed):0;
 if(device.type==='radar'){
  rangeExponent=40;
  if(blocked)reasons.push('建筑或地形阻断雷达直达路径');
  losses.rain=2*km*p.rainCoefficient*e.rainMmH**p.rainExponent;
  losses.cloudFog=2*km*e.cloudDbKm;
  losses.multipath=sceneMultipath(device,t,e,context,direction,p.frequencyGHz*1e9,299792458,true);
  losses.clutter=p.clutterDb;losses.noise=e.emNoiseDb;losses.cochannel=e.cochannelDb;losses.crosstalk=e.crosstalkDb;
  const total=Object.values(losses).reduce((a,b)=>a+b,0);
  marginDb=40*log(p.maxRange/d)+10*log(t.rcs/p.referenceRcs)-total+p.referenceSnrDb-p.thresholdDb;snrDb=p.thresholdDb+marginDb;
  effectiveRange=p.maxRange*(t.rcs/p.referenceRcs)**0.25*10**((p.referenceSnrDb-p.thresholdDb-total)/40);
  const degradation=10**(clamp(-marginDb,0,40)/20);
  errors={rangeMeters:p.rangeAccuracy*degradation,azimuthDegrees:p.azimuthAccuracy*degradation,elevationDegrees:p.elevationAccuracy*degradation};
  extras.ghostRiskIndex=clamp((Math.abs(losses.multipath)+p.clutterDb+e.cochannelDb)/40,0,1);
  if(Number.isFinite(context.sensorGround)&&Number.isFinite(context.targetGround)&&p.reflection>0){
   const reflected=Math.hypot(direction.horizontal,Math.max(0.1,device.position[1]-context.sensorGround)+Math.max(0.1,t.position[1]-context.targetGround));
   const apparentRange=(d+reflected)/2;
   extras.ghostCandidate={apparentRangeMeters:apparentRange,rangeBiasMeters:apparentRange-d,relativePowerDb:20*log(p.reflection*d/Math.max(1,reflected)),resolvable:apparentRange-d>p.rangeAccuracy};
  }
  extras.ghostNote='双径/杂波虚警风险指标，非虚假目标概率或已定位的虚假目标';
 }else if(device.type==='optical'){
  if(blocked)reasons.push('实体遮挡造成视野截断');
  const extinction=3.912/e.visibilityKm*km;
  losses.visibility=20*extinction/Math.LN10;
  losses.rain=p.rainDbKm*e.rainMmH*km;
  const light=t.opticalMode==='thermal'?t.thermalContrast:Math.min(1,e.illuminanceLux/p.minLux);
  if(t.opticalMode!=='thermal'&&e.illuminanceLux<p.minLux)reasons.push('低于可见光最低照度');
  const pixels=fov.width*t.size/(2*d*Math.tan(fov.horizontal*DEG/2));
  const contrast=light*10**(-(losses.visibility+losses.rain)/20);
  extras={mode:t.opticalMode,angularPixels:pixels,effectivePixels:pixels*contrast,horizontalFov:fov.horizontal,verticalFov:fov.vertical,contrastFactor:contrast};
  marginDb=20*log(extras.effectivePixels/p.requiredPixels);
  effectiveRange=Math.min(p.maxRange,d*10**(marginDb/20));
  errors={angularPixelDegrees:fov.horizontal/fov.width};
 }else if(device.type==='radio'){
  rangeExponent=10*p.pathExponent;
  if(!t.emitting)reasons.push('目标无线电静默');
  const band=t.frequencyGHz>=p.bandMinGHz&&t.frequencyGHz<=p.bandMaxGHz;
  const channel=device.presetId!=='radio-x1c'||[0.9,1.2,2.4,5.2,5.8].some(f=>Math.abs(f-t.frequencyGHz)*1000<=p.bandToleranceMHz+1e-9);
  if(!band||!channel)reasons.push('目标信号不在接收频段');
  losses.penetration=buildingCount*p.wallLossDb;losses.diffraction=diffraction(t.frequencyGHz*1e9);
  losses.multipath=sceneMultipath(device,t,e,context,direction,t.frequencyGHz*1e9,299792458,false);
  losses.noise=e.emNoiseDb;losses.cochannel=e.cochannelDb;losses.crosstalk=e.crosstalkDb;
  const total=Object.values(losses).reduce((a,b)=>a+b,0);
  marginDb=rangeExponent*log(p.maxRange/d)+t.eirpDbm-p.referenceEirpDbm-total+p.referenceSnrDb-p.thresholdDb;snrDb=p.thresholdDb+marginDb;
  effectiveRange=p.maxRange*10**((t.eirpDbm-p.referenceEirpDbm-total+p.referenceSnrDb-p.thresholdDb)/rangeExponent);
  const degradation=10**(clamp(-marginDb,0,40)/20),risk=clamp(Math.abs(losses.multipath)/20+buildingCount*0.1,0,1);
  extras.multipathDopplerSpreadHz=t.frequencyGHz*1e9*t.speed/299792458*risk;
  errors={azimuthDegrees:p.bearingAccuracy*degradation,multipathBiasDegrees:risk*p.bearingAccuracy*2,networkLocalizationMeters:e.rfStations>=4?p.networkAccuracy*e.gdop*degradation*(1+risk):null};
  if(e.rfStations<4)warnings.push('少于 4 站，不输出三维 TDOA 网络定位误差；单站仍可进行频谱感知');
  else warnings.push('TDOA 误差是给定站数/GDOP 的参考估计，未求解真实站网与时差');
 }else{
  const soundSpeed=331.3+0.606*e.temperatureC+e.windSpeed;
  const noise=powerSumDb([p.referenceNoiseDb,e.trafficDb,e.constructionDb,e.crowdDb,e.windNoiseDb,e.rainNoiseDb]);
  losses.spreading=20*log(d);losses.air=p.absorptionDbKm*km;losses.penetration=buildingCount*p.wallLossDb;
  losses.diffraction=diffraction(t.acousticFrequencyHz,soundSpeed);
  losses.multipath=sceneMultipath(device,t,e,context,direction,t.acousticFrequencyHz,soundSpeed,false);losses.refraction=e.refractionDb;
  const total=Object.values(losses).reduce((a,b)=>a+b,0);
  const received=t.sourceDb-total;
  if(received<p.minSoundDb)reasons.push('低于设备输入声压下限');
  if(received>p.maxSoundDb)reasons.push('超过设备输入声压上限');
  if(received-noise>p.dynamicRangeDb)warnings.push('声压差超过给定动态范围，需要接收增益/动态范围实测校核');
  snrDb=received-noise;marginDb=snrDb-p.thresholdDb;
  effectiveRange=d*10**(marginDb/20);
  const degradation=10**(clamp(-marginDb,0,40)/20),reflectionRisk=clamp((Math.abs(losses.multipath)+losses.diffraction)/40,0,1);
  errors={azimuthDegrees:p.bearingAccuracy*degradation*(1+reflectionRisk),elevationDegrees:p.elevationAccuracy*degradation*(1+reflectionRisk),multipathBiasDegrees:reflectionRisk*p.bearingAccuracy*2};
  extras={receivedSoundDb:received,noiseDb:noise,soundSpeed,propagationSeconds:d/soundSpeed,temporalDriftMeters:t.speed*(p.updateSeconds+d/soundSpeed),mixingRiskIndex:reflectionRisk};
 }
 if(marginDb<0)reasons.push(device.type==='optical'?'有效像素/对比不足':'信噪比低于模型阈值');
 if(blocked&&(device.type==='radar'||device.type==='optical'))effectiveRange=0;
 if(device.type==='radio'&&(!t.emitting||reasons.includes('目标信号不在接收频段'))){effectiveRange=0;snrDb=null;marginDb=null;}
 const eligible=reasons.length===0;
 const score=eligible?clamp(0.5+marginDb/40,0,1):0;
 return {modelVersion:MODEL_VERSION,id:device.id,type:device.type,name:device.name,eligible,status:!eligible?'outside-model':context.known!==true?'uncertain':'within-model',reasons,warnings,geometry:{...direction,blocked,buildingCount,known:context.known??false},marginDb,snrDb,losses,equivalentRangeMeters:clamp(effectiveRange,0,p.maxRange),score,scoreMeaning:'未标定的模型裕量评分，不是探测/识别概率',errors,extras};
}
export function validateScenario(value,origin){
 if(!value||value.modelVersion!==MODEL_VERSION||!Array.isArray(value.devices)||value.devices.length>16)throw Error('需要当前版本的装备方案，含 0–16 个设备');
 if(!Array.isArray(value.origin)||value.origin.length!==3||value.origin.some((x,i)=>!Number.isFinite(x)||Math.abs(x-origin[i])>1e-7))throw Error('方案坐标原点与当前城市不一致');
 const ids=new Set();for(const device of value.devices){validateDevice(device);if(ids.has(device.id))throw Error('装备 ID 重复');ids.add(device.id);}
 validateTarget(value.target);validateEnvironment(value.environment);
 return structuredClone({modelVersion:MODEL_VERSION,origin:value.origin,devices:value.devices,target:value.target,environment:value.environment});
}
