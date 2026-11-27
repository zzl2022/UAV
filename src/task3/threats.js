// 任务三 · 三类威胁场景鲁棒性验证：径向入侵航路生成 + 逐帧推演。
// 检出判定完全复用 sensors/engine.js 的 evaluate 与 scene.js 的 query.trace，不伪造检出；
// 帧结构、快判/实判两级模式与 AlarmTracker 用法沿用 planning/flight.js。
import {evaluate} from '../sensors/engine.js';
import {emcCheck} from '../planning/optimizer.js';
import {interpolateRoute,AlarmTracker} from '../planning/flight.js';
import {DEFAULT_THREAT_CONFIGS,THREAT_CONFIG_LIMITS} from './constants.js';
const DEG=Math.PI/180,STEP=20,CLEARANCE=25;
const GEOMETRY_FAIL=['近距盲区','超出标称距离','超出方位视场','超出俯仰视场','目标无线电静默','目标信号不在接收频段'];

// 径向与自定义折线共用坡度包络、建筑净空修复和三维距离计时，保证两类路线口径一致。
function finalizeRoute(query,positions,speedMps,startDelayS){
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
 return {points,duration:points.at(-1).time,length,repairs,blockedSegments};
}

const LAUNCH_BUFFER_M=1000;
function distanceToBounds(x,z,bounds){
 return Math.hypot(Math.max(bounds.west-x,0,x-bounds.east),Math.max(bounds.south-z,0,z-bounds.north));
}
function rayExit(core,dx,dz,bounds){
 let edge=Infinity;
 if(dx>1e-9)edge=Math.min(edge,(bounds.east-core[0])/dx);if(dx<-1e-9)edge=Math.min(edge,(bounds.west-core[0])/dx);
 if(dz>1e-9)edge=Math.min(edge,(bounds.north-core[2])/dz);if(dz<-1e-9)edge=Math.min(edge,(bounds.south-core[2])/dz);
 return edge;
}
// 来向角为核心指向起点的方位角（北 0°，顺时针）；自动航线穿过核心至起点的对称位置。
export function buildRadialRoute(query,bounds,{azimuthDeg,aglM,speedMps,id,startDelayS=0}){
 const core=bounds.core,a=azimuthDeg*DEG,dx=Math.sin(a),dz=-Math.cos(a);
 const edge=rayExit(core,dx,dz,bounds);
 if(!Number.isFinite(edge)||edge<=0)throw Error('核心区不在 bounds 内，无法生成径向航路');
 // 按到矩形范围的最短水平距离求 1 km 外扩，斜向和非正方形范围也采用同一口径。
 const cornerRadius=Math.hypot(Math.max(Math.abs(bounds.west-core[0]),Math.abs(bounds.east-core[0])),Math.max(Math.abs(bounds.south-core[2]),Math.abs(bounds.north-core[2])));
 let low=edge,high=cornerRadius+LAUNCH_BUFFER_M;
 for(let i=0;i<60;i++){const middle=(low+high)/2;if(distanceToBounds(core[0]+dx*middle,core[2]+dz*middle,bounds)<LAUNCH_BUFFER_M)low=middle;else high=middle;}
 const requestedRadius=high,mapBounds=query.getDataBounds?.()?.dem;
 if(mapBounds&&(core[0]<mapBounds.west||core[0]>mapBounds.east||core[2]<mapBounds.south||core[2]>mapBounds.north))throw Error('核心目标不在有效地图范围内，无法生成自动航线');
 const startRadius=Math.min(requestedRadius,mapBounds?rayExit(core,dx,dz,mapBounds):Infinity);
 const endRadius=Math.min(startRadius,mapBounds?rayExit(core,-dx,-dz,mapBounds):Infinity);
 const positions=[];let skipped=0;
 const append=radius=>{
  const x=core[0]+dx*radius,z=core[2]+dz*radius,ground=query.groundAt(x,z);
  if(!Number.isFinite(ground)){skipped++;return;}
  const surface=query.surfaceAt(x,z);
  positions.push([x,Math.max(ground+aglM,(surface??ground)+CLEARANCE),z]);
 };
 // 分成入场、离场两段采样，保证核心点本身也在航线上；地图不足时仅截断越界部分。
 const incoming=Math.max(1,Math.ceil(startRadius/STEP)),outgoing=Math.max(1,Math.ceil(endRadius/STEP));
 for(let i=0;i<incoming;i++)append(startRadius*(1-i/incoming));
 append(0);
 for(let i=1;i<=outgoing;i++)if(endRadius>0)append(-endRadius*i/outgoing);
 if(positions.length<2)throw Error(`径向航路 ${id} 全段无有效地形点（跳过 ${skipped} 点）`);
 return {id,azimuthDeg,...finalizeRoute(query,positions,speedMps,startDelayS),speed:speedMps,aglM,startDelayS,skipped,launch:{requestedBufferM:LAUNCH_BUFFER_M,actualBufferM:distanceToBounds(positions[0][0],positions[0][2],bounds),clippedByMap:startRadius<requestedRadius-1e-6,startRadiusM:startRadius,endRadiusM:endRadius},notes:'按来向角直线穿越核心至对称位置；起点距部署范围 1000 m，起终点受有效地图边界限制；高程取 max(地面+agl, 表面+25)，坡度包络 ±1/3，建筑阻挡抬升；不是真实导航方案。'};
}

// 用户路点接受 [x,z] 或 [x,y,z]；输入 y 不参与飞行高度，高度统一由当前地形、AGL 与表面净空计算。
export function buildCustomRoute(query,{waypoints,aglM,speedMps,id='single-custom'}){
 const limits=THREAT_CONFIG_LIMITS;
 if(!Number.isFinite(aglM)||aglM<=0||aglM>limits.maxAglM)throw Error(`自定义折线离地高度必须是 (0,${limits.maxAglM}] 米内的有限数值`);
 if(!Number.isFinite(speedMps)||speedMps<=0||speedMps>limits.maxSpeedMps)throw Error(`自定义折线速度必须是 (0,${limits.maxSpeedMps}] 米/秒内的有限数值`);
 if(!Array.isArray(waypoints)||waypoints.length<2)throw Error('自定义折线至少需要两个不同有效路点');
 const normalized=waypoints.map((point,i)=>{
  if(!Array.isArray(point)||![2,3].includes(point.length)||point.some(v=>!Number.isFinite(v)))throw Error(`自定义折线路点 ${i+1} 必须是 [x,z] 或 [x,y,z] 有限数值数组`);
  return point.length===2?[point[0],point[1]]:[point[0],point[2]];
 });
 if(new Set(normalized.map(p=>p.join(','))).size<2)throw Error('自定义折线至少需要两个不同有效路点');
 const ordered=normalized.filter((point,i)=>!i||point[0]!==normalized[i-1][0]||point[1]!==normalized[i-1][1]);
 for(const [i,[x,z]] of ordered.entries())if(!Number.isFinite(query.groundAt(x,z)))throw Error(`自定义折线路点 ${i+1} 无有效地形高程`);
 const positions=[];let skipped=0;
 const append=(x,z)=>{
  const ground=query.groundAt(x,z);if(!Number.isFinite(ground)){skipped++;return;}
  const surface=query.surfaceAt(x,z);positions.push([x,Math.max(ground+aglM,(surface??ground)+CLEARANCE),z]);
 };
 for(let i=1;i<ordered.length;i++){
  const a=ordered[i-1],b=ordered[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/STEP));
  for(let j=0;j<n;j++){const f=j/n;append(a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f);}
 }
 append(...ordered.at(-1));
 if(positions.length<2)throw Error(`自定义折线全段无有效地形点（跳过 ${skipped} 点）`);
 return {id,kind:'custom',azimuthDeg:null,waypoints:ordered.map(p=>[...p]),...finalizeRoute(query,positions,speedMps,0),speed:speedMps,startDelayS:0,aglM,skipped,notes:'用户有序路点构成的运动学折线；高程取 max(地面+agl, 表面+25)，坡度包络 ±1/3，建筑阻挡抬升；不是真实导航方案。'};
}

// 规范化单个场景配置；缺省字段继承默认值，返回的新对象和数组可直接 JSON 序列化。
export function normalizeThreatConfig(scenarioKey,config={}){
 const defaults=Object.hasOwn(DEFAULT_THREAT_CONFIGS,scenarioKey)?DEFAULT_THREAT_CONFIGS[scenarioKey]:null;if(!defaults)throw Error(`未知威胁场景 ${scenarioKey}`);
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error(`威胁场景 ${scenarioKey} 配置必须是对象`);
 const s={...defaults,...config},l=THREAT_CONFIG_LIMITS;
 if(scenarioKey==='single'&&(s.count!==1||s.directions!==1||!Array.isArray(s.azimuthsDeg)||s.azimuthsDeg.length!==1||!Array.isArray(s.aglM)||s.aglM.length!==1))throw Error('单机单点入侵只能设置 1 架目标、1 个来向和1个离地高度');
 if(!Number.isInteger(s.count)||s.count<l.minCount||s.count>l.maxCount)throw Error(`威胁场景 ${scenarioKey} 数量必须是 ${l.minCount}–${l.maxCount} 的整数`);
 if(!Number.isInteger(s.directions)||s.directions<l.minDirections||s.directions>l.maxDirections||s.directions>s.count)throw Error(`威胁场景 ${scenarioKey} 方位数必须是 ${l.minDirections}–${l.maxDirections} 且不超过总数量的整数`);
 if(!Array.isArray(s.azimuthsDeg)||s.azimuthsDeg.length!==s.directions)throw Error(`威胁场景 ${scenarioKey} 必须提供与方位数一致的攻击来向方位角数组`);
 for(const azimuth of s.azimuthsDeg)if(!Number.isFinite(azimuth)||azimuth<0||azimuth>=360)throw Error(`威胁场景 ${scenarioKey} 方位角必须是 [0,360) 内的有限数值`);
 if(!Array.isArray(s.aglM)||!s.aglM.length)throw Error(`威胁场景 ${scenarioKey} 至少需要一个离地高度`);
 for(const agl of s.aglM)if(!Number.isFinite(agl)||agl<=0||agl>l.maxAglM)throw Error(`威胁场景 ${scenarioKey} 离地高度必须是 (0,${l.maxAglM}] 米内的有限数值`);
 if(!Number.isFinite(s.speedMps)||s.speedMps<=0||s.speedMps>l.maxSpeedMps)throw Error(`威胁场景 ${scenarioKey} 速度必须是 (0,${l.maxSpeedMps}] 米/秒内的有限数值`);
 return {count:s.count,directions:s.directions,azimuthsDeg:s.azimuthsDeg.map(a=>Object.is(a,-0)?0:a),aglM:[...s.aglM],speedMps:s.speedMps,simultaneous:defaults.simultaneous};
}

// 总架数均分到各方位，余数从第一个方位依次加一；所有自动航线穿越核心，蜂群按方向内 2 秒错峰。
export function buildThreatRoutes(query,bounds,scenarioKey,config){
 const s=normalizeThreatConfig(scenarioKey,config),routes=[];
 const base=Math.floor(s.count/s.directions),remainder=s.count%s.directions;
 for(let d=0;d<s.directions;d++){
  const directionCount=base+(d<remainder?1:0);
  for(let k=0;k<directionCount;k++){
   const swarm=scenarioKey==='swarm';
   routes.push(buildRadialRoute(query,bounds,{azimuthDeg:s.azimuthsDeg[d],aglM:s.aglM[(d+k)%s.aglM.length],speedMps:s.speedMps,id:`${scenarioKey}-${d+1}-${k+1}`,startDelayS:swarm?k*2:0}));
  }
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
