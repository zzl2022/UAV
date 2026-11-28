import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceExplanation} from '../src/task3/device-explanation.js';
import {createDevice} from '../src/sensors/presets.js';
import {collectDecisionEvidence} from '../src/task3/decision-evidence.js';
import {buildDeviceExplanationDocument} from '../src/task3/device-explanation-pdf.js';
const devices=Array.from({length:8},(_,i)=>createDevice(i===7?'radio-tdoa':'radar-03d',`d-${i}`,[i*100,22,0]));
const report={plans:[{id:'balanced',name:'均衡型',devices,sites:devices.map(()=>({name:'测试楼顶',installation:'屋顶上方 2 m；施工条件未实测'})),metrics:[{condition:'nominal',total:100}],coverageContributions:Object.fromEntries(devices.map((d,i)=>[d.id,[{condition:'nominal',coveredSamples:i,independentSamples:0}]]))}],conditions:[{id:'nominal',name:'基线发射'}],sampling:{bounds:{core:[0,0,0]}},settings:{coreRadius:700,marginReserveDb:3},emc:{balanced:{counts:{fail:0,warning:0},conflicts:[]}}};
const input={report,run:{runId:'test-run'},activePlanId:'balanced',deviceIds:devices.map(d=>d.id)};
test('逐台解释全部勾选设备，不截断为代表点，零贡献和缺失数据如实说明',()=>{
 const model=createDeviceExplanation(input);assert.equal(model.devices.length,8);assert.equal(model.devices[0].id,'d-0');assert.match(model.devices[0].plain.join(''),/没有达到模型覆盖门槛/);
 for(const d of model.devices){assert.ok(d.technical.length>=4);assert.ok(d.plain.length>=4);assert.equal(d.contributions[0].independentSamples,0);}
 assert.match(model.devices[7].plain.join(''),/不发射无线电/);
 const missing=structuredClone(report);delete missing.plans[0].coverageContributions['d-0'];assert.match(createDeviceExplanation({...input,report:missing,deviceIds:['d-0']}).devices[0].plain.join(''),/未提供/);
});

test('真实事件重建本步边际收益，区分策略排除、预算和同点位不同姿态，不改动候选矩阵',()=>{
 const candidate=(id,presetId,cost,cover,siteId='s')=>({device:createDevice(presetId,id,[0,22,0]),site:{id:siteId,name:'测试点',installationProxy:1.2,position:[0,22,0]},cost,cover});
 const a=candidate('a','radar-03d',4,[0,1,2,3]),b=candidate('b','radio-tdoa',3,[0,1]),excluded=candidate('x','optical-nvt',1,[0,1,2,3]),pool=[a,b],candidates=[a,b,excluded],original=structuredClone(candidates);
 const event={type:'select',phase:'greedy',step:1,candidateIndex:0,deviceId:'a',cost:4,cumulativeCost:4,gain:12,gainPerCost:3};
 const plan={devices:[a.device],sites:[a.site],presetSubset:['radar-03d','radio-tdoa'],budget:8,optimizationTrace:{events:[event],policy:{redundancy:0}},emcRemediation:{actions:[]}};
 const evidence=collectDecisionEvidence({plan,pool,candidates,sampling:{samples:[{weight:3},{weight:1}]},conditions:[{id:'nominal'},{id:'silent'}],settings:{marginReserveDb:3}}).a;
 assert.equal(evidence.selection.bestGainPerCost,3);assert.equal(evidence.selection.eligibleCandidateCount,2);assert.equal(evidence.selection.sameSiteAlternatives.find(r=>r.deviceId==='b').gain,8);assert.equal(evidence.selection.sameSiteAlternatives.find(r=>r.deviceId==='x').allowed,false);assert.deepEqual(candidates,original);
});

test('删除后重新选入与 EMC 移位关联回原事件，不能为替代点伪造贪心步骤',()=>{
 const a={device:createDevice('radar-03d','a',[0,22,0]),site:{id:'s1',position:[0,22,0],installationProxy:1.2},cost:4,cover:[0]},replacement={device:createDevice('radar-03d','replacement',[100,22,0]),site:{id:'s2',position:[100,22,0],installationProxy:1.2},cost:4,cover:[0]};
 const events=[{type:'select',phase:'greedy',step:1,candidateIndex:0,deviceId:'a',cost:4,cumulativeCost:4,gain:6,gainPerCost:1.5},{type:'delete',candidateIndex:0},{type:'select',phase:'refill',step:3,candidateIndex:0,deviceId:'a',cost:4,cumulativeCost:4,gain:6,gainPerCost:1.5}];
 const plan={devices:[replacement.device],sites:[replacement.site],presetSubset:['radar-03d'],budget:8,optimizationTrace:{events,policy:{redundancy:0}},emcRemediation:{actions:[{action:'relocate',deviceId:'a',replacementDeviceId:'replacement'}]}};
 const evidence=collectDecisionEvidence({plan,pool:[a,replacement],candidates:[a,replacement],sampling:{samples:[{weight:3}]},conditions:[{id:'nominal'}],settings:{marginReserveDb:3}}).replacement;
 assert.equal(evidence.originDeviceId,'a');assert.equal(evidence.selection.event.step,3);assert.equal(evidence.selection.sameSiteAlternatives[0].siteId,'s1');assert.equal(evidence.finalCandidate.siteId,'s2');assert.equal(evidence.migration.length,1);assert.equal(evidence.selection.sameSiteAlternatives[0].gain,6);
 const duplicatePose=structuredClone(a);duplicatePose.device.id='other-pitch';duplicatePose.device.parameters.pitch+=10;
 const withPoses=collectDecisionEvidence({plan,pool:[a,replacement,duplicatePose],candidates:[a,replacement,duplicatePose],sampling:{samples:[{weight:3}]},conditions:[{id:'nominal'}],settings:{marginReserveDb:3}}).replacement;
 assert.deepEqual(withPoses.otherSites.map(row=>row.siteId),['s1'],'附近站点不得重复列出同站点不同姿态');
});

test('正式明细包含完整流程与全部物理参数，历史证据缺失如实说明，排版无设备强制换页',()=>{
 const model=createDeviceExplanation({...input,deviceIds:['d-0']});assert.equal(model.schema,'task3-device-explanation/2.0');assert.equal(model.workflow.length,8);assert.ok(model.prerequisites.length>=5);assert.ok(model.exceptions.length>=6);assert.ok(model.acceptance.length>=5);
 const device=model.devices[0];assert.equal(device.parameterRows.length,Object.keys(devices[0].parameters).length+Object.keys(devices[0].physics).length);assert.match(device.technical.join(''),/未保留/);assert.equal(device.alternatives.length,0);
 const definition=buildDeviceExplanationDocument(model),serialized=JSON.stringify(definition);assert.equal(definition.defaultStyle.fontSize,10.5);assert.ok(!serialized.includes('"pageBreak":"before"'));assert.ok(!serialized.includes('"unbreakable":true'));assert.match(serialized,/参数配置与异常处理/);assert.match(serialized,/验收/);assert.ok(!serialized.includes('NaN'));
 const derived=structuredClone(report);derived.plans[0].derivation={};derived.plans[0].linkExamples={'d-0':[{condition:'nominal',marginDb:999}]};assert.deepEqual(createDeviceExplanation({...input,report:derived,deviceIds:['d-0']}).devices[0].linkExamples,[],'移动派生结果不得沿用固定方案的旧链路值');
});
test('选择按当前列表顺序去重，未知设备、方案及空选择被拒绝，生成结果与原数据隔离',()=>{
 const model=createDeviceExplanation({...input,deviceIds:['d-7','d-0','d-7']});assert.deepEqual(model.devices.map(d=>d.id),['d-0','d-7']);
 model.devices[0].position[0]=999;assert.equal(devices[0].position[0],0);
 for(const overrides of [{deviceIds:[]},{deviceIds:['invalid']},{activePlanId:'invalid'},{conditionId:'invalid'}])assert.throws(()=>createDeviceExplanation({...input,...overrides}));
});
