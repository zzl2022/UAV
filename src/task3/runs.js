// 多轮仿真过程数据存档：每轮推演的完整快照写入 artifacts/task3/runs/<runId>.json，
// 作为布设规则提炼（task6）的唯一数据来源。浏览器端通过导出下载留存；CLI 脚本直接落盘。
import {RUN_SCHEMA,TASK3_VERSION} from './constants.js';

export function createRunId(date=new Date()){
 return `run-${date.toISOString().replace(/[-:]/g,'').replace(/\..*/,'').replace('T','-')}-${Math.random().toString(36).slice(2,7)}`;
}

export function createRun({label,settings,weights,equipment,environment,target,origin,inputHashes}){
 return {
  schema:RUN_SCHEMA,version:TASK3_VERSION,runId:createRunId(),createdAt:new Date().toISOString(),label:label??'',
  settings,weights,equipment,environment,target,origin,inputHashes,
  summary:null,blindspots:null,threats:null,emc:null,rulesInput:null,durationMs:null,limitations:[],
 };
}

export function finalizeRun(run,{summary,blindspots,threats,emc,durationMs,limitations}){
 return {...run,summary,blindspots,threats,emc,durationMs,limitations:limitations??run.limitations};
}

export function validateRun(run){
 if(run?.schema!==RUN_SCHEMA||typeof run.runId!=='string'||!run.runId)throw Error('过程数据 schema 或 runId 无效');
 if(!run.settings||!run.summary||!Array.isArray(run.summary.plans)||!run.summary.plans.length)throw Error('过程数据缺少方案摘要');
 for(const plan of run.summary.plans){
  if(!plan.id||!Number.isFinite(plan.cost)||!plan.metrics)throw Error(`方案 ${plan.id??'?'} 摘要无效`);
 }
 return run;
}
