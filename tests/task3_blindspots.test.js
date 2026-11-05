import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {createDevice,DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';
import {museumLandmark} from '../src/landmarks.js';
import {buildBuildingIndex,nearestBuildings,classifySample,classifyBlindSpots} from '../src/task3/blindspots.js';
import {BLIND_CATEGORIES,BLIND_THRESHOLDS} from '../src/task3/constants.js';

// 合成场景：夹缝两楼、长墙贴楼、孤楼角部、设备视线被楼截断的阴影 lane。
const box=(id,x0,z0,x1,z1,height)=>({id,name:id,height,ground:0,foundationDepth:0,rings:[[[x0,0,z0],[x1,0,z0],[x1,0,z1],[x0,0,z1],[x0,0,z0]]]});
const buildings=[box('gap-west',-40,-10,-20,10,40),box('gap-east',20,-10,40,10,40),box('facade-b',200,-50,300,50,80),box('corner-b',100,200,120,220,30),box('shadow-b',80,-190,120,-150,60)];
const city={metadata:{},buildings},terrain={positions:[-1500,0,-1500,1500,0,-1500,-1500,0,1500,1500,0,1500],indices:[0,2,1,1,2,3]};
const query=createSceneQuery(createModel(city,terrain));
const radar=createDevice('radar-03d','r1',[100,60,-700]);radar.parameters.pitch=-15;const devices=[radar];
const sample=(id,[x,y,z],agl)=>({id,position:[x,y,z],agl,core:false});
const S={gap:sample('s-gap',[0,30,0],30),low:sample('s-low',[190,30,0],30),corner:sample('s-corner',[92,60,192],60),shadowFar:sample('s-shadow-far',[100,30,-80],30),shadowNear:sample('s-shadow-near',[100,30,-140],30),other:sample('s-other',[800,200,300],200)};
const index=buildBuildingIndex(city);
const classify=s=>classifySample({sample:s,index,devices,query,target:DEFAULT_TARGET,environment:DEFAULT_ENV});

test('spatial index returns ascending polygon distances without scanning far buildings',()=>{
 const near=nearestBuildings(index,0,0);
 assert.equal(near.length,4);assert.ok(near.every((n,i,a)=>!i||a[i-1].distanceM<=n.distanceM));
 assert.deepEqual(new Set(near.slice(0,2).map(n=>n.building.id)),new Set(['gap-east','gap-west']));
 assert.equal(near[0].distanceM,20);assert.equal(near[1].distanceM,20);
 assert.equal(nearestBuildings(index,0,0,2).length,2);
 assert.equal(nearestBuildings(index,-30,0)[0].distanceM,0); // 多边形内部
 const far=nearestBuildings(index,5000,5000);assert.equal(far.length,4);assert.ok(far[0].distanceM>1000);
});

test('four blind categories and priority gap>shadow>lowFacade>corner are honored',()=>{
 const gap=classify(S.gap);assert.equal(gap.category,'gap'); // 同时满足 lowFacade/corner，gap 优先
 assert.ok(gap.cause.gapWidthM<=BLIND_THRESHOLDS.gapMaxWidthM);assert.deepEqual([...gap.cause.buildingIds].sort(),['gap-east','gap-west']);assert.equal(gap.cause.agl,30);
 const shadowFar=classify(S.shadowFar);assert.equal(shadowFar.category,'shadow');
 assert.ok(shadowFar.cause.blockerDistanceM<=BLIND_THRESHOLDS.shadowMaxBlockerDistanceM);assert.ok(shadowFar.cause.deviceCount>=1);
 const shadowNear=classify(S.shadowNear);assert.equal(shadowNear.category,'shadow'); // 同时满足 lowFacade/corner，shadow 优先
 const low=classify(S.low);assert.equal(low.category,'lowFacade');
 assert.ok(low.cause.distanceToFacadeM<=BLIND_THRESHOLDS.lowFacadeMaxDistanceM);assert.equal(low.cause.nearestBuildingId,'facade-b');assert.equal(low.cause.agl,30);
 const corner=classify(S.corner);assert.equal(corner.category,'corner');
 assert.ok(corner.cause.cornerDistanceM<=BLIND_THRESHOLDS.cornerMaxDistanceM);assert.equal(corner.cause.nearestBuildingId,'corner-b');
 assert.deepEqual(classify(S.other),{category:'other',cause:{reason:'不满足四类几何特征'}});
});

test('classifyBlindSpots stats match points and only blind samples are classified',()=>{
 const samples=Object.values(S);
 const full=classifyBlindSpots({city,samples,coverageRow:samples.map(()=>0),devices,query,target:DEFAULT_TARGET,environment:DEFAULT_ENV,conditionId:'synthetic'});
 assert.equal(full.conditionId,'synthetic');assert.equal(full.stats.total,6);
 assert.deepEqual(full.stats.byCategory,{gap:1,corner:1,lowFacade:1,shadow:2,other:1});
 assert.equal(Object.values(full.stats.byCategory).reduce((a,b)=>a+b,0),full.points.length);
 for(const p of full.points){assert.ok(BLIND_CATEGORIES[p.category]);assert.equal(p.sampleId.startsWith('s-'),true);}
 const partial=classifyBlindSpots({city,samples,coverageRow:[1,1,0,0,0,0],devices,query,target:DEFAULT_TARGET,environment:DEFAULT_ENV,conditionId:'partial'});
 assert.equal(partial.stats.total,4);assert.equal(partial.points.length,4);
});

test('real city smoke: interference blind spots near the museum classify consistently',()=>{
 const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url)));
 const realCity=json('../public/data/city.json'),realTerrain=json('../public/data/terrain.json'),report=json('../public/deployment-example.json');
 const realQuery=createSceneQuery(createModel(realCity,realTerrain)),landmark=museumLandmark(realCity);
 const plan=report.plans.find(p=>p.id===report.selectedId),ci=report.conditions.findIndex(c=>c.id==='interference'),row=plan.coverage[ci];
 const blind=report.sampling.samples.map((s,j)=>({s,j})).filter(({j})=>row[j]===0)
  .sort((a,b)=>Math.hypot(a.s.position[0]-landmark.position[0],a.s.position[2]-landmark.position[2])-Math.hypot(b.s.position[0]-landmark.position[0],b.s.position[2]-landmark.position[2]))
  .slice(0,8).map(({s})=>s);
 const result=classifyBlindSpots({city:realCity,samples:blind,coverageRow:blind.map(()=>0),devices:plan.devices,query:realQuery,target:report.target,environment:report.environment,conditionId:report.conditions[ci].id});
 assert.equal(result.conditionId,'interference');assert.equal(result.stats.total,blind.length);assert.equal(result.points.length,blind.length);
 assert.equal(Object.values(result.stats.byCategory).reduce((a,b)=>a+b,0),result.stats.total);
 const counted={gap:0,corner:0,lowFacade:0,shadow:0,other:0};
 for(const p of result.points){
  assert.ok(BLIND_CATEGORIES[p.category]);counted[p.category]++;
  if(p.category==='gap'){assert.ok(p.cause.gapWidthM<=BLIND_THRESHOLDS.gapMaxWidthM);assert.equal(p.cause.buildingIds.length,2);}
  if(p.category==='shadow'){assert.ok(p.cause.blockerDistanceM<=BLIND_THRESHOLDS.shadowMaxBlockerDistanceM);assert.ok(p.cause.deviceCount>=1);}
  if(p.category==='lowFacade'){assert.ok(p.cause.distanceToFacadeM<=BLIND_THRESHOLDS.lowFacadeMaxDistanceM);assert.ok(p.cause.agl<=BLIND_THRESHOLDS.lowFacadeMaxAglM);assert.ok(p.cause.nearestBuildingId);}
  if(p.category==='corner'){assert.ok(p.cause.cornerDistanceM<=BLIND_THRESHOLDS.cornerMaxDistanceM);assert.ok(p.cause.nearestBuildingId);}
  if(p.category==='other')assert.equal(p.cause.reason,'不满足四类几何特征');
 }
 assert.deepEqual(result.stats.byCategory,counted);
});
