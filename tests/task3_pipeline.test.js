import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {runTask3Pipeline,validatePresetIds} from '../src/task3/pipeline.js';
import {validateRun} from '../src/task3/runs.js';
import {METRIC_WEIGHTS} from '../src/task3/constants.js';

const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));
const terrain=JSON.parse(readFileSync(new URL('../public/data/terrain.json',import.meta.url)));
const query=createSceneQuery(createModel(city,terrain));
const yieldTask=()=>new Promise(resolve=>setImmediate(resolve));

test('task3 pipeline: 一键串联产出 ≥3 套差异化方案、盲区分类、三威胁与 EMC 结论，过程数据可校验',async()=>{
 const {report,run}=await runTask3Pipeline({city,query,settings:{scope:'core',spacing:700,siteSpacing:500,heights:[30,60,100],maxSites:192,maxDevices:64,budget:600,costs:{radar:12,radio:5,optical:4,acoustic:2},coreRadius:700,coreWeight:3,marginReserveDb:3},weights:{...METRIC_WEIGHTS},progress:()=>{},yieldTask});
 // ≥3 套方案且点位/类型组合不同
 assert.equal(report.plans.length,3);
 assert.ok(new Set(report.plans.map(p=>p.devices.length)).size>1||new Set(report.plans.map(p=>p.presetSubset.join())).size>1,'三套方案须有差异');
 // 推荐方案与四指标
 assert.ok(report.plans.some(p=>p.id===report.recommendedId));
 for(const row of report.scoring.plans){for(const k of ['coverage','blindRatio','cost','feasibility'])assert.ok(Number.isFinite(row.indicators[k]),k);assert.ok(row.score>=0&&row.score<=1);}
 // 盲区四类归因完整
 for(const rows of Object.values(report.blindspots))for(const r of rows){assert.equal(r.stats.total,Object.values(r.stats.byCategory).reduce((a,b)=>a+b,0));for(const p of r.points)assert.ok(['gap','corner','lowFacade','shadow','other'].includes(p.category));}
 // 三威胁场景
 for(const key of ['single','multi','swarm']){const th=report.threats[key];assert.ok(th.summary.targetCount>0);assert.ok(th.frames.length>0);assert.ok(th.summary.meanDetectedFraction>=0&&th.summary.meanDetectedFraction<=1);}
 assert.equal(report.threats.swarm.summary.targetCount,42);
 // EMC 每方案有结论
 for(const p of report.plans)assert.ok(['pass','degraded','fail'].includes(report.emc[p.id].verdict));
 // 过程数据
 validateRun(run);assert.ok(run.rulesInput.candidateStats.length>0);assert.ok(run.rulesInput.perHeightBlind.length===3);
});

test('task3 pipeline: 装备选择注入生效，非法预设被拒',async()=>{
 assert.throws(()=>validatePresetIds([]));assert.throws(()=>validatePresetIds(['nope']));
 const {report}=await runTask3Pipeline({city,query,settings:{scope:'core',spacing:700,siteSpacing:500,heights:[30,60,100],maxSites:192,maxDevices:32,budget:300,costs:{radar:12,radio:5,optical:4,acoustic:2},coreRadius:700,coreWeight:3,marginReserveDb:3},presetIds:['radar-03d','radio-tdoa'],weights:{...METRIC_WEIGHTS},progress:()=>{},yieldTask,withThreatFrames:false});
 const types=new Set(report.plans.flatMap(p=>p.devices.map(d=>d.presetId)));
 assert.deepEqual([...types].sort(),['radar-03d','radio-tdoa'].sort());
});
