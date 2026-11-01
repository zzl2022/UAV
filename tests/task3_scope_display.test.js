import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {generateSamples} from '../src/planning/optimizer.js';
import {createDevice} from '../src/sensors/presets.js';
import {museumLandmark} from '../src/landmarks.js';
import {runTask3Pipeline} from '../src/task3/pipeline.js';
import {resolveTask3Settings,createScopeMetadata} from '../src/task3/scope.js';
import {createDeviceDisplayMap} from '../src/task3/device-display.js';
import {buildRadialRoute} from '../src/task3/threats.js';
import {validateRun} from '../src/task3/runs.js';
import {METRIC_WEIGHTS} from '../src/task3/constants.js';

const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));
const terrain=JSON.parse(readFileSync(new URL('../public/data/terrain.json',import.meta.url)));
const query=createSceneQuery(createModel(city,terrain));
const yieldTask=()=>new Promise(resolve=>setImmediate(resolve));
const baseSettings=()=>({scope:'core',spacing:500,siteSpacing:500,heights:[30,60,100],maxSites:32,maxDevices:12,budget:300,costs:{radar:12,radio:5,optical:4,acoustic:2},coreRadius:700,coreWeight:3,marginReserveDb:3});

test('task3 scope: 未传范围字段保持 core 2400×2400 m 且采样结果与旧路径一致',()=>{
 const original=baseSettings(),settings=resolveTask3Settings({...original,scope:undefined});
 assert.equal(settings.scope,'core');assert.equal(settings.scopeWidthM,2400);assert.equal(settings.scopeDepthM,2400);
 const legacy=generateSamples(city,query,original),actual=generateSamples(city,query,settings,query.getDataBounds());
 assert.deepEqual(actual,legacy);
 const scope=createScopeMetadata(settings,actual,query.getDataBounds()),core=museumLandmark(city).position;
 assert.equal(scope.widthM,2400);assert.equal(scope.depthM,2400);assert.deepEqual(scope.center,core);
 assert.equal(scope.requestedBounds.west,core[0]-1200);assert.equal(scope.requestedBounds.east,core[0]+1200);
});

test('task3 scope: 自定义矩形贯穿真实流水线、运行记录和威胁边界',async()=>{
 const settings=resolveTask3Settings({...baseSettings(),scope:'custom',scopeWidthM:1400,scopeDepthM:1000});
 const {report,run}=await runTask3Pipeline({city,query,settings,presetIds:['radar-03d','radio-tdoa'],weights:{...METRIC_WEIGHTS},yieldTask,withThreatFrames:false});
 const b=report.sampling.bounds,core=museumLandmark(city).position;
 assert.equal(report.settings.scope,'custom');assert.equal(report.settings.scopeWidthM,1400);assert.equal(report.settings.scopeDepthM,1000);
 assert.equal(b.east-b.west,1400);assert.equal(b.north-b.south,1000);assert.deepEqual(b.core,core);
 assert.equal(report.scope,report.sampling.dataCoverage);assert.deepEqual(run.scope,report.scope);assert.equal(run.settings.scopeWidthM,1400);validateRun(run);
 const inside=position=>position[0]>=b.west&&position[0]<b.east&&position[2]>=b.south&&position[2]<b.north;
 assert.ok(report.sampling.samples.length>0);assert.ok(report.sampling.samples.every(p=>inside(p.position)));
 for(const plan of report.plans){assert.ok(plan.devices.every(d=>inside(d.position)));assert.ok(plan.sites.every(s=>inside(s.position)));}
 // 威胁从矩形边缘外 150 m 起飞：东西向宽度与南北向深度分别生效。
 const flat={groundAt:()=>0,surfaceAt:()=>0,trace:()=>({blocked:false,clearance:0})};
 const north=buildRadialRoute(flat,b,{azimuthDeg:0,aglM:45,speedMps:15,id:'north'}),east=buildRadialRoute(flat,b,{azimuthDeg:90,aglM:45,speedMps:15,id:'east'});
 assert.ok(Math.abs(north.points[0].position[2]-(b.south-150))<1e-9);
 assert.ok(Math.abs(east.points[0].position[0]-(b.east+150))<1e-9);
},{timeout:60000});

test('task3 scope: 非法范围、无有效采样点和完全超出 DEM 均明确报错',async()=>{
 for(const change of [{scopeWidthM:0},{scopeWidthM:-10},{scopeWidthM:NaN},{scopeWidthM:Infinity},{scopeDepthM:0},{scopeDepthM:-1},{scopeDepthM:NaN},{scopeDepthM:Infinity},{scopeWidthM:undefined},{scopeDepthM:null}]){
  const settings={...baseSettings(),scope:'custom',scopeWidthM:1000,scopeDepthM:800,...change};
  assert.throws(()=>resolveTask3Settings(settings),/有限正数/);
 }
 await assert.rejects(runTask3Pipeline({city,query,settings:{...baseSettings(),scope:'custom',scopeWidthM:0,scopeDepthM:800}}),/有限正数/);
 assert.throws(()=>resolveTask3Settings({...baseSettings(),scope:'custom',scopeWidthM:Number.MAX_VALUE,scopeDepthM:800}),/无法安全采样/);
 const settings=resolveTask3Settings({...baseSettings(),scope:'custom',scopeWidthM:1000,scopeDepthM:800});
 const empty={groundAt:()=>null,surfaceAt:()=>null};
 assert.throws(()=>generateSamples(city,empty,settings),/没有可用空域采样点/);
 const noOverlap={dem:{west:1e9,east:1e9+1000,south:1e9,north:1e9+1000}};
 assert.throws(()=>generateSamples(city,empty,settings,noOverlap),/超出 DEM 数据边界/);
});

test('task3 scope: 部分超出 DEM 时只采样有效交集并记录裁切',()=>{
 const settings=resolveTask3Settings({...baseSettings(),scope:'custom',scopeWidthM:1e9,scopeDepthM:1e9,spacing:1000,heights:[30]});
 const sampling=generateSamples(city,query,settings,query.getDataBounds()),scope=createScopeMetadata(settings,sampling,query.getDataBounds());
 assert.ok(sampling.samples.length>0);assert.equal(scope.boundaryClipped,true);assert.equal(scope.clipped,true);
 assert.ok(scope.effectiveBounds.west>scope.requestedBounds.west);assert.match(scope.note,/DEM 数据裁切/);
 for(const sample of sampling.samples){
  const [x,,z]=sample.position;
  assert.ok(x>=scope.effectiveBounds.west&&x<=scope.effectiveBounds.east&&z>=scope.effectiveBounds.south&&z<=scope.effectiveBounds.north);
 }
});

test('task3 device display: 当前方案编号稳定唯一，保留内部 ID、中文类型和型号并支持连续追加',()=>{
 const fixed=[createDevice('radar-03d','internal-radar',[0,100,0]),createDevice('radio-tdoa','internal-radio',[100,80,0])],mobile=createDevice('radar-02c','mobile-radar-1',[200,50,0]);
 const mapping=createDeviceDisplayMap(fixed);
 assert.deepEqual(mapping.entries.map(e=>e.displayName),['设备-1','设备-2']);
 assert.equal(new Set(mapping.entries.map(e=>e.displayName)).size,2);
 assert.equal(mapping.get('internal-radar').internalId,'internal-radar');assert.equal(mapping.get('internal-radar').typeName,'雷达');assert.equal(mapping.get('internal-radar').modelName,'03D 三坐标雷达');
 assert.equal(mapping.details('internal-radio').typeName,'无线电');assert.equal(mapping.details('internal-radio').modelName,'TDOA-X1B');
 assert.equal(mapping.nameOf('unknown'),'unknown');assert.equal(mapping.get('unknown'),null);
 assert.deepEqual(createDeviceDisplayMap(fixed).toJSON(),mapping.toJSON(),'相同方案顺序重建时编号稳定');
 const extended=createDeviceDisplayMap([...fixed,mobile]);assert.equal(extended.get('mobile-radar-1').displayName,'设备-3');assert.equal(extended.get('internal-radar').displayName,'设备-1');
 assert.throws(()=>createDeviceDisplayMap([fixed[0],fixed[0]]),/内部 ID 重复/);
});
