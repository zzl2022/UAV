// 任务三 · 三类威胁场景鲁棒性验证：径向入侵航路生成 + 逐帧推演。
// 检出判定完全复用 sensors/engine.js 的 evaluate 与 scene.js 的 query.trace，不伪造检出；
// 帧结构、快判/实判两级模式与 AlarmTracker 用法沿用 planning/flight.js。
import {evaluate} from '../sensors/engine.js';
import {emcCheck} from '../planning/optimizer.js';
import {interpolateRoute,AlarmTracker} from '../planning/flight.js';
import {THREAT_SCENARIOS} from './constants.js';
const DEG=Math.PI/180,STEP=20,CLEARANCE=25;
const GEOMETRY_FAIL=['近距盲区','超出标称距离','超出方位视场','超出俯仰视场','目标无线电静默','目标信号不在接收频段'];

// 从 bounds 边缘沿方位角直线飞向 core 中心；方位角定义与 engine.angles 一致（北为 0°，顺时针）。
export function buildRadialRoute(query,bounds,{azimuthDeg,aglM,speedMps,id,lateralOffsetM=0,startDelayS=0}){
 const core=bounds.core,a=azimuthDeg*DEG,dx=Math.sin(a),dz=-Math.cos(a);
 let edge=Infinity;
 if(dx>1e-9)edge=Math.min(edge,(bounds.east-core[0])/dx);if(dx<-1e-9)edge=Math.min(edge,(bounds.west-core[0])/dx);
 if(dz>1e-9)edge=Math.min(edge,(bounds.north-core[2])/dz);if(dz<-1e-9)edge=Math.min(edge,(bounds.south-core[2])/dz);
 if(!Number.isFinite(edge)||edge<=0)throw Error('核心区不在 bounds 内，无法生成径向航路');
 const radius=edge+150,px=Math.cos(a),pz=Math.sin(a);
 const sx=core[0]+dx*radius+px*lateralOffsetM,sz=core[2]+dz*radius+pz*lateralOffsetM,ex=core[0],ez=core[2];
 const length2d=Math.hypot(ex-sx,ez-sz),n=Math.max(1,Math.ceil(length2d/STEP)),positions=[];let skipped=0;
 for(let i=0;i<=n;i++){
  const f=i/n,x=sx+(ex-sx)*f,z=sz+(ez-sz)*f,ground=query.groundAt(x,z);
  if(ground===null){skipped++;continue;}
  const surface=query.surfaceAt(x,z);
  positions.push([x,Math.max(ground+aglM,(surface??ground)+CLEARANCE),z]);
 }
 if(positions.length<2)throw Error(`径向航路 ${id} 全段无有效地形点（跳过 ${skipped} 点）`);
 const slopeEnvelope=()=>{
  for(let i=1;i<positions.length;i++){const d=Math.hypot(positions[i][0]-positions[i-1][0],positions[i][2]-positions[i-1][2]);positions[i][1]=Math.max(positions[i][1],positions[i-1][1]-d/3);}
  for(let i=positions.length-2;i>=0;i--){const d=Math.hypot(positions[i][0]-positions[i+1][0],positions[i][2]-positions[i+1][2]);positions[i][1]=Math.max(positions[i][1],positions[i+1][1]-d/3);}
 };
 let repairs=0;slopeEnvelope();
 for(let pass=0;pass<3;pass++){let changed=false;
  for(let i=1;i<positions.length;i++){const r=query.trace(positions[i-1],positions[i]);if(r.blocked){const lift=Math.max(5,r.clearance+CLEARANCE);positions[i-1][1]+=lift;positions[i][1]+=lift;changed=true;repairs++;}}
  if(!changed)break;slopeEnvelope();
 }
 let blockedSegments=0;for(let i=1;i<positions.length;i++)if(query.trace(positions[i-1],positions[i]).blocked)blockedSegments++;
 let length=0;const points=positions.map((position,i)=>{if(i)length+=Math.hypot(...position.map((v,k)=>v-positions[i-1][k]));return {position,time:startDelayS+length/speedMps};});
 return {id,azimuthDeg,points,duration:points.at(-1).time,speed:speedMps,startDelayS,length,skipped,repairs,blockedSegments,notes:'直线径向入侵航路；高程取 max(地面+agl, 表面+25)，坡度包络 ±1/3，建筑阻挡抬升；不是真实导航方案。'};
}

// 按 THREAT_SCENARIOS 生成三类威胁航路：single=8 方位各 1 架；multi=4 方位同时；swarm=3 方位 ×14 架横向铺开。
export function buildThreatRoutes(query,bounds,scenarioKey){
 const s=THREAT_SCENARIOS[scenarioKey];if(!s)throw Error(`未知威胁场景 ${scenarioKey}`);
 const routes=[],offsets=[0,30,-30,60,-60];
 for(let d=0;d<s.directions;d++)for(let k=0;k<s.dronesPerDirection;k++){
  const swarm=scenarioKey==='swarm';
  routes.push(buildRadialRoute(query,bounds,{azimuthDeg:d*(360/s.directions),aglM:s.aglM[(d+k)%s.aglM.length],speedMps:s.speedMps,id:`${scenarioKey}-${d+1}-${k+1}`,lateralOffsetM:swarm?offsets[k%offsets.length]:0,startDelayS:swarm?k*2:0}));
 }
 return routes;
}

// 逐帧推演：每帧对在场目标 × 设备先无遮挡快判、再 trace 实判；设备容量按 marginDb 降序截取，溢出如实记录。
export async function simulateThreat({query,devices,routes,target,environment,core,coreRadius=700,interval=2,simultaneous=false,progress=()=>{},yieldTask=async()=>{}}){
 const emc=emcCheck(devices),envs=devices.map(d=>({...environment,cochannelDb:environment.cochannelDb+(emc.penalties[d.id]??0)}));
 const cache=new Map(),frames=[],trackers=new Map(routes.map(r=>[r.id,new AlarmTracker()])),stats=new Map(routes.map(r=>[r.id,{active:0,detected:0,first:null}]));
 const jobs=[];
 if(simultaneous){const t0=Math.min(...routes.map(r=>r.points[0].time)),t1=Math.max(...routes.map(r=>r.duration));for(let t=t0;t<t1;t+=interval)jobs.push({time:t});jobs.push({time:t1});}
 else for(const route of routes){for(let t=route.points[0].time;t<route.duration;t+=interval)jobs.push({time:t,route});jobs.push({time:route.duration,route});}
 for(const [index,job] of jobs.entries()){
  const active=(job.route?[job.route]:routes).filter(r=>job.time>=r.points[0].time-1e-9&&job.time<=r.duration+1e-9);
  const pairs=[],targets=new Map();
  for(const route of active){
   const time=Math.min(route.duration,Math.max(route.points[0].time,job.time)),position=interpolateRoute(route,time);
   const pointIndex=Math.max(0,Math.min(route.points.length-1,Math.round((time-route.startDelayS)/Math.max(1e-9,route.duration-route.startDelayS)*(route.points.length-1))));
   const entry={id:route.id,routeId:route.id,azimuthDeg:route.azimuthDeg,position,insideCore:Math.hypot(position[0]-core[0],position[2]-core[2])<=coreRadius,detectedBy:[]};
   targets.set(route.id,entry);
   for(const [di,device] of devices.entries()){
    const t={...target,count:1,position},base=evaluate(device,t,envs[di],{known:true,blocked:false,buildingCount:0});
    const fail=base.reasons.some(r=>GEOMETRY_FAIL.includes(r));
    let context={known:true,blocked:false,buildingCount:0};
    if(!fail){const key=`${device.id}:${route.id}:${pointIndex}`;if(!cache.has(key))cache.set(key,query.trace(device.position,position));context=cache.get(key);}
    const result=fail?base:evaluate(device,t,envs[di],context);
    if(result.status==='within-model'&&result.eligible)pairs.push({device,di,targetId:route.id,marginDb:result.marginDb});
   }
  }
  const overflow=[];
  for(const [di,device] of devices.entries()){
   const list=pairs.filter(p=>p.di===di).sort((a,b)=>b.marginDb-a.marginDb);
   for(const [rank,p] of list.entries()){
    if(rank<device.parameters.capacity)targets.get(p.targetId).detectedBy.push({id:device.id,type:device.type,marginDb:p.marginDb});
    else overflow.push({deviceId:device.id,targetId:p.targetId,marginDb:p.marginDb});
   }
  }
  const frame={time:job.time,targets:[...targets.values()],overflow};frames.push(frame);
  for(const t of frame.targets){
   const st=stats.get(t.id);st.active++;if(t.detectedBy.length){st.detected++;if(st.first===null)st.first=job.time-routes.find(r=>r.id===t.id).startDelayS;}
   trackers.get(t.id).accept({time:job.time,detections:t.detectedBy,insideCore:t.insideCore});
  }
  if(index%12===0){progress({stage:'threats',completed:index,total:jobs.length});await yieldTask();}
 }
 const perTarget=routes.map(r=>{const st=stats.get(r.id);return {routeId:r.id,id:r.id,firstDetectionTime:st.first,detectedFraction:st.active?st.detected/st.active:0,lossEvents:trackers.get(r.id).events.filter(e=>e.kind==='lost').length};});
 const firsts=perTarget.map(p=>p.firstDetectionTime).filter(v=>v!==null),fractions=perTarget.map(p=>p.detectedFraction);
 const overflowed=new Set(frames.flatMap(f=>f.overflow.map(o=>o.targetId)));
 const summary={
  targetCount:routes.length,
  meanFirstDetectionTime:firsts.length?firsts.reduce((a,b)=>a+b,0)/firsts.length:null,
  meanDetectedFraction:fractions.reduce((a,b)=>a+b,0)/Math.max(1,fractions.length),
  minDetectedFraction:Math.min(...fractions),
  framesWithAllDetected:frames.filter(f=>f.targets.length&&f.targets.every(t=>t.detectedBy.length)).length,
  totalFrames:frames.length,
  overflowEvents:frames.reduce((s,f)=>s+f.overflow.length,0),
  overflowedTargets:overflowed.size,
 };
 return {routes,interval,frames,perTarget,summary,notes:'检出全部来自 sensors/engine.js 对 query.trace 实测几何的判定；设备并发容量按帧截取，溢出与漏探如实计数；首报时间以各目标起飞时刻为基准。'};
}

export function threatSummaryText(result){
 const s=result.summary,detected=result.perTarget.filter(p=>p.firstDetectionTime!==null).length;
 const mean=s.meanFirstDetectionTime===null?'—':`${s.meanFirstDetectionTime.toFixed(1)} s`;
 const base=`共推演 ${s.targetCount} 架入侵目标，${detected} 架被真实检出（平均首报 ${mean}，平均检出占比 ${(s.meanDetectedFraction*100).toFixed(1)}%，最低 ${(s.minDetectedFraction*100).toFixed(1)}%）`;
 return s.overflowEvents?base+`；设备容量溢出 ${s.overflowEvents} 架次，涉及 ${s.overflowedTargets} 架目标漏探。`:base+'；未发生容量溢出。';
}
