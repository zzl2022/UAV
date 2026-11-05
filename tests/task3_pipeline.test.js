import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {runTask3Pipeline,validatePresetIds} from '../src/task3/pipeline.js';
import {chooseGreedy} from '../src/planning/optimizer.js';
import {validateRun} from '../src/task3/runs.js';
import {METRIC_WEIGHTS} from '../src/task3/constants.js';

const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));
const terrain=JSON.parse(readFileSync(new URL('../public/data/terrain.json',import.meta.url)));
const query=createSceneQuery(createModel(city,terrain));
const yieldTask=()=>new Promise(resolve=>setImmediate(resolve));
const closeTo=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ≠ ${expected}`);
function replayTrace(events){
 const selected=[];
 for(const event of events){
  if(event.type==='select')selected.push(event);
  else if(event.type==='delete'){
   const index=selected.map(e=>e.candidateIndex).lastIndexOf(event.candidateIndex);
   assert.ok(index>=0,'删除事件必须对应仍在方案中的候选');selected.splice(index,1);
  }else assert.fail(`未知轨迹事件 ${event.type}`);
 }
 return selected;
}

test('chooseGreedy 轨迹如实记录反向删除和再补选，且不改变最终选择',()=>{
 const candidates=[{cost:2,cover:[0,1]},{cost:1,cover:[1]},{cost:2,cover:[2]},{cost:10,cover:[0,1,2]}];
 const result=chooseGreedy(candidates,[1,3,1],{budget:4,maxDevices:3});
 assert.deepEqual(result.indices,[0,2]);assert.equal(result.cost,4);assert.equal(result.coveredWeight,5);
 assert.deepEqual(result.events.map(e=>[e.type,e.phase,e.pass,e.candidateIndex]),[
  ['select','greedy',1,1],['select','greedy',1,0],['delete','reverse-delete',1,1],['select','refill',2,2],
 ]);
 let cost=0;
 for(const [index,event] of result.events.entries()){
  assert.equal(event.step,index+1);assert.equal(event.pass,index===3?2:1);
  if(event.type==='select'){
   for(const key of ['phase','pass','step','candidateIndex','deviceId','presetId','siteId','gain','cost','gainPerCost','cumulativeCost','coveredWeightPct'])assert.ok(Object.hasOwn(event,key),key);
   cost+=event.cost;closeTo(event.gainPerCost,event.gain/event.cost);
  }else{cost-=event.releasedCost;assert.equal(event.releasedCost,1);assert.match(event.reason,/不降低覆盖/);}
  closeTo(event.cumulativeCost,cost);assert.ok(event.coveredWeightPct>=0&&event.coveredWeightPct<=100);
 }
 assert.deepEqual(replayTrace(result.events).map(e=>e.candidateIndex),result.indices);closeTo(cost,result.cost);
 assert.deepEqual(result.events.map(e=>e.coveredWeightPct),[60,80,80,100]);
});

test('task3 pipeline: 一键串联产出 ≥3 套差异化方案、盲区分类、三威胁与 EMC 结论，过程数据可校验',async()=>{
 const {report,run}=await runTask3Pipeline({city,query,weights:{...METRIC_WEIGHTS},progress:()=>{},yieldTask});
 // ≥3 套方案且点位/类型组合不同
 assert.equal(report.plans.length,3);
 assert.ok(new Set(report.plans.map(p=>p.devices.length)).size>1||new Set(report.plans.map(p=>p.presetSubset.join())).size>1,'三套方案须有差异');
 // 推荐方案与四指标
 assert.ok(report.plans.some(p=>p.id===report.recommendedId));
 for(const row of report.scoring.plans){for(const k of ['coverage','blindRatio','cost','feasibility'])assert.ok(Number.isFinite(row.indicators[k]),k);assert.ok(row.score>=0&&row.score<=1);}
 // 盲区四类归因完整
 for(const rows of Object.values(report.blindspots))for(const r of rows){assert.equal(r.stats.total,Object.values(r.stats.byCategory).reduce((a,b)=>a+b,0));for(const p of r.points)assert.ok(['gap','corner','lowFacade','shadow','other'].includes(p.category));}
 // 三威胁场景
 for(const key of ['single','multi','swarm']){const th=report.threats[key];assert.ok(th.summary.targetCount>0);assert.ok(th.frames.length>0);assert.ok(th.summary.meanDetectedFraction>=0&&th.summary.meanDetectedFraction<=1);}
 assert.equal(report.threats.swarm.summary.targetCount,42);
 // 标准默认 500 m 网格：处置后推荐方案必须无 fail，记录和覆盖复核完整
 assert.equal(report.settings.spacing,500);assert.equal(report.deploymentStatus,'deployable');
 assert.equal(report.emc[report.recommendedId].counts.fail,0);
 for(const p of report.plans){
  assert.ok(['pass','degraded','fail'].includes(report.emc[p.id].verdict));assert.equal(report.emc[p.id].counts.fail,0);assert.ok(report.emc[p.id].remediation.coverageReview.after.length>0);assert.ok(run.emc[p.id].remediation);
  const trace=p.optimizationTrace;
  assert.ok(trace);assert.equal(trace.policy.id,p.id);assert.equal(trace.policy.budget,p.budget);assert.equal(trace.policy.maxDevices,p.maxDevices);assert.deepEqual(trace.policy.presetSubset,p.presetSubset);assert.ok(trace.poolSize>0);assert.ok(trace.events.length>0);
  let traceCost=0,lastCoveragePct=0,lastPass=0;
  for(const [index,event] of trace.events.entries()){
   assert.equal(event.step,index+1);assert.ok(event.pass>=lastPass);lastPass=event.pass;assert.ok(Number.isInteger(event.candidateIndex)&&event.candidateIndex>=0&&event.candidateIndex<trace.poolSize);
   if(event.type==='select'){
    for(const key of ['phase','pass','step','candidateIndex','deviceId','presetId','siteId','gain','cost','gainPerCost','cumulativeCost','coveredWeightPct'])assert.ok(Object.hasOwn(event,key),key);
    assert.ok(event.deviceId&&event.presetId&&event.siteId);assert.ok(event.gain>0&&event.cost>0);closeTo(event.gainPerCost,event.gain/event.cost);traceCost+=event.cost;
   }else{
    assert.equal(event.type,'delete');assert.equal(event.phase,'reverse-delete');assert.ok(event.releasedCost>0);assert.match(event.reason,/不降低覆盖/);traceCost-=event.releasedCost;
   }
   closeTo(event.cumulativeCost,traceCost);assert.ok(event.coveredWeightPct+1e-8>=lastCoveragePct);assert.ok(event.coveredWeightPct<=100+1e-8);lastCoveragePct=event.coveredWeightPct;
  }
  assert.ok(traceCost<=p.budget+1e-8);
  const initialSelection=replayTrace(trace.events),expected=initialSelection.map(e=>({deviceId:e.deviceId,presetId:e.presetId,siteId:e.siteId}));
  assert.equal(initialSelection.length,p.devices.length);
  for(const action of p.emcRemediation.actions){
   const index=expected.findIndex(d=>d.deviceId===action.deviceId);assert.ok(index>=0,'EMC 动作必须衔接轨迹最终选点');
   if(action.action==='relocate'){expected[index].deviceId=action.replacementDeviceId;expected[index].siteId=action.after.siteId;}
  }
  assert.deepEqual(expected.map(d=>d.deviceId),p.devices.map(d=>d.id));assert.deepEqual(expected.map(d=>d.presetId),p.devices.map(d=>d.presetId));assert.deepEqual(expected.map(d=>d.siteId),p.sites.map(s=>s.id));
  // 逐设备贡献来自最终实际覆盖矩阵；独立贡献之和必须等于仅由一台设备覆盖的采样数。
  for(const [c,condition] of report.conditions.entries()){
   const rows=p.devices.map(d=>p.coverageContributions[d.id][c]);
   assert.ok(rows.every(row=>row.condition===condition.id&&row.coveredSamples>=row.independentSamples&&row.independentSamples>=0));
   assert.equal(rows.reduce((sum,row)=>sum+row.independentSamples,0),p.coverage[c].filter(count=>count===1).length);
   assert.ok(rows.reduce((sum,row)=>sum+row.coveredSamples,0)>=p.metrics[c].covered);
  }
 }
 const enhancedEvents=report.plans.find(p=>p.id==='enhanced').optimizationTrace.events,firstEnhancement=enhancedEvents.findIndex(e=>e.phase==='redundancy');
 assert.ok(firstEnhancement>0);const enhancement=enhancedEvents.slice(firstEnhancement),baseSelection=replayTrace(enhancedEvents.slice(0,firstEnhancement)),fullSelection=replayTrace(enhancedEvents);
 assert.ok(enhancement.length>0&&enhancement.every(e=>e.type==='select'&&e.phase==='redundancy'));
 assert.deepEqual(fullSelection.slice(0,baseSelection.length).map(e=>e.candidateIndex),baseSelection.map(e=>e.candidateIndex));assert.equal(fullSelection.length-baseSelection.length,enhancement.length);
 assert.ok(report.emc.enhanced.remediation.before.counts.fail>0);assert.ok(report.emc.enhanced.remediation.actions.length>0);
 // 过程数据
 validateRun(run);assert.ok(run.rulesInput.candidateStats.length>0);assert.ok(run.rulesInput.perHeightBlind.length===3);
});

test('task3 pipeline: 装备选择注入生效，非法预设被拒',async()=>{
 assert.throws(()=>validatePresetIds([]));assert.throws(()=>validatePresetIds(['nope']));
 const {report}=await runTask3Pipeline({city,query,settings:{scope:'core',spacing:700,siteSpacing:500,heights:[30,60,100],maxSites:192,maxDevices:32,budget:300,costs:{radar:12,radio:5,optical:4,acoustic:2},coreRadius:700,coreWeight:3,marginReserveDb:3},presetIds:['radar-03d','radio-tdoa'],weights:{...METRIC_WEIGHTS},progress:()=>{},yieldTask,withThreatFrames:false});
 const types=new Set(report.plans.flatMap(p=>p.devices.map(d=>d.presetId)));
 assert.deepEqual([...types].sort(),['radar-03d','radio-tdoa'].sort());
});
