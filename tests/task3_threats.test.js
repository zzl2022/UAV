import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildRadialRoute,buildThreatRoutes,simulateThreat,threatSummaryText} from '../src/task3/threats.js';
import {THREAT_SCENARIOS} from '../src/task3/constants.js';
import {createDevice,DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';

const bounds={west:-1000,east:1000,south:-1000,north:1000,core:[0,0,0]};
const flatQuery={
 groundAt:()=>0,surfaceAt:()=>0,
 trace:(a,b)=>({blocked:false,buildingCount:0,clearance:0,obstacleDistance:null,sensorGround:0,targetGround:0,known:true}),
};

test('radial route flies from bounds edge to core with monotone time and start delay',()=>{
 const r=buildRadialRoute(flatQuery,bounds,{azimuthDeg:0,aglM:45,speedMps:15,id:'t0',startDelayS:5});
 assert.equal(r.points[0].time,5);assert.ok(r.duration>5);assert.equal(r.speed,15);
 assert.ok(Math.abs(r.points[0].position[0])<1e-9&&r.points[0].position[2]<-1100,'方位 0° 应从北侧边界外进入');
 assert.ok(Math.hypot(r.points.at(-1).position[0],r.points.at(-1).position[2])<1e-9,'终点为 core 中心');
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

test('threat scenarios build the required route counts, offsets and delays',()=>{
 const single=buildThreatRoutes(flatQuery,bounds,'single');assert.equal(single.length,8);
 assert.deepEqual(single.map(r=>r.azimuthDeg),[0,45,90,135,180,225,270,315]);
 assert.ok(single.every(r=>r.startDelayS===0));
 assert.equal(buildThreatRoutes(flatQuery,bounds,'multi').length,4);
 const swarm=buildThreatRoutes(flatQuery,bounds,'swarm');assert.equal(swarm.length,42);
 for(let d=1;d<=3;d++){
  const group=swarm.filter(r=>r.id.startsWith(`swarm-${d}-`));
  assert.equal(group.length,14);assert.deepEqual(group.map(r=>r.startDelayS),Array.from({length:14},(_,k)=>k*2));
  assert.ok(new Set(group.map(r=>r.points[0].position.map(v=>v.toFixed(1)).join(','))).size>1,'同方向横向铺开');
 }
 assert.throws(()=>buildThreatRoutes(flatQuery,bounds,'nope'));
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
 assert.equal(result.summary.targetCount,8);assert.ok(result.frames.length>0);
 assert.equal(result.perTarget.length,8);
 for(const p of result.perTarget){assert.ok(p.detectedFraction>=0&&p.detectedFraction<=1);assert.ok(p.firstDetectionTime===null||p.firstDetectionTime>=0);}
 assert.ok(result.summary.meanDetectedFraction>=0&&result.summary.meanDetectedFraction<=1);
 assert.ok(typeof threatSummaryText(result)==='string');
},{timeout:60000});
