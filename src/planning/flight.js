import {evaluate} from '../sensors/engine.js';
import {emcCheck} from './optimizer.js';
const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
export function interpolateRoute(route,time){
 const t=Math.min(route.duration,Math.max(0,time));let lo=0,hi=route.points.length-1;
 while(lo+1<hi){const mid=(lo+hi)>>1;if(route.points[mid].time<=t)lo=mid;else hi=mid;}
 const a=route.points[lo],b=route.points[hi],f=b.time===a.time?0:(t-a.time)/(b.time-a.time);
 return a.position.map((x,i)=>x+(b.position[i]-x)*f);
}
export function buildFlightRoute(query,bounds,{speed=15,clearance=25,cruiseAgl=60}={}){
 const step=250,nodes=[],keys=new Map();
 const cols=Math.ceil((bounds.east-bounds.west)/step),rows=Math.ceil((bounds.north-bounds.south)/step);
 for(let i=0;i<=cols;i++)for(let j=0;j<=rows;j++){
  const x=bounds.west+i*step,z=bounds.south+j*step,ground=query.groundAt(x,z);if(ground===null)continue;
  const node={id:nodes.length,i,j,x,z,ground};nodes.push(node);keys.set(`${i},${j}`,node.id);
 }
 if(nodes.length<3)throw Error('缺少连续有效地形，无法生成飞行轨迹');
 const near=(x,z,list=nodes)=>list.reduce((a,b)=>Math.hypot(a.x-x,a.z-z)<Math.hypot(b.x-x,b.z-z)?a:b);
 const center=near(bounds.core[0],bounds.core[2]);const edges=new Map();
 function neighbors(id){
  if(edges.has(id))return edges.get(id);const a=nodes[id],result=[];
  for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
   const other=keys.get(`${a.i+di},${a.j+dj}`);if(other===undefined)continue;const b=nodes[other],count=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/15);let valid=true;
   for(let k=1;k<count;k++)if(query.groundAt(a.x+(b.x-a.x)*k/count,a.z+(b.z-a.z)*k/count)===null){valid=false;break;}
   if(valid)result.push(other);
  }
  edges.set(id,result);return result;
 }
 const connected=new Set([center.id]),queue=[center.id];for(let i=0;i<queue.length;i++)for(const id of neighbors(queue[i]))if(!connected.has(id)){connected.add(id);queue.push(id);}
 const component=nodes.filter(n=>connected.has(n.id));
 const west=near(bounds.west+step,bounds.core[2],component),east=near(bounds.east-step,bounds.core[2],component);
 function astar(start,end){
  const open=new Set([start.id]),g=new Map([[start.id,0]]),parent=new Map();
  while(open.size){let current;let best=Infinity;for(const id of open){const n=nodes[id],f=g.get(id)+Math.hypot(n.x-end.x,n.z-end.z);if(f<best){best=f;current=id;}}
   if(current===end.id){const result=[current];while(parent.has(result[0]))result.unshift(parent.get(result[0]));return result;}
   open.delete(current);const a=nodes[current];for(const id of neighbors(current)){const b=nodes[id],cost=g.get(current)+Math.hypot(a.x-b.x,a.z-b.z);if(cost<(g.get(id)??Infinity)){g.set(id,cost);parent.set(id,current);open.add(id);}}
  }throw Error('飞行路径不连通');
 }
 const ids=[...astar(west,center),...astar(center,east).slice(1)],positions=[];
 for(let i=0;i<ids.length-1;i++){
  const a=nodes[ids[i]],b=nodes[ids[i+1]],count=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/20);
  for(let j=0;j<count;j++){const f=j/count,x=a.x+(b.x-a.x)*f,z=a.z+(b.z-a.z)*f,g=query.groundAt(x,z),surface=query.surfaceAt(x,z);if(g===null||surface===null)throw Error('轨迹经过无地形覆盖区');positions.push([x,Math.max(g+cruiseAgl,surface+clearance),z]);}
 }
 const end=nodes[ids.at(-1)],surface=query.surfaceAt(end.x,end.z);positions.push([end.x,Math.max(end.ground+cruiseAgl,surface+clearance),end.z]);
 function slopeEnvelope(){for(let i=1;i<positions.length;i++){const d=Math.hypot(positions[i][0]-positions[i-1][0],positions[i][2]-positions[i-1][2]);positions[i][1]=Math.max(positions[i][1],positions[i-1][1]-d/3);}for(let i=positions.length-2;i>=0;i--){const d=Math.hypot(positions[i][0]-positions[i+1][0],positions[i][2]-positions[i+1][2]);positions[i][1]=Math.max(positions[i][1],positions[i+1][1]-d/3);}}
 let repairs=0;slopeEnvelope();
 for(let pass=0;pass<3;pass++){let changed=false;for(let i=1;i<positions.length;i++){const result=query.trace(positions[i-1],positions[i]);if(result.blocked){const lift=Math.max(5,result.clearance+clearance);positions[i-1][1]+=lift;positions[i][1]+=lift;changed=true;repairs++;}}if(!changed)break;slopeEnvelope();}
 for(let i=1;i<positions.length;i++){const c=query.trace(positions[i-1],positions[i]);if(c.blocked||!c.known)throw Error('轨迹未通过建筑/地形连续线段检查');}
 let length=0;const points=positions.map((position,i)=>{if(i)length+=distance(position,positions[i-1]);return {position,time:length/speed};});
 return {id:'museum-west-east',name:'西侧进入 → 河南博物院周边 → 东侧离开',points,duration:length/speed,length,speed,maxVerticalSpeed:speed/Math.sqrt(10),clearance,cruiseAgl,repairs,geometryVerified:true,notes:'在有效 DEM 连通域内寻路并抬升避开 LoD1 建筑；不是航空运行许可或真实导航方案。'};
}
export async function simulateFlight({query,devices,route,target,environment,core,coreRadius=700,interval=2,progress=()=>{},yieldTask=async()=>{}}){
 const emc=emcCheck(devices),frames=[];const times=[];for(let t=0;t<route.duration;t+=interval)times.push(t);times.push(route.duration);
 for(const [index,time] of times.entries()){
  const position=interpolateRoute(route,time),detections=[],states=[];
  for(const device of devices){
   const env={...environment,cochannelDb:environment.cochannelDb+(emc.penalties[device.id]??0)};
   const base=evaluate(device,{...target,position},env,{known:true,blocked:false,buildingCount:0});
   const geometryFail=base.reasons.some(r=>['近距盲区','超出标称距离','超出方位视场','超出俯仰视场','目标无线电静默','目标信号不在接收频段'].includes(r));
   const result=geometryFail?base:evaluate(device,{...target,position},env,query.trace(device.position,position));
   if(result.status==='within-model'&&result.eligible)detections.push({id:device.id,type:device.type,name:device.name,marginDb:result.marginDb,snrDb:result.snrDb});
   states.push({id:device.id,type:device.type,status:result.status,reasons:result.reasons,marginDb:result.marginDb});
  }
  frames.push({time,position,insideCore:Math.hypot(position[0]-core[0],position[2]-core[2])<=coreRadius,detections,states});
  if(index%12===0){progress({stage:'flight',completed:index,total:times.length});await yieldTask();}
 }
 const tracker=new AlarmTracker();for(const frame of frames)tracker.accept(frame);
 return {interval,frames,events:tracker.events,summary:{samples:frames.length,detectedSamples:frames.filter(f=>f.detections.length).length,detectedFraction:frames.filter(f=>f.detections.length).length/frames.length,firstDetectionTime:frames.find(f=>f.detections.length)?.time??null,lossEvents:tracker.events.filter(e=>e.kind==='lost').length},notes:'报警按离散模型帧更新，运动按轨迹插值；不保证帧间始终可探测。'};
}
export class AlarmTracker{
 constructor(){this.events=[];this.active=false;this.ever=false;this.misses=0;this.insideCore=false;this.lastTime=-1;this.status='clear';}
 accept(frame){
  if(frame.time<this.lastTime)throw Error('倒放或跳转前需要重建报警状态');this.lastTime=frame.time;
  if(frame.insideCore!==this.insideCore){this.events.push({time:frame.time,kind:frame.insideCore?'enter-core':'leave-core',message:frame.insideCore?'无人机进入核心区':'无人机离开核心区'});this.insideCore=frame.insideCore;}
  if(frame.detections.length){
   if(!this.active)this.events.push({time:frame.time,kind:this.ever?'reacquired':'detected',message:this.ever?'重新发现无人机':'首次发现无人机',deviceIds:frame.detections.map(d=>d.id)});
   this.active=true;this.ever=true;this.misses=0;this.status='alarm';
  }else if(this.active){this.misses++;this.status='coasting';if(this.misses>=2){this.events.push({time:frame.time,kind:'lost',message:'连续两帧未检出，确认失联'});this.active=false;this.status='clear';}}
  else this.status='clear';
  return this.status;
 }
}
