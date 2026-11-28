import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCustomRoute,buildRadialRoute,buildThreatRoutes,simulateThreat,threatSummaryText,normalizeThreatConfig} from '../src/task3/threats.js';
import {computeCustomSingleThreat} from '../src/task3/worker.js';
import {THREAT_SCENARIOS} from '../src/task3/constants.js';
import {createDevice,DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';

const bounds={west:-1000,east:1000,south:-1000,north:1000,core:[0,0,0]};
const flatQuery={
 groundAt:()=>0,surfaceAt:()=>0,
 trace:(a,b)=>({blocked:false,buildingCount:0,clearance:0,obstacleDistance:null,sensorGround:0,targetGround:0,known:true}),
};

test('automatic route starts 1 km outside deployment and crosses core to symmetric endpoint',()=>{
 const r=buildRadialRoute(flatQuery,bounds,{azimuthDeg:0,aglM:45,speedMps:15,id:'t0',startDelayS:5});
 assert.equal(r.points[0].time,5);assert.ok(r.duration>5);assert.equal(r.speed,15);
 assert.deepEqual(r.points[0].position,[0,45,-2000]);
 assert.deepEqual(r.points.at(-1).position,[0,45,2000]);
 assert.ok(r.points.some(p=>p.position[0]===0&&p.position[2]===0),'必须穿过核心');
 assert.ok(r.points.every(p=>Math.abs(p.position[1]-45)<1e-9),'平地无遮挡时保持 max(ground+agl, surface+25)');
 for(let i=1;i<r.points.length;i++){
  assert.ok(r.points[i].time>r.points[i-1].time);
  assert.ok(Math.hypot(r.points[i].position[0]-r.points[i-1].position[0],r.points[i].position[2]-r.points[i-1].position[2])<=20+1e-9);
 }
 const east=buildRadialRoute(flatQuery,bounds,{azimuthDeg:90,aglM:30,speedMps:15,id:'t90'});
 assert.ok(east.points[0].position[0]>1100&&Math.abs(east.points[0].position[2])<1e-9);
});

test('radial route skips DEM gaps and throws when nothing valid remains',()=>{
 const gappy={...flatQuery,groundAt:(x,z)=>Math.hypot(x,z)>1100?null:0};
 const r=buildRadialRoute(gappy,bounds,{azimuthDeg:0,aglM:45,speedMps:15,id:'gap'});
 assert.ok(r.skipped>0);assert.ok(r.points.length>2);
 const voidQuery={...flatQuery,groundAt:()=>null,surfaceAt:()=>null};
 assert.throws(()=>buildRadialRoute(voidQuery,bounds,{azimuthDeg:0,aglM:45,speedMps:15,id:'void'}));
});

test('threat scenarios retain counts and delays while every automatic route crosses core',()=>{
 const single=buildThreatRoutes(flatQuery,bounds,'single');assert.equal(single.length,1);
 assert.deepEqual(single.map(r=>r.azimuthDeg),[0]);assert.ok(single[0].points.every(p=>p.position[1]===30));
 assert.ok(single.every(r=>r.startDelayS===0));
 assert.equal(buildThreatRoutes(flatQuery,bounds,'multi').length,4);
 const swarm=buildThreatRoutes(flatQuery,bounds,'swarm');assert.equal(swarm.length,42);
 for(let d=1;d<=3;d++){
  const group=swarm.filter(r=>r.id.startsWith(`swarm-${d}-`));
  assert.equal(group.length,14);assert.deepEqual(group.map(r=>r.startDelayS),Array.from({length:14},(_,k)=>k*2));
  assert.ok(group.every(r=>r.points.some(p=>Math.hypot(p.position[0],p.position[2])<1e-9)),'同方向每架均穿越核心');
 }
 assert.throws(()=>buildThreatRoutes(flatQuery,bounds,'nope'));
});

test('oblique automatic routes preserve bearing, 1 km shortest distance, symmetry, height and speed',()=>{
 const area={west:-700,east:1300,south:-400,north:1600,core:[200,0,300]};
 for(const azimuthDeg of [0,30,45,90,125,180,225,270,315,359]){
  const route=buildRadialRoute(flatQuery,area,{azimuthDeg,aglM:55,speedMps:20,id:`angle-${azimuthDeg}`});
  const start=route.points[0].position,end=route.points.at(-1).position;
  const gap=Math.hypot(Math.max(area.west-start[0],0,start[0]-area.east),Math.max(area.south-start[2],0,start[2]-area.north));
  assert.ok(Math.abs(gap-1000)<1e-6);assert.equal(route.launch.clippedByMap,false);
  assert.ok(Math.abs(start[0]+end[0]-2*area.core[0])<1e-6&&Math.abs(start[2]+end[2]-2*area.core[2])<1e-6);
  const bearing=(Math.atan2(start[0]-area.core[0],-(start[2]-area.core[2]))*180/Math.PI+360)%360;
  assert.ok(Math.abs(bearing-azimuthDeg)<1e-9);
  assert.ok(route.points.some(p=>p.position[0]===area.core[0]&&p.position[2]===area.core[2]));
  for(const p of route.points){assert.equal(p.position[1],55);assert.ok(Math.abs((p.position[0]-area.core[0])*Math.cos(azimuthDeg*Math.PI/180)+(p.position[2]-area.core[2])*Math.sin(azimuthDeg*Math.PI/180))<1e-6);}
  assert.ok(Math.abs(route.duration-route.length/20)<1e-9);
 }
});

test('map boundary clips launch and reflected endpoint independently, including full-map deployment',()=>{
 const dem={west:-1600,east:2400,south:-1300,north:1800};
 const query={...flatQuery,getDataBounds:()=>({dem,gis:{west:-10,east:10,south:-10,north:10}}),groundAt:(x,z)=>x>=dem.west-1e-8&&x<=dem.east+1e-8&&z>=dem.south-1e-8&&z<=dem.north+1e-8?0:null};
 for(const area of [bounds,{...dem,core:[0,0,0]}])for(const azimuthDeg of [0,45,90,135,180,225,270,315]){
  const route=buildRadialRoute(query,area,{azimuthDeg,aglM:30,speedMps:15,id:'clipped'});
  assert.equal(route.skipped,0);
  for(const p of route.points){assert.ok(query.groundAt(p.position[0],p.position[2])!==null);}
  const start=route.points[0].position,end=route.points.at(-1).position;
  if(route.launch.clippedByMap)assert.ok(Math.min(Math.abs(start[0]-dem.west),Math.abs(start[0]-dem.east),Math.abs(start[2]-dem.south),Math.abs(start[2]-dem.north))<1e-6,'起点精确落在地图边界');
  if(route.launch.endRadiusM<route.launch.startRadiusM)assert.ok(Math.min(Math.abs(end[0]-dem.west),Math.abs(end[0]-dem.east),Math.abs(end[2]-dem.south),Math.abs(end[2]-dem.north))<1e-6,'对侧不足时终点精确落在边界');
  if(area!==bounds)assert.ok(route.launch.actualBufferM<1e-6,'全图部署从边界起飞');
 }
 assert.throws(()=>buildRadialRoute(query,{...bounds,core:[9999,0,0]},{azimuthDeg:0,aglM:30,speedMps:15,id:'outside'}),/核心/);
});

test('near-parallel approach on a long narrow deployment still launches 1000 m outside',()=>{
 const narrow={west:-10,east:10,south:-10000,north:10000,core:[0,0,0]};
 const route=buildRadialRoute(flatQuery,narrow,{azimuthDeg:1,aglM:30,speedMps:15,id:'narrow'});
 assert.ok(Math.abs(route.launch.actualBufferM-1000)<1e-6);
});

test('单机单点只允许一架一个来向一条航线，仍可调整来向高度和速度',()=>{
 for(const config of [{count:8},{directions:2,azimuthsDeg:[0,90]},{aglM:[30,60]},{azimuthsDeg:[0,90]}])assert.throws(()=>normalizeThreatConfig('single',config),/单机单点/);
 const config=normalizeThreatConfig('single',{azimuthsDeg:[125],aglM:[55],speedMps:20});
 const routes=buildThreatRoutes(flatQuery,bounds,'single',config);assert.equal(routes.length,1);assert.equal(routes[0].azimuthDeg,125);assert.ok(routes[0].points.every(p=>p.position[1]===55));assert.equal(routes[0].speed,20);
});

test('capacity=1 device reports one target per frame and records the overflow honestly',async()=>{
 const device=createDevice('radio-tdoa','d1',[0,50,0]);device.parameters.capacity=1;
 const routes=[buildRadialRoute(flatQuery,bounds,{azimuthDeg:0,aglM:45,speedMps:15,id:'a'}),buildRadialRoute(flatQuery,bounds,{azimuthDeg:180,aglM:45,speedMps:15,id:'b'})];
 const result=await simulateThreat({query:flatQuery,devices:[device],routes,target:{...DEFAULT_TARGET},environment:{...DEFAULT_ENV},core:[0,0,0],simultaneous:true});
 assert.ok(result.frames.length>10);
 for(const f of result.frames){
  assert.equal(f.targets.length,2);
  assert.equal(f.targets.reduce((s,t)=>s+t.detectedBy.length,0),1,'容量 1 每帧最多报 1 个');
  assert.equal(f.overflow.length,1);assert.equal(f.overflow[0].deviceId,'d1');
 }
 const a=result.perTarget.find(p=>p.id==='a'),b=result.perTarget.find(p=>p.id==='b');
 assert.equal(a.detectedFraction,1);assert.equal(b.detectedFraction,0);assert.equal(b.firstDetectionTime,null);
 assert.equal(result.summary.overflowEvents,result.frames.length);assert.equal(result.summary.overflowedTargets,1);
 assert.ok(threatSummaryText(result).includes('容量溢出'));
});

test('simultaneous frames merge staggered timelines; per-target stats use real detections',async()=>{
 const device=createDevice('radio-tdoa','d1',[0,50,0]);
 const routes=[buildRadialRoute(flatQuery,bounds,{azimuthDeg:0,aglM:45,speedMps:15,id:'a'}),buildRadialRoute(flatQuery,bounds,{azimuthDeg:90,aglM:45,speedMps:15,id:'b',startDelayS:20})];
 const result=await simulateThreat({query:flatQuery,devices:[device],routes,target:{...DEFAULT_TARGET},environment:{...DEFAULT_ENV},core:[0,0,0],simultaneous:true});
 assert.equal(result.summary.targetCount,2);
 assert.ok(result.frames.some(f=>f.targets.length===1&&f.time<20),'b 起飞前帧内只有 a');
 assert.ok(result.frames.some(f=>f.targets.length===2),'汇合后帧内两架');
 assert.ok(result.frames.some(f=>f.targets.length===1&&f.time>routes[0].duration),'a 到达后帧内只剩 b');
 for(const p of result.perTarget){assert.equal(p.detectedFraction,1);assert.ok(p.firstDetectionTime<=2);assert.equal(p.lossEvents,0);}
 assert.equal(result.summary.framesWithAllDetected,result.summary.totalFrames);
 const text=threatSummaryText(result);assert.ok(text.includes('2 架')&&text.includes('未发生容量溢出'));
});

test('sequential mode flies each route independently and concatenates frames',async()=>{
 const device=createDevice('radio-tdoa','d1',[0,50,0]);
 const routes=[buildRadialRoute(flatQuery,bounds,{azimuthDeg:0,aglM:45,speedMps:15,id:'a'}),buildRadialRoute(flatQuery,bounds,{azimuthDeg:90,aglM:60,speedMps:15,id:'b'})];
 const result=await simulateThreat({query:flatQuery,devices:[device],routes,target:{...DEFAULT_TARGET},environment:{...DEFAULT_ENV},core:[0,0,0],simultaneous:false});
 assert.ok(result.frames.every(f=>f.targets.length===1));
 const counts=routes.map(r=>Math.floor((r.duration-r.startDelayS-1e-9)/2)+2);
 assert.equal(result.frames.length,counts[0]+counts[1]);
 assert.deepEqual(result.perTarget.map(p=>p.routeId),['a','b']);
});

test('custom polyline preserves waypoint order and shares elevation, segmentation and timing rules',()=>{
 const route=buildCustomRoute(flatQuery,{waypoints:[[0,999,0],[50,888,0],[50,777,40]],aglM:45,speedMps:10});
 assert.equal(route.kind,'custom');assert.equal(route.id,'single-custom');assert.equal(route.speed,10);assert.equal(route.startDelayS,0);
 assert.deepEqual(route.waypoints,[[0,0],[50,0],[50,40]],'输入 y 不替代地形/AGL 高度，平面路点顺序保持不变');
 assert.deepEqual(route.points[0].position,[0,45,0]);assert.deepEqual(route.points.at(-1).position,[50,45,40]);
 assert.equal(route.length,90);assert.equal(route.duration,9);assert.equal(route.points[0].time,0);
 assert.ok(route.points.some(p=>p.position[0]===50&&p.position[2]===0),'中间拐点必须保留');
 for(let i=0;i<route.points.length;i++){
  const point=route.points[i];assert.equal(point.position[1],45);
  if(!i)continue;const previous=route.points[i-1],distance=Math.hypot(...point.position.map((v,k)=>v-previous.position[k]));
  assert.ok(Math.hypot(point.position[0]-previous.position[0],point.position[2]-previous.position[2])<=20+1e-9);
  assert.ok(point.time>previous.time);assert.ok(Math.abs((point.time-previous.time)*10-distance)<1e-9);
 }
 const faster=buildCustomRoute(flatQuery,{waypoints:[[0,0],[50,0],[50,40]],aglM:45,speedMps:20});assert.equal(faster.duration,4.5);
 const elevated={...flatQuery,groundAt:()=>100,surfaceAt:()=>120};
 const clearance=buildCustomRoute(elevated,{waypoints:[[0,0],[20,0]],aglM:10,speedMps:15});
 assert.ok(clearance.points.every(p=>p.position[1]===145),'表面上方 25 米净空优先于过低的地面+AGL');
 const agl=buildCustomRoute(elevated,{waypoints:[[0,0],[20,0]],aglM:60,speedMps:15});
 assert.ok(agl.points.every(p=>p.position[1]===160),'地面+AGL 高于表面净空时保持指定 AGL');
});

test('custom polyline rejects malformed, terrain-less and non-distinct waypoints',()=>{
 for(const waypoints of [undefined,[],[[0,0]],[[0,0],[0,0]],[[0,10,0],[0,20,0]]])assert.throws(()=>buildCustomRoute(flatQuery,{waypoints,aglM:45,speedMps:15}),/至少需要两个不同有效路点/);
 for(const waypoints of [[[0,0],[NaN,0]],[[0,0],[Infinity,0]],[[0,0],[1,2,3,4]],[[0,0],null]])assert.throws(()=>buildCustomRoute(flatQuery,{waypoints,aglM:45,speedMps:15}),/有限数值数组/);
 const missingGround={...flatQuery,groundAt:(x)=>x===50?null:0};
 assert.throws(()=>buildCustomRoute(missingGround,{waypoints:[[0,0],[50,0]],aglM:45,speedMps:15}),/无有效地形高程/);
 assert.throws(()=>buildCustomRoute(flatQuery,{waypoints:[[0,0],[20,0]],aglM:0,speedMps:15}),/离地高度/);
 assert.throws(()=>buildCustomRoute(flatQuery,{waypoints:[[0,0],[20,0]],aglM:45,speedMps:0}),/速度/);
 const deduplicated=buildCustomRoute(flatQuery,{waypoints:[[0,0],[0,0],[20,0]],aglM:45,speedMps:15});
 assert.deepEqual(deduplicated.waypoints,[[0,0],[20,0]]);assert.equal(deduplicated.points.length,2);
});

test('custom single worker result merges as one single record with real detections and capacity limits',async()=>{
 const device=createDevice('radio-tdoa','d1',[0,50,0]);device.parameters.capacity=1;
 const input={plan:{id:'plan-a',devices:[device]},waypoints:[[-50,0],[50,0],[50,50]],aglM:45,speedMps:15,target:{...DEFAULT_TARGET},environment:{...DEFAULT_ENV},core:[0,0,0],coreRadius:700,interval:2};
 const output=await computeCustomSingleThreat({query:flatQuery,input});
 assert.equal(output.planId,'plan-a');assert.equal(output.scenarioKey,'single');assert.equal(output.single.custom,true);assert.equal(output.single.config.custom,true);
 assert.equal(output.single.routes.length,1);assert.equal(output.single.routes[0].kind,'custom');assert.equal(output.single.summary.targetCount,1);
 assert.deepEqual(output.single.config.waypoints,[[-50,0],[50,0],[50,50]]);assert.ok(output.single.frames.length>0);assert.ok(output.single.text.includes('1 架'));
 for(const frame of output.single.frames){
  assert.equal(frame.targets.length,1);assert.equal(frame.targets[0].id,'single-custom');assert.ok(frame.targets[0].detectedBy.length<=device.parameters.capacity,'每帧检出数不得超过设备并发容量');assert.equal(frame.targets[0].detectedBy.length,1);assert.equal(frame.targets[0].detectedBy[0].id,'d1');assert.equal(frame.overflow.length,0);
 }
 assert.equal(output.single.perTarget[0].detectedFraction,1);assert.equal(output.single.summary.overflowEvents,0);assert.ok(JSON.stringify(output));
 await assert.rejects(()=>computeCustomSingleThreat({query:flatQuery,input:{...input,waypoints:[[0,0]]}}),/至少需要两个不同有效路点/);
 await assert.rejects(()=>computeCustomSingleThreat({query:flatQuery,input:{...input,plan:null}}),/当前方案及设备快照/);
});

test('real city smoke: single scenario over the selected deployment plan',async()=>{
 const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));
 const terrain=JSON.parse(readFileSync(new URL('../public/data/terrain.json',import.meta.url)));
 const report=JSON.parse(readFileSync(new URL('../public/deployment-example.json',import.meta.url)));
 const query=createSceneQuery(createModel(city,terrain)),core=report.sampling.bounds.core;
 const bounds={west:core[0]-1200,east:core[0]+1200,south:core[2]-1200,north:core[2]+1200,core};
 const devices=report.plans.find(p=>p.id===report.selectedId).devices;
 const routes=buildThreatRoutes(query,bounds,'single');
 assert.equal(routes.length,THREAT_SCENARIOS.single.directions);
 const result=await simulateThreat({query,devices,routes,target:report.target,environment:report.environment,core});
 assert.equal(result.summary.targetCount,1);assert.ok(result.frames.length>0);
 assert.equal(result.perTarget.length,1);assert.ok(result.frames.every(frame=>frame.targets.length===1));
 for(const p of result.perTarget){assert.ok(p.detectedFraction>=0&&p.detectedFraction<=1);assert.ok(p.firstDetectionTime===null||p.firstDetectionTime>=0);}
 assert.ok(result.summary.meanDetectedFraction>=0&&result.summary.meanDetectedFraction<=1);
 assert.ok(typeof threatSummaryText(result)==='string');
},{timeout:60000});
