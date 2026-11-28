import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBuildingIndex,containsBuildingFootprint,createDeploymentExclusion} from '../src/task3/building-constraints.js';
import {generateCandidatesWithEquipment,runTask3Pipeline,remediateEmcConflicts} from '../src/task3/pipeline.js';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {TASK3_DEFAULT_SETTINGS} from '../src/task3/scope.js';
const box=(id,x,z,size=10,base=0)=>({id,name:'同名建筑',height:20,foundationDepth:0,rings:[[[x,base,z],[x+size,base,z],[x+size,base,z+size],[x,base,z+size],[x,base,z]]]});
test('连通单元不按名字或合并网格区分，接触与相交实体连通，垂直分离仍独立',()=>{
 const city={buildings:[box('a',0,0),box('b',10,0),box('c',18,0),box('d',40,0),box('e',0,0,10,30)]};
 const index=createBuildingIndex(city);assert.equal(index.components.length,3);assert.deepEqual(index.componentById.get('b').buildingIds,['a','b','c']);assert.notEqual(index.componentById.get('d'),index.componentById.get('a'));
 assert.equal(index.at(5,5,40)[0].building.id,'e');
 const guard=createDeploymentExclusion(city,{buildingExclusions:{buildingIds:['b']}});assert.equal(guard.blocked([23,200,5]),true);assert.equal(guard.blocked([45,2,5]),false);assert.deepEqual(guard.buildingIds,['a','b','c']);
});
test('庭院内部不属于建筑，占地与孔洞边界属于禁部署区域',()=>{
 const courtyard=box('courtyard',0,0,20);courtyard.rings.push([[5,0,5],[5,0,15],[15,0,15],[15,0,5],[5,0,5]]);
 const city={buildings:[courtyard,box('inner',8,8,2)]},index=createBuildingIndex(city);assert.equal(index.components.length,2);
 assert.equal(containsBuildingFootprint(courtyard,10,10),false);assert.equal(containsBuildingFootprint(courtyard,5,10),true);
 const guard=createDeploymentExclusion(city,{buildingExclusions:{buildingIds:['courtyard']}});assert.equal(guard.blocked([10,2,10]),false);assert.equal(guard.blocked([0,22,10]),true);
 assert.throws(()=>guard.assertDevices([{id:'bad',position:[1,22,1]}]),/禁部署/);
 assert.throws(()=>createDeploymentExclusion(city,{buildingExclusions:{buildingIds:['unknown']}}),/当前场景/);
});
test('初始候选先排除禁部署建筑，再进行网格高低建筑抽稀；禁止全部候选时明确失败',()=>{
 const city={buildings:[box('a',0,0),box('b',30,0)]},query={groundAt:()=>0,surfaceAt:()=>20},sampling={bounds:{west:-50,east:100,south:-50,north:100,core:[0,0,0]}},settings={...TASK3_DEFAULT_SETTINGS,buildingExclusions:{buildingIds:['a']}};
 const result=generateCandidatesWithEquipment(city,query,settings,sampling,['radar-03d']);assert.ok(result.candidates.length);assert.ok(result.sites.every(s=>s.buildingId==='b'));
 assert.throws(()=>generateCandidatesWithEquipment(city,query,{...settings,buildingExclusions:{buildingIds:['a','b']}},sampling,['radar-03d']),/没有可用部署候选点/);
 assert.throws(()=>remediateEmcConflicts({devices:[{id:'bad',position:[5,22,5]}],exclusion:createDeploymentExclusion(city,settings)}),/禁部署/);
});
test('真实流水线所有方案与补点遵守建筑约束，约束可追溯到报告和运行记录',async()=>{
 const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url))),terrain=JSON.parse(readFileSync(new URL('../public/data/terrain.json',import.meta.url))),query=createSceneQuery(createModel(city,terrain));
 const settings={...TASK3_DEFAULT_SETTINGS,spacing:1000,maxDevices:6,maxSites:8,budget:100};
 const base=await runTask3Pipeline({city,query,settings,planTypes:['economy'],withThreatFrames:false});
 const sites=base.report.plans[0].sites.filter(s=>s.buildingId);assert.ok(sites.length);
 settings.buildingExclusions={sceneKey:'recon',buildingIds:[sites[0].buildingId]};
 const {report,run}=await runTask3Pipeline({city,query,settings,withThreatFrames:false}),guard=createDeploymentExclusion(city,settings);
 for(const p of report.plans)guard.assertDevices(p.devices,p.sites);
 assert.deepEqual(report.settings.buildingExclusions,run.settings.buildingExclusions);assert.ok(report.settings.buildingExclusions.buildingIds.includes(sites[0].buildingId));
});
