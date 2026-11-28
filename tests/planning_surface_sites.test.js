import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {generateCandidates,generateSamples} from '../src/planning/optimizer.js';
import {generateCandidatesWithEquipment,runTask3Pipeline} from '../src/task3/pipeline.js';
import {TASK3_DEFAULT_SETTINGS} from '../src/task3/scope.js';
import {containsBuildingFootprint,createDeploymentExclusion} from '../src/task3/building-constraints.js';

const ring=points=>[...points,points[0]].map(([x,z])=>[x,0,z]);
const box=(id,x,z,w,h)=>({id,name:id,height:h,foundationDepth:0,rings:[ring([[x,z],[x+w,z],[x+w,z+w],[x,z+w]])]});
function scene(buildings){
 const city={buildings,metadata:{coreBuilding:buildings[0],origin:[0,0,0],sources:{fixture:'generated-metre-grid'}}};
 const terrain={positions:[-600,0,-600,600,0,-600,600,0,600,-600,0,600],indices:[0,2,1,0,3,2]};
 return {city,query:createSceneQuery(createModel(city,terrain))};
}
const bounds={west:-200,east:200,south:-200,north:200,core:[0,0,0]};
const settings={...TASK3_DEFAULT_SETTINGS,scope:'custom',scopeWidthM:400,scopeDepthM:400,spacing:100,heights:[30,60,200],siteSpacing:300,maxSites:48,maxDevices:4,budget:100};
const ordinary=(ctx,settingsOverride=settings)=>generateCandidatesWithEquipment(ctx.city,ctx.query,settingsOverride,{bounds},['radio-tdoa']).sites;

test('高楼、同格中等高度、凹形和带孔屋面均可获得本楼支承，两个入口采用同一批位置',()=>{
 const courtyard=box('courtyard',-130,-130,50,160);
 courtyard.rings.push(ring([[-120,-120],[-120,-90],[-90,-90],[-90,-120]]));
 const concave=box('L',-60,-130,50,22);
 concave.rings=[ring([[-60,-130],[-10,-130],[-10,-120],[-50,-120],[-50,-80],[-60,-80]])];
 const ctx=scene([courtyard,concave,box('middle',-5,-140,25,42),box('small',-45,-70,10,8)]);
 const sites=ordinary(ctx),roofs=sites.filter(s=>s.mountKind==='roof');
 assert.equal(roofs.length,4);
 for(const s of roofs)assert.equal(ctx.query.surfaceHitAt(s.position[0],s.position[2]).buildingId,s.buildingId);
 const legacy=generateCandidates(ctx.city,ctx.query,settings,{bounds});
 assert.deepEqual([...new Map(legacy.map(c=>[c.site.id,c.site])).values()],sites);
 const levels=sites.filter(s=>s.buildingId==='courtyard'&&s.mountKind==='facade');
 assert.equal(new Set(levels.map(s=>s.supportY)).size,2);
 for(const s of levels){
  assert.equal(containsBuildingFootprint(courtyard,s.position[0],s.position[2]),false);
  assert.ok(s.position[1]<courtyard.height);
  assert.ok(s.supportY>ctx.query.surfaceAt(s.position[0],s.position[2]));
  assert.equal(s.position[1]-s.supportY,2);
 }
});

test('禁部署同时约束屋面及向墙外偏移的安装点；开放地表仍可用，缺少地形无法入池',()=>{
 const ctx=scene([box('core',-20,-20,40,60)]),restricted={...settings,buildingExclusions:{buildingIds:['core']}};
 const allowed=ordinary(ctx),other=ordinary(ctx,restricted);
 assert.ok(allowed.some(s=>s.mountKind==='facade'));
 assert.ok(other.length&&other.every(s=>s.mountKind==='ground'));
 const guard=createDeploymentExclusion(ctx.city,restricted);
 for(const s of other)assert.equal(guard.blocked(s.position,s.buildingId),false);
 assert.throws(()=>ordinary({...ctx,query:{groundAt:()=>null,surfaceAt:()=>null}}),/没有可用部署候选点/);
});

test('开放空域、实体内部与建筑禁选分别判定',()=>{
 const ctx=scene([box('core',-65,-65,130,160)]);
 const sampling=generateSamples(ctx.city,ctx.query,settings,ctx.query.getDataBounds());
 assert.ok(sampling.excluded.insideBuildings>0);
 assert.ok(sampling.samples.some(p=>p.kind==='grid'&&ctx.query.surfaceHitAt(p.position[0],p.position[2]).buildingId===null));
 assert.ok(sampling.samples.some(p=>p.agl===200&&ctx.query.surfaceHitAt(p.position[0],p.position[2]).buildingId==='core'));
 const gapQuery={...ctx.query,surfaceAt:(x,z)=>x>0?null:ctx.query.surfaceAt(x,z)};
 const gap=generateSamples(ctx.city,gapQuery,settings,ctx.query.getDataBounds());
 assert.ok(gap.excluded.unknownSurface>0);
 assert.ok(gap.samples.every(s=>s.position[0]<=0));
 assert.deepEqual(sampling.samples,generateSamples(ctx.city,ctx.query,{...settings,buildingExclusions:{buildingIds:['core']}},ctx.query.getDataBounds()).samples);
});

test('完整流水线重算允许、禁选、解除禁选，并核对核心候选和最终支承记录',async t=>{
 const ctx=scene([box('core',-65,-65,130,160)]);
 const run=async(ids,width)=>runTask3Pipeline({...ctx,settings:{...settings,scopeWidthM:width,scopeDepthM:width,buildingExclusions:{buildingIds:ids}},presetIds:['radio-tdoa','acoustic-cry'],planTypes:['balanced'],withThreatFrames:false});
 const a=await run([],400),b=await run(['core'],400),c=await run([],400),narrow=await run([],200);
 for(const result of [a,b,c,narrow]){
  const {report,run}=result,plan=report.plans[0];
  assert.deepEqual(report.siteScreening,run.siteScreening);
  assert.ok(plan.devices.length>0);
  assert.equal(report.siteScreening.coreBuildings[0].selectedHostCountByPlan[plan.id],plan.sites.filter(s=>s.buildingId==='core').length);
  t.diagnostic(JSON.stringify({excluded:report.siteScreening.coreBuildings[0].userExcluded,initial:report.siteScreening.initialCounts,selected:plan.sites.map(s=>s.mountKind)}));
 }
 assert.ok(a.report.siteScreening.coreBuildings[0].initialSiteCount>0);
 assert.equal(a.report.siteScreening.coreBuildings[0].selectedHostCountByPlan.balanced,0);
 await assert.rejects(run(['core'],200),/没有可用部署候选点/);
 assert.ok(narrow.report.plans[0].sites.some(s=>s.buildingId==='core'&&s.mountKind==='facade'));
 assert.equal(b.report.siteScreening.coreBuildings[0].initialSiteCount,0);
 assert.ok(b.report.plans[0].sites.every(s=>s.buildingId!=='core'));
 assert.deepEqual(c.report.plans[0].sites,a.report.plans[0].sites);
});
