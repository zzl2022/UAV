import {evaluate,angles} from '../../src/sensors/engine.js';
import {createDevice,PRESETS,DEFAULT_ENV,DEFAULT_TARGET} from '../../src/sensors/presets.js';
import {scenarios,boundsFor} from '../../src/planning/optimizer.js';
import {emcAnalysis} from '../../src/task3/emc.js';
import {createBuildingIndex,containsBuildingFootprint} from '../../src/task3/building-constraints.js';

export const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
export const quantile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);if(!a.length)return null;const p=(a.length-1)*q,i=Math.floor(p);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(p-i);};
export function makeAuditSamples(query,bounds,{spacing=300,heights=[20,45,90],offset=.37}={}){
 const points=[];let outside=0,solid=0;
 for(let x=bounds.west+spacing*offset;x<bounds.east;x+=spacing)for(let z=bounds.south+spacing*offset;z<bounds.north;z+=spacing)for(const agl of heights){
  const ground=query.groundAt(x,z);if(!Number.isFinite(ground)){outside++;continue;}
  const surface=query.surfaceAt(x,z);if(surface!==null&&surface>=ground+agl-1){solid++;continue;}
  points.push({id:`audit-${points.length+1}`,position:[x,ground+agl,z],agl,core:Math.hypot(x-bounds.core[0],z-bounds.core[2])<=700});
 }
 return {bounds,spacing,heights,offset,points,excluded:{outside,solid},meaning:'固定300米验证网格，偏移0.37格；与优化网格分开生成，只使用有效空域点'};
}
const success=(r,reserve=3)=>r.status==='within-model'&&r.eligible&&r.marginDb!==null&&r.marginDb>=reserve;
function signature(device){return device.position.join('|');}
export function makeAuditEvaluator(query,audit){
 const geometry=new Map();
 return (devices,environment,target,reserve=3)=>{
  const conditions=scenarios(environment),emc=emcAnalysis(devices),coverage=conditions.map(()=>audit.points.map(()=>0)),typeCoverage={};
  for(const type of ['radar','radio','optical','acoustic'])typeCoverage[type]=conditions.map(()=>audit.points.map(()=>0));
  for(const d of devices){
   const key=signature(d);let contexts=geometry.get(key);
   if(!contexts){contexts=audit.points.map(p=>query.trace(d.position,p.position));geometry.set(key,contexts);}
   for(const [c,condition] of conditions.entries())for(const [j,point] of audit.points.entries()){
    const result=evaluate(d,{...target,...condition.target,position:point.position},{...condition.environment,cochannelDb:condition.environment.cochannelDb+(emc.penalties[d.id]??0)},contexts[j]);
    if(success(result,reserve)){coverage[c][j]++;typeCoverage[d.type][c][j]++;}
   }
  }
  const metrics=conditions.map((condition,c)=>{
   const indexes=audit.points.map((_,j)=>j),core=indexes.filter(j=>audit.points[j].core),covered=indexes.filter(j=>coverage[c][j]>0).length;
   return {condition:condition.id,total:indexes.length,covered,coverageRate:indexes.length?covered/indexes.length:null,coreCoverageRate:core.length?core.filter(j=>coverage[c][j]>0).length/core.length:null,lowCoverageRate:mean(indexes.filter(j=>audit.points[j].agl===audit.heights[0]).map(j=>Number(coverage[c][j]>0))),redundancyRate:mean(indexes.map(j=>Number(coverage[c][j]>1))),typeRates:Object.fromEntries(Object.entries(typeCoverage).map(([type,rows])=>[type,mean(rows[c].map(v=>Number(v>0)))]))};
  });
  return {metrics,coverage,robustCoverage:Math.min(...metrics.map(m=>m.coverageRate??0)),worstCoreCoverage:Math.min(...metrics.map(m=>m.coreCoverageRate??0)),typeCoverage};
 };
}

export function geography(city,query,bounds){
 const all=city.buildings.map(b=>{const r=b.rings[0];return {building:b,x:mean(r.map(p=>p[0])),z:mean(r.map(p=>p[2])),height:b.height};});
 const local=all.filter(b=>b.x>=bounds.west&&b.x<=bounds.east&&b.z>=bounds.south&&b.z<=bounds.north);
 const neighbors=local.map((b,i)=>{let distance=Infinity;for(let j=0;j<local.length;j++)if(i!==j)distance=Math.min(distance,Math.hypot(b.x-local[j].x,b.z-local[j].z));return distance;}).filter(Number.isFinite);
 const heights=local.map(b=>b.height),grounds=[];
 for(let i=0;i<5;i++)for(let j=0;j<5;j++){const h=query.groundAt(bounds.west+(i+.5)*(bounds.east-bounds.west)/5,bounds.south+(j+.5)*(bounds.north-bounds.south)/5);if(Number.isFinite(h))grounds.push(h);}
 const areaKm2=(bounds.east-bounds.west)*(bounds.north-bounds.south)/1e6;
 return {totalBuildings:all.length,scopeBuildings:local.length,densityBuildingsKm2:local.length/areaKm2,meanHeightM:mean(heights),heightP50M:quantile(heights,.5),heightP90M:quantile(heights,.9),heightSpreadP90P10M:(quantile(heights,.9)??0)-(quantile(heights,.1)??0),nearestCentroidP50M:quantile(neighbors,.5),terrainReliefM:grounds.length?Math.max(...grounds)-Math.min(...grounds):null,terrainMode:city.metadata?.terrain?.resolution?'DEM':'flat-site-proxy',note:'近邻距离为建筑质心间距，不等同两建筑外墙净距；新增站点地形为平面代理，不能推断真实坡度或道路。'};
}

// 在真实地图上，以相同点位/目标/几何作成对反事实；不将新增链路试验当成独立地图样本。
export function makePairedProbes(city,query,audit,sites,settings){
 const selectedSites=sites.slice(0,12),raw=[],sensitivity=[],heightPairs=[],capacity=[];
 for(const [index,site] of selectedSites.entries()){
  const endpoints=audit.points.filter(p=>Math.hypot(p.position[0]-site.position[0],p.position[2]-site.position[2])<=1200);
  for(const presetId of ['radar-03d','radio-tdoa','radio-x1c','optical-nvt','acoustic-cry']){
   const device=createDevice(presetId,`probe-${index}-${presetId}`,site.position);device.parameters.heading=angles(site.position,audit.bounds.core).azimuth;
   if(device.type==='radar')device.parameters.pitch=-15;
   const pairs={radio:[['emitting',false],['emNoiseDb',15],['frequencyGHz',4.9]],optical:[['heading',90],['visibilityKm',.5]],acoustic:[['trafficDb',70],['heading',90]],radar:[['rcs',.001],['emNoiseDb',15]]}[device.type];
   const totals=Object.fromEntries(pairs.map(([factor,value])=>[factor,{factor,value,total:0,baseCovered:0,variantCovered:0,baseMargin:[],variantMargin:[],gain:0,loss:0}]));
   for(const point of endpoints){
    const context=query.trace(device.position,point.position),base=evaluate(device,{...DEFAULT_TARGET,position:point.position},DEFAULT_ENV,context),baseCovered=success(base);
    for(const [factor,value] of pairs){
     const changedDevice=structuredClone(device),changedTarget={...DEFAULT_TARGET,position:point.position},changedEnvironment={...DEFAULT_ENV};
     if(factor==='heading')changedDevice.parameters.heading=(changedDevice.parameters.heading+value)%360;
     else if(factor in changedTarget)changedTarget[factor]=value;else changedEnvironment[factor]=value;
     const changed=evaluate(changedDevice,changedTarget,changedEnvironment,context),variantCovered=success(changed),total=totals[factor];total.total++;total.baseCovered+=Number(baseCovered);total.variantCovered+=Number(variantCovered);total.loss+=Number(baseCovered&&!variantCovered);total.gain+=Number(!baseCovered&&variantCovered);
     if(base.marginDb!==null&&changed.marginDb!==null){total.baseMargin.push(base.marginDb);total.variantMargin.push(changed.marginDb);}
     // 边界样本保留完整判据，供人工核对归因。
     if(baseCovered!==variantCovered&&raw.filter(r=>r.presetId===presetId&&r.factor===factor).length<3)raw.push({presetId,factor,siteId:site.id,position:point.position,device:structuredClone(device),base,variant:changed});
    }
   }
   for(const t of Object.values(totals))sensitivity.push({presetId,siteId:site.id,...t,baseMeanMarginDb:mean(t.baseMargin),variantMeanMarginDb:mean(t.variantMargin),baseMargin:undefined,variantMargin:undefined});
   if(device.type==='radio'){
    const point=endpoints.find(p=>success(evaluate(device,{...DEFAULT_TARGET,position:p.position},DEFAULT_ENV,query.trace(device.position,p.position))));
    if(point)capacity.push({presetId,siteId:site.id,targetPosition:point.position,capacity:device.parameters.capacity,requestedTargets:42,overflowLowerBoundForOneNode:Math.max(0,42-device.parameters.capacity)});
   }
  }
  const baseGround=query.groundAt(site.position[0],site.position[2]),surface=site.supportY??query.surfaceAt(site.position[0],site.position[2]);
  for(const presetId of ['radar-03d','acoustic-cry']){
   let low=0,high=0,total=0;
   for(const point of endpoints){
    const make=mount=>{const d=createDevice(presetId,'height-probe',[site.position[0],surface+mount,site.position[2]]);d.parameters.heading=angles(d.position,audit.bounds.core).azimuth;if(d.type==='radar')d.parameters.pitch=-15;return success(evaluate(d,{...DEFAULT_TARGET,position:point.position},DEFAULT_ENV,query.trace(d.position,point.position)));};
    low+=Number(make(.5));high+=Number(make(8));total++;
   }
   heightPairs.push({presetId,siteId:site.id,aboveGroundBaseM:surface-baseGround,total,lowMountM:.5,highMountM:8,lowCovered:low,highCovered:high});
  }
 }
 return {sensitivity,heightPairs,capacity,examples:raw,siteCount:selectedSites.length,meaning:'相同地图点位与独立验证目标的配对链路实判；容量下界仅指单节点，不能直接替代多站融合结果'};
}

export function validateFinalPlan(city,query,report,plan){
 const errors=[],index=createBuildingIndex(city),blocked=new Set(report.settings.buildingExclusions?.buildingIds??[]),limits=report.settings.typeLimits??{};
 const counts=Object.fromEntries(['radar','radio','optical','acoustic'].map(type=>[type,plan.devices.filter(d=>d.type===type).length]));
 if(plan.devices.length>plan.maxDevices)errors.push('总设备数超限');
 if(plan.cost>plan.budget+1e-6)errors.push('预算超限');
 for(const [type,limit] of Object.entries(limits))if(counts[type]>limit)errors.push(`${type} 类型数量超限`);
 for(const [i,d] of plan.devices.entries()){
  const ground=query.groundAt(d.position[0],d.position[2]),surface=query.surfaceAt(d.position[0],d.position[2]);
  if(!Number.isFinite(ground)||!Number.isFinite(surface))errors.push(`${d.id} 无地形`);
  const site=plan.sites[i],support=site?.mountKind==='facade'?site.supportY:surface;
  if(site?.mountKind==='facade'){
   const host=index.byId.get(site.buildingId);
   if(!host||!Number.isFinite(support)||support<=surface||d.position[1]>=host.maxY||containsBuildingFootprint(host.building,d.position[0],d.position[2]))errors.push(`${d.id} 立面净空或支承标高无效`);
  }
  if(Math.abs(d.position[1]-support-(report.settings.installationHeightM??2))>2.1)errors.push(`${d.id} 架设高度未生效`);
  if(plan.sites[i]?.buildingId&&blocked.has(plan.sites[i].buildingId))errors.push(`${d.id} 落在禁部署建筑`);
  for(const id of blocked){const entry=index.byId.get(id);if(entry&&containsBuildingFootprint(entry.building,d.position[0],d.position[2]))errors.push(`${d.id} 进入禁部署轮廓`);}
 }
 if(errors.length)throw Error(errors.join('；'));
 return {passed:true,checks:['预算','总量','类型数量上限','真实地形','架设高度','禁部署建筑最终落点'],actualTypeCounts:counts};
}
