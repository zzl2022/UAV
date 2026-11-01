// 任务三自动化流水线：候选方案生成 → 覆盖推演 → 多指标择优 → 威胁场景验证 → 电磁兼容校核。
// 候选生成/采样/贪心复用 src/planning/optimizer.js 的导出件；装备选择（presetIds）在本层注入，
// optimizer 仅增加显式 custom 范围兼容分支，既有 city/core 路径不变。检出判定复用 sensors/engine.js evaluate + scene.js query.trace。
import {generateSamples,scenarios,chooseGreedy} from '../planning/optimizer.js';
import {enrichReport} from '../planning/report.js';
import {createDevice,PRESETS,DEFAULT_ENV,DEFAULT_TARGET} from '../sensors/presets.js';
import {evaluate,angles,validateTarget,validateEnvironment} from '../sensors/engine.js';
import {museumLandmark} from '../landmarks.js';
import {classifyBlindSpots} from './blindspots.js';
import {scorePlans,comparisonTable} from './metrics.js';
import {buildThreatRoutes,simulateThreat,threatSummaryText} from './threats.js';
import {emcAnalysis,emcVerdictText,distance3D} from './emc.js';
import {createRun,finalizeRun} from './runs.js';
import {TASK3_VERSION,METRIC_WEIGHTS,EQUIPMENT_FACTS,EQUIPMENT_CHANNELS_GHZ,EMC_RULES} from './constants.js';
import {TASK3_DEFAULT_SETTINGS,resolveTask3Settings,createScopeMetadata} from './scope.js';

export const PIPELINE_STAGES=['candidates','coverage','scoring','threats','emc'];
export const STAGE_NAMES={candidates:'候选方案生成',coverage:'覆盖推演',scoring:'多指标择优',threats:'威胁场景验证',emc:'电磁兼容校核'};

// 装备选择校验：至少选一个预设；未知预设抛错。
export function validatePresetIds(presetIds){
 if(!Array.isArray(presetIds)||!presetIds.length)throw Error('至少选择一款装备');
 for(const id of presetIds)if(!PRESETS.some(p=>p.id===id))throw Error(`未知装备预设 ${id}`);
 return presetIds;
}

function modelChannel(presetId,index){
 const channels=EQUIPMENT_CHANNELS_GHZ[presetId];
 return channels?.length?channels[index%channels.length]:null;
}

// 与 optimizer.generateCandidates 同手法，但装备预设由用户选择注入；雷达俯仰与频道分组为模型假设。
export function generateCandidatesWithEquipment(city,query,settings,sampling,presetIds){
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
 const variants=[];
 for(const presetId of presetIds){
  const preset=PRESETS.find(p=>p.id===presetId);
  if(preset.type==='radar')for(const pitch of [0,-15,-30])variants.push({presetId,pitch});
  else variants.push({presetId,pitch:0});
 }
 const candidates=[];
 for(const [index,site] of sites.entries())for(const {presetId,pitch} of variants){
  const device=createDevice(presetId,`task3-${index+1}-${presetId}-${pitch}`,site.position);
  if(device.type==='radar'){device.parameters.pitch=pitch;device.parameters.frequencyGHz=modelChannel(presetId,index);} // X/Ku 带内既有模型频道
  if(['optical','acoustic'].includes(device.type))device.parameters.heading=angles(device.position,bounds.core).azimuth;
  candidates.push({device,site,cost:settings.costs[device.type]+site.installationProxy*0.2});
 }
 return {candidates,sites};
}

async function evaluateCandidates({candidates,sampling,conditions,settings,environment,target,query,progress,yieldTask,contexts=new Map()}){
 const n=sampling.samples.length;
 for(let i=0;i<candidates.length;i++){
  const candidate=candidates[i],cover=[];
  for(let j=0;j<n;j++){
   const position=sampling.samples[j].position,base={...target,position};
   const quick=evaluate(candidate.device,base,environment,{known:true,blocked:false,buildingCount:0});
   if(quick.reasons.some(r=>['近距盲区','超出标称距离','超出方位视场','超出俯仰视场'].includes(r)))continue;
   const key=[candidate.site.id,j].join(':');let context=contexts.get(key);if(!context){context=query.trace(candidate.device.position,position);contexts.set(key,context);}
   for(let c=0;c<conditions.length;c++){
    const condition=conditions[c],result=evaluate(candidate.device,{...base,...condition.target},condition.environment,context);
    if(result.status==='within-model'&&result.marginDb!==null&&result.marginDb>=settings.marginReserveDb)cover.push(c*n+j);
   }
  }
  candidate.cover=cover;
  if(i%4===3){progress({stage:'coverage',completed:i+1,total:candidates.length,samples:n});await yieldTask();}
 }
 return contexts;
}

// EMC 回写择优：fail 每例 ×0.85（下限 0.7），degraded ×0.97；有无未解决 fail 优先于得分。
function applyEmcToScoring(scored,emcByPlan){
 for(const row of scored.plans){
  const emc=emcByPlan[row.id];if(!emc)continue;
  const factor=emc.counts.fail?Math.max(0.7,0.85**emc.counts.fail):emc.counts.warning?0.97:1;
  row.emcVerdict=emc.verdict;row.emcDeployable=emc.counts.fail===0;row.emcFactor=factor;row.scoreRaw=row.score;row.score=row.score*factor;
 }
 [...scored.plans].sort((a,b)=>Number(b.emcDeployable)-Number(a.emcDeployable)||b.score-a.score||a.indicators.cost-b.indicators.cost).forEach((r,i)=>r.rank=i+1);
 scored.plans.sort((a,b)=>a.rank-b.rank);
 scored.recommendedId=scored.plans[0].id;
 scored.recommendationStatus=scored.plans[0].emcDeployable?'deployable':'unresolved';
 scored.methodEmc='EMC 结论回写：fail 每例得分 ×0.85（累计下限 0.7），仅 warning ×0.97；无 fail 方案优先进入推荐序，再按回写后得分与成本排序。全部方案仍有 fail 时 recommendationStatus=unresolved，不标记为可部署最优。';
 return scored;
}

const emcSnapshot=result=>({verdict:result.verdict,counts:{...result.counts},conflicts:structuredClone(result.conflicts)});
const stateSignature=devices=>devices.map(d=>`${d.id}@${d.position.join(',')}@${d.parameters?.frequencyGHz??''}`).join('|');

function chooseRemedialAction(options,current,measureCoverage){
 const currentCoverage=measureCoverage?measureCoverage(current.devices,current.sites,current.indices):0;
 for(const option of options)option.coverageLoss=measureCoverage?currentCoverage-measureCoverage(option.devices,option.sites,option.indices):0;
 options.sort((a,b)=>a.result.counts.fail-b.result.counts.fail||a.result.counts.warning-b.result.counts.warning||a.coverageLoss-b.coverageLoss||a.moveDistance-b.moveDistance||a.key.localeCompare(b.key));
 return options[0];
}

// 确定性的单步贪心处置：每轮先试全部合法单设备换频，无改进再试既有候选点内的局部同型号替代。
// 每步必须减少 fail 数，且状态签名去重；搜索规模随冲突设备数×频道数/局部候选数增长，不做组合枚举。
export function remediateEmcConflicts({devices,sites=[],candidates=[],indices=null,measureCoverage=null,maxSteps=null}={}){
 let current={devices:structuredClone(devices),sites:structuredClone(sites),indices:indices?[...indices]:devices.map(()=>-1)};
 const initial=emcAnalysis(current.devices),before=emcSnapshot(initial),actions=[],visited=new Set([stateSignature(current.devices)]);
 const limit=maxSteps??Math.min(64,Math.max(8,devices.length*2));
 let result=initial;
 if(!result.counts.fail)return {...current,before,after:emcSnapshot(result),actions,status:'not-required',deployable:true,unresolved:[]};
 for(let step=0;step<limit&&result.counts.fail;step++){
  const involved=new Set(result.conflicts.filter(c=>c.severity==='fail').flatMap(c=>[c.a,c.b]));
  const options=[];
  // 第一阶段：只使用装备既有模型频道，优先换频。
  for(let i=0;i<current.devices.length;i++){
   const device=current.devices[i];if(!involved.has(device.id))continue;
   const channels=EQUIPMENT_CHANNELS_GHZ[device.presetId]??[],oldFrequency=device.parameters?.frequencyGHz;
   for(const frequencyGHz of channels){
    if(Math.abs(frequencyGHz-oldFrequency)<1e-9)continue;
    const nextDevices=[...current.devices];nextDevices[i]=structuredClone(device);nextDevices[i].parameters.frequencyGHz=frequencyGHz;
    const signature=stateSignature(nextDevices);if(visited.has(signature))continue;
    const nextResult=emcAnalysis(nextDevices);if(nextResult.counts.fail>=result.counts.fail)continue;
    options.push({kind:'retune',deviceIndex:i,frequencyGHz,oldFrequency,devices:nextDevices,sites:current.sites,indices:current.indices,result:nextResult,signature,moveDistance:0,key:`${device.id}:${frequencyGHz}`});
   }
  }
  if(options.length){
   const best=chooseRemedialAction(options,current,measureCoverage),i=best.deviceIndex,old=current.devices[i];
   actions.push({step:actions.length+1,action:'retune',deviceId:old.id,reason:'在装备既有模型频道内换频，减少 fail 级电磁冲突',before:{frequencyGHz:best.oldFrequency,position:[...old.position],emcCounts:{...result.counts}},after:{frequencyGHz:best.frequencyGHz,position:[...old.position],emcCounts:{...best.result.counts}},coverageLoss:best.coverageLoss});
   current={devices:best.devices,sites:best.sites,indices:best.indices};visited.add(best.signature);result=best.result;continue;
  }
  // 第二阶段：同型号、同俯仰变体在原有真实候选点内局部替代，保留当前合法载频。
  for(let i=0;i<current.devices.length;i++){
   const device=current.devices[i];if(!involved.has(device.id))continue;
   const alternatives=candidates.map((candidate,index)=>({candidate,index})).filter(({candidate,index})=>{
    if(current.indices.includes(index)||candidate.device.presetId!==device.presetId)return false;
    if(Math.abs((candidate.device.parameters?.pitch??0)-(device.parameters?.pitch??0))>1e-9)return false;
    const d=distance3D(device,candidate.device);return d>0&&d<=EMC_RULES.relocationSearchRadiusM;
   }).map(entry=>({...entry,distance:distance3D(device,entry.candidate.device)})).sort((a,b)=>a.distance-b.distance||a.index-b.index).slice(0,EMC_RULES.maxRelocationCandidates);
   for(const {candidate,index,distance} of alternatives){
    const nextDevice=structuredClone(candidate.device),frequency=device.parameters?.frequencyGHz,channels=EQUIPMENT_CHANNELS_GHZ[device.presetId]??[];
    if(channels.some(f=>Math.abs(f-frequency)<1e-9))nextDevice.parameters.frequencyGHz=frequency;
    const nextDevices=[...current.devices];nextDevices[i]=nextDevice;
    const nextSites=[...current.sites];nextSites[i]=structuredClone(candidate.site);
    const nextIndices=[...current.indices];nextIndices[i]=index;
    const signature=stateSignature(nextDevices);if(visited.has(signature))continue;
    const nextResult=emcAnalysis(nextDevices);if(nextResult.counts.fail>=result.counts.fail)continue;
    options.push({kind:'relocate',deviceIndex:i,candidate,index,distance,devices:nextDevices,sites:nextSites,indices:nextIndices,result:nextResult,signature,moveDistance:distance,key:`${device.id}:${candidate.device.id}`});
   }
  }
  if(!options.length)break;
  const best=chooseRemedialAction(options,current,measureCoverage),i=best.deviceIndex,old=current.devices[i];
  actions.push({step:actions.length+1,action:'relocate',deviceId:old.id,replacementDeviceId:best.devices[i].id,reason:'合法换频无法继续减少 fail，在既有真实候选点内作局部同型号移位',before:{siteId:current.sites[i]?.id??null,position:[...old.position],frequencyGHz:old.parameters?.frequencyGHz??null,emcCounts:{...result.counts}},after:{siteId:best.sites[i]?.id??null,position:[...best.devices[i].position],frequencyGHz:best.devices[i].parameters?.frequencyGHz??null,emcCounts:{...best.result.counts}},coverageLoss:best.coverageLoss});
  current={devices:best.devices,sites:best.sites,indices:best.indices};visited.add(best.signature);result=best.result;
 }
 result=emcAnalysis(current.devices);
 const after=emcSnapshot(result),unresolved=after.conflicts.filter(c=>c.severity==='fail');
 return {...current,before,after,actions,status:result.counts.fail?'unresolved':'resolved',deployable:!result.counts.fail,unresolved,...(!result.counts.fail?{}:{reason:'合法换频和既有候选点局部移位后仍有 fail 级冲突，需人工调整装备或点位。'})};
}

export async function runTask3Pipeline({city,query,settings={...TASK3_DEFAULT_SETTINGS},environment={...DEFAULT_ENV},target={...DEFAULT_TARGET},weights={...METRIC_WEIGHTS},presetIds=PRESETS.map(p=>p.id),progress=()=>{},yieldTask=async()=>{},withThreatFrames=true}){
 settings=resolveTask3Settings(settings);validatePresetIds(presetIds);validateTarget(target);validateEnvironment(environment);
 const landmark=museumLandmark(city);if(!landmark)throw Error('缺少河南博物院核心区定位');
 const start=Date.now(),run=createRun({label:'task3-pipeline',settings:structuredClone(settings),weights,equipment:presetIds,environment,target,origin:city.metadata.origin,inputHashes:city.metadata.sources});
 // ① 候选方案生成（含采样与覆盖矩阵评估）
 progress({stage:'candidates',completed:0,total:1});
 const dataBounds=query.getDataBounds?.()??null,sampling=generateSamples(city,query,settings,dataBounds),scope=createScopeMetadata(settings,sampling,dataBounds);
 sampling.dataCoverage=scope;
 const {candidates,sites}=generateCandidatesWithEquipment(city,query,settings,sampling,presetIds);
 const conditions=scenarios(environment),n=sampling.samples.length;
 const weights1=conditions.flatMap((_,c)=>sampling.samples.map(p=>p.weight*(c===0?2:1)));
 progress({stage:'candidates',completed:1,total:1});
 // ② 覆盖推演
 const contexts=await evaluateCandidates({candidates,sampling,conditions,settings,environment,target,query,progress,yieldTask});
 // 残余盲点邻近补点（沿用 optimizer 的 repair 手法）：候选集仍无法覆盖的位置，在邻近真实表面搜索可见补点。
 {
  const repairPreset=presetIds.includes('radar-03d')?'radar-03d':(presetIds.find(id=>PRESETS.find(p=>p.id===id)?.type==='radar')??null);
  const union=new Uint8Array(weights1.length);for(const c of candidates)for(const j of c.cover)union[j]=1;
  const holes=sampling.samples.map((p,j)=>({p,j})).filter(({j})=>conditions.some((_,c)=>!union[c*n+j])).sort((a,b)=>Number(b.p.core)-Number(a.p.core)||a.p.agl-b.p.agl);
  const anchors=new Set();let repairSites=0;const maxRepairs=Math.min(64,Math.max(0,settings.maxSites-sites.length));
  if(repairPreset)for(const {p,j} of holes){
   const key=[p.position[0].toFixed(0),p.position[2].toFixed(0)].join(',');if(anchors.has(key)||repairSites>=maxRepairs)continue;anchors.add(key);
   let found=null;
   for(const radius of [80,180,350]){for(let a=0;a<12;a++){
    const angle=a*Math.PI/6,x=p.position[0]+radius*Math.cos(angle),z=p.position[2]+radius*Math.sin(angle);
    if(settings.scope==='custom'&&(x<sampling.bounds.west||x>=sampling.bounds.east||z<sampling.bounds.south||z>=sampling.bounds.north))continue;
    const ground=query.groundAt(x,z),surface=query.surfaceAt(x,z);
    if(ground===null||surface===null)continue;const position=[x,surface+2,z],direction=angles(position,p.position);
    const device=createDevice(repairPreset,`task3-repair-${repairSites+1}`,position);device.parameters.pitch=Math.max(-60,Math.min(0,direction.elevation-30));device.parameters.frequencyGHz=modelChannel(repairPreset,repairSites);
    const context=query.trace(position,p.position);if(!context.known||context.blocked)continue;
    if(conditions.every(condition=>{const result=evaluate(device,{...target,position:p.position,...condition.target},condition.environment,context);return result.status==='within-model'&&result.marginDb>=settings.marginReserveDb;})){
     found={device,site:{id:`repair-site-${repairSites+1}`,position,buildingId:null,name:'残余盲点邻近补点',installationProxy:1+(surface-ground)/100,installation:'实际网格表面上方 2 m，补点施工条件未实测'},cost:settings.costs.radar+(1+(surface-ground)/100)*0.2};break;
    }
   }if(found)break;}
   if(found){candidates.push(found);await evaluateCandidates({candidates:[found],sampling,conditions,settings,environment,target,query,progress:()=>{},yieldTask}).then(r=>{for(const [k,v] of r.entries())contexts.set(k,v);});repairSites++;}
  }
  if(repairSites)progress({stage:'coverage',completed:candidates.length,total:candidates.length,samples:n});
 }
 // 三套差异化策略：经济型（仅雷达+无线电长距装备、半预算）、均衡型（全类型、3/4 预算）、
 // 冗余增强型（全类型、全预算，饱和后对核心区样本追加二重覆盖）。类型组合/点位/预算均不同。
 const radarRadio=presetIds.filter(id=>['radar','radio'].includes(PRESETS.find(p=>p.id===id)?.type));
 const policies=[
  {id:'economy',name:'经济型 · 雷达+无线电',presetSubset:radarRadio.length?radarRadio:presetIds,budget:Math.round(settings.budget*0.5),maxDevices:Math.max(1,Math.round(settings.maxDevices*0.5)),redundancy:0},
  {id:'balanced',name:'均衡型 · 全类型',presetSubset:presetIds,budget:Math.round(settings.budget*0.75),maxDevices:Math.max(1,Math.round(settings.maxDevices*0.75)),redundancy:0},
  {id:'enhanced',name:'冗余增强型 · 全类型+核心双覆盖',presetSubset:presetIds,budget:settings.budget,maxDevices:settings.maxDevices,redundancy:0.5},
 ];
 // 冗余增强：饱和后继续按“第二重覆盖增益 ×redundancy / 成本”补选，直至预算/设备上限。
 function chooseWithRedundancy(pool,policy){
  const chosen=chooseGreedy(pool,weights1,policy);if(!policy.redundancy)return chosen;
  const counts=new Uint16Array(weights1.length);for(const i of chosen.indices)for(const j of pool[i].cover)counts[j]++;
  let cost=chosen.cost;const selected=[...chosen.indices];
  while(selected.length<policy.maxDevices){
   let best=-1,bestScore=0;
   for(let i=0;i<pool.length;i++){
    if(selected.includes(i)||cost+pool[i].cost>policy.budget+1e-9)continue;
    let gain=0;for(const j of pool[i].cover){if(counts[j]===0)gain+=weights1[j];else if(counts[j]===1)gain+=weights1[j]*policy.redundancy;}
    const score=gain/pool[i].cost;if(score>bestScore+1e-10){bestScore=score;best=i;}
   }
   if(best<0)break;selected.push(best);cost+=pool[best].cost;for(const j of pool[best].cover)counts[j]++;
  }
  const covered=new Uint8Array(weights1.length);for(const i of selected)for(const j of pool[i].cover)covered[j]=1;
  return {indices:selected,cost,covered:Array.from(covered)};
 }
 // 选后初始换频（图着色式贪心）只使用既有模型频道；残余 fail 交由可审计处置流程处理。
 function assignRadarChannels(devices){
  const groups={};for(const d of devices){if(d.type!=='radar')continue;const g=d.presetId;groups[g]??=[];groups[g].push(d);}
  for(const [presetId,list] of Object.entries(groups)){
   const channels=EQUIPMENT_CHANNELS_GHZ[presetId]??[],assigned=[];if(!channels.length)continue;
   for(const d of list){
    let best=channels[0],bestScore=Infinity;
    for(const ch of channels){const same=assigned.filter(o=>Math.abs(o.ch-ch)<EMC_RULES.coChannelSeparationGHz&&distance3D(o.device,d)<EMC_RULES.coChannelMinDistanceM).length;const adj=assigned.filter(o=>Math.abs(o.ch-ch)>=EMC_RULES.coChannelSeparationGHz&&Math.abs(o.ch-ch)<EMC_RULES.adjacentChannelGHz&&distance3D(o.device,d)<EMC_RULES.adjacentMinDistanceM).length;const score=same*10+adj;if(score<bestScore){bestScore=score;best=ch;}}
    d.parameters.frequencyGHz=best;assigned.push({device:d,ch:best});
   }
  }
 }
 function sameCoverageDevice(a,b){
  if(a.position.some((v,i)=>v!==b.position[i]))return false;
  const ap=a.parameters??{},bp=b.parameters??{},keys=new Set([...Object.keys(ap),...Object.keys(bp)]);
  return [...keys].every(k=>ap[k]===bp[k]);
 }
 function coverageMetrics(coverage){
  return coverage.map((counts,c)=>({condition:conditions[c].id,name:conditions[c].name,covered:Array.from(counts).filter(x=>x>0).length,total:n,coverageRate:Array.from(counts).filter(x=>x>0).length/n,blindRate:Array.from(counts).filter(x=>!x).length/n,redundant:Array.from(counts).filter(x=>x>1).length,coreCoverageRate:sampling.samples.reduce((sum,p,j)=>sum+(p.core&&counts[j]>0?1:0),0)/Math.max(1,sampling.samples.filter(p=>p.core).length),coreRedundantRate:sampling.samples.reduce((sum,p,j)=>sum+(p.core&&counts[j]>1?1:0),0)/Math.max(1,sampling.samples.filter(p=>p.core).length)}));
 }
 const coverageSummary=metrics=>metrics.map(m=>({condition:m.condition,covered:m.covered,total:m.total,coverageRate:m.coverageRate,coreCoverageRate:m.coreCoverageRate}));
 // 最终方案逐设备使用实际载频/位置重跑受影响覆盖；未变设备复用其真实候选覆盖矩阵。
 async function calculatePlanCoverage({devices,sites,indices,pool}){
  const emc=emcAnalysis(devices),coverage=conditions.map(()=>new Uint16Array(n)),deviceCoverage=devices.map(()=>conditions.map(()=>new Uint8Array(n))),reevaluatedDeviceIds=[];
  for(let k=0;k<devices.length;k++){
   const candidate=pool[indices[k]];let cover=candidate.cover;
   if(!sameCoverageDevice(candidate.device,devices[k])){
    const actual={...candidate,device:devices[k],site:sites[k]};
    await evaluateCandidates({candidates:[actual],sampling,conditions,settings,environment,target,query,progress:()=>{},yieldTask,contexts});cover=actual.cover;reevaluatedDeviceIds.push(devices[k].id);
   }
   for(const j of cover){const c=Math.floor(j/n),index=j%n,penalty=emc.penalties[devices[k].id]??0;
    if(penalty>0){const condition=conditions[c],checked=evaluate(devices[k],{...target,position:sampling.samples[index].position,...condition.target},{...condition.environment,cochannelDb:condition.environment.cochannelDb+penalty},contexts.get(`${sites[k].id}:${index}`));if(checked.status!=='within-model'||checked.marginDb<settings.marginReserveDb)continue;}
    deviceCoverage[k][c][index]=1;coverage[c][index]++;
   }
  }
  const coverageContributions=Object.fromEntries(devices.map((device,k)=>[device.id,conditions.map((condition,c)=>{
   let coveredSamples=0,independentSamples=0;
   for(let index=0;index<n;index++)if(deviceCoverage[k][c][index]){coveredSamples++;if(coverage[c][index]===1)independentSamples++;}
   return {condition:condition.id,coveredSamples,independentSamples};
  })]));
  return {emc,coverage,metrics:coverageMetrics(coverage),coverageContributions,reevaluatedDeviceIds};
 }
 function candidateCoverageValue(pool){
  return (_devices,_sites,indices)=>{const covered=new Uint8Array(weights1.length);for(const i of indices)if(i>=0)for(const j of pool[i].cover)covered[j]=1;return covered.reduce((sum,v,j)=>sum+v*weights1[j],0);};
 }
 const plans=[];
 for(const policy of policies){
  const pool=candidates.filter(c=>policy.presetSubset.includes(c.device.presetId));
  const chosen=chooseWithRedundancy(pool,policy),initial={indices:[...chosen.indices],devices:chosen.indices.map(i=>structuredClone(pool[i].device)),sites:chosen.indices.map(i=>structuredClone(pool[i].site)),pool};
  assignRadarChannels(initial.devices);
  const remediation=remediateEmcConflicts({...initial,candidates:pool,measureCoverage:candidateCoverageValue(pool)});
  const beforeCoverage=remediation.before.counts.fail?await calculatePlanCoverage(initial):null;
  const finalState={indices:remediation.indices,devices:remediation.devices,sites:remediation.sites,pool},finalCoverage=await calculatePlanCoverage(finalState);
  remediation.after=emcSnapshot(finalCoverage.emc);remediation.unresolved=remediation.after.conflicts.filter(c=>c.severity==='fail');remediation.deployable=!finalCoverage.emc.counts.fail;
  remediation.coverageReview={before:beforeCoverage?coverageSummary(beforeCoverage.metrics):null,after:coverageSummary(finalCoverage.metrics),reevaluatedDeviceIds:finalCoverage.reevaluatedDeviceIds};
  plans.push({id:policy.id,name:policy.name,budget:policy.budget,maxDevices:policy.maxDevices,presetSubset:policy.presetSubset,devices:finalState.devices,cost:finalState.indices.reduce((sum,i)=>sum+pool[i].cost,0),installationProxy:finalState.sites.reduce((sum,s)=>sum+s.installationProxy,0),sites:finalState.sites,metrics:finalCoverage.metrics,coverage:finalCoverage.coverage.map(counts=>Array.from(counts)),coverageContributions:finalCoverage.coverageContributions,deployable:remediation.deployable,emcRemediation:remediation});
 }
 // 四类盲区分类（每方案 × 每工况）
 const blindspots={};
 for(const plan of plans){blindspots[plan.id]=[];for(let c=0;c<conditions.length;c++)blindspots[plan.id].push(classifyBlindSpots({city,samples:sampling.samples,coverageRow:plan.coverage[c],devices:plan.devices,query,target,environment:conditions[c].environment,conditionId:conditions[c].id}));}
 progress({stage:'coverage',completed:candidates.length,total:candidates.length,samples:n});
 // ③ 多指标择优 + EMC 校核 + 回写
 progress({stage:'scoring',completed:0,total:1});
 const emcByPlan={},emcReports={};
 for(const plan of plans){const result=emcAnalysis(plan.devices);emcByPlan[plan.id]={verdict:result.verdict,counts:result.counts};emcReports[plan.id]={...result,text:emcVerdictText(result),remediation:plan.emcRemediation};}
 let scoring=scorePlans({plans,conditions,weights});
 scoring=applyEmcToScoring(scoring,emcByPlan);
 const table=comparisonTable(scoring,conditions);
 progress({stage:'scoring',completed:1,total:1});
 // ④ 三类威胁场景验证（对推荐方案）
 progress({stage:'threats',completed:0,total:3});
 const recommended=plans.find(p=>p.id===scoring.recommendedId),threats={};
 const scenarioEnv=conditions[0].environment,scenarioTarget={...target,...conditions[0].target};
 let ti=0;
 for(const key of ['single','multi','swarm']){
  const routes=buildThreatRoutes(query,sampling.bounds,key);
  const result=await simulateThreat({query,devices:recommended.devices,routes,target:scenarioTarget,environment:scenarioEnv,core:sampling.bounds.core,coreRadius:settings.coreRadius,interval:2,simultaneous:key!=='single',progress:()=>{},yieldTask});
  threats[key]={...result,text:threatSummaryText(result)};if(!withThreatFrames)threats[key]={routes:result.routes,interval:result.interval,perTarget:result.perTarget,summary:result.summary,notes:result.notes,text:threats[key].text};
  ti++;progress({stage:'threats',completed:ti,total:3});
 }
 // ⑤ EMC 校核结论已在 ③ 计算，此处仅汇总阶段完成信号
 progress({stage:'emc',completed:1,total:1});
 const report={version:TASK3_VERSION,createdAt:new Date().toISOString(),settings:structuredClone(settings),scope,weights,equipment:PRESETS.filter(p=>presetIds.includes(p.id)).map(p=>({id:p.id,name:p.name,type:p.type})),environment:structuredClone(environment),target:structuredClone(target),origin:city.metadata.origin,inputHashes:city.metadata.sources,sampling,conditions:conditions.map(({id,name})=>({id,name})),candidateCount:candidates.length,siteCount:sites.length,plans,blindspots,scoring,comparison:table,threats,emc:emcReports,recommendedId:scoring.recommendedId,deploymentStatus:scoring.recommendationStatus,durationMs:Date.now()-start,limitations:['覆盖率仅针对所列有效空域采样点，不是连续空间无盲区证明。','盲区四分类为几何归因初值，阈值将按多轮仿真统计校订。','威胁推演为运动学逐帧模型，检出全部来自感知模型实判；蜂群容量溢出如实计数。','EMC 为工程代理规则，非频谱合规认证；自动处置仅使用既有模型离散频道和真实候选点，处置后的实际载频/位置已按同一感知模型重算受影响覆盖。','成本为相对成本单位，非人民币报价；施工可行性为重量/尺寸/架设方式/安装高度代理，未实测。']};
 if(scope.clipped)report.limitations.push(scope.note);
 enrichReport(report,city); // 复用 areaEstimates/typeCounts
 // 规则提炼输入：候选池覆盖统计（类型/相对高度/覆盖数）与推荐方案分层盲区，供 rules.js 基于多轮数据统计阈值。
 const siteElevations=sites.map(s=>s.position[1]),sortedElev=[...siteElevations].sort((a,b)=>a-b);
 const heightRankOf=y=>sortedElev.filter(v=>v<=y).length/sortedElev.length;
 const candidateStats=candidates.map(c=>({type:c.device.type,presetId:c.device.presetId,heightRank:heightRankOf(c.site.position[1]),coverCount:c.cover.length}));
 const recId=scoring.recommendedId,recPlan=plans.find(p=>p.id===recId),nominal=conditions[0].id;
 const perHeightBlind=settings.heights.map(h=>{const idx=sampling.samples.map((p,j)=>({p,j})).filter(({p})=>p.kind==='grid'&&p.agl===h);const blind=idx.filter(({j})=>!recPlan.coverage[0][j]).length;return {height:h,validGridCells:idx.length,blindGridCells:blind};});
 const rulesInput={candidateStats,perHeightBlind,recommendedId:recId,nominalCondition:nominal};
 const runRecord=finalizeRun(run,{summary:{samples:n,candidates:candidates.length,sites:sites.length,plans:plans.map(p=>({id:p.id,name:p.name,devices:p.devices.length,cost:p.cost,feasibility:scoring.plans.find(r=>r.id===p.id)?.indicators.feasibility??null,score:scoring.plans.find(r=>r.id===p.id)?.score??null,rank:scoring.plans.find(r=>r.id===p.id)?.rank??null,emcVerdict:emcByPlan[p.id].verdict,deployable:p.deployable,emcResolutionStatus:p.emcRemediation.status,metrics:p.metrics})) ,recommendedId:recId},blindspots:Object.fromEntries(Object.entries(blindspots).map(([pid,rows])=>[pid,rows.map(r=>({conditionId:r.conditionId,stats:r.stats,points:r.points.map(p=>({sampleId:p.sampleId,position:p.position,agl:p.agl,core:p.core,category:p.category,cause:p.cause}))}))])),threats:Object.fromEntries(Object.entries(threats).map(([k,v])=>[k,{summary:v.summary,perTarget:v.perTarget}])),emc:Object.fromEntries(Object.entries(emcReports).map(([pid,r])=>[pid,{verdict:r.verdict,counts:r.counts,conflicts:r.conflicts,remediation:r.remediation}])),durationMs:report.durationMs,limitations:report.limitations});
 runRecord.rulesInput=rulesInput;runRecord.scope=structuredClone(scope);
 return {report,run:runRecord};
}
