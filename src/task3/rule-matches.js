import {DEFAULT_ENV,DEFAULT_TARGET} from '../sensors/presets.js';
import {scenarios} from '../planning/optimizer.js';

// Keep the preceding run's inputs for controlled comparisons, without retaining its frames or mesh data.
export function comparisonInputs(report){
 if(!report)return null;
 const {settings,environment,target,weights,equipment,equipmentSnapshot,origin}=report;
 return structuredClone({settings,environment,target,weights,equipment,equipmentSnapshot,origin});
}

function equal(a,b){
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const keys=Object.keys(a);
 return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
}

function paired(trigger,previous,current){
 if(!previous)return false;
 const [group,key]=trigger.field.split('.');
 if(previous[group]?.[key]!==trigger.from||current[group]?.[key]!==trigger.to)return false;
 return equal({...previous,[group]:{...previous[group],[key]:trigger.to}},current);
}

function concurrentNodes(report,plan,count){
 const ids=new Set();
 if(plan.derivation)return ids; // Mobile variants do not have a fresh dynamic simulation.
 for(const scenario of Object.values(report.threatsByPlan?.[plan.id]??{})){
  for(const frame of scenario.frames??[]){
   if(frame.targets.length<count)continue;
   const loads=new Map();
   for(const target of frame.targets)for(const node of target.detectedBy)loads.set(node.id,(loads.get(node.id)??0)+1);
   for(const entry of frame.overflow??[])loads.set(entry.deviceId,(loads.get(entry.deviceId)??0)+1);
   for(const [id,n] of loads)if(n===count)ids.add(id);
  }
 }
 return ids;
}

export function matchDeploymentRules(rules,report,plan,previous=null){
 const current=comparisonInputs(report),devices=plan.devices,conditions=scenarios(report.environment);
 return rules.map(rule=>{
  const t=rule.trigger;
  let matched=[],basis='本次结果未满足完整触发条件。';
  switch(rule.id){
   case 'R01':{
    const silent=conditions.find(c=>c.target.emitting===false&&report.conditions.some(r=>r.id===c.id));
    if(silent){matched=devices.filter(d=>d.type==='radio'||plan.coverageContributions?.[d.id]?.some(r=>r.condition===silent.id&&r.coveredSamples>0));basis=`「${silent.name}」工况中，列出受静默影响的无线电设备，以及确实覆盖了采样点的其他设备。`;}
    break;
   }
   case 'R02':case 'R03':case 'R04':{
    if(paired(t,previous,current)){
     const types={R02:['radar'],R03:['radar','radio'],R04:['acoustic']}[rule.id];
     matched=devices.filter(d=>types.includes(d.type));basis=`与同地图上一轮比较，${t.field} 从 ${t.from} 变为 ${t.to} ${t.unit}。`;
    }else basis='需有同地图、其他输入相同的前后两轮记录。';
    break;
   }
   case 'R05':
    if(current.target.frequencyGHz===t.all[0].value){matched=devices.filter(d=>d.presetId===t.all[1].value);basis='本轮目标频率与设备预设同时满足条件。';}
    break;
   case 'R06':{
    const ids=concurrentNodes(report,plan,t.value);
    matched=devices.filter(d=>d.type==='radio'&&ids.has(d.id));basis='仅按同一帧中每台接收设备的有效链路计数（含超出容量的目标）。';break;
   }
   case 'R07':
    if(current.settings.buildingExclusions?.buildingIds?.length){matched=devices;basis='本轮已启用建筑禁部署约束，列出受约束的最终设备。';}
    break;
   case 'R08':
    if(Number.isFinite(plan.maxDevices)||Number.isFinite(plan.budget)||current.settings.typeLimits){
     matched=devices.filter(d=>!d.mobileRepair);basis=`固定方案上限为 ${plan.maxDevices??'—'} 台、预算 ${plan.budget??'—'}，追加警车单独核算。`;
    }
    break;
   case 'R09':{
    const satisfies=(object,fields)=>Object.entries(fields).every(([key,value])=>object?.[key]===value);
    if(!previous)break;
    const derived=structuredClone(previous);
    const baselineEnv=Object.keys(t.environment).every(k=>previous.environment[k]===DEFAULT_ENV[k]);
    const baselineTarget=Object.keys(t.target).every(k=>previous.target[k]===DEFAULT_TARGET[k]);
    const resources=Object.entries(t.resourceChanges).every(([k,[from]])=>(previous.settings[k]??(k==='installationHeightM'?2:undefined))===from);
    Object.assign(derived.environment,t.environment);Object.assign(derived.target,t.target);
    for(const [k,[,to]] of Object.entries(t.resourceChanges))derived.settings[k]=to;
    if(baselineEnv&&baselineTarget&&resources&&satisfies(current.environment,t.environment)&&equal(derived,current)){
     matched=devices;basis='本轮符合组合工况，资源档位与上一轮相符。该规则属于跨地图观察结论。';
    }break;
   }
  }
  return {rule,deviceIds:matched.map(d=>d.id),basis};
 });
}
