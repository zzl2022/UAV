import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseGreedy} from '../src/planning/optimizer.js';
import {validateDeploymentControls} from '../src/planning/deployment-controls.js';
import {resolveTask3Settings} from '../src/task3/scope.js';
import {runTask3Pipeline} from '../src/task3/pipeline.js';
import {normalizeThreatConfig} from '../src/task3/threats.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {createModel} from '../src/model.js';
import {MAPS,CONFIGURATIONS,resolveConfiguration,parameterDictionary} from '../scripts/cross-map-study/design.js';
import {makeAuditSamples,validateFinalPlan} from '../scripts/cross-map-study/measure.js';
import {resolveResearchCoreExclusions} from '../scripts/cross-map-study/run.js';

test('synthetic core markers map only to actual building IDs, retaining a conservative envelope explanation',()=>{
 const square=(id,x,z)=>({id,rings:[[[x,0,z],[x+10,0,z],[x+10,0,z+10],[x,0,z+10]]]});
 const city={metadata:{coreBuilding:square('synthetic',0,0)},buildings:[square('actual',5,5),square('far',200,200)]};
 const selection=resolveResearchCoreExclusions(city,{buildingIds:['synthetic']});
 assert.deepEqual(selection.buildingIds,['actual']);assert.ok(selection.resolution.method.includes('保守'));
 assert.deepEqual(resolveResearchCoreExclusions(city,{buildingIds:['far']}),{buildingIds:['far']});
 assert.throws(()=>resolveResearchCoreExclusions({...city,buildings:[square('far',200,200)]},{buildingIds:['synthetic']}),/不能假造/);
});

test('study design covers every platform map and distinct, valid, explicitly resolved configurations',()=>{
 assert.equal(MAPS.length,9);assert.ok(CONFIGURATIONS.length>=10);
 const fingerprints=new Set();
 for(const d of CONFIGURATIONS){const c=resolveConfiguration(d);resolveTask3Settings(c.settings);for(const key of ['single','multi','swarm'])normalizeThreatConfig(key,c.settings.threatConfigs[key]);fingerprints.add(JSON.stringify([c.settings,c.environment,c.target,c.presetIds]));}
 assert.equal(fingerprints.size,CONFIGURATIONS.length);
 const dictionary=parameterDictionary();assert.equal(dictionary.module2.filter(p=>p.eligibleForDeployment).length,7);assert.equal(dictionary.module3.threatLimits.maxSpeedMps,100);
});
test('type quantity limits constrain greedy selection, deletion and refill without imposing minimum quotas',()=>{
 const pool=[{device:{type:'radio'},cover:[0,1],cost:1},{device:{type:'radio'},cover:[2],cost:1},{device:{type:'radar'},cover:[0,1,2],cost:4},{device:{type:'acoustic'},cover:[3],cost:1}];
 const chosen=chooseGreedy(pool,[1,1,1,1],{budget:20,maxDevices:10,typeLimits:{radio:1,radar:0,acoustic:1}});
 assert.deepEqual(chosen.indices,[0,3]);assert.equal(chosen.covered[2],0);
 assert.deepEqual(chooseGreedy(pool,[1,1,1,1],{budget:20,maxDevices:10,typeLimits:{radio:0,radar:0,acoustic:0}}).indices,[]);
 for(const invalid of [{typeLimits:{radio:-1}},{typeLimits:{foo:2}},{installationHeightM:0},{radarPitchesDeg:[1]},{radarPitchesDeg:[]},{headingOffsetDeg:181}])assert.throws(()=>validateDeploymentControls(invalid));
});
test('independent audit grid excludes solid and missing terrain points',()=>{
 const query={groundAt:x=>x<0?null:0,surfaceAt:(x,z)=>x>500?100:0};
 const audit=makeAuditSamples(query,{west:-300,east:900,south:0,north:600,core:[0,0,0]});
 assert.ok(audit.excluded.outside>0);assert.ok(audit.excluded.solid>0);assert.ok(audit.points.length>0);assert.ok(audit.points.every(p=>p.position[0]>=0&&p.position[0]<=500));
});
test('full pipeline applies mast height, pitch set and category limits through final deployed devices',async()=>{
 const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url))),terrain=JSON.parse(readFileSync(new URL('../public/data/terrain.json',import.meta.url))),query=createSceneQuery(createModel(city,terrain));
 const c=resolveConfiguration(CONFIGURATIONS[0]);Object.assign(c.settings,{spacing:1000,heights:[30],maxSites:4,maxDevices:4,installationHeightM:8,radarPitchesDeg:[-10],typeLimits:{radar:1,radio:0,optical:0,acoustic:0}});c.presetIds=['radar-03d'];
 for(const key of ['multi','swarm'])Object.assign(c.settings.threatConfigs[key],{count:1,directions:1,azimuthsDeg:[0],aglM:[30]});
 const {report}=await runTask3Pipeline({city,query,...c});
 for(const plan of report.plans){assert.ok(plan.devices.length<=1);for(const [i,device] of plan.devices.entries()){assert.equal(device.parameters.pitch,-10);const site=plan.sites[i],support=site.mountKind==='facade'?site.supportY:query.surfaceAt(device.position[0],device.position[2]);assert.ok(Math.abs(device.position[1]-support-8)<1e-6);}assert.equal(validateFinalPlan(city,query,report,plan).passed,true);}
});
