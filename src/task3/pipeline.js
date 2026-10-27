// 任务三自动化流水线：候选方案生成 → 覆盖推演 → 多指标择优 → 威胁场景验证 → 电磁兼容校核。
// 候选生成/采样/贪心复用 src/planning/optimizer.js 的导出件；装备选择（presetIds）在本层注入，
// 不改动既有 optimizer。检出判定复用 sensors/engine.js evaluate + scene.js query.trace。
import {generateSamples,scenarios,chooseGreedy,validateSettings,DEFAULT_SETTINGS} from '../planning/optimizer.js';
import {enrichReport} from '../planning/report.js';
import {createDevice,PRESETS,DEFAULT_ENV,DEFAULT_TARGET} from '../sensors/presets.js';
import {evaluate,angles,validateTarget,validateEnvironment} from '../sensors/engine.js';
import {museumLandmark} from '../landmarks.js';
import {classifyBlindSpots} from './blindspots.js';
import {scorePlans,comparisonTable} from './metrics.js';
import {buildThreatRoutes,simulateThreat,threatSummaryText} from './threats.js';
import {emcAnalysis,emcVerdictText} from './emc.js';
import {createRun,finalizeRun} from './runs.js';
import {TASK3_VERSION,METRIC_WEIGHTS,EQUIPMENT_FACTS} from './constants.js';

export const PIPELINE_STAGES=['candidates','coverage','scoring','threats','emc'];
export const STAGE_NAMES={candidates:'候选方案生成',coverage:'覆盖推演',scoring:'多指标择优',threats:'威胁场景验证',emc:'电磁兼容校核'};

// 装备选择校验：至少选一个预设；未知预设抛错。
export function validatePresetIds(presetIds){
 if(!Array.isArray(presetIds)||!presetIds.length)throw Error('至少选择一款装备');
 for(const id of presetIds)if(!PRESETS.some(p=>p.id===id))throw Error(`未知装备预设 ${id}`);
 return presetIds;
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
  if(device.type==='radar'){device.parameters.pitch=pitch;device.parameters.frequencyGHz=(presetId==='radar-02c'?9.3+(index%4)*0.15:16+(index%4)*0.5);} // X/Ku 带内频道分组（模型假设）
  if(['optical','acoustic'].includes(device.type))device.parameters.heading=angles(device.position,bounds.core).azimuth;
  candidates.push({device,site,cost:settings.costs[device.type]+site.installationProxy*0.2});
 }
 return {candidates,sites};
}

async function evaluateCandidates({candidates,sampling,conditions,settings,environment,target,query,progress,yieldTask}){
 const n=sampling.samples.length,contexts=new Map();
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

// EMC 回写择优：fail 每例 ×0.85（下限 0.7），degraded ×0.97；口径写入 scoring.methodEmc。
function applyEmcToScoring(scored,emcByPlan){
 for(const row of scored.plans){
  const emc=emcByPlan[row.id];if(!emc)continue;
  const factor=emc.counts.fail?Math.max(0.7,0.85**emc.counts.fail):emc.counts.warning?0.97:1;
  row.emcVerdict=emc.verdict;row.emcFactor=factor;row.scoreRaw=row.score;row.score=row.score*factor;
 }
 [...scored.plans].sort((a,b)=>b.score-a.score||a.indicators.cost-b.indicators.cost).forEach((r,i)=>r.rank=i+1);
 scored.plans.sort((a,b)=>a.rank-b.rank);
 scored.recommendedId=scored.plans[0].id;
 scored.methodEmc='EMC 结论回写：方案存在 fail 级冲突时每例得分 ×0.85（累计下限 0.7），仅 warning 时 ×0.97，通过不调整；推荐序按回写后得分重排。';
 return scored;
}

export async function runTask3Pipeline({city,query,settings={...DEFAULT_SETTINGS,scope:'core',siteSpacing:500},environment={...DEFAULT_ENV},target={...DEFAULT_TARGET},weights={...METRIC_WEIGHTS},presetIds=PRESETS.map(p=>p.id),progress=()=>{},yieldTask=async()=>{},withThreatFrames=true}){
 validateSettings(settings);validatePresetIds(presetIds);validateTarget(target);validateEnvironment(environment);
 const landmark=museumLandmark(city);if(!landmark)throw Error('缺少河南博物院核心区定位');
 const start=Date.now(),run=createRun({label:'task3-pipeline',settings,weights,equipment:presetIds,environment,target,origin:city.metadata.origin,inputHashes:city.metadata.sources});
 // ① 候选方案生成（含采样与覆盖矩阵评估）
 progress({stage:'candidates',completed:0,total:1});
 const sampling=generateSamples(city,query,settings);
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
    const angle=a*Math.PI/6,x=p.position[0]+radius*Math.cos(angle),z=p.position[2]+radius*Math.sin(angle),ground=query.groundAt(x,z),surface=query.surfaceAt(x,z);
    if(ground===null||surface===null)continue;const position=[x,surface+2,z],direction=angles(position,p.position);
    const device=createDevice(repairPreset,`task3-repair-${repairSites+1}`,position);device.parameters.pitch=Math.max(-60,Math.min(0,direction.elevation-30));device.parameters.frequencyGHz=repairPreset==='radar-02c'?9.3+(repairSites%4)*0.15:16+(repairSites%4)*0.5;
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
 // 选后换频（图着色式贪心）：对方案内雷达按预设频道组重新分配载频，最小化 600 m 内同频对；
 // 换频后仍存在的冲突才是真实 EMC 冲突。频道分组为模型假设（X 带 4×0.15 GHz、Ku 带 4×0.5 GHz）。
 function assignRadarChannels(devices){
  const groups={};for(const d of devices){if(d.type!=='radar')continue;const g=d.presetId;groups[g]??=[];groups[g].push(d);}
  for(const [presetId,list] of Object.entries(groups)){
   const base=presetId==='radar-02c'?9.3:16,step=presetId==='radar-02c'?0.15:0.5,channels=[0,1,2,3].map(i=>base+i*step);
   const assigned=[];
   for(const d of list){
    let best=channels[0],bestScore=Infinity;
    for(const ch of channels){const same=assigned.filter(o=>Math.abs(o.ch-ch)<0.1&&Math.hypot(...o.device.position.map((v,k)=>v-d.position[k]))<600).length;const adj=assigned.filter(o=>Math.abs(o.ch-ch)>=0.1&&Math.abs(o.ch-ch)<0.5&&Math.hypot(...o.device.position.map((v,k)=>v-d.position[k]))<300).length;const score=same*10+adj;if(score<bestScore){bestScore=score;best=ch;}}
    d.parameters.frequencyGHz=best;assigned.push({device:d,ch:best});
   }
  }
 }
 const plans=[];
 for(const policy of policies){
  const pool=candidates.filter(c=>policy.presetSubset.includes(c.device.presetId));
  const chosen=chooseWithRedundancy(pool,policy),devices=chosen.indices.map(i=>structuredClone(pool[i].device));
  assignRadarChannels(devices);const emcProxy=emcAnalysis(devices),coverage=conditions.map(()=>new Uint16Array(n));
  for(const i of chosen.indices)for(const j of pool[i].cover){const c=Math.floor(j/n),index=j%n;
   if(emcProxy.penalties[pool[i].device.id]>0){const condition=conditions[c],result=evaluate(pool[i].device,{...target,position:sampling.samples[index].position,...condition.target},{...condition.environment,cochannelDb:condition.environment.cochannelDb+emcProxy.penalties[pool[i].device.id]},contexts.get(`${pool[i].site.id}:${index}`));if(result.status!=='within-model'||result.marginDb<settings.marginReserveDb)continue;}
   coverage[c][index]++;
  }
  const metrics=coverage.map((counts,c)=>({condition:conditions[c].id,name:conditions[c].name,covered:Array.from(counts).filter(x=>x>0).length,total:n,coverageRate:Array.from(counts).filter(x=>x>0).length/n,blindRate:Array.from(counts).filter(x=>!x).length/n,redundant:Array.from(counts).filter(x=>x>1).length,coreCoverageRate:sampling.samples.reduce((sum,p,j)=>sum+(p.core&&counts[j]>0?1:0),0)/Math.max(1,sampling.samples.filter(p=>p.core).length),coreRedundantRate:sampling.samples.reduce((sum,p,j)=>sum+(p.core&&counts[j]>1?1:0),0)/Math.max(1,sampling.samples.filter(p=>p.core).length)}));
  plans.push({id:policy.id,name:policy.name,budget:policy.budget,maxDevices:policy.maxDevices,presetSubset:policy.presetSubset,devices,cost:chosen.cost,installationProxy:chosen.indices.reduce((sum,i)=>sum+pool[i].site.installationProxy,0),sites:chosen.indices.map(i=>pool[i].site),metrics,coverage:coverage.map(counts=>Array.from(counts))});
 }
 // 四类盲区分类（每方案 × 每工况）
 const blindspots={};
 for(const plan of plans){blindspots[plan.id]=[];for(let c=0;c<conditions.length;c++)blindspots[plan.id].push(classifyBlindSpots({city,samples:sampling.samples,coverageRow:plan.coverage[c],devices:plan.devices,query,target,environment:conditions[c].environment,conditionId:conditions[c].id}));}
 progress({stage:'coverage',completed:candidates.length,total:candidates.length,samples:n});
 // ③ 多指标择优 + EMC 校核 + 回写
 progress({stage:'scoring',completed:0,total:1});
 const emcByPlan={},emcReports={};
 for(const plan of plans){const result=emcAnalysis(plan.devices);emcByPlan[plan.id]={verdict:result.verdict,counts:result.counts};emcReports[plan.id]={...result,text:emcVerdictText(result)};}
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
 const report={version:TASK3_VERSION,createdAt:new Date().toISOString(),settings:structuredClone(settings),weights,equipment:PRESETS.filter(p=>presetIds.includes(p.id)).map(p=>({id:p.id,name:p.name,type:p.type})),environment:structuredClone(environment),target:structuredClone(target),origin:city.metadata.origin,inputHashes:city.metadata.sources,sampling,conditions:conditions.map(({id,name})=>({id,name})),candidateCount:candidates.length,siteCount:sites.length,plans,blindspots,scoring,comparison:table,threats,emc:emcReports,recommendedId:scoring.recommendedId,durationMs:Date.now()-start,limitations:['覆盖率仅针对所列有效空域采样点，不是连续空间无盲区证明。','盲区四分类为几何归因初值，阈值将按多轮仿真统计校订。','威胁推演为运动学逐帧模型，检出全部来自感知模型实判；蜂群容量溢出如实计数。','EMC 为工程代理规则，非频谱合规认证；选后换频引起的载频微调（X 带 ≤0.45 / Ku 带 ≤1.5 GHz）对单点裕量的影响未逐点重估，覆盖复核仅在 EMC 罚值大于零时进行。','成本为相对成本单位，非人民币报价；施工可行性为重量/尺寸/架设方式/安装高度代理，未实测。']};
 enrichReport(report,city); // 复用 areaEstimates/typeCounts
 // 规则提炼输入：候选池覆盖统计（类型/相对高度/覆盖数）与推荐方案分层盲区，供 rules.js 基于多轮数据统计阈值。
 const siteElevations=sites.map(s=>s.position[1]),sortedElev=[...siteElevations].sort((a,b)=>a-b);
 const heightRankOf=y=>sortedElev.filter(v=>v<=y).length/sortedElev.length;
 const candidateStats=candidates.map(c=>({type:c.device.type,presetId:c.device.presetId,heightRank:heightRankOf(c.site.position[1]),coverCount:c.cover.length}));
 const recId=scoring.recommendedId,recPlan=plans.find(p=>p.id===recId),nominal=conditions[0].id;
 const perHeightBlind=settings.heights.map(h=>{const idx=sampling.samples.map((p,j)=>({p,j})).filter(({p})=>p.kind==='grid'&&p.agl===h);const blind=idx.filter(({j})=>!recPlan.coverage[0][j]).length;return {height:h,validGridCells:idx.length,blindGridCells:blind};});
 const rulesInput={candidateStats,perHeightBlind,recommendedId:recId,nominalCondition:nominal};
 const runRecord=finalizeRun(run,{summary:{samples:n,candidates:candidates.length,sites:sites.length,plans:plans.map(p=>({id:p.id,name:p.name,devices:p.devices.length,cost:p.cost,feasibility:scoring.plans.find(r=>r.id===p.id)?.indicators.feasibility??null,score:scoring.plans.find(r=>r.id===p.id)?.score??null,rank:scoring.plans.find(r=>r.id===p.id)?.rank??null,emcVerdict:emcByPlan[p.id].verdict,metrics:p.metrics})) ,recommendedId:recId},blindspots:Object.fromEntries(Object.entries(blindspots).map(([pid,rows])=>[pid,rows.map(r=>({conditionId:r.conditionId,stats:r.stats,points:r.points.map(p=>({sampleId:p.sampleId,position:p.position,agl:p.agl,core:p.core,category:p.category,cause:p.cause}))}))])),threats:Object.fromEntries(Object.entries(threats).map(([k,v])=>[k,{summary:v.summary,perTarget:v.perTarget}])),emc:Object.fromEntries(Object.entries(emcReports).map(([pid,r])=>[pid,{verdict:r.verdict,counts:r.counts,conflicts:r.conflicts}])),durationMs:report.durationMs,limitations:report.limitations});
 runRecord.rulesInput=rulesInput;
 return {report,run:runRecord};
}
