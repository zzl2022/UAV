// 警车移动雷达补盲：仅对当前方案做增量搜索与覆盖复核，不重跑候选生成、择优或威胁流水线。
// 车载只改变部署方式；雷达射频参数复用用户已选预设，挂载高度与地表代理假设显式记录。
import {createDevice,PRESETS} from '../sensors/presets.js';
import {resolveEquipmentProfiles,applyEquipmentProfile} from '../sensors/equipment-catalog.js';
import {evaluate,angles} from '../sensors/engine.js';
import {scenarios} from '../planning/optimizer.js';
import {classifyBlindSpots} from './blindspots.js';
import {emcAnalysis,emcVerdictText} from './emc.js';
import {EQUIPMENT_CHANNELS_GHZ} from './constants.js';

export const MOBILE_REPAIR_LIMITS={maxAnchors:12,maxCandidates:144,maxDevices:6,radiiM:[500,750,1000],directions:12,fineRadiusM:750,fineGridStepM:25,maxFineCandidatesPerAnchor:4096,maxFineCoveringPerAnchor:8,mountHeightM:2,surfaceToleranceM:0.5};
const GEOMETRIC=['近距盲区','超出标称距离','超出方位视场','超出俯仰视场'];
const ASSUMPTIONS=['警车仅作为部署方式，不改变装备文档中的雷达射频性能。',`车载雷达挂载高度 ${MOBILE_REPAIR_LIMITS.mountHeightM} m 为模型假设，非装备文档参数。`,'现有数据没有完整道路网；候选仅是地表几何代理，不代表已验证道路可达、停车或施工条件。','新增成本沿用任务三相对成本代理，非人民币报价；原方案比较排名不重算。'];

function coverageMetrics(coverage,samples,conditions){
 const n=samples.length,coreTotal=Math.max(1,samples.filter(p=>p.core).length);
 return coverage.map((counts,c)=>({condition:conditions[c].id,name:conditions[c].name,covered:counts.filter(x=>x>0).length,total:n,coverageRate:counts.filter(x=>x>0).length/n,blindRate:counts.filter(x=>!x).length/n,redundant:counts.filter(x=>x>1).length,coreCoverageRate:samples.reduce((sum,p,j)=>sum+(p.core&&counts[j]>0?1:0),0)/coreTotal,coreRedundantRate:samples.reduce((sum,p,j)=>sum+(p.core&&counts[j]>1?1:0),0)/coreTotal}));
}

function resultWithoutDevices(plan,summary){
 return {planId:plan.id,plan:{...structuredClone(plan),derivation:summary},blindspots:null,emc:null,summary};
}

function summarizeBase(plan,conditionId,blindIndices,samples,limits){
 return {type:'mobile-radar-repair',basePlanId:plan.id,conditionId,status:'pending',message:'',baseDeviceCount:plan.devices.length,addedDeviceCount:0,addedDeviceIds:[],baseCost:plan.cost,addedCost:0,totalCost:plan.cost,beforeBlindCount:blindIndices.length,afterBlindCount:blindIndices.length,coveredSampleIds:[],remainingSampleIds:blindIndices.map(j=>samples[j].id),selected:[],actions:[],radarPresetId:null,search:{anchors:0,validGroundCandidates:0,evaluatedCandidates:0,coveringCandidates:0,coarseGroundCandidates:0,coarseCoveringCandidates:0,fineAnchors:0,fineGroundCandidates:0,fineEvaluatedCandidates:0,fineCoveringCandidates:0,fineRadiusM:limits?.fineRadiusM??MOBILE_REPAIR_LIMITS.fineRadiusM,fineGridStepM:limits?.fineGridStepM??MOBILE_REPAIR_LIMITS.fineGridStepM,emcRejectedCandidates:0},assumptions:[...ASSUMPTIONS],candidateMeaning:'真实地形上的开阔地表几何代理；未验证道路可达性。',originalComparisonUnchanged:true};
}

// UI 与测试共用的派生状态写回/恢复；快照保存原对象，重复取消不会累积移动设备。
export function applyMobileRepairResult(report,result){
 const index=report.plans.findIndex(p=>p.id===result.planId);if(index<0)throw Error(`找不到补盲方案 ${result.planId}`);
 const snapshot={planId:result.planId,index,plan:report.plans[index],blindspots:report.blindspots[result.planId],emc:report.emc[result.planId]};
 report.plans[index]=result.plan;
 if(result.blindspots)report.blindspots[result.planId]=result.blindspots;
 if(result.emc)report.emc[result.planId]=result.emc;
 report.mobileRepair=structuredClone(result.summary);
 return snapshot;
}

export function restoreMobileRepairSnapshot(report,snapshot){
 if(!snapshot)return;
 report.plans[snapshot.index]=snapshot.plan;report.blindspots[snapshot.planId]=snapshot.blindspots;report.emc[snapshot.planId]=snapshot.emc;
 if(report.mobileRepair?.basePlanId===snapshot.planId)delete report.mobileRepair;
}

export async function repairPlanWithMobileRadars({city,query,plan,sampling,equipment,equipmentSnapshot=null,settings,environment,target,conditionId='nominal',progress=()=>{},yieldTask=async()=>{},adapters={},limits=MOBILE_REPAIR_LIMITS}){
 const equipmentProfiles=resolveEquipmentProfiles(equipmentSnapshot),evaluateSensor=adapters.evaluate??evaluate,analyzeEmc=adapters.emcAnalysis??emcAnalysis,classify=adapters.classifyBlindSpots??classifyBlindSpots;
 const conditions=scenarios(environment),conditionIndex=conditions.findIndex(c=>c.id===conditionId);if(conditionIndex<0)throw Error(`未知覆盖工况 ${conditionId}`);
 const samplesList=sampling.samples,n=samplesList.length;
 const blindIndices=(plan.coverage[conditionIndex]??[]).map((count,j)=>count===0?j:-1).filter(j=>j>=0);
 const summary=summarizeBase(plan,conditionId,blindIndices,samplesList,limits),original=structuredClone(plan),originalEmc=analyzeEmc(plan.devices);
 const radarIds=equipment.filter(item=>PRESETS.find(p=>p.id===item.id)?.type==='radar').map(item=>item.id);
 const radarPresetId=radarIds.includes('radar-03d')?'radar-03d':radarIds[0]??null;
 if(!radarPresetId){summary.status='no-radar';summary.message='当前推演未选择雷达预设，未部署移动设备，原盲点全部保留。';return resultWithoutDevices(plan,summary);}
 summary.radarPresetId=radarPresetId;
 if(!blindIndices.length){summary.status='no-blindspots';summary.message='当前工况没有采样盲点，无需部署移动雷达。';return resultWithoutDevices(plan,summary);}
 const channels=EQUIPMENT_CHANNELS_GHZ[radarPresetId]??[];if(!channels.length)throw Error(`装备 ${radarPresetId} 缺少合法模型频道`);
 const bounds=sampling.bounds,bySampleId=new Map(samplesList.map((sample,j)=>[sample.id,j]));
 const anchors=[...blindIndices].sort((a,b)=>Number(Boolean(samplesList[b].core))-Number(Boolean(samplesList[a].core))||a-b).slice(0,limits.maxAnchors);
 summary.search.anchors=anchors.length;
 const candidates=[],seen=new Set();
 const addCandidate=(anchorIndex,x,z,searchPhase)=>{
  const anchor=samplesList[anchorIndex];
  if(x<bounds.west||x>=bounds.east||z<bounds.south||z>=bounds.north)return null;
  const key=`${x.toFixed(1)},${z.toFixed(1)}`;if(seen.has(key))return null;seen.add(key);
  const ground=query.groundAt(x,z),surface=query.surfaceAt(x,z);if(ground===null||surface===null)return null;
  // surface==ground 才接受：楼顶或建筑内部高差不满足开阔地表代理。
  if(Math.abs(surface-ground)>limits.surfaceToleranceM)return null;
  const position=[x,ground+limits.mountHeightM,z],direction=angles(position,anchor.position),device=applyEquipmentProfile(createDevice(radarPresetId,`mobile-candidate-${candidates.length+1}`,position),equipmentProfiles);
  device.parameters.pitch=Math.max(-60,Math.min(0,direction.elevation-30));device.parameters.frequencyGHz=channels[0];
  device.mobileRepair={platform:'police-car',deployment:'警车移动部署',mountHeightM:limits.mountHeightM,mountHeightSource:'模型假设',roadReachabilityVerified:false};
  const site={id:`mobile-candidate-site-${candidates.length+1}`,position:[...position],buildingId:null,name:'开阔地表几何代理点（未验证道路可达）',installation:`警车移动部署（可移动雷达）；挂载高度 ${limits.mountHeightM} m（模型假设）；不代表道路可达或施工条件已实测`,deployment:'police-car',groundM:ground,surfaceM:surface,mountHeightM:limits.mountHeightM,mountHeightSource:'模型假设',installationProxy:1,roadReachabilityVerified:false};
  const candidate={key,device,site,anchorIndex,anchorSampleId:anchor.id,searchPhase,coverSampleIds:[]};candidates.push(candidate);return candidate;
 };
 let stopped=false;
 for(const radius of limits.radiiM){
  if(stopped)break;
  for(const anchorIndex of anchors){
   if(stopped)break;
   const anchor=samplesList[anchorIndex];
   for(let a=0;a<limits.directions;a++){
    const angle=a/limits.directions*Math.PI*2,x=anchor.position[0]+radius*Math.cos(angle),z=anchor.position[2]+radius*Math.sin(angle);
    addCandidate(anchorIndex,x,z,'coarse-ring');
    if(candidates.length>=limits.maxCandidates){stopped=true;break;}
   }
  }
 }
 summary.search.validGroundCandidates=candidates.length;summary.search.coarseGroundCandidates=candidates.length;
 const sampleCovered=async(device,j,condition)=>{
  const sample=samplesList[j],base={...target,position:sample.position},quick=evaluateSensor(device,base,environment,{known:true,blocked:false,buildingCount:0});
  if(quick.reasons.some(reason=>GEOMETRIC.includes(reason)))return false;
  const context=query.trace(device.position,sample.position),result=evaluateSensor(device,{...base,...condition.target},condition.environment,context);
  return result.status==='within-model'&&result.marginDb!==null&&result.marginDb>=settings.marginReserveDb;
 };
 const evaluateCandidate=async(candidate,indices,count=true)=>{
  if(count)summary.search.evaluatedCandidates++;
  for(const j of indices){const id=samplesList[j].id;if(!candidate.coverSampleIds.includes(id)&&await sampleCovered(candidate.device,j,conditions[conditionIndex]))candidate.coverSampleIds.push(id);}
 };
 const covering=[],coarseCandidates=[...candidates];
 for(let i=0;i<coarseCandidates.length;i++){
  const candidate=coarseCandidates[i];await evaluateCandidate(candidate,blindIndices);
  if(candidate.coverSampleIds.length)covering.push(candidate);
  progress({stage:'search',completed:i+1,total:coarseCandidates.length});if(i%4===3)await yieldTask();
 }
 summary.search.coveringCandidates=covering.length;summary.search.coarseCoveringCandidates=covering.length;
 const remaining=new Set(blindIndices.map(j=>samplesList[j].id)),selected=[],selectedKeys=new Set(),rejectedKeys=new Set(),devices=structuredClone(plan.devices),fineCompleted=new Set();
 // 粗圆环无法继续减盲时，针对一个剩余盲点做二维细网格；命中后再复算其对其他盲点的贡献。
 const searchFine=async anchorIndex=>{
  fineCompleted.add(anchorIndex);summary.search.fineAnchors++;
  const anchor=samplesList[anchorIndex],steps=Math.floor(limits.fineRadiusM/limits.fineGridStepM),total=Math.min(limits.maxFineCandidatesPerAnchor,(2*steps+1)**2);
  let attempted=0,found=0;
  outer:for(let iz=-steps;iz<=steps;iz++)for(let ix=-steps;ix<=steps;ix++){
   const dx=ix*limits.fineGridStepM,dz=iz*limits.fineGridStepM;if(Math.hypot(dx,dz)>limits.fineRadiusM)continue;
   const candidate=addCandidate(anchorIndex,anchor.position[0]+dx,anchor.position[2]+dz,'fine-grid');if(!candidate)continue;
   attempted++;summary.search.fineGroundCandidates++;summary.search.validGroundCandidates=candidates.length;
   summary.search.fineEvaluatedCandidates++;await evaluateCandidate(candidate,[anchorIndex]);
   if(candidate.coverSampleIds.length){
    await evaluateCandidate(candidate,blindIndices.filter(j=>j!==anchorIndex),false);covering.push(candidate);found++;summary.search.fineCoveringCandidates++;
   }
   progress({stage:'fine-search',completed:attempted,total});if(attempted%4===0)await yieldTask();
   if(found>=limits.maxFineCoveringPerAnchor||attempted>=limits.maxFineCandidatesPerAnchor)break outer;
  }
  summary.search.coveringCandidates=covering.length;progress({stage:'fine-search',completed:attempted,total});await yieldTask();
 };
 while(selected.length<limits.maxDevices&&remaining.size){
  const ranked=covering.filter(c=>!selectedKeys.has(c.key)&&!rejectedKeys.has(c.key)).map(candidate=>({candidate,gain:candidate.coverSampleIds.filter(id=>remaining.has(id)).length})).filter(row=>row.gain>0).sort((a,b)=>b.gain-a.gain||b.candidate.coverSampleIds.length-a.candidate.coverSampleIds.length||a.candidate.key.localeCompare(b.candidate.key));
  if(!ranked.length){
   const nextAnchor=anchors.find(j=>!fineCompleted.has(j)&&remaining.has(samplesList[j].id));if(nextAnchor===undefined)break;
   await searchFine(nextAnchor);continue;
  }
  let chosen=null,emcRejected=0;
  for(const {candidate} of ranked){
   const deviceId=`task3-mobile-${plan.id}-${selected.length+1}`;let legal=null;
   const currentFail=analyzeEmc(devices).counts.fail;
   for(const frequencyGHz of channels){
    const device=structuredClone(candidate.device);device.id=deviceId;device.parameters.frequencyGHz=frequencyGHz;
    const emc=analyzeEmc([...devices,device]),introducesFail=emc.conflicts.some(c=>c.severity==='fail'&&(c.a===deviceId||c.b===deviceId));
    if(!introducesFail&&emc.counts.fail===currentFail){legal={device,emc};break;}
   }
   if(!legal){rejectedKeys.add(candidate.key);emcRejected++;summary.actions.push({step:summary.actions.length+1,action:'reject-candidate-emc',candidateId:candidate.device.id,candidateKey:candidate.key,anchorSampleId:candidate.anchorSampleId,position:[...candidate.device.position],attemptedFrequenciesGHz:[...channels],reason:'所有合法频道均会新增 fail 级 EMC 冲突'});continue;}
   const newlyCoveredSampleIds=[];
   for(const id of candidate.coverSampleIds){if(!remaining.has(id))continue;const j=bySampleId.get(id);if(await sampleCovered(legal.device,j,conditions[conditionIndex]))newlyCoveredSampleIds.push(id);}
   if(!newlyCoveredSampleIds.length){rejectedKeys.add(candidate.key);continue;}
   chosen={candidate,...legal,deviceId,newlyCoveredSampleIds};break;
  }
  summary.search.emcRejectedCandidates+=emcRejected;
  if(!chosen)break;
  const {candidate,device,deviceId,newlyCoveredSampleIds}=chosen,site={...structuredClone(candidate.site),id:`mobile-site-${plan.id}-${selected.length+1}`};
  devices.push(device);selected.push({device,site,deviceId,anchorSampleId:candidate.anchorSampleId,searchPhase:candidate.searchPhase,newlyCoveredSampleIds});selectedKeys.add(candidate.key);for(const id of newlyCoveredSampleIds)remaining.delete(id);
  summary.actions.push({step:summary.actions.length+1,action:'deploy-mobile-radar',deviceId,siteId:site.id,presetId:radarPresetId,searchPhase:candidate.searchPhase,position:[...device.position],frequencyGHz:device.parameters.frequencyGHz,newlyCoveredSampleIds:[...newlyCoveredSampleIds],mountHeightM:limits.mountHeightM,mountHeightSource:'模型假设',roadReachabilityVerified:false,emcCounts:{...chosen.emc.counts}});
  progress({stage:'select',completed:selected.length,total:Math.min(limits.maxDevices,Math.max(1,covering.length))});await yieldTask();
 }
 if(!selected.length){
  summary.status=summary.search.emcRejectedCandidates?'emc-unavailable':'no-candidate';
  summary.message=summary.status==='emc-unavailable'?'找到可覆盖候选，但合法频道均会新增 fail 级 EMC 冲突；未部署设备，原盲点全部保留。':'没有找到同时满足开阔地表、真实覆盖与 EMC 要求的候选点；未部署设备，原盲点全部保留。';
  return resultWithoutDevices(plan,summary);
 }
 // 对原方案+全部移动设备逐设备、逐采样、逐工况重算；贡献与独立覆盖由同一矩阵得到。
 const finalEmc=analyzeEmc(devices),coverage=conditions.map(()=>new Uint16Array(n)),deviceCoverage=devices.map(()=>conditions.map(()=>new Uint8Array(n)));
 for(let k=0;k<devices.length;k++){
  const device=devices[k];
  for(let j=0;j<n;j++){
   const sample=samplesList[j],base={...target,position:sample.position},quick=evaluateSensor(device,base,environment,{known:true,blocked:false,buildingCount:0});
   if(quick.reasons.some(reason=>GEOMETRIC.includes(reason)))continue;
   const context=query.trace(device.position,sample.position);
   for(let c=0;c<conditions.length;c++){
    const condition=conditions[c],penalty=finalEmc.penalties[device.id]??0,result=evaluateSensor(device,{...base,...condition.target},{...condition.environment,cochannelDb:condition.environment.cochannelDb+penalty},context);
    if(result.status==='within-model'&&result.marginDb!==null&&result.marginDb>=settings.marginReserveDb){deviceCoverage[k][c][j]=1;coverage[c][j]++;}
   }
  }
  progress({stage:'recalculate',completed:k+1,total:devices.length});await yieldTask();
 }
 const addedIds=new Set(selected.map(item=>item.deviceId)),newFailCount=finalEmc.conflicts.filter(c=>c.severity==='fail'&&(addedIds.has(c.a)||addedIds.has(c.b))).length;
 if(newFailCount)throw Error('移动补盲 EMC 复核发现新增 fail，已停止生成派生方案');
 for(let c=0;c<conditions.length;c++)for(let j=0;j<n;j++)if(original.coverage[c][j]>0&&coverage[c][j]===0)throw Error('移动补盲覆盖复核异常：原已覆盖采样点发生回退');
 const coverageContributions=Object.fromEntries(devices.map((device,k)=>[device.id,conditions.map((condition,c)=>{
  let coveredSamples=0,independentSamples=0;for(let j=0;j<n;j++)if(deviceCoverage[k][c][j]){coveredSamples++;if(coverage[c][j]===1)independentSamples++;}
  return {condition:condition.id,coveredSamples,independentSamples};
 })]));
 const finalCoverage=coverage.map(row=>Array.from(row)),blindspots=[];
 for(let c=0;c<conditions.length;c++)blindspots.push(await classify({city,samples:samplesList,coverageRow:finalCoverage[c],devices,query,target,environment:conditions[c].environment,conditionId:conditions[c].id}));
 const coveredSampleIds=blindIndices.filter(j=>finalCoverage[conditionIndex][j]>0).map(j=>samplesList[j].id),remainingSampleIds=blindIndices.filter(j=>finalCoverage[conditionIndex][j]===0).map(j=>samplesList[j].id);
 const addedCost=selected.length*(settings.costs.radar+0.2),sites=[...structuredClone(plan.sites),...selected.map(item=>item.site)];
 Object.assign(summary,{status:remainingSampleIds.length?'partial':'covered',addedDeviceCount:selected.length,addedDeviceIds:selected.map(item=>item.deviceId),addedCost,totalCost:plan.cost+addedCost,afterBlindCount:remainingSampleIds.length,coveredSampleIds,remainingSampleIds,selected:selected.map(item=>({deviceId:item.deviceId,siteId:item.site.id,presetId:radarPresetId,position:[...item.device.position],frequencyGHz:item.device.parameters.frequencyGHz,anchorSampleId:item.anchorSampleId,searchPhase:item.searchPhase,newlyCoveredSampleIds:item.newlyCoveredSampleIds,mountHeightM:limits.mountHeightM,mountHeightSource:'模型假设',roadReachabilityVerified:false})),emc:{beforeCounts:{...originalEmc.counts},afterCounts:{...finalEmc.counts},newFailCount}});
 summary.message=summary.status==='covered'?`新增 ${selected.length} 台警车移动雷达，真实覆盖 ${coveredSampleIds.length} 个当前工况盲点；该工况采样盲点已全部覆盖，其余工况已同步重算。`:`新增 ${selected.length} 台警车移动雷达，真实覆盖 ${coveredSampleIds.length} 个当前工况盲点，仍有 ${remainingSampleIds.length} 个未覆盖并继续保留。${summary.search.emcRejectedCandidates?' 部分候选因 EMC 不可行被排除。':''}`;
 const derivedPlan={...structuredClone(plan),devices,sites,cost:plan.cost+addedCost,installationProxy:plan.installationProxy+selected.length,metrics:coverageMetrics(finalCoverage,samplesList,conditions),coverage:finalCoverage,coverageContributions,deployable:finalEmc.counts.fail===0,derivation:summary};
 const emc={...finalEmc,text:emcVerdictText(finalEmc),remediation:plan.emcRemediation??null,mobileRepair:{beforeCounts:{...originalEmc.counts},afterCounts:{...finalEmc.counts},newFailCount}};
 return {planId:plan.id,plan:derivedPlan,blindspots,emc,summary};
}
