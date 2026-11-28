import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import loadHighs from 'highs';
import {estimateFleetCoverage} from '../src/task3/fleet-capacity.js';
import {comparisonInputs,matchDeploymentRules} from '../src/task3/rule-matches.js';
import {createDevice,DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';
import {remediateEmcConflicts} from '../src/task3/pipeline.js';
import {generateSamples,DEFAULT_SETTINGS} from '../src/planning/optimizer.js';

const book=JSON.parse(readFileSync(new URL('../public/data/cross-map-deployment-rules.json',import.meta.url)));
const report=()=>({settings:{...DEFAULT_SETTINGS,installationHeightM:2,budget:360,maxDevices:24},environment:{...DEFAULT_ENV},target:{...DEFAULT_TARGET},conditions:[{id:'nominal'},{id:'silent'}],origin:[0,0,0]});
const makePlan=()=>({id:'balanced',budget:100,devices:[createDevice('radio-x1c','rx',[0,0,0]),createDevice('radar-03d','tx',[30,0,0]),createDevice('acoustic-cry','ac',[10,0,0])]});
const match=(r,p,prior)=>Object.fromEntries(matchDeploymentRules(book.acceptedRules,r,p,prior).map(row=>[row.rule.id,row.deviceIds]));

test('关联使用最终设备、真实帧和完整触发条件，工况与预设数量不代替有效链路',()=>{
 const r=report(),p=makePlan();
 r.settings.buildingExclusions={buildingIds:['one']};r.target.frequencyGHz=4.9;
 r.threatsByPlan={balanced:{swarm:{frames:[{targets:Array.from({length:42},()=>({detectedBy:[]}))}]}}};
 const base=match(r,p);assert.deepEqual(base.R01,['rx']);assert.deepEqual(base.R05,['rx']);assert.deepEqual(base.R06,[]);
 assert.deepEqual(base.R07,['rx','tx','ac']);assert.deepEqual(base.R08,base.R07);
 const f=r.threatsByPlan.balanced.swarm.frames[0];
 for(const target of f.targets.slice(0,15))target.detectedBy.push({id:'rx'});
 f.overflow=Array.from({length:27},(_,i)=>({deviceId:'rx',targetId:i+15}));
 assert.deepEqual(match(r,p).R06,['rx']);
 p.derivation={};assert.deepEqual(match(r,p).R06,[]);
});

test('单参数与组合规则需要可比较的基线，换地图或同时改变其他参数后不误报',()=>{
 for(const [id,group,key,from,to,ids] of [['R02','target','rcs',.01,.001,['tx']],['R03','environment','emNoiseDb',0,15,['rx','tx']],['R04','environment','trafficDb',35,70,['ac']]]){
  const r=report(),p=makePlan();r[group][key]=from;const prior=comparisonInputs(r);r[group][key]=to;
  assert.deepEqual(match(r,p,prior)[id],ids);assert.deepEqual(match(r,p)[id],[]);
  r.origin=[1,0,0];assert.deepEqual(match(r,p,prior)[id],[]);
 }
 const t=book.acceptedRules.find(r=>r.id==='R09').trigger,r=report(),prior=comparisonInputs(r),p=makePlan();
 Object.assign(r.target,t.target);Object.assign(r.environment,t.environment);for(const [key,[,to]] of Object.entries(t.resourceChanges))r.settings[key]=to;
 assert.equal(match(r,p,prior).R09.length,3);r.settings.spacing+=5;assert.deepEqual(match(r,p,prior).R09,[]);
});

test('提示修复比较前后状态，并遵守预算；无合法方案时保留原提示',()=>{
 const devices=[createDevice('radar-03d','tx',[0,10,0]),createDevice('optical-nvt','op',[0,10,0])];
 const alt=createDevice('optical-nvt','alternative',[80,10,0]);
 const candidates=[...devices,alt].map((device,i)=>({device,site:{id:'site'+i,position:device.position},cost:i===2?2:1}));
 const args={devices,sites:candidates.slice(0,2).map(c=>c.site),indices:[0,1],candidates,severity:'warning'};
 const good=remediateEmcConflicts({...args,budget:3});
 assert.equal(good.before.counts.warning,1);assert.deepEqual(good.after.counts,{warning:0,fail:0});
 assert.equal(good.actions[0].replacementDeviceId,'alternative');assert.deepEqual(devices[1].position,[0,10,0]);
 const bad=remediateEmcConflicts({...args,budget:2});assert.equal(bad.status,'unresolved');assert.equal(bad.unresolved.length,1);
});

test('HiGHS 对重合覆盖去重，有限车辆、零辆、过量和非法数量均有明确结果',async()=>{
 const solver=await loadHighs(),groups=[{cars:[0],count:3},{cars:[1],count:2},{cars:[0,1],count:10},{cars:[],count:1}];
 const run=available=>estimateFleetCoverage(solver,{available,totalCars:2,groups});
 assert.deepEqual(run(1),{covered:13,total:16,used:1});assert.equal(run(2).covered,15);assert.equal(run(100).covered,15);
 assert.deepEqual(run(0),{covered:0,total:16,used:0});
 for(const n of [-1,Infinity,.5,NaN])assert.throws(()=>run(n));
});

test('精细网格在读取地表前拒绝过大的采样矩阵',()=>{
 const coreBuilding={rings:[[[0,0,0],[1,0,1]]]},city={metadata:{coreBuilding},buildings:[]};
 assert.throws(()=>generateSamples(city,{},{...DEFAULT_SETTINGS,scope:'custom',spacing:50,scopeWidthM:30000,scopeDepthM:30000}),/50000/);
});
