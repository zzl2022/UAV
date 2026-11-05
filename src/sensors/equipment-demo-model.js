import {validateProfile} from './equipment-catalog.js';
import {createDevice} from './presets.js';
import {catalogModel} from './equipment-models.js';
import {angles,angularDifference,evaluate,powerSumDb,knifeEdgeLoss,twoRayLoss} from './engine.js';

const metric=(id,label,unit,min,max,floor)=>({id,label,unit,min,max,floor});
export const DEMO_METRICS={
 radar:[metric('margin','探测裕量','dB',-20,40,0),metric('snr','处理后信噪比','dB',-10,60,0),metric('pd','模型检出概率','',0,1,.1)],
 radio:[metric('margin','探测裕量','dB',-20,40,0),metric('snr','处理后信噪比','dB',-10,60,0),metric('pd','模型检出概率','',0,1,.1)],
 optical:[metric('pixels','目标成像像素','px',0,100,1),metric('visibility','视线可达','',0,1,.5),metric('transmission','大气透射系数','',0,1,.05)],
 acoustic:[metric('margin','信噪比裕量','dB',-20,40,0),metric('snr','接收信噪比','dB',-20,60,0),metric('level','接收声压级','dB SPL',0,120,0)],
 fivega:[metric('visibility','视线可达','',0,1,.5),metric('distance','距设备距离','m',0,1500,0)],
 electrostatic:[metric('distance','距设备距离','m',0,100,0),metric('relative','归一化距离','',0,1,0)],
};
export function demoDefaults(profile){
 const p=profile.parameters,w=profile.working,type=profile.type;
 const radius={radar:1500,radio:1000,optical:400,acoustic:500,fivega:1500,electrostatic:100}[type];
 const horizontal=type==='optical'?(w.channel==='thermal'?p.thermalHfov:p.wideHfov):type==='fivega'?120:p.azimuthFov;
 return {radius,ceiling:800,heightDefaultVersion:1,spacing:['electrostatic','optical'].includes(type)?25:type==='acoustic'?50:100,
  heading:0,pitch:type==='optical'||type==='fivega'?10:0,mountHeight:30,horizontal:horizontal??60,
  vertical:type==='fivega'?(p.verticalBeamAngle??65):40,metric:type==='fivega'?'distance':DEMO_METRICS[type][0].id,style:'volume',density:2,clip:1,autoscale:true,nominal:false,reflections:false};
}
export function prepareDemo(profile,settings,position){
 profile=validateProfile(profile);settings={...demoDefaults(profile),...settings};
 for(const [key,min,max] of [['radius',25,5000],['ceiling',25,3000],['heading',0,360],['pitch',-90,90],['horizontal',.1,360],['vertical',.1,179],['mountHeight',1,500]]){
  if(!Number.isFinite(settings[key])||settings[key]<min||settings[key]>max)throw Error('请检查演示范围与朝向');
 }
 if(![25,50,100].includes(settings.spacing)||!['volume','surface'].includes(settings.style))throw Error('演示采样或渲染方式无效');
 if(profile.type==='optical'&&settings.horizontal>=180)throw Error('光电视场必须小于 180°');
 if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('请选择有效的演示点位');
 const type=profile.type,selected=DEMO_METRICS[type].find(m=>m.id===settings.metric);if(!selected)throw Error('演示物理量无效');
 let device=null;
 if(['radar','radio'].includes(type)){
  device=createDevice(catalogModel(profile.presetId).basePresetId??profile.presetId,'equipment-demo',position);device.name=profile.name;Object.assign(device.parameters,profile.parameters,{heading:settings.heading,pitch:settings.pitch});device.physics={...profile.physics};
  if(!settings.reflections)device.parameters.reflection=0;
 }
 return {profile,settings,position:[...position],type,metric:{...selected,max:selected.id==='distance'?settings.radius:selected.max},device,
  kind:['optical','fivega'].includes(type)?'几何示意':type==='electrostatic'?'距离示意':'模型演示'};
}
export function demoShape(spec){
 const {profile,settings:s,type}=spec,p=profile.parameters;
 const horizontal=['optical','fivega'].includes(type)?s.horizontal:['acoustic','electrostatic'].includes(type)?360:p.azimuthFov;
 let low=-90,high=90;
 if(type==='optical'){
  const w=profile.working,thermal=w.channel==='thermal',width=thermal?p.thermalWidth:p.imageWidth,height=thermal?p.thermalHeight:p.imageHeight;
  const vertical=2*Math.atan(Math.tan(s.horizontal*Math.PI/360)*height/width)*180/Math.PI;low=-vertical/2;high=vertical/2;
 }else if(type==='fivega'){low=-s.vertical/2;high=s.vertical/2;}
 else if(['radar','radio'].includes(type)){low=p.elevationMin;high=p.elevationMax;}
 return {horizontal,low,high};
}
export function demoValue(spec,position,scenario,context){
 const {profile,settings:s,type}=spec,p=profile.parameters,a=angles(spec.position,position),d=Math.max(1,a.distance),shape=demoShape(spec),e=a.elevation-s.pitch;
 if(a.distance>s.radius||a.distance<(p.minRange??0))return {mask:2};
 if(Math.abs(angularDifference(a.azimuth,s.heading))>shape.horizontal/2+1e-8||e<shape.low||e>shape.high)return {mask:2};
 if(context.known!==true)return {mask:0};
 if(spec.device){
  const r=evaluate(spec.device,{...scenario.target,position},scenario.environment,context);
  if(r.reasons.some(reason=>!['信噪比低于模型阈值','FHSS observation window insufficient'].includes(reason)))return {mask:2};
  const value=s.metric==='pd'?r.extras.signalPd:s.metric==='snr'?r.snrDb:r.marginDb;
  return Number.isFinite(value)?{mask:1,value}:{mask:0};
 }
 if(['optical','fivega'].includes(type)&&context.blocked)return {mask:2};
 if(type==='optical'){
  if(p.maxRange!=null&&a.distance>p.maxRange)return {mask:2};
  const env=scenario.environment,transmission=Math.exp(-3.912*d/(env.visibilityKm*1000))*10**(-p.rainDbKm*env.rainMmH*d/1000/20);
  const pixels=(profile.working.channel==='thermal'?p.thermalWidth:p.imageWidth)*(scenario.target.capability?.width_m??scenario.target.size)/(2*d*Math.tan(s.horizontal*Math.PI/360));
  return {mask:1,value:s.metric==='visibility'?1:s.metric==='transmission'?transmission:pixels};
 }
 if(type==='acoustic'){
  if(a.distance>p.maxRange||scenario.target.count>p.capacity)return {mask:2};
  const t=scenario.target,env=scenario.environment,speed=331.3+.606*env.temperatureC+env.windSpeed;
  let loss=20*Math.log10(d)+p.absorptionDbKm*d/1000+(context.buildingCount??0)*p.wallLossDb+env.refractionDb;
  if(context.blocked)loss+=knifeEdgeLoss(Math.max(0,context.clearance??0),context.obstacleDistance??d/2,Math.max(1,d-(context.obstacleDistance??d/2)),t.acousticFrequencyHz,speed);
  if(s.reflections&&Number.isFinite(context.sensorGround)&&Number.isFinite(context.targetGround)){
   loss+=twoRayLoss(a.horizontal,Math.max(.1,spec.position[1]-context.sensorGround),Math.max(.1,position[1]-context.targetGround),t.acousticFrequencyHz,p.reflection,speed);
   if(context.facadePaths?.length){const path=context.facadePaths[0];loss+=-10*Math.log10(1+p.reflection**2*(d/path.distance)**2);}
  }
  const level=t.sourceDb-loss,noise=powerSumDb([p.referenceNoiseDb,env.trafficDb,env.constructionDb,env.crowdDb,env.windNoiseDb,env.rainNoiseDb]);
  if(level<p.minSoundDb||level>p.maxSoundDb)return {mask:2};
  return {mask:1,value:s.metric==='level'?level:s.metric==='snr'?level-noise:level-noise-p.thresholdDb};
 }
 return {mask:1,value:s.metric==='visibility'?1:s.metric==='relative'?a.distance/s.radius:a.distance};
}
export async function sampleDemo({spec,grid,scenario,query,cancelled=()=>false,onProgress=()=>{}}){
 const [nx,ny,nz]=grid.dimensions,values=new Float32Array(grid.total*4),counts={signal:0,hard:0,unknown:0,inside:0,outside:0};
 let deadline=performance.now()+12,done=0;
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const px=grid.origin[0]+x*grid.step[0],pz=grid.origin[2]+z*grid.step[2],ground=query.groundAt(px,pz),surface=ground===null?null:query.surfaceAt(px,pz);
  for(let y=0;y<ny;y++){
   if(cancelled())return null;
   const py=grid.origin[1]+y*grid.step[1],point=[px,py,pz],i=x+nx*(y+ny*z);let r;
   if(ground===null)r={mask:0};else if(py-ground>spec.settings.ceiling)r={mask:4};else if(py<=Math.max(ground,surface??ground)+.1)r={mask:3};
   else{
    // Cheap geometric rejection avoids tracing rays outside the demonstration.
    r=demoValue(spec,point,scenario,{known:false});
    if(r.mask!==2)r=demoValue(spec,point,scenario,spec.type==='electrostatic'?{known:true,blocked:false}:query.trace(spec.position,point));
   }
   if(r.mask===1&&!Number.isFinite(r.value))r={mask:0};
   values[i*4+3]=r.mask;if(r.mask===1){values[i*4]=r.value;counts.signal++;}
   else if(r.mask===2)counts.hard++;else if(r.mask===3)counts.inside++;else if(r.mask===4)counts.outside++;else counts.unknown++;
   done++;if(performance.now()>deadline){onProgress(done,grid.total);await new Promise(resolve=>setTimeout(resolve,0));deadline=performance.now()+12;}
  }
 }
 return {grid,values,counts};
}

// Point queries share the same masks and metric calculations as the displayed field.
export function probeDemo(spec,position,scenario,query){
 const ground=query.groundAt(position[0],position[2]),surface=ground==null?null:query.surfaceAt(position[0],position[2]);
 const geometry=angles(spec.position,position);let mask;
 if(ground==null)mask=0;
 else if(position[1]-ground>spec.settings.ceiling)mask=4;
 else if(position[1]<=Math.max(ground,surface??ground)+.1)mask=3;
 const metrics=[];
 if(mask===undefined){
  const context=spec.type==='electrostatic'?{known:true,blocked:false}:query.trace(spec.position,position);
  for(const metric of DEMO_METRICS[spec.type]){
   const result=demoValue({...spec,settings:{...spec.settings,metric:metric.id}},position,scenario,context);
   metrics.push({id:metric.id,label:metric.label,unit:metric.unit,value:result.mask===1&&Number.isFinite(result.value)?result.value:null});
   if(metric.id===spec.settings.metric)mask=result.mask;
  }
 }
 return {position:[...position],distance:geometry.distance,azimuth:geometry.azimuth,elevation:geometry.elevation,heightAboveGround:ground==null?null:position[1]-ground,mask,metrics};
}
