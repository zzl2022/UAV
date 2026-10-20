import {createDevice,DEFAULT_ENV,DEFAULT_TARGET} from '../sensors/presets.js';
import {evaluate,angles,validateTarget,validateEnvironment} from '../sensors/engine.js';
import {museumLandmark} from '../landmarks.js';
export const PLAN_VERSION='deployment-1.0';
export const DEFAULT_SETTINGS={scope:'city',spacing:500,heights:[30,60,100],siteSpacing:900,maxSites:192,maxDevices:64,budget:600,costs:{radar:12,radio:5,optical:4,acoustic:2},coreRadius:700,coreWeight:3,marginReserveDb:3};
export function validateSettings(s){
 if(!['city','core'].includes(s.scope)||!Number.isFinite(s.spacing)||s.spacing<150||s.spacing>1000||!Number.isFinite(s.siteSpacing)||s.siteSpacing<300||s.siteSpacing>1500)throw Error('优化范围或采样间距无效');
 if(!Array.isArray(s.heights)||s.heights.length<1||s.heights.length>5||s.heights.some(h=>!Number.isFinite(h)||h<10||h>500))throw Error('需设置 1–5 个 10–500 m 离地高度');
 for(const [key,min,max] of [['maxSites',4,256],['maxDevices',1,64],['budget',1,1000]])if(!Number.isInteger(s[key])||s[key]<min||s[key]>max)throw Error(`${key} 超出允许范围`);
 for(const type of ['radar','radio','optical','acoustic'])if(!Number.isFinite(s.costs?.[type])||s.costs[type]<=0||s.costs[type]>100)throw Error('成本必须为正的相对成本单位');
 if(!Number.isFinite(s.coreRadius)||s.coreRadius<100||s.coreRadius>3000||!Number.isFinite(s.coreWeight)||s.coreWeight<1||s.coreWeight>10||!Number.isFinite(s.marginReserveDb)||s.marginReserveDb<0||s.marginReserveDb>20)throw Error('核心区权重或裕量无效');
}
export function scenarios(environment){return [
 {id:'nominal',name:'基线 · 发射',environment:{...environment},target:{emitting:true,count:1}},
 {id:'silent',name:'无线电静默',environment:{...environment},target:{emitting:false,count:1}},
 {id:'weather',name:'雨雾及街道噪声',environment:{...environment,rainMmH:30,visibilityKm:0.3,rainNoiseDb:55,trafficDb:65},target:{emitting:true,count:1}},
 {id:'interference',name:'电磁干扰',environment:{...environment,emNoiseDb:10,cochannelDb:10,crosstalkDb:5},target:{emitting:true,count:1}},
 ];}
export function boundsFor(city,settings){
 const landmark=museumLandmark(city);if(!landmark)throw Error('缺少河南博物院核心区定位');
 if(settings.scope==='core')return {west:landmark.position[0]-1200,east:landmark.position[0]+1200,south:landmark.position[2]-1200,north:landmark.position[2]+1200,core:landmark.position};
 let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
 for(const b of city.buildings)for(const p of b.rings[0]){west=Math.min(west,p[0]);east=Math.max(east,p[0]);south=Math.min(south,p[2]);north=Math.max(north,p[2]);}
 return {west,east,south,north,core:landmark.position};
}
export function generateSamples(city,query,settings){
 const bounds=boundsFor(city,settings),samples=[],seen=new Set();let outsideDem=0,insideBuildings=0;
 function add(x,z,height,kind='grid'){
  const key=[x.toFixed(1),z.toFixed(1),height].join(',');if(seen.has(key))return;seen.add(key);
  const ground=query.groundAt(x,z);if(ground===null){outsideDem++;return;}
  const surface=query.surfaceAt(x,z);const y=ground+height;
  if(surface!==null&&y<=surface+1){insideBuildings++;return;}
  const core=Math.hypot(x-bounds.core[0],z-bounds.core[2])<=settings.coreRadius;
  samples.push({id:`sample-${samples.length+1}`,position:[x,y,z],agl:height,weight:core?settings.coreWeight:1,core,kind});
 }
 for(let x=bounds.west+settings.spacing/2;x<bounds.east;x+=settings.spacing)for(let z=bounds.south+settings.spacing/2;z<bounds.north;z+=settings.spacing)for(const height of settings.heights)add(x,z,height);
 // Additional points behind facades around the core; never count points inside buildings as navigable airspace.
 const nearby=city.buildings.filter(b=>Math.hypot(b.rings[0][0][0]-bounds.core[0],b.rings[0][0][2]-bounds.core[2])<settings.coreRadius).sort((a,b)=>b.height-a.height).slice(0,24);
 for(const b of nearby){const r=b.rings[0],cx=r.reduce((a,p)=>a+p[0],0)/r.length,cz=r.reduce((a,p)=>a+p[2],0)/r.length;for(const p of [r[0],r[Math.floor(r.length/2)]]){const dx=p[0]-cx,dz=p[2]-cz,len=Math.hypot(dx,dz)||1;add(p[0]+dx/len*12,p[2]+dz/len*12,settings.heights[0],'facade');}}
 if(!samples.length)throw Error('选定区域没有可用空域采样点');
 return {bounds,samples,excluded:{outsideDem,insideBuildings},spacing:settings.spacing};
}
export function generateCandidates(city,query,settings,sampling){
 const {bounds}=sampling,sites=[],cells=new Map();
 for(const b of city.buildings){
  if(b.height>140)continue;const ring=b.rings[0],x=ring.reduce((a,p)=>a+p[0],0)/ring.length,z=ring.reduce((a,p)=>a+p[2],0)/ring.length;
  if(x<bounds.west||x>bounds.east||z<bounds.south||z>bounds.north||query.groundAt(x,z)===null)continue;
  const key=[Math.floor((x-bounds.west)/settings.siteSpacing),Math.floor((z-bounds.south)/settings.siteSpacing)].join(',');
  const current=cells.get(key)??{};if(!current.low||b.height<current.low.building.height)current.low={x,z,building:b};if(!current.high||b.height>current.high.building.height)current.high={x,z,building:b};cells.set(key,current);
 }
 for(const site of [...cells.values()].flatMap(c=>c.low.building.id===c.high.building.id?[c.low]:[c.low,c.high]).sort((a,b)=>Math.hypot(a.x-bounds.core[0],a.z-bounds.core[2])-Math.hypot(b.x-bounds.core[0],b.z-bounds.core[2])).slice(0,Math.min(settings.maxSites,128))){
  const surface=query.surfaceAt(site.x,site.z);if(surface===null||Math.abs(surface-(site.building.rings[0][0][1]+site.building.height))>2)continue;
  sites.push({id:`site-${sites.length+1}`,position:[site.x,surface+2,site.z],buildingId:site.building.id,name:site.building.name,installationProxy:1+site.building.height/100,installation:'屋顶上方 2 m；施工条件未实测'});
 }
 if(!sites.length)throw Error('没有可用部署候选点');
 const candidates=[];
 for(const [index,site] of sites.entries())for(const [presetId,pitch] of [['radar-03d',0],['radar-03d',-15],['radar-03d',-30],['radio-tdoa',0],['optical-nvt',0],['acoustic-cry',0]]){
  const device=createDevice(presetId,`plan-${index+1}-${presetId}-${pitch}`,site.position);
  if(device.type==='radar'){device.parameters.frequencyGHz=16+(index%4)*0.5;device.parameters.pitch=pitch;}
  if(['optical','acoustic'].includes(device.type))device.parameters.heading=angles(device.position,sampling.bounds.core).azimuth;
  candidates.push({device,site,cost:settings.costs[device.type]+site.installationProxy*0.2});
 }
 return candidates;
}
export function chooseGreedy(candidates,weights,{budget,maxDevices}){
 const covered=new Uint8Array(weights.length),selected=[];let cost=0;
 for(let pass=0;pass<4;pass++){
  const prior=selected.join(',');
  while(selected.length<maxDevices){
   let best=-1,bestScore=0;
   for(let i=0;i<candidates.length;i++){
    const candidate=candidates[i];if(selected.includes(i)||cost+candidate.cost>budget+1e-9)continue;
    let gain=0;for(const j of candidate.cover)if(!covered[j])gain+=weights[j];
    const score=gain/candidate.cost;if(score>bestScore+1e-10){bestScore=score;best=i;}
   }
   if(best<0)break;selected.push(best);cost+=candidates[best].cost;for(const j of candidates[best].cover)covered[j]=1;
  }
  const counts=new Uint16Array(weights.length);for(const i of selected)for(const j of candidates[i].cover)counts[j]++;
  for(let k=selected.length-1;k>=0;k--){const i=selected[k];if(candidates[i].cover.every(j=>counts[j]>=2)){for(const j of candidates[i].cover)counts[j]--;cost-=candidates[i].cost;selected.splice(k,1);}}
  // Redundant deletion frees budget: refill rather than stopping with avoidable holes.
  if(selected.join(',')===prior)break;
 }
 return {indices:selected,cost:Math.max(0,cost),covered:Array.from(covered),coveredWeight:weights.reduce((sum,w,i)=>sum+w*covered[i],0),totalWeight:weights.reduce((a,b)=>a+b,0)};
}
export function emcCheck(devices){
 const penalties=Object.fromEntries(devices.map(d=>[d.id,0])),conflicts=[];
 for(let i=0;i<devices.length;i++)for(let j=i+1;j<devices.length;j++){
  const a=devices[i],b=devices[j];if(a.type!=='radar'||b.type!=='radar')continue;
  const distance=Math.hypot(...a.position.map((v,k)=>v-b.position[k]));
  if(Math.abs(a.parameters.frequencyGHz-b.parameters.frequencyGHz)<0.1&&distance<600){const penalty=6*(1-distance/600);penalties[a.id]+=penalty;penalties[b.id]+=penalty;conflicts.push({first:a.id,second:b.id,distance,penaltyDb:penalty});}
 }
 return {penalties,conflicts,meaning:'同频差 <0.1 GHz、间距 <600 m 的启发式干扰代理；不是频谱合规或真实 EMC 认证'};
}
export async function optimizeDeployment({city,query,settings={...DEFAULT_SETTINGS},environment={...DEFAULT_ENV},target={...DEFAULT_TARGET},progress=()=>{},yieldTask=async()=>{}}){
 validateSettings(settings);validateTarget(target);validateEnvironment(environment);const start=Date.now(),sampling=generateSamples(city,query,settings),candidates=generateCandidates(city,query,settings,sampling),conditions=scenarios(environment),n=sampling.samples.length;
 const weights=conditions.flatMap((condition,c)=>sampling.samples.map(p=>p.weight*(c===0?2:1)));
 const contexts=new Map();
 async function evaluateCandidate(candidate){
  const cover=[];
  for(let j=0;j<n;j++){
   const position=sampling.samples[j].position,base={...target,position};
   // Reject hard distance/FOV gates before querying 15,889 building volumes.
   const quick=evaluate(candidate.device,base,environment,{known:true,blocked:false,buildingCount:0});
   if(quick.reasons.some(r=>['近距盲区','超出标称距离','超出方位视场','超出俯仰视场'].includes(r)))continue;
   const key=[candidate.site.id,j].join(':');let context=contexts.get(key);if(!context){context=query.trace(candidate.device.position,position);contexts.set(key,context);}
   for(let c=0;c<conditions.length;c++){
    const condition=conditions[c],result=evaluate(candidate.device,{...base,...condition.target},condition.environment,context);
    if(result.status==='within-model'&&result.marginDb!==null&&result.marginDb>=settings.marginReserveDb)cover.push(c*n+j);
   }
  }
  candidate.cover=cover;
 }
 for(let i=0;i<candidates.length;i++){await evaluateCandidate(candidates[i]);if(i%4===3){progress({stage:'matrix',completed:i+1,total:candidates.length,samples:n});await yieldTask();}}
 const initialUnion=new Uint8Array(weights.length);for(const c of candidates)for(const j of c.cover)initialUnion[j]=1;
 const holes=sampling.samples.map((p,j)=>({p,j})).filter(({j})=>conditions.some((_,c)=>!initialUnion[c*n+j])).sort((a,b)=>Number(b.p.core)-Number(a.p.core)||a.p.agl-b.p.agl);
 const anchors=new Set();let repairSites=0;
 const remainingSites=Math.max(0,settings.maxSites-new Set(candidates.map(c=>c.site.id)).size);
 for(const {p,j} of holes){
  const key=[p.position[0].toFixed(0),p.position[2].toFixed(0)].join(',');if(anchors.has(key)||repairSites>=Math.min(64,remainingSites))continue;anchors.add(key);
  let found=null;
  for(const radius of [80,180,350]){for(let a=0;a<12;a++){
   const angle=a*Math.PI/6,x=p.position[0]+radius*Math.cos(angle),z=p.position[2]+radius*Math.sin(angle),ground=query.groundAt(x,z),surface=query.surfaceAt(x,z);
   if(ground===null||surface===null)continue;const position=[x,surface+2,z],direction=angles(position,p.position);
   const device=createDevice('radar-03d',`repair-${repairSites+1}`,position);device.parameters.pitch=Math.max(-60,Math.min(0,direction.elevation-30));device.parameters.frequencyGHz=16+(repairSites%4)*0.5;
   const context=query.trace(position,p.position);if(!context.known||context.blocked)continue;
   if(conditions.every(condition=>{const result=evaluate(device,{...target,position:p.position,...condition.target},condition.environment,context);return result.status==='within-model'&&result.marginDb>=settings.marginReserveDb;})){
    found={device,site:{id:`repair-site-${repairSites+1}`,position,buildingId:null,name:'残余盲点邻近补点',installationProxy:1+(surface-ground)/100,installation:'实际网格表面上方 2 m，补点施工条件未实测'},cost:settings.costs.radar+(1+(surface-ground)/100)*0.2};break;
   }
  }if(found)break;}
  if(found){await evaluateCandidate(found);candidates.push(found);repairSites++;progress({stage:'repair',completed:repairSites,total:Math.min(64,remainingSites),samples:n});await yieldTask();}
 }
 const budgets=[{id:'economy',name:'经济方案',budget:Math.round(settings.budget*0.5),maxDevices:Math.max(1,Math.round(settings.maxDevices*0.5))},{id:'balanced',name:'均衡方案',budget:Math.round(settings.budget*0.75),maxDevices:Math.max(1,Math.round(settings.maxDevices*0.75))},{id:'enhanced',name:'增强方案',budget:settings.budget,maxDevices:settings.maxDevices}];
 const plans=[];
 for(const policy of budgets){
  const chosen=chooseGreedy(candidates,weights,policy),devices=chosen.indices.map(i=>structuredClone(candidates[i].device)),emc=emcCheck(devices),coverage=conditions.map(()=>new Uint16Array(n));
  for(const i of chosen.indices)for(const j of candidates[i].cover){const c=Math.floor(j/n),index=j%n;
   if(emc.penalties[candidates[i].device.id]>0){const condition=conditions[c],result=evaluate(candidates[i].device,{...target,position:sampling.samples[index].position,...condition.target},{...condition.environment,cochannelDb:condition.environment.cochannelDb+emc.penalties[candidates[i].device.id]},contexts.get(`${candidates[i].site.id}:${index}`));if(result.status!=='within-model'||result.marginDb<settings.marginReserveDb)continue;}
   coverage[c][index]++;
  }
  const metrics=coverage.map((counts,c)=>({condition:conditions[c].id,name:conditions[c].name,covered:Array.from(counts).filter(x=>x>0).length,total:n,coverageRate:Array.from(counts).filter(x=>x>0).length/n,blindRate:Array.from(counts).filter(x=>!x).length/n,redundant:Array.from(counts).filter(x=>x>1).length,coreCoverageRate:sampling.samples.reduce((sum,p,j)=>sum+(p.core&&counts[j]>0?1:0),0)/Math.max(1,sampling.samples.filter(p=>p.core).length)}));
  const blindWeight=coverage.reduce((sum,counts,c)=>sum+sampling.samples.reduce((s,p,j)=>s+(counts[j]?0:p.weight*(c===0?2:1)),0),0);
  plans.push({...policy,devices,cost:chosen.cost,installationProxy:chosen.indices.reduce((sum,i)=>sum+candidates[i].site.installationProxy,0),sites:chosen.indices.map(i=>candidates[i].site),metrics,blindWeight,coverage:coverage.map(counts=>Array.from(counts)),emc});
 }
 plans.sort((a,b)=>a.blindWeight-b.blindWeight||a.cost-b.cost||a.installationProxy-b.installationProxy);
 const union=new Uint8Array(weights.length);for(const c of candidates)for(const j of c.cover)union[j]=1;
 const selected=plans[0];
 return {version:PLAN_VERSION,algorithm:'Weighted greedy set cover + reverse deletion/refill + scenario/EMC revalidation; no global-optimum certificate',settings:structuredClone(settings),origin:city.metadata.origin,inputHashes:city.metadata.sources,environment:structuredClone(environment),target:structuredClone(target),sampling,candidateCount:candidates.length,siteCount:new Set(candidates.map(c=>c.site.id)).size,repairSites,conditions:conditions.map(({id,name})=>({id,name})),plans,selectedId:selected.id,uncoverableByCandidatePool:conditions.map((condition,c)=>({condition:condition.id,count:sampling.samples.filter((_,j)=>!union[c*n+j]).length})),durationMs:Date.now()-start,limitations:['覆盖率仅针对所列有效空域采样点，不是连续空间无盲区证明。','雷达候选及盲点补点使用可调安装俯仰姿态（最低 -60°）；实际天线能力须标定确认。','价格为相对成本假设；屋顶承重、供电、网络和使用许可没有实测。','精度继承未标定感知模型与未注明垂直基准的 DEM。','气象、静默和干扰采用有限条件集；不宣称全威胁鲁棒。']};
}
