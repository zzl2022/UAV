import test from 'node:test';
import assert from 'node:assert/strict';
import {heatDevices,heatGrid,heatClass,bestDetection,sampleHeatmap} from '../src/sensors/heatmap.js';
import {createDevice,DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
const r=createDevice('radar-02c','radar',[0,10,0]),rf=createDevice('radio-tdoa','radio',[0,10,0]);
r.parameters.reflection=0;rf.parameters.reflection=0;
const terrain={positions:[-2000,0,-2000,2000,0,-2000,-2000,0,2000,2000,0,2000],indices:[0,2,1,1,2,3]};
const wall={id:'wall',height:100,foundationDepth:0,rings:[[[300,0,-100],[330,0,-100],[330,0,100],[300,0,100],[300,0,-100]]]};
const query=createSceneQuery(createModel({metadata:{},buildings:[wall]},terrain));
const grid=points=>({points:points.map(([x,z,height])=>({x,z,height})),spacing:75});
test('heat grid bounds cost and retains terrain-relative slice heights',()=>{
 const g=heatGrid({west:0,east:12000,south:0,north:6000},75,[30,60,100]);
 assert.ok(g.points.length<=4096);assert.ok(g.spacing>75);assert.deepEqual([...new Set(g.points.map(p=>p.height))],[30,60,100]);
 assert.throws(()=>heatGrid({west:0,east:0,south:0,north:1},150,[30]));
});
test('layer selection and union preserve hard failures and unknown paths',()=>{
 const devices=[r,rf,createDevice('optical-nvt','optical')];
 assert.deepEqual(heatDevices(devices,'selected','radar').map(d=>d.id),['radar']);
 assert.deepEqual(heatDevices(devices,'combined','radar').map(d=>d.id),['radar','radio']);
 assert.equal(heatDevices(devices,'radio','radar').length,1);
 const fail={status:'outside-model',marginDb:40,geometry:{known:true}},uncertain={status:'uncertain',marginDb:20,geometry:{known:false}},pass={status:'within-model',marginDb:1,geometry:{known:true}};
 assert.equal(bestDetection([fail,uncertain,pass]),pass);assert.equal(heatClass(pass),'marginal');assert.equal(heatClass(fail),'blind');assert.equal(heatClass(uncertain),'unknown');
});
test('heatmap exposes pulse blind zone, real building shadow and altitude recovery',async()=>{
 const result=await sampleHeatmap({query,devices:[r],target:DEFAULT_TARGET,environment:DEFAULT_ENV,grid:grid([[0,-100,30],[600,0,30],[600,0,300],[315,0,30],[5000,0,60]])});
 assert.equal(result.cells[0].category,'blind');assert.match(result.cells[0].reason,/近距盲区/);
 assert.equal(result.cells[1].category,'blind');assert.match(result.cells[1].reason,/阻断/);
 assert.equal(result.cells[2].category,'strong');assert.equal(result.counts.inside,1);assert.equal(result.counts.missing,1);
 assert.equal(Object.values(result.counts).reduce((a,b)=>a+b,0),5);
});
test('radio silence changes entire layer and union can recover using radar',async()=>{
 const args={query,target:{...DEFAULT_TARGET,emitting:false},environment:DEFAULT_ENV,grid:grid([[0,-600,60],[0,-1000,100]])};
 const radio=await sampleHeatmap({...args,devices:[rf]});assert.equal(radio.counts.blind,2);assert.ok(radio.cells.every(c=>c.snrDb===null));
 const combined=await sampleHeatmap({...args,devices:[r,rf]});assert.equal(combined.counts.strong,2);assert.ok(combined.cells.every(c=>c.deviceId==='radar'));
});
test('cancelled jobs never publish obsolete coverage',async()=>{
 assert.equal(await sampleHeatmap({query,devices:[r],target:DEFAULT_TARGET,environment:DEFAULT_ENV,grid:grid([[0,-600,60]]),cancelled:()=>true}),null);
});
