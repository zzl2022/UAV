import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevice,DEFAULT_TARGET,DEFAULT_ENV} from '../src/sensors/presets.js';
import {evaluate} from '../src/sensors/engine.js';
import {profileGroups,defaultProfile,validateProfile} from '../src/sensors/equipment-catalog.js';
import {prepareDemo,demoValue} from '../src/sensors/equipment-demo-model.js';
const context={known:true,blocked:false};
test('hidden legacy radar controls do not change active energy result; real target RCS does',()=>{
 const device=createDevice('radar-02c','r',[0,100,0]),target={...structuredClone(DEFAULT_TARGET),position:[0,200,-1000]};
 const baseline=evaluate(device,target,DEFAULT_ENV,context);
 Object.assign(device.parameters,{thresholdDb:50,referenceSnrDb:40,referenceRcs:1});
 assert.equal(evaluate(device,target,DEFAULT_ENV,context).marginDb,baseline.marginDb);
 assert.notEqual(evaluate(device,{...target,rcs:.1},DEFAULT_ENV,context).marginDb,baseline.marginDb);
 const keys=profileGroups('radar-02c').flatMap(g=>g.keys);assert.ok(!keys.includes('parameters.referenceRcs'));assert.ok(keys.includes('physics.pdRequired'));
});
test('reference RF calibration cancels receiver constants but retains EIRP sensitivity',()=>{
 const device=createDevice('radio-tdoa','rf',[0,100,0]),target={...structuredClone(DEFAULT_TARGET),position:[0,200,-1000]};
 const baseline=evaluate(device,target,DEFAULT_ENV,context);
 Object.assign(device.physics,{rxGainDb:20,noiseFigureDb:10,receiverLossDb:10,bandwidthMHz:50});
 assert.ok(Math.abs(evaluate(device,target,DEFAULT_ENV,context).marginDb-baseline.marginDb)<1e-10);
 assert.ok(Math.abs(evaluate(device,{...target,eirpDbm:target.eirpDbm+3},DEFAULT_ENV,context).marginDb-baseline.marginDb-3)<1e-10);
 assert.doesNotThrow(()=>validateProfile(defaultProfile('radio-tdoa')));
});
test('optical near-ground gap is view geometry and changes with pitch without a minRange',()=>{
 const profile=defaultProfile('optical-nvt'),settings={horizontal:60,pitch:10,radius:400};
 const spec=prepareDemo(profile,settings,[0,30,0]),scenario={target:DEFAULT_TARGET,environment:DEFAULT_ENV};
 assert.equal(demoValue(spec,[0,0,-100],scenario,context).mask,2);
 assert.equal(demoValue(spec,[0,0,-300],scenario,context).mask,1);
 const lower=prepareDemo(profile,{...settings,pitch:-10},[0,30,0]);
 assert.equal(demoValue(lower,[0,0,-100],scenario,context).mask,1);
});
