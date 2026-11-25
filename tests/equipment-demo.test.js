import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG_MODELS} from '../src/sensors/equipment-models.js';
import {defaultProfile} from '../src/sensors/equipment-catalog.js';
import {DEMO_METRICS,demoDefaults,prepareDemo,demoValue,sampleDemo,probeDemo} from '../src/sensors/equipment-demo-model.js';
import {DEFAULT_TARGET,DEFAULT_ENV} from '../src/sensors/presets.js';
import {volumeGrid} from '../src/sensors/volume.js';
const scenario={target:structuredClone(DEFAULT_TARGET),environment:{...DEFAULT_ENV}},position=[0,30,0];
const context={known:true,blocked:false,buildingCount:0,sensorGround:0,targetGround:0};
const make=(id,overrides={})=>{const p=defaultProfile(id);return prepareDemo(p,{...demoDefaults(p),...overrides},position);};

test('hover queries return every metric using the same model as the field and preserve invalid masks',()=>{
 const query={groundAt:()=>0,surfaceAt:()=>0,trace:()=>context};
 for(const [type,point] of [['radar',[0,100,-900]],['radio',[0,100,-500]],['optical',[0,40,-100]],['acoustic',[0,30,-50]],['fivega',[0,40,-100]],['electrostatic',[0,30,-50]]]){
  const model=CATALOG_MODELS.find(m=>m.type===type);
  const spec=make(model.id),result=probeDemo(spec,point,scenario,query);
  assert.equal(result.metrics.length,DEMO_METRICS[spec.type].length);
  for(const metric of result.metrics){
   const reference=demoValue({...spec,settings:{...spec.settings,metric:metric.id}},point,scenario,context);
   assert.equal(metric.value,reference.mask===1?reference.value:null);
  }
  assert.equal(result.heightAboveGround,point[1]);
  assert.equal(probeDemo(spec,point,scenario,{...query,groundAt:()=>null}).mask,0);
  const solid=probeDemo(spec,[0,0,-50],scenario,query);assert.equal(solid.mask,3);assert.deepEqual(solid.metrics,[]);
  assert.equal(probeDemo(spec,[0,spec.settings.ceiling+1,-50],scenario,query).mask,4);
 }
});

test('every catalog model has demonstration metrics without inventing detection probabilities for other modalities',()=>{
 for(const model of CATALOG_MODELS){const p=defaultProfile(model.id),before=structuredClone(p),s=prepareDemo(p,demoDefaults(p),position);assert.ok(s.metric);assert.equal(s.settings.ceiling,800);assert.deepEqual(p,before);}
 for(const type of ['optical','acoustic','fivega','electrostatic'])assert.ok(DEMO_METRICS[type].every(m=>m.id!=='pd'));
 assert.throws(()=>make('optical-nvt',{horizontal:200}));assert.throws(()=>make('radar-02c',{radius:NaN}));
});
test('radar demonstration consumes the edited draft but keeps its pulse blind zone and geometric masks',()=>{
 const spec=make('radar-02c'),p=[0,100,-900],r=demoValue(spec,p,scenario,context);
 assert.equal(r.mask,1);assert.equal(demoValue(spec,[0,50,-100],scenario,context).mask,2);
 assert.equal(demoValue(spec,p,scenario,{...context,blocked:true}).mask,2);
 const draft=structuredClone(spec.profile);draft.physics.peakPowerW*=10;
 const brighter=prepareDemo(draft,spec.settings,position);assert.ok(Math.abs(demoValue(brighter,p,scenario,context).value-r.value-10)<1e-8);
});
test('radio silence and discrete-band rejection are hard failures rather than low probabilities',()=>{
 const spec=make('radio-x1c'),p=[0,100,-500];
 assert.equal(demoValue(spec,p,scenario,context).mask,1);
 assert.equal(demoValue(spec,p,{...scenario,target:{...scenario.target,emitting:false}},context).mask,2);
 assert.equal(demoValue(spec,p,{...scenario,target:{...scenario.target,frequencyGHz:3}},context).mask,2);
});
test('optical demonstration uses explicit demonstration FOV, preserves missing specifications, and distinguishes pixels from atmospheric transmission',()=>{
 const spec=make('optical-nvt',{pitch:0,horizontal:60,radius:500});assert.equal(spec.profile.parameters.maxRange,null);
 const near=demoValue(spec,[0,30,-100],scenario,context),far=demoValue(spec,[0,30,-200],scenario,context);
 assert.equal(near.mask,1);assert.ok(Math.abs(near.value/far.value-2)<1e-9);
 assert.equal(demoValue(spec,[0,30,-100],scenario,{...context,blocked:true}).mask,2);
 const transmission=make('optical-nvt',{pitch:0,horizontal:60,metric:'transmission'});
 assert.ok(demoValue(transmission,[0,30,-100],{...scenario,environment:{...DEFAULT_ENV,visibilityKm:1}},context).value<demoValue(transmission,[0,30,-100],scenario,context).value);
});
test('acoustic demonstration does not reuse the unconfirmed camera field of view and handles noise and finite obstruction losses',()=>{
 const spec=make('acoustic-cry',{metric:'snr'}),front=demoValue(spec,[0,30,-100],scenario,context),back=demoValue(spec,[0,30,100],scenario,context);
 assert.equal(front.mask,1);assert.equal(back.mask,1);assert.equal(front.value,back.value);
 const noisy=demoValue(spec,[0,30,-100],{...scenario,environment:{...DEFAULT_ENV,trafficDb:70}},context);assert.ok(noisy.value<front.value);
 const blocked=demoValue(spec,[0,30,-100],scenario,{...context,blocked:true,buildingCount:1,clearance:0,obstacleDistance:50});assert.equal(blocked.mask,1);assert.ok(blocked.value<front.value);
});
test('5G-A and electrostatic demonstrations remain geometry and distance fields rather than turning reported lower bounds into maximum ranges',()=>{
 const fivega=make('fivega-zte-a9650-s49',{radius:2000,pitch:0});assert.equal(demoValue(fivega,[0,30,-1700],scenario,context).mask,1);
 assert.equal(demoValue(fivega,[0,30,-100],scenario,{...context,blocked:true}).mask,2);
 const electro=make('electrostatic-crsc-er1',{radius:200});assert.equal(demoValue(electro,[0,30,-150],scenario,{...context,blocked:true}).value,150);
 assert.equal(electro.kind,'距离示意');
});
test('sampling preserves unknown terrain, solids and cancellation, and does not trace electrostatic fields through an optical obstruction rule',async()=>{
 const spec=make('electrostatic-crsc-er1',{radius:100}),grid=volumeGrid({west:-50,east:50,south:-50,north:50},{spacing:50,verticalSpacing:25,minY:0,maxY:75});
 const query={groundAt:x=>x<0?null:0,surfaceAt:()=>10,trace:()=>{throw Error('electrostatic must not use a line-of-sight mask');}};
 const result=await sampleDemo({spec,grid,scenario,query});assert.ok(result.counts.signal>0);assert.ok(result.counts.unknown>0);assert.ok(result.counts.inside>0);
 assert.equal(await sampleDemo({spec,grid,scenario,query,cancelled:()=>true}),null);
});
