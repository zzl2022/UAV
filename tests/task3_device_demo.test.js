import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevice,DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';
import {deviceDemoStartDecision,DEMO_MAX_SAMPLES} from '../src/sensors/equipment-demo-limits.js';
import {prepareEquipmentDemoRun} from '../src/sensors/equipment-demo-session.js';
import {prepareDeploymentDemoInputs} from '../src/task3/device-demo.js';

test('设备仿真按实际三维距离、实例及启动间隔决定是否切换',()=>{
 const active={id:'A',position:[0,0,0]};
 assert.equal(deviceDemoStartDecision(active,active,3000,3000),'focus');
 assert.equal(deviceDemoStartDecision(active,{id:'B',position:[0,29.99,0]},3000,6000),'nearby');
 assert.equal(deviceDemoStartDecision(active,{id:'C',position:[0,30,0]},3000,4499),'cooldown');
 assert.equal(deviceDemoStartDecision(active,{id:'C',position:[0,30,0]},3000,4500),'start');
 assert.equal(deviceDemoStartDecision(null,active,-Infinity,0),'start');
});

test('设备会话保留本轮报告的部署点、参数和环境，并限制采样预算',()=>{
 const position=[140,95,-80],device=createDevice('radar-03d','model-demo',position);
 device.parameters.heading=225;device.parameters.pitch=-15;device.physics.peakPowerW=2345;
 const report={environment:{...DEFAULT_ENV},target:{...DEFAULT_TARGET}};
 const input=prepareDeploymentDemoInputs(device,report);
 assert.equal(input.profile.physics.peakPowerW,2345);
 assert.equal(input.settings.heading,225);assert.equal(input.settings.pitch,-15);
 assert.deepEqual(input.position,position);assert.equal(input.scenario.target,report.target);
 const model={buildings:{},ground:{geometry:{boundingBox:{min:{x:-10000,y:0,z:-10000},max:{x:10000,y:200,z:10000}}}}};
 const query={},run=prepareEquipmentDemoRun({...input,settings:{...input.settings,spacing:25},model,getQuery:()=>query});
 assert.ok(run.grid.total<=DEMO_MAX_SAMPLES);
 assert.equal(run.query,query);assert.deepEqual(run.spec.position,position);
 assert.deepEqual(run.scenario.environment,report.environment);assert.notEqual(run.scenario.environment,report.environment);
 assert.throws(()=>prepareDeploymentDemoInputs(device,{target:report.target}),/缺少环境或目标参数/);
 delete device.physics.peakPowerW;
 assert.throws(()=>prepareDeploymentDemoInputs(device,report),/缺少.*功率/);
});
