// 只汇总本轮真实候选矩阵与真实事件，不重新选点或改变优化结果。
export function collectDecisionEvidence({plan,pool,candidates,sampling,conditions,settings}){
 const n=sampling.samples.length,counts=new Uint16Array(n*conditions.length),selected=new Set(),snapshots=new Map();
 const weightedGain=(candidate,redundancy)=>candidate.cover.reduce((sum,j)=>sum+(counts[j]===0?1:counts[j]===1?redundancy:0)*(sampling.samples[j%n].weight??1)*(Math.floor(j/n)===0?2:1),0);
 const allowed=new Set(plan.presetSubset),finalIds=new Set(plan.devices.map(d=>d.id)),needed=new Set(finalIds);
 // 移位后的设备关联回实际入选设备，不能把替代点包装成原始贪心入选点。
 for(const action of [...(plan.emcRemediation?.actions??[])].reverse())if(needed.has(action.replacementDeviceId))needed.add(action.deviceId);
 const row=(candidate,gain=null)=>({deviceId:candidate.device.id,presetId:candidate.device.presetId,type:candidate.device.type,name:candidate.device.name,siteId:candidate.site.id,siteName:candidate.site.name,position:[...candidate.device.position],pitch:candidate.device.parameters.pitch,frequencyGHz:candidate.device.parameters.frequencyGHz??null,cost:candidate.cost,allowed:allowed.has(candidate.device.presetId),gain,gainPerCost:gain===null?null:gain/candidate.cost,coveredSamples:conditions.map((condition,c)=>({condition:condition.id,covered:candidate.cover.filter(j=>Math.floor(j/n)===c).length,total:n}))});
 for(const event of plan.optimizationTrace?.events??[]){
  const candidate=pool[event.candidateIndex];if(!candidate)continue;
  if(event.type==='delete'){selected.delete(candidate.device.id);for(const j of candidate.cover)counts[j]--;continue;}
  if(event.type!=='select')continue;
  if(needed.has(event.deviceId)){
   const redundancy=event.phase==='redundancy'?(plan.optimizationTrace.policy.redundancy??0):0,costBefore=event.cumulativeCost-event.cost;
   const alternatives=candidates.filter(c=>c.site.id===candidate.site.id).map(c=>{
    const gain=weightedGain(c,redundancy),r=row(c,gain);
    return {...r,alreadySelected:selected.has(c.device.id),budgetFits:costBefore+c.cost<=plan.budget+1e-9,selectedAtThisStep:c.device.id===event.deviceId};
   });
   const eligible=pool.filter(c=>!selected.has(c.device.id)&&costBefore+c.cost<=plan.budget+1e-9),bestScore=eligible.reduce((best,c)=>Math.max(best,weightedGain(c,redundancy)/c.cost),0);
   snapshots.set(event.deviceId,{event:structuredClone(event),costBefore,budgetRemainingBefore:plan.budget-costBefore,eligibleCandidateCount:eligible.length,bestGainPerCost:bestScore,sameSiteAlternatives:alternatives});
  }
  selected.add(candidate.device.id);for(const j of candidate.cover)counts[j]++;
 }
 const byDevice={};
 for(const [i,device] of plan.devices.entries()){
  let originId=device.id;const migration=[];
  for(const action of [...(plan.emcRemediation?.actions??[])].reverse())if(action.replacementDeviceId===originId){migration.unshift(structuredClone(action));originId=action.deviceId;}
  const candidate=pool.find(c=>c.device.id===device.id),site=plan.sites[i],selection=snapshots.get(originId)??null;
  const finalSiteAlternatives=candidates.filter(c=>c.site.id===site.id).map(c=>row(c));
  byDevice[device.id]={schema:'task3-device-decision/1.0',basis:'本轮候选覆盖矩阵与真实优化事件；候选值为 EMC 最终复核前预评估',selection,originDeviceId:originId,migration,finalCandidate:candidate?row(candidate):null,finalSiteAlternatives,
   otherSites:pool.filter(c=>c.device.presetId===device.presetId&&c.device.parameters.pitch===device.parameters.pitch&&c.site.id!==site.id).map(c=>({...row(c),distanceM:Math.hypot(c.device.position[0]-device.position[0],c.device.position[2]-device.position[2])})).sort((a,b)=>a.distanceM-b.distanceM||a.deviceId.localeCompare(b.deviceId)).filter((r,i,rows)=>rows.findIndex(other=>other.siteId===r.siteId)===i).slice(0,3),
   site:{...structuredClone(site),aboveGroundM:Number.isFinite(site.installationProxy)?(site.installationProxy-1)*100+2:null},
   marginReserveDb:settings.marginReserveDb};
 }
 return byDevice;
}
