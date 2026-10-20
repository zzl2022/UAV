import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseGreedy,DEFAULT_SETTINGS,validateSettings,emcCheck} from '../src/planning/optimizer.js';
import {AlarmTracker,interpolateRoute} from '../src/planning/flight.js';
import {validateReport} from '../src/planning/report.js';
import {createDevice} from '../src/sensors/presets.js';
const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));
const report=JSON.parse(readFileSync(new URL('../public/deployment-example.json',import.meta.url)));
test('weighted set cover honors cost and equipment limits and removes redundant equipment',()=>{
 const c=[{cost:2,cover:[0,1]},{cost:1,cover:[1]},{cost:2,cover:[2]},{cost:10,cover:[0,1,2]}];
 const full=chooseGreedy(c,[1,3,1],{budget:4,maxDevices:3});assert.equal(full.coveredWeight,5);assert.ok(full.cost<=4);assert.ok(full.indices.length<=3);
 const limited=chooseGreedy(c,[1,3,1],{budget:1,maxDevices:1});assert.deepEqual(limited.indices,[1]);assert.equal(limited.coveredWeight,3);
});
test('infeasible sampled coverage stays uncovered instead of reporting a false success',()=>{
 const result=chooseGreedy([{cost:1,cover:[0]}],[1,1],{budget:10,maxDevices:3});assert.deepEqual(result.covered,[1,0]);assert.equal(result.coveredWeight/result.totalWeight,0.5);
});
test('planning rejects invalid or unbounded settings',()=>{
 assert.doesNotThrow(()=>validateSettings(DEFAULT_SETTINGS));
 for(const change of [{spacing:0},{maxDevices:65},{budget:NaN},{heights:[-1]},{costs:{...DEFAULT_SETTINGS.costs,radar:0}}])assert.throws(()=>validateSettings({...structuredClone(DEFAULT_SETTINGS),...change}));
});
test('EMC proxy detects nearby same-frequency radars and respects separation/channel changes',()=>{
 const a=createDevice('radar-03d','a',[0,100,0]),b=createDevice('radar-03d','b',[50,100,0]);
 const close=emcCheck([a,b]);assert.equal(close.conflicts.length,1);assert.ok(close.penalties.a>0);
 b.parameters.frequencyGHz+=0.5;assert.equal(emcCheck([a,b]).conflicts.length,0);b.parameters.frequencyGHz=a.parameters.frequencyGHz;b.position[0]=700;assert.equal(emcCheck([a,b]).conflicts.length,0);
});
test('alarm state requires real detections and confirms loss after two absent frames',()=>{
 const tracker=new AlarmTracker(),frame=(time,detected,insideCore=false)=>({time,detections:detected?[{id:'radar'}]:[],insideCore});
 assert.equal(tracker.accept(frame(0,false)),'clear');assert.equal(tracker.accept(frame(2,true)),'alarm');assert.equal(tracker.events[0].kind,'detected');
 assert.equal(tracker.accept(frame(4,false,true)),'coasting');assert.equal(tracker.accept(frame(6,false,true)),'clear');assert.ok(tracker.events.some(e=>e.kind==='lost'));
 tracker.accept(frame(8,true,false));assert.ok(tracker.events.some(e=>e.kind==='reacquired'));assert.ok(tracker.events.some(e=>e.kind==='enter-core'));assert.ok(tracker.events.some(e=>e.kind==='leave-core'));assert.throws(()=>tracker.accept(frame(1,true)));
});
test('flight interpolation clamps endpoints and preserves time parameterization',()=>{
 const route={duration:10,points:[{time:0,position:[0,0,0]},{time:10,position:[100,50,-20]}]};assert.deepEqual(interpolateRoute(route,5),[50,25,-10]);assert.deepEqual(interpolateRoute(route,-1),[0,0,0]);assert.deepEqual(interpolateRoute(route,20),[100,50,-20]);
});
test('shipped real-city plan has consistent provenance, budgets, sampled coverage and no fabricated rates',()=>{
 assert.equal(validateReport(report,city),report);assert.ok(report.sampling.samples.length>300);assert.ok(report.candidateCount>700);assert.ok(report.repairSites>0);
 for(const plan of report.plans){assert.ok(plan.cost<=plan.budget+1e-7);assert.ok(plan.devices.length<=plan.maxDevices);for(const m of plan.metrics){assert.equal(m.coverageRate,m.covered/m.total);assert.ok(Math.abs(m.blindRate-(1-m.coverageRate))<1e-12);}}
 const selected=report.plans.find(p=>p.id===report.selectedId);assert.equal(selected.metrics[0].covered,selected.metrics[0].total);assert.ok(selected.metrics.find(m=>m.condition==='interference').blindRate>0);
 assert.ok(report.route.geometryVerified);assert.equal(report.flight.frames.length,report.flight.summary.samples);assert.equal(report.flight.summary.detectedSamples,report.flight.frames.filter(f=>f.detections.length>0).length);
 const ids=new Set(selected.devices.map(d=>d.id));let time=-1;for(const f of report.flight.frames){assert.ok(f.time>time);time=f.time;for(const d of f.detections)assert.ok(ids.has(d.id));}
 const bad=structuredClone(report);bad.plans[0].metrics[0].coverageRate=0;assert.throws(()=>validateReport(bad,city));
});
