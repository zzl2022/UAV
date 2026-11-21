import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceExplanation} from '../src/task3/device-explanation.js';
import {createDevice} from '../src/sensors/presets.js';
const devices=Array.from({length:8},(_,i)=>createDevice(i===7?'radio-tdoa':'radar-03d',`d-${i}`,[i*100,22,0]));
const report={plans:[{id:'balanced',name:'均衡型',devices,sites:devices.map(()=>({name:'测试楼顶',installation:'屋顶上方 2 m；施工条件未实测'})),metrics:[{condition:'nominal',total:100}],coverageContributions:Object.fromEntries(devices.map((d,i)=>[d.id,[{condition:'nominal',coveredSamples:i,independentSamples:0}]]))}],conditions:[{id:'nominal',name:'基线发射'}],sampling:{bounds:{core:[0,0,0]}},settings:{coreRadius:700,marginReserveDb:3},emc:{balanced:{counts:{fail:0,warning:0},conflicts:[]}}};
const input={report,run:{runId:'test-run'},activePlanId:'balanced',deviceIds:devices.map(d=>d.id)};
test('逐台解释全部勾选设备，不截断为代表点，零贡献和缺失数据如实说明',()=>{
 const model=createDeviceExplanation(input);assert.equal(model.devices.length,8);assert.equal(model.devices[0].id,'d-0');assert.match(model.devices[0].plain.join(''),/没有达到模型覆盖门槛/);
 for(const d of model.devices){assert.ok(d.technical.length>=4);assert.ok(d.plain.length>=4);assert.equal(d.contributions[0].independentSamples,0);}
 assert.match(model.devices[7].plain.join(''),/不发射无线电/);
 const missing=structuredClone(report);delete missing.plans[0].coverageContributions['d-0'];assert.match(createDeviceExplanation({...input,report:missing,deviceIds:['d-0']}).devices[0].plain.join(''),/未提供/);
});
test('选择按当前列表顺序去重，未知设备、方案及空选择被拒绝，生成结果与原数据隔离',()=>{
 const model=createDeviceExplanation({...input,deviceIds:['d-7','d-0','d-7']});assert.deepEqual(model.devices.map(d=>d.id),['d-0','d-7']);
 model.devices[0].position[0]=999;assert.equal(devices[0].position[0],0);
 for(const overrides of [{deviceIds:[]},{deviceIds:['invalid']},{activePlanId:'invalid'},{conditionId:'invalid'}])assert.throws(()=>createDeviceExplanation({...input,...overrides}));
});
