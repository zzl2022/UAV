// 部署方案布设文档数据模型：所有数值直接来自 report/run，规则来自真实多轮过程数据，供 PDF 导出复用。
import {TYPES} from '../sensors/presets.js';
import {THREAT_SCENARIOS} from './constants.js';
import {createDeviceDisplayMap} from './device-display.js';

export const DEPLOYMENT_DOC_SCHEMA='task3-deployment-doc/1.0';
const number=(value,digits=1)=>Number(value).toFixed(digits);

function representativeCases(report,plan,conditionId,maxCases=4){
 const condition=report.conditions.find(item=>item.id===conditionId)??report.conditions[0];
 if(!condition)throw Error('报告缺少覆盖工况，无法选择代表点');
 const display=createDeviceDisplayMap(plan.devices),core=report.sampling.bounds.core,coreRadius=report.settings.coreRadius;
 const metric=plan.metrics.find(item=>item.condition===condition.id);
 if(!metric)throw Error(`方案 ${plan.id} 缺少 ${condition.id} 工况指标`);
 const rows=plan.devices.map((device,index)=>{
  const contribution=plan.coverageContributions?.[device.id]?.find(item=>item.condition===condition.id);
  if(!contribution)return null;
  const site=plan.sites[index]??device.deployment??{},mobile=device.mobileRepair?.platform==='police-car';
  const distanceToCoreM=Math.hypot(device.position[0]-core[0],device.position[2]-core[2]);
  return {device,index,site,mobile,contribution,distanceToCoreM,display:display.details(device.id)};
 }).filter(Boolean);
 if(!rows.length)throw Error('当前方案缺少逐设备覆盖贡献，不能编造代表点原因');
 const ranked=[...rows].sort((a,b)=>b.contribution.independentSamples-a.contribution.independentSamples||b.contribution.coveredSamples-a.contribution.coveredSamples||a.distanceToCoreM-b.distanceToCoreM||a.index-b.index);
 const target=Math.min(5,Math.max(1,Math.min(maxCases,ranked.length))),selected=[];
 const add=row=>{if(row&&!selected.includes(row)&&selected.length<target)selected.push(row);};
 add(ranked[0]);
 for(const row of ranked)if(selected.length<Math.min(3,target)&&!selected.some(item=>item.device.type===row.device.type))add(row);
 const mobile=ranked.find(row=>row.mobile);
 if(mobile&&!selected.includes(mobile)){
  if(selected.length>=target){const removable=[...selected].reverse().find(row=>!row.mobile);if(removable)selected.splice(selected.indexOf(removable),1);}
  add(mobile);
 }
 for(const row of ranked)add(row);
 const cases=selected.sort((a,b)=>a.index-b.index).map(row=>{
  const {device,index,site,mobile,contribution,distanceToCoreM}=row,entry=row.display;
  const reasons=[`${condition.name}下实际覆盖 ${contribution.coveredSamples}/${metric.total} 个采样，其中 ${contribution.independentSamples} 个由该设备独立覆盖。`];
  if(mobile){
   const action=plan.derivation?.selected?.find(item=>item.deviceId===device.id);
   reasons.push(`移动补盲过程记录显示，该设备新增覆盖 ${action?.newlyCoveredSampleIds?.length??0} 个 ${plan.derivation?.conditionId===condition.id?condition.name:'启动补盲时所选工况'}盲点；点位是开阔地表几何代理，道路可达性未验证。`);
  }else{
   reasons.push(`点位距核心中心 ${number(distanceToCoreM)} m，${distanceToCoreM<=coreRadius?'位于核心权重区内':'位于核心权重区外，承担外围采样覆盖'}；部署依据为 ${site.installation??'流水线真实候选点安装代理'}。`);
   reasons.push(contribution.independentSamples>0?'该点具有独立覆盖采样，因而优先作为解释方案空间覆盖构成的代表点。':'该点与其他设备形成重叠覆盖，用于解释当前方案的冗余覆盖构成。');
  }
  return {
   deviceId:device.id,displayName:entry.displayName,type:device.type,typeName:TYPES[device.type]??device.type,modelName:entry.modelName,
   position:[...device.position],siteName:site.name??(mobile?'开阔地表几何代理点（未验证道路可达）':'流水线实际候选点'),installation:site.installation??'流水线实际候选点安装代理',mobile,
   conditionId:condition.id,coveredSamples:contribution.coveredSamples,independentSamples:contribution.independentSamples,totalSamples:metric.total,distanceToCoreM,reasons,
  };
 });
 return {condition:{...condition},cases};
}

// 当前方案全部设备点位：PDF“部署方案设计”逐台列出，不截断。
function planDevices(plan){
 const display=createDeviceDisplayMap(plan.devices);
 return plan.devices.map((device,index)=>{
  const entry=display.details(device.id),site=plan.sites?.[index]??(typeof device.deployment==='object'?device.deployment:null)??{};
  return {
   id:device.id,displayName:entry?.displayName??device.id,type:device.type,
   typeName:entry?.typeName??TYPES[device.type]??device.type,modelName:entry?.modelName??device.name??device.presetId??'未提供',
   presetId:device.presetId??null,position:[...device.position],
   siteName:site?.name??'流水线实际候选点',installation:site?.installation??'流水线实际候选点安装代理',
   mobile:device.mobileRepair?.platform==='police-car'||site?.deployment==='police-car',
  };
 });
}

// 多方案比较：排名、四指标、EMC 结论、综合得分，直接复用 pipeline 的 comparison/scoring 结果。
function comparisonModel(report,selectedPlanId){
 const scoringRows=Array.isArray(report.scoring?.plans)?report.scoring.plans:[],byId=new Map(scoringRows.map(row=>[row.id,row]));
 const source=Array.isArray(report.comparison?.rows)?report.comparison.rows:scoringRows.map(row=>({
  rank:row.rank,id:row.id,name:row.name??row.id,deviceCount:row.deviceCount,
  coverage:row.indicators?.coverage,blindRatio:row.indicators?.blindRatio,
  cost:row.indicators?.cost,feasibility:row.indicators?.feasibility,score:row.score,
 }));
 const rows=source.map(row=>({
  rank:row.rank,id:row.id,name:row.name??row.id,deviceCount:row.deviceCount,
  coverage:row.coverage,blindRatio:row.blindRatio,cost:row.cost,feasibility:row.feasibility,score:row.score,
  emcVerdict:byId.get(row.id)?.emcVerdict??report.emc?.[row.id]?.verdict??null,
  selected:row.id===selectedPlanId,recommended:row.id===report.recommendedId,
 }));
 const recommended=(report.plans??[]).find(item=>item.id===report.recommendedId);
 return {
  recommendedId:report.recommendedId??null,recommendedName:recommended?.name??null,
  recommendationStatus:report.deploymentStatus??report.scoring?.recommendationStatus??null,
  method:report.scoring?.method??report.comparison?.method??null,
  weights:{...(report.weights??report.comparison?.weights??{})},rows,
 };
}

// 威胁场景验证结果：优先读取按方案缓存的 threatsByPlan；旧报告仅推荐方案有 threats 时如实标记可用性。
function threatModel(report,run,plan){
 const derived=Boolean(plan.derivation),threatPlanId=derived?plan.derivation.basePlanId:plan.id;
 const source=report.threatsByPlan?.[threatPlanId]??(threatPlanId===report.recommendedId?report.threats:null)??run?.threatsByPlan?.[threatPlanId]??(threatPlanId===report.recommendedId?run?.threats:null)??{};
 const scenarios=Object.entries(source).map(([key,value])=>{
  const config=value?.config??{},perTarget=Array.isArray(value?.perTarget)?value.perTarget:[];
  return {
   key,name:THREAT_SCENARIOS[key]?.name??key,
   targetCount:value?.summary?.targetCount??config.count??0,
   detectedCount:perTarget.filter(item=>item.firstDetectionTime!==null).length,
   meanFirstDetectionTime:value?.summary?.meanFirstDetectionTime??null,
   meanDetectedFraction:value?.summary?.meanDetectedFraction??null,
   minDetectedFraction:value?.summary?.minDetectedFraction??null,
   overflowEvents:value?.summary?.overflowEvents??null,overflowedTargets:value?.summary?.overflowedTargets??null,
   config:{count:config.count??null,directions:config.directions??null,azimuthsDeg:Array.isArray(config.azimuthsDeg)?[...config.azimuthsDeg]:[],
    aglM:Array.isArray(config.aglM)?[...config.aglM]:[],speedMps:config.speedMps??null,simultaneous:Boolean(config.simultaneous)},
   perTarget:perTarget.map(item=>({id:item.id??item.routeId,firstDetectionTime:item.firstDetectionTime??null,detectedFraction:item.detectedFraction??null,lossEvents:item.lossEvents??null})),
   text:value?.text??null,
  };
 });
 return {planId:plan.id,planName:plan.name,sourcePlanId:threatPlanId,derived,available:scenarios.length>0,note:derived?'当前为警车移动补盲派生方案；威胁结果来自原方案，未对派生方案重新计算。':null,scenarios};
}

// 覆盖效果：工况指标 + 盲区四分类 + 单高度层面积估计，全部来自真实离散采样。
function coverageModel(report,plan){
 const blindRows=Array.isArray(report.blindspots?.[plan.id])?report.blindspots[plan.id]:[];
 const conditions=(report.conditions??[]).map((condition,index)=>{
  const metric=plan.metrics?.[index]??{},blind=blindRows.find(row=>row?.conditionId===condition.id)??blindRows[index]??null;
  const areaEstimates=(plan.areaEstimates?.[condition.id]??[]).map(item=>({
   height:item.height,validGridCells:item.validGridCells,blindGridCells:item.blindGridCells,
   approximateBlindAreaMeters2:item.approximateBlindAreaMeters2,
  }));
  return {
   condition:condition.id,name:condition.name,
   covered:metric.covered,total:metric.total,coverageRate:metric.coverageRate,blindRate:metric.blindRate,
   redundant:metric.redundant,coreCoverageRate:metric.coreCoverageRate,coreRedundantRate:metric.coreRedundantRate,
   blindTotal:blind?.stats?.total??null,byCategory:{...(blind?.stats?.byCategory??{})},areaEstimates,
  };
 });
 const coreSamples=Array.isArray(report.sampling?.samples)?report.sampling.samples.filter(sample=>sample.core).length:null;
 const core={
  radiusM:report.settings?.coreRadius??null,sampleCount:coreSamples,
  coverageRate:plan.metrics?.[0]?.coreCoverageRate??null,redundantRate:plan.metrics?.[0]?.coreRedundantRate??null,
 };
 return {conditions,core};
}

function emcModel(emc){
 return {
  text:emc.text??null,notes:Array.isArray(emc.notes)?[...emc.notes]:[],source:emc.source??null,
  conflicts:Array.isArray(emc.conflicts)?emc.conflicts.map(conflict=>({...conflict})):[],
  remediation:emc.remediation?{
   status:emc.remediation.status??null,deployable:Boolean(emc.remediation.deployable),
   actionCount:Array.isArray(emc.remediation.actions)?emc.remediation.actions.length:0,
   actions:Array.isArray(emc.remediation.actions)?emc.remediation.actions.map(action=>({...action})):[],
   unresolvedCount:Array.isArray(emc.remediation.unresolved)?emc.remediation.unresolved.length:0,
  }:null,
 };
}

function buildPlanDocument({report,run,plan,rules,conditionId,documentKind,generatedAt,selectedPlanId}){
 if(!Array.isArray(plan.devices)||!plan.devices.length)throw Error(`方案 ${plan.id} 没有可解释的设备点位`);
 const {condition,cases}=representativeCases(report,plan,conditionId);
 const scope=report.scope??report.sampling.dataCoverage??{};
 const settings=report.settings,derived=Boolean(plan.derivation),emc=report.emc[plan.id];
 if(!emc)throw Error(`方案 ${plan.id} 缺少 EMC 结果`);
 const scoring=report.scoring?.plans?.find(item=>item.id===plan.id);
 const coverage=coverageModel(report,plan);
 const usableRules=(Array.isArray(rules)?rules:rules.rules??[]).filter(rule=>rule?.evidence?.samples>0&&rule.evidence.runIds&&rule.evidence.method).map(rule=>({id:rule.id,title:rule.title,text:rule.text,evidence:{samples:rule.evidence.samples,runIds:rule.evidence.runIds,method:rule.evidence.method}}));
 const limitations=[...report.limitations];
 if(derived){
  limitations.push('当前为警车移动补盲派生方案：覆盖、盲区、设备贡献与 EMC 已按新增设备重算；原方案比较排名和威胁推演未对派生方案重算，不得当作移动方案的威胁验证结果。',...plan.derivation.assumptions??[]);
 }else limitations.push('本次仅包含固定点位流水线结果，未启用警车移动补盲；本文不包含也不声称任何移动补盲效果。');
 return {
  schema:DEPLOYMENT_DOC_SCHEMA,documentKind,generatedAt,
  source:{runId:run.runId,runCreatedAt:run.createdAt,reportCreatedAt:report.createdAt,activePlanId:plan.id,recommendedId:report.recommendedId,origin:report.origin,inputHashes:report.inputHashes},
  scope:{widthM:scope.widthM??settings.scopeWidthM,depthM:scope.depthM??settings.scopeDepthM,clipped:Boolean(scope.clipped),note:scope.note??'采样仅使用实际 GIS/DEM 数据，不外推无数据区域覆盖。'},
  grid:{spacingM:settings.spacing,siteSpacingM:settings.siteSpacing,heightsM:[...settings.heights],sampleCount:report.sampling.samples.length,candidateCount:report.candidateCount,siteCount:report.siteCount,marginReserveDb:settings.marginReserveDb,excluded:{...report.sampling.excluded}},
  plan:{id:plan.id,name:plan.name,deviceCount:plan.devices.length,cost:plan.cost,typeCounts:{...plan.typeCounts},recommended:plan.id===report.recommendedId,derived},
  devices:planDevices(plan),
  metrics:{conditions:coverage.conditions,averageBlindRate:coverage.conditions.reduce((sum,metric)=>sum+(metric.blindRate??0),0)/Math.max(1,coverage.conditions.length),weakestConditionId:[...coverage.conditions].sort((a,b)=>(a.coverageRate??0)-(b.coverageRate??0))[0]?.condition??null,...(scoring?{originalScore:scoring.score,originalRank:scoring.rank}:{})},
  coverage:{core:coverage.core,conditions:coverage.conditions},
  comparison:comparisonModel(report,selectedPlanId??plan.id),
  threats:threatModel(report,run,plan),
  emc:{verdict:emc.verdict,counts:{...emc.counts},...emcModel(emc)},
  rules:usableRules,caseCondition:condition,cases,
  mobileRepair:derived?{enabled:true,basePlanId:plan.derivation.basePlanId,addedDeviceCount:plan.derivation.addedDeviceCount,conditionId:plan.derivation.conditionId,status:plan.derivation.status}:{enabled:false},
  limitations,
 };
}

export function createDeploymentDocument({report,run,activePlanId=report?.recommendedId,rules=[],conditionId='nominal',documentKind='current',generatedAt=new Date().toISOString()}){
 if(!report||!run?.runId)throw Error('生成布设文档需要完整 report 和带 runId 的 run');
 const plan=report.plans.find(item=>item.id===activePlanId);
 if(!plan)throw Error(`当前方案 ${activePlanId} 不在报告中`);
 return buildPlanDocument({report,run,plan,rules,conditionId,documentKind,generatedAt,selectedPlanId:plan.id});
}

// 三套方案合并文档：一次导出覆盖经济型、均衡型、增强型；每套方案均含部署、覆盖、威胁与 EMC 数据。
export function createDeploymentDocumentAll({report,run,rules=[],conditionId='nominal',documentKind='all',generatedAt=new Date().toISOString(),activePlanId=report?.recommendedId}){
 if(!report||!run?.runId)throw Error('生成布设文档需要完整 report 和带 runId 的 run');
 const plans=Array.isArray(report.plans)?report.plans:[];
 if(!plans.length)throw Error('报告中没有任何布设方案');
 const selectedPlanId=plans.some(item=>item.id===activePlanId)?activePlanId:report.recommendedId;
 const comparison=comparisonModel(report,selectedPlanId);
 const models=plans.map(plan=>buildPlanDocument({report,run,plan,rules,conditionId,documentKind,generatedAt,selectedPlanId}));
 for(const model of models)model.comparison=comparison;
 return {
  schema:DEPLOYMENT_DOC_SCHEMA,documentKind,generatedAt,
  source:{runId:run.runId,runCreatedAt:run.createdAt,reportCreatedAt:report.createdAt,activePlanId:selectedPlanId,recommendedId:report.recommendedId,planIds:plans.map(plan=>plan.id),origin:report.origin,inputHashes:report.inputHashes},
  comparison,plans:models,
  limitations:[...new Set(models.flatMap(model=>model.limitations))],
 };
}
