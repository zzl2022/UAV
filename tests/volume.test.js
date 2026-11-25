import test from 'node:test';
import assert from 'node:assert/strict';
import {volumeGrid,sampleVolume,sampleField,continuousResult,rampColor} from '../src/sensors/volume.js';
import {evaluate} from '../src/sensors/engine.js';
import {createDevice,DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';
const r=createDevice('radar-02c','r',[0,20,0]),rf=createDevice('radio-tdoa','rf',[0,20,0]);r.parameters.reflection=0;rf.parameters.reflection=0;
const query={groundAt:()=>0,surfaceAt:()=>0,trace:()=>({known:true,blocked:false,buildingCount:0,sensorGround:0,targetGround:0})};
test('volume grid samples all three axes and respects explicit memory bound',()=>{
 const grid=volumeGrid({west:-1500,east:1500,south:-1500,north:1500},{spacing:50,verticalSpacing:20,minY:5,maxY:1200,maxSamples:40000});
 assert.ok(grid.total<=40000);assert.ok(grid.dimensions.every(d=>d>2));assert.equal(grid.total,grid.dimensions.reduce((a,b)=>a*b,1));
 assert.throws(()=>volumeGrid({west:0,east:1,south:0,north:1},{minY:100,maxY:0}));
});
test('volume Float32 values reproduce engine SNR, margin and statistical Pd at independent heights',async()=>{
 const grid=volumeGrid({west:-100,east:100,south:-900,north:-500},{spacing:100,verticalSpacing:100,minY:50,maxY:250});
 const field=await sampleVolume({grid,query,devices:[r],target:DEFAULT_TARGET,environment:DEFAULT_ENV});
 for(let z=0;z<grid.dimensions[2];z++)for(let y=0;y<grid.dimensions[1];y++)for(let x=0;x<grid.dimensions[0];x++){
  const pos=grid.origin.map((v,i)=>v+[x,y,z][i]*grid.step[i]),i=x+grid.dimensions[0]*(y+grid.dimensions[1]*z),res=evaluate(r,{...DEFAULT_TARGET,position:pos},DEFAULT_ENV,query.trace());
  assert.equal(field.values[i*4+3],1);assert.ok(Math.abs(field.values[i*4]-res.marginDb)<1e-4);assert.ok(Math.abs(field.values[i*4+1]-res.snrDb)<1e-4);assert.ok(Math.abs(field.values[i*4+2]-res.extras.signalPd)<1e-6);
 }
});
test('continuous scalar interpolation keeps more than three color levels and cannot fill masked blind space',()=>{
 const grid=volumeGrid({west:0,east:100,south:0,north:100},{spacing:100,verticalSpacing:100,minY:0,maxY:100}),values=new Float32Array(8*4);
 for(let i=0;i<8;i++){values[i*4]=i%2?20:0;values[i*4+3]=1;}
 const field={grid,values};assert.equal(sampleField(field,[25,25,25]).value,5);assert.equal(sampleField(field,[75,25,25]).value,15);
 values[3]=2;assert.equal(sampleField(field,[25,25,25]).value,null);
 assert.ok(new Set(Array.from({length:256},(_,i)=>rampColor(i/255).map(x=>Math.round(x*255)).join(','))).size>250);
});
test('RF silence and radar pulse blindness are separate hard masks; weak Pd is continuous',async()=>{
 const grid=volumeGrid({west:-100,east:100,south:-300,north:-100},{spacing:100,verticalSpacing:100,minY:30,maxY:130});
 const radar=await sampleVolume({grid,query,devices:[r],target:DEFAULT_TARGET,environment:DEFAULT_ENV});assert.equal(radar.counts.signal,0);assert.equal(radar.counts.hard,grid.total);
 const radio=await sampleVolume({grid,query,devices:[rf],target:{...DEFAULT_TARGET,emitting:false},environment:DEFAULT_ENV});assert.equal(radio.counts.signal,0);
 const low=evaluate(r,{...DEFAULT_TARGET,position:[0,500,-5000]}, {...DEFAULT_ENV,emNoiseDb:40},query.trace());assert.ok(low.marginDb<0);const c=continuousResult([low]);assert.equal(c.state,1);assert.ok(c.pd>0&&c.pd<.9);
});
test('model volume keeps solid, unknown, altitude cap and cancellation distinct',async()=>{
 const grid=volumeGrid({west:0,east:100,south:0,north:100},{spacing:100,verticalSpacing:100,minY:5,maxY:205});grid.maxAgl=100;
 const field=await sampleVolume({grid,query:{...query,groundAt:x=>x===100?null:0,surfaceAt:()=>50},devices:[r],target:DEFAULT_TARGET,environment:DEFAULT_ENV});assert.ok(field.counts.inside>0);assert.ok(field.counts.unknown>0);assert.ok(field.counts.outside>0);assert.equal(Object.values(field.counts).reduce((a,b)=>a+b,0)-field.counts.detected,grid.total);
 assert.equal(await sampleVolume({grid,query,devices:[r],target:DEFAULT_TARGET,environment:DEFAULT_ENV,cancelled:()=>true}),null);
});
