import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevice,DEFAULT_TARGET,DEFAULT_ENV} from '../src/sensors/presets.js';
import {evaluate,validateDevice} from '../src/sensors/engine.js';
import {radarSnr,requiredSnr,radioBudget,facadeLoss,C} from '../src/sensors/physics.js';
import {facadeIndex} from '../src/sensors/reflections.js';
const clear={known:true,blocked:false,buildingCount:0,sensorGround:0,targetGround:0};
const target=(distance)=>({...DEFAULT_TARGET,position:[0,10,-distance]});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('MATLAB radar energy equation reproduces documented free-space ranges',()=>{
 for(const [id,expected] of [['radar-02c',8420],['radar-03d',8090]]){
  const d=createDevice(id,'r',[0,10,0]),p=d.physics;
  const snr=radarSnr(p,d.parameters.frequencyGHz,8000,0.01);
  const range=8000*10**((snr-requiredSnr(0.9,1e-6))/40);
  assert.ok(Math.abs(range-expected)<30);
  near(radarSnr({...p,peakPowerW:p.peakPowerW*10},d.parameters.frequencyGHz,8000,0.01)-snr,10);
  d.parameters.reflection=0;d.parameters.clutterDb=0;
  const r=evaluate(d,target(8000),DEFAULT_ENV,clear);near(r.snrDb,snr);
  near(r.extras.pulseBlindRangeMeters,C*3e-6/2);
  assert.equal(evaluate(d,target(400),DEFAULT_ENV,clear).extras.modelPd,0);
  assert.equal(evaluate(d,target(1000),DEFAULT_ENV,{...clear,known:false}).extras.modelPd,null);
  p.pulses=1.5;assert.throws(()=>validateDevice(d));
 }
});
test('RF sensitivity inversion, frequency loss, silence and short FHSS observations',()=>{
 const d=createDevice('radio-tdoa','rf',[0,10,0]),p=d.physics;
 const b=radioBudget(p,4000,5.8,25.5,4000);near(b.snrDb,requiredSnr(p.pdRequired,p.pfa));
 const low=radioBudget(p,4000,2.9,25.5,4000);near(low.snrDb-b.snrDb,20*Math.log10(2));
 d.parameters.reflection=0;const t={...target(1000),fhss:true};
 p.observationSeconds=0.00001;const r=evaluate(d,t,DEFAULT_ENV,clear);assert.ok(r.reasons.includes('FHSS observation window insufficient'));
 const silent=evaluate(d,{...t,emitting:false},DEFAULT_ENV,clear);assert.equal(silent.extras.modelPd,0);assert.equal(silent.extras.receivedPowerDbm,null);
 assert.throws(()=>evaluate(d,{...t,fhss:'false'},DEFAULT_ENV,clear));
});
test('finite facade image source rejects blocked legs, wrong side and low walls',()=>{
 const b={height:20,rings:[[[0,0,-10],[0,0,10]]]};
 const index=facadeIndex([b]),a=[10,5,-5],z=[10,5,5];
 const paths=index(a,z,()=>true);assert.ok(paths.length>0);near(paths[0].distance,Math.sqrt(500));near(paths[0].point[0],0);
 assert.equal(index(a,z,()=>false).length,0);
 assert.equal(index(a,[-10,5,5],()=>true).length,0);
 assert.equal(index([10,30,-5],[10,30,5],()=>true).length,0);
 near(facadeLoss([],10,1e9,0.4),0);
});
test('optical range is an extinction-dependent threshold root',()=>{
 const d=createDevice('optical-nvt','o',[0,10,0]),t={...target(100),opticalMode:'narrow'};
 const r=evaluate(d,t,DEFAULT_ENV,clear),range=r.extras.recognitionRangeMeters;
 const edge=evaluate(d,{...t,position:[0,10,-range]},DEFAULT_ENV,clear);
 assert.ok(Math.abs(edge.marginDb)<1e-6);
 assert.equal(evaluate(d,t,DEFAULT_ENV,{...clear,blocked:true}).extras.recognitionRangeMeters,0);
});
test('acoustic facade echo distance bias is one-way excess path',()=>{
 const d=createDevice('acoustic-cry','a',[0,10,0]);
 const r=evaluate(d,target(100),DEFAULT_ENV,{...clear,facadePaths:[{point:[10,10,-50],distance:120}]});
 near(r.extras.rangeBiasMeters,20);near(r.extras.reflectionDelaySeconds,20/r.extras.soundSpeed);
 assert.ok(r.losses.facadeReflection<0);
});
