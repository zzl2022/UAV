import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevice,DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';
import {angles} from '../src/sensors/engine.js';
import {defaultProfile} from '../src/sensors/equipment-catalog.js';
import {EQUIPMENT_CHANNELS_GHZ} from '../src/task3/constants.js';
import {repairPlanWithMobileRadars,applyMobileRepairResult,restoreMobileRepairSnapshot,MOBILE_REPAIR_LIMITS} from '../src/task3/mobile-repair.js';

const equipment=[{id:'radar-03d',type:'radar'}];
const sample=(id,x,z)=>({id,position:[x,30,z],agl:30,core:true,weight:3});
const makeFixture=(samples,devices=[])=>({
 city:{buildings:[]},sampling:{samples,bounds:{west:-1500,east:1500,south:-1500,north:1500,core:[0,0,0]}},
 plan:{id:'balanced',name:'测试方案',devices,sites:devices.map((d,i)=>({id:`base-${i}`,position:[...d.position],installationProxy:1})),cost:devices.length*12,installationProxy:devices.length,coverage:Array.from({length:4},()=>samples.map(()=>0)),metrics:[],coverageContributions:{}},
});
const query={
 groundAt:()=>0,surfaceAt:(x,z)=>z>500?20:0,
 trace:()=>({known:true,blocked:false,buildingCount:0,sensorGround:0,targetGround:0}),
};
const adapters={
 evaluate(device,target){
  if(!device.mobileRepair)return {status:'out-of-model',marginDb:null,reasons:['超出标称距离']};
  const distance=Math.hypot(...device.position.map((value,index)=>value-target.position[index])),covered=distance<=220;
  return {status:covered?'within-model':'out-of-model',marginDb:covered?12:null,reasons:covered?[]:['超出标称距离']};
 },
 classifyBlindSpots({samples,coverageRow,conditionId}){
  const points=samples.flatMap((item,j)=>coverageRow[j]===0?[{sampleId:item.id,position:item.position,agl:item.agl,core:item.core,category:'other',cause:{reason:'测试'}}]:[]);
  return {conditionId,points,stats:{total:points.length,byCategory:{gap:0,corner:0,lowFacade:0,shadow:0,other:points.length}}};
 },
};
const run=(fixture,testAdapters=adapters,equipmentSnapshot=null)=>repairPlanWithMobileRadars({...fixture,query,equipment,equipmentSnapshot,settings:{marginReserveDb:3,costs:{radar:12}},environment:DEFAULT_ENV,target:DEFAULT_TARGET,conditionId:'nominal',adapters:testAdapters,limits:{...MOBILE_REPAIR_LIMITS,radiiM:[80,180,350]}});

test('移动补盲仅移除真实覆盖 sampleId，部分覆盖时保留其余盲点并重算全部工况贡献',async()=>{
 const fixture=makeFixture([sample('s-covered',0,0),sample('s-remaining',0,1000)]),original=structuredClone(fixture.plan),result=await run(fixture,{...adapters,evaluate(device,target,environment,context){
  if(target.position[2]===1000)return {status:'out-of-model',marginDb:null,reasons:['超出标称距离']};
  return adapters.evaluate(device,target,environment,context);
 }});
 assert.equal(result.summary.status,'partial');assert.deepEqual(result.summary.coveredSampleIds,['s-covered']);assert.deepEqual(result.summary.remainingSampleIds,['s-remaining']);
 assert.ok(result.summary.addedDeviceCount>0);assert.equal(result.summary.emc.newFailCount,0);assert.deepEqual(fixture.plan,original,'输入原方案不得被原地修改');
 for(let c=0;c<4;c++){
  assert.ok(result.plan.coverage[c][0]>0);assert.equal(result.plan.coverage[c][1],0);assert.equal(result.blindspots[c].stats.total,1);assert.deepEqual(result.blindspots[c].points.map(p=>p.sampleId),['s-remaining']);
  const mobile=result.plan.devices.find(d=>d.id===result.summary.addedDeviceIds[0]);assert.ok(mobile.mobileRepair);assert.equal(result.plan.coverageContributions[mobile.id][c].coveredSamples,1);
 }
 assert.equal(result.plan.cost,original.cost+result.summary.addedCost);assert.equal(result.summary.originalComparisonUnchanged,true);
});

test('移动补盲可全部覆盖当前盲点，且新增设备使用合法频道与地表假设记录',async()=>{
 const fixture=makeFixture([sample('s-a',-60,0),sample('s-b',60,0)]),result=await run(fixture);
 assert.equal(result.summary.status,'covered');assert.equal(result.summary.afterBlindCount,0);assert.deepEqual(new Set(result.summary.coveredSampleIds),new Set(['s-a','s-b']));
 for(const row of result.blindspots)assert.equal(row.stats.total,0);
 for(const device of result.plan.devices){
  assert.ok(EQUIPMENT_CHANNELS_GHZ[device.presetId].includes(device.parameters.frequencyGHz));assert.equal(device.mobileRepair.roadReachabilityVerified,false);assert.equal(device.mobileRepair.mountHeightM,2);assert.equal(device.mobileRepair.mountHeightSource,'模型假设');assert.equal(device.mobileRepair.deployment,'警车移动部署');
 }
 const site=result.plan.sites.at(-1);assert.equal(site.deployment,'police-car');assert.equal(site.groundM,site.surfaceM);assert.match(site.installation,/警车移动部署/);assert.match(site.installation,/不代表道路可达/);
 const deployActions=result.summary.actions.filter(action=>action.action==='deploy-mobile-radar');assert.equal(deployActions.length,result.summary.addedDeviceCount);assert.deepEqual(new Set(deployActions.flatMap(action=>action.newlyCoveredSampleIds)),new Set(result.summary.coveredSampleIds));
 for(const action of deployActions){assert.ok(EQUIPMENT_CHANNELS_GHZ[action.presetId].includes(action.frequencyGHz));assert.equal(action.mountHeightM,2);assert.equal(action.roadReachabilityVerified,false);assert.ok(action.deviceId);assert.ok(action.siteId);}
});

test('移动补盲使用同次装备快照，保留运行字段并沿用原俯仰和合法频道规则',async()=>{
 const profile=defaultProfile('radar-03d');profile.parameters.maxRange=7123;profile.parameters.frequencyGHz=15;profile.physics.peakPowerW=3333;
 const fixture=makeFixture([sample('s-a',0,0)]),result=await run(fixture,{...adapters,evaluate(device,target,environment,context){
  if(device.mobileRepair&&(device.parameters.maxRange!==7123||device.physics.peakPowerW!==3333))return {status:'out-of-model',marginDb:null,reasons:['超出标称距离']};
  return adapters.evaluate(device,target,environment,context);
 }},{profiles:[profile]});
 assert.equal(result.summary.status,'covered');const mobile=result.plan.devices.find(device=>device.id===result.summary.addedDeviceIds[0]),selected=result.summary.selected[0],anchor=fixture.sampling.samples.find(item=>item.id===selected.anchorSampleId),direction=angles(mobile.position,anchor.position);
 assert.equal(mobile.parameters.maxRange,7123);assert.equal(mobile.physics.peakPowerW,3333);assert.equal(mobile.parameters.pitch,Math.max(-60,Math.min(0,direction.elevation-30)));assert.ok(EQUIPMENT_CHANNELS_GHZ['radar-03d'].includes(mobile.parameters.frequencyGHz));assert.notEqual(mobile.parameters.frequencyGHz,15);assert.equal(mobile.presetId,'radar-03d');assert.equal(mobile.type,'radar');assert.ok(mobile.mobileRepair);assert.equal(mobile.mobileRepair.platform,'police-car');
});

test('稀疏圆环未命中时，警车通过 25 米细网格找到狭窄有效位置',async()=>{
 const fixture=makeFixture([sample('s-narrow',0,0)]),narrowAdapters={...adapters,evaluate(device,target){
  if(!device.mobileRepair)return {status:'out-of-model',marginDb:null,reasons:['超出标称距离']};
  const atFlexibleSite=Math.abs(device.position[0]-425)<0.01&&Math.abs(device.position[2]+425)<0.01;
  const covered=atFlexibleSite&&Math.hypot(...device.position.map((value,index)=>value-target.position[index]))<=800;
  return {status:covered?'within-model':'out-of-model',marginDb:covered?12:null,reasons:covered?[]:['超出标称距离']};
 }},result=await run(fixture,narrowAdapters);
 assert.equal(result.summary.status,'covered');assert.equal(result.summary.search.coarseCoveringCandidates,0);assert.equal(result.summary.search.fineAnchors,1);assert.ok(result.summary.search.fineCoveringCandidates>0);assert.equal(result.summary.search.fineGridStepM,25);
 assert.equal(result.summary.selected.length,1);assert.equal(result.summary.selected[0].searchPhase,'fine-grid');assert.equal(result.summary.selected[0].position[0],425);assert.equal(result.summary.selected[0].position[2],-425);
 for(const row of result.plan.coverage)assert.ok(row[0]>0);for(const row of result.blindspots)assert.equal(row.stats.total,0);
});

test('屋顶或无开阔地表候选时不生成虚假设备',async()=>{
 const fixture=makeFixture([sample('s-a',0,0)]),result=await repairPlanWithMobileRadars({...fixture,query:{...query,surfaceAt:()=>30},equipment,settings:{marginReserveDb:3,costs:{radar:12}},environment:DEFAULT_ENV,target:DEFAULT_TARGET,adapters});
 assert.equal(result.summary.status,'no-candidate');assert.equal(result.summary.search.validGroundCandidates,0);assert.equal(result.summary.addedDeviceCount,0);assert.equal(result.plan.devices.length,0);assert.deepEqual(result.plan.coverage,fixture.plan.coverage);assert.match(result.summary.message,/原盲点全部保留/);
});

test('未选雷达预设时明确提示且不搜索、不部署',async()=>{
 const fixture=makeFixture([sample('s-a',0,0)]);let queried=false;
 const result=await repairPlanWithMobileRadars({...fixture,query:{...query,groundAt(){queried=true;return 0;}},equipment:[{id:'optical-nvt',type:'optical'}],settings:{marginReserveDb:3,costs:{radar:12}},environment:DEFAULT_ENV,target:DEFAULT_TARGET,adapters});
 assert.equal(result.summary.status,'no-radar');assert.equal(result.summary.addedDeviceCount,0);assert.equal(queried,false);assert.match(result.summary.message,/未选择雷达预设/);assert.deepEqual(result.plan.coverage,fixture.plan.coverage);
});

test('候选会新增 EMC fail 时全部拒绝并保留盲点',async()=>{
 const channels=EQUIPMENT_CHANNELS_GHZ['radar-03d'],frequencies=[...channels,channels[0]],devices=frequencies.map((frequencyGHz,index)=>{const device=createDevice('radar-03d',`base-${index}`,[0,3,0]);device.parameters.frequencyGHz=frequencyGHz;return device;});
 const fixture=makeFixture([sample('s-a',0,0)],devices),result=await run(fixture);
 assert.equal(result.summary.status,'emc-unavailable');assert.ok(result.summary.search.emcRejectedCandidates>0);assert.equal(result.summary.addedDeviceCount,0);assert.equal(result.plan.devices.length,devices.length);assert.deepEqual(result.plan.coverage,fixture.plan.coverage);assert.match(result.summary.message,/新增 fail/);
 const rejectActions=result.summary.actions.filter(action=>action.action==='reject-candidate-emc');assert.equal(rejectActions.length,result.summary.search.emcRejectedCandidates);assert.ok(rejectActions.every(action=>action.attemptedFrequenciesGHz.length===channels.length));
});

test('派生结果重复应用不叠加，取消后完整恢复原设备、盲点与 EMC',async()=>{
 const fixture=makeFixture([sample('s-a',0,0)]),result=await run(fixture),report={plans:[fixture.plan],blindspots:{balanced:[{conditionId:'nominal',points:[{sampleId:'s-a'}],stats:{total:1}}]},emc:{balanced:{verdict:'pass',counts:{fail:0,warning:0}}}},original=structuredClone(report);
 const snapshot=applyMobileRepairResult(report,result),derivedDeviceCount=report.plans[0].devices.length;applyMobileRepairResult(report,result);
 assert.equal(report.plans[0].devices.length,derivedDeviceCount);assert.ok(report.mobileRepair);
 restoreMobileRepairSnapshot(report,snapshot);assert.deepEqual(report,original);restoreMobileRepairSnapshot(report,snapshot);assert.deepEqual(report,original,'重复取消必须幂等');
});
