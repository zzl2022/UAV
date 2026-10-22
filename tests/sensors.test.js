import test from 'node:test';
import assert from 'node:assert/strict';
import {PRESETS,createDevice,DEFAULT_TARGET,DEFAULT_ENV} from '../src/sensors/presets.js';
import {MODEL_VERSION,evaluate,powerSumDb,knifeEdgeLoss,twoRayLoss,angles,validateScenario} from '../src/sensors/engine.js';
const clear={known:true,blocked:false,buildingCount:0,sensorGround:0,targetGround:0};
const target=()=>({...structuredClone(DEFAULT_TARGET),position:[0,10,-1000]});
const environment=()=>({...DEFAULT_ENV});
const device=(id='radar-02c')=>{const d=createDevice(id,'test',[0,10,0]);delete d.physics;if('reflection' in d.parameters)d.parameters.reflection=0;if('clutterDb' in d.parameters)d.parameters.clutterDb=0;return d;};
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} ≠ ${b}`);
test('all seven documented presets execute without non-finite results',()=>{
 for(const p of PRESETS){const r=evaluate(device(p.id),target(),environment(),clear);assert.equal(r.type,p.type);assert.ok(Number.isFinite(r.marginDb));assert.ok(r.equivalentRangeMeters>=0);assert.ok(!/NaN|Infinity/.test(JSON.stringify(r)));}
 assert.equal(new Set(PRESETS.map(p=>p.type)).size,4);
});
test('radar obeys fourth-power range loss and RCS scaling',()=>{
 const d=device(),t=target(),e=environment();const a=evaluate(d,t,e,clear);t.position[2]*=2;const b=evaluate(d,t,e,clear);close(a.marginDb-b.marginDb,40*Math.log10(2));
 t.rcs*=10;close(evaluate(d,t,e,clear).marginDb-b.marginDb,10);
});
test('radar reference range reaches its threshold and receiver threshold changes the decision margin',()=>{
 const d=device(),t=target(),e=environment();t.position[2]=-d.parameters.maxRange;const a=evaluate(d,t,e,clear);close(a.marginDb,0);assert.ok(a.eligible);
 d.parameters.thresholdDb+=5;const b=evaluate(d,t,e,clear);close(b.marginDb,-5);close(a.snrDb,b.snrDb);assert.ok(!b.eligible);
});
test('radar distinguishes blind zone, azimuth seam, elevation and hard blockage',()=>{
 const d=device(),t=target(),e=environment();t.position=[0,10,-10];assert.ok(evaluate(d,t,e,clear).reasons.includes('近距盲区'));
 d.parameters.azimuthFov=10;d.parameters.heading=1;t.position=[Math.sin(359*Math.PI/180)*1000,10,-Math.cos(359*Math.PI/180)*1000];assert.ok(evaluate(d,t,e,clear).eligible);
 t.position=[1000,10,0];assert.ok(evaluate(d,t,e,clear).reasons.includes('超出方位视场'));
 t.position=[0,3000,-1000];assert.ok(evaluate(d,t,e,clear).reasons.includes('超出俯仰视场'));
 t.position=[0,10,-1000];const r=evaluate(d,t,e,{...clear,blocked:true,buildingCount:1});assert.equal(r.equivalentRangeMeters,0);assert.ok(!r.eligible);
});
test('rain, cloud, noise and interference reduce radar margin independently',()=>{
 const d=device(),t=target(),e=environment(),a=evaluate(d,t,e,clear);
 for(const [key,value] of Object.entries({rainMmH:30,cloudDbKm:2,emNoiseDb:6,cochannelDb:5,crosstalkDb:4})){const r=evaluate(d,t,{...e,[key]:value},clear);assert.ok(r.marginDb<a.marginDb,key);assert.ok(r.equivalentRangeMeters<a.equivalentRangeMeters,key);}
});
test('optical narrow view resolves smaller angular targets and fog reduces contrast',()=>{
 const d=device('optical-nvt'),t=target(),e=environment();e.visibilityKm=100;
 const wide=evaluate(d,t,e,clear);t.opticalMode='narrow';const narrow=evaluate(d,t,e,clear);assert.ok(narrow.extras.effectivePixels>wide.extras.effectivePixels);assert.ok(narrow.eligible);
 const fog=evaluate(d,t,{...e,visibilityKm:0.2},clear);assert.ok(fog.extras.effectivePixels<narrow.extras.effectivePixels);assert.ok(!fog.eligible);
});
test('visible channel fails in darkness while thermal uses thermal contrast',()=>{
 const d=device('optical-nvt'),t=target(),e={...environment(),illuminanceLux:0};t.position[2]=-100;
 assert.ok(evaluate(d,t,e,clear).reasons.includes('低于可见光最低照度'));
 t.opticalMode='thermal';const thermal=evaluate(d,t,e,clear);assert.ok(thermal.eligible);
 const blocked=evaluate(d,t,e,{...clear,blocked:true});assert.equal(blocked.equivalentRangeMeters,0);
});
test('radio handles silence, receiver band and X1C discrete channels',()=>{
 const d=device('radio-tdoa'),t=target(),e=environment();assert.ok(evaluate(d,t,e,clear).eligible);
 t.emitting=false;assert.equal(evaluate(d,t,e,clear).equivalentRangeMeters,0);t.emitting=true;t.frequencyGHz=8;assert.ok(evaluate(d,t,e,clear).reasons.includes('目标信号不在接收频段'));
 t.frequencyGHz=3;assert.ok(evaluate(device('radio-x1c'),t,e,clear).reasons.includes('目标信号不在接收频段'));
 t.frequencyGHz=5.8;assert.ok(!evaluate(device('radio-x1c'),t,e,clear).reasons.includes('目标信号不在接收频段'));
});
test('radio penetration, diffraction, network geometry and receiver threshold are distinct',()=>{
 const d=device('radio-tdoa'),t=target(),e=environment(),a=evaluate(d,t,e,clear);
 const blocked=evaluate(d,t,e,{...clear,blocked:true,buildingCount:2,clearance:20,obstacleDistance:300});assert.equal(blocked.losses.penetration,30);assert.ok(blocked.losses.diffraction>0);assert.ok(blocked.marginDb<a.marginDb);
 assert.equal(evaluate(d,t,{...e,rfStations:1},clear).errors.networkLocalizationMeters,null);
 close(evaluate(d,t,{...e,gdop:2},clear).errors.networkLocalizationMeters,2*a.errors.networkLocalizationMeters);
 d.parameters.thresholdDb+=5;close(evaluate(d,t,e,clear).marginDb,a.marginDb-5);
});
test('acoustic noise sums as energy and rising noise reduces SNR',()=>{
 close(powerSumDb([60,60]),63.01029995663981);
 const d=device('acoustic-cry'),t=target(),e=environment();t.position[2]=-100;
 const a=evaluate(d,t,e,clear),b=evaluate(d,t,{...e,trafficDb:90,constructionDb:80},clear);assert.ok(a.eligible);assert.ok(!b.eligible);assert.ok(b.snrDb<a.snrDb);assert.ok(b.extras.noiseDb>90);
});
test('acoustic diffraction, refraction, weather and temporal drift respond to inputs',()=>{
 const d=device('acoustic-cry'),t=target(),e=environment();t.position[2]=-100;
 const a=evaluate(d,t,e,clear),b=evaluate(d,t,{...e,refractionDb:4},clear);close(a.marginDb-b.marginDb,4);
 const blocked=evaluate(d,t,e,{...clear,blocked:true,buildingCount:1,clearance:20,obstacleDistance:50});assert.ok(blocked.losses.diffraction>0);assert.ok(blocked.marginDb<a.marginDb);
 const wind=evaluate(d,t,{...e,windSpeed:20},clear);assert.ok(wind.extras.propagationSeconds<a.extras.propagationSeconds);
 assert.ok(a.extras.temporalDriftMeters>t.speed*d.parameters.updateSeconds);
});
test('two-ray and knife-edge functions follow their analytical limits',()=>{
 close(twoRayLoss(1000,10,50,2.4e9,0),0);assert.ok(Number.isFinite(twoRayLoss(0,1,1,1e9,0.99)));
 assert.ok(knifeEdgeLoss(30,500,500,1e9)>knifeEdgeLoss(5,500,500,1e9));
 assert.ok(knifeEdgeLoss(30,500,500,2.4e9)>knifeEdgeLoss(30,500,500,2000,343));
});
test('radar multipath exposes virtual echoes and capacity gates apply',()=>{
 const d=device(),t=target(),e=environment();d.parameters.reflection=0.4;const a=evaluate(d,t,e,clear);assert.ok(a.extras.ghostCandidate.apparentRangeMeters>=a.geometry.distance);assert.ok(a.extras.ghostRiskIndex>=0);
 t.count=d.parameters.capacity+1;assert.ok(evaluate(d,t,e,clear).reasons.includes('超出模型并发容量'));
});
test('missing terrain never produces a confident clear-path claim',()=>{
 const d=device(),t=target();const a=evaluate(d,t,environment(),{...clear,known:false,sensorGround:null});assert.equal(a.status,'uncertain');assert.ok(a.warnings.length>=2);assert.equal(a.losses.multipath,0);
});
test('invalid inputs and incompatible scenarios fail explicitly; round trips are stable',()=>{
 const d=device(),t=target(),e=environment();assert.throws(()=>evaluate(d,t,{...e,visibilityKm:0},clear));assert.throws(()=>evaluate(d,t,{...e,rfStations:3.5},clear));d.parameters.maxRange=NaN;assert.throws(()=>evaluate(d,t,e,clear));
 const s={modelVersion:MODEL_VERSION,origin:[113.66,34.78,0],devices:[device()],target:t,environment:e};assert.deepEqual(validateScenario(JSON.parse(JSON.stringify(s)),s.origin),s);
 assert.throws(()=>validateScenario(s,[0,0,0]));assert.throws(()=>validateScenario({...s,devices:[s.devices[0],s.devices[0]]},s.origin));assert.throws(()=>validateScenario({...s,modelVersion:'old'},s.origin));
});
test('local axes use north-zero bearing and upward elevation',()=>{
 close(angles([0,0,0],[0,0,-100]).azimuth,0);close(angles([0,0,0],[100,0,0]).azimuth,90);close(angles([0,0,0],[0,100,0]).elevation,90);
});
