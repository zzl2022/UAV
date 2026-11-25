import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deviceFeasibility,scorePlans,comparisonTable} from '../src/task3/metrics.js';
import {METRIC_WEIGHTS,FEASIBILITY_MODEL} from '../src/task3/constants.js';
import {createDevice} from '../src/sensors/presets.js';

function makePlan(id,cost,rates,blinds,presets){
 return {id,name:id,cost,
  metrics:rates.map((r,i)=>({condition:`c${i}`,covered:Math.round(r*100),total:100,coverageRate:r,blindRate:blinds[i]})),
  devices:presets.map((p,i)=>createDevice(p,`${id}-d${i}`,[0,62,0])),
  sites:presets.map((p,i)=>({id:`${id}-s${i}`,position:[0,62,0],installationProxy:1.6}))};
}

test('deviceFeasibility combines document facts with stated assumptions',()=>{
 const site={position:[0,62,0]};
 const radar=deviceFeasibility(createDevice('radar-03d','r',[0,62,0]),site,0);
 const mini=deviceFeasibility(createDevice('radio-mini','m',[0,62,0]),site,0);
 const acoustic=deviceFeasibility(createDevice('acoustic-cry','a',[0,62,0]),site,0);
 for(const f of [radar,mini,acoustic]){
  assert.ok(f.score>=0&&f.score<=1);
  for(const k of ['mass','volume','mount','height'])assert.ok(f.parts[k]>=0&&f.parts[k]<=1);
 }
 assert.ok(radar.parts.mass<mini.parts.mass); // 85 kg vs 5 kg，重量来自文档
 assert.equal(radar.parts.mount,0.85);assert.equal(mini.parts.mount,1); // 车载式/固定式 需车载硬化场地
 assert.equal(acoustic.parts.volume,0.9);assert.match(acoustic.provenance.volume,/假设/); // 文档未给尺寸
 const expectedHeight=1-FEASIBILITY_MODEL.heightPenaltyPer100M*62/100;
 assert.ok(Math.abs(radar.parts.height-expectedHeight)<1e-12);
 assert.ok(deviceFeasibility(createDevice('radio-mini','m2',[0,162,0]),{position:[0,162,0]},0).parts.height<mini.parts.height);
 assert.equal(deviceFeasibility(createDevice('radio-mini','m3',[0,62,0]),site,62).parts.height,1); // 贴地安装无高度惩罚
});

test('scorePlans normalizes across plans, reverses cost/blind and recommends the best score',()=>{
 const plans=[
  makePlan('cheap',10,[0.9,0.8],[0.1,0.2],['radio-mini','optical-nvt','acoustic-cry']),
  makePlan('mid',20,[0.95,0.85],[0.05,0.15],['radio-tdoa','optical-nvt']),
  makePlan('heavy',30,[0.99,0.9],[0.01,0.1],['radar-03d','radar-02c']),
 ];
 const scored=scorePlans({plans,conditions:[{id:'c0'},{id:'c1'}]});
 assert.equal(scored.plans.length,3);
 const byId=Object.fromEntries(scored.plans.map(p=>[p.id,p]));
 for(const p of scored.plans)for(const v of Object.values(p.normalized))assert.ok(v>=0&&v<=1);
 // 反向指标：成本最低者归一化为 1，盲区占比最大者为 0
 assert.equal(byId.cheap.normalized.cost,1);assert.equal(byId.heavy.normalized.cost,0);
 assert.equal(byId.cheap.normalized.blindRatio,0);assert.equal(byId.heavy.normalized.blindRatio,1);
 // 覆盖完整性取各工况 coverageRate 最小值，另附均值
 assert.equal(byId.mid.indicators.coverage,0.85);
 assert.ok(Math.abs(byId.mid.indicators.coverageMean-0.9)<1e-12);
 assert.deepEqual(scored.plans.map(p=>p.rank).sort(),[1,2,3]);
 assert.equal(scored.recommendedId,'heavy'); // 覆盖与盲区优势压过成本劣势
 assert.equal(scored.plans.find(p=>p.rank===1).id,scored.recommendedId);
 assert.equal(scored.weights.coverage,METRIC_WEIGHTS.coverage);
 assert.match(scored.method,/min-max/);
});

test('ties on score fall back to lower relative cost',()=>{
 const a=makePlan('pricey',30,[1],[0],['radio-mini']);
 const b=makePlan('frugal',10,[0.5],[0],['radio-mini']);
 const weights={coverage:0.3,blind:0.1,cost:0.3,feasibility:0.3}; // 覆盖优势与成本优势恰好抵消
 const scored=scorePlans({plans:[a,b],weights});
 assert.ok(Math.abs(scored.plans[0].score-scored.plans[1].score)<1e-12);
 assert.equal(scored.recommendedId,'frugal');
});

test('invalid weights are rejected',()=>{
 const plans=[makePlan('a',10,[0.9],[0.1],['radio-mini']),makePlan('b',20,[0.95],[0.05],['radio-tdoa'])];
 assert.throws(()=>scorePlans({plans,weights:{coverage:0.4,blind:0.25,cost:0.2}})); // 缺 feasibility
 assert.throws(()=>scorePlans({plans,weights:{coverage:-0.1,blind:0.5,cost:0.4,feasibility:0.2}})); // 负权重
 assert.throws(()=>scorePlans({plans,weights:{coverage:0.4,blind:0.25,cost:0.2,feasibility:0.2}})); // 和 ≠ 1
 assert.throws(()=>scorePlans({plans,weights:{coverage:0.4,blind:0.25,cost:0.2,feasibility:0.15,extra:0}})); // 未知键
 assert.doesNotThrow(()=>scorePlans({plans})); // 默认 METRIC_WEIGHTS 合法
});

test('comparisonTable exposes pure data rows for UI and export',()=>{
 const conditions=[{id:'c0',name:'工况零'},{id:'c1',name:'工况一'}];
 const plans=[makePlan('a',10,[0.9,0.8],[0.1,0.2],['radio-mini']),makePlan('b',20,[0.95,0.85],[0.05,0.15],['radio-tdoa'])];
 const table=comparisonTable(scorePlans({plans,conditions}),conditions);
 assert.equal(table.rows.length,2);
 for(const key of ['rank','name','deviceCount','coverage','coverageNorm','blindRatio','blindRatioNorm','cost','costNorm','feasibility','feasibilityNorm','score'])assert.ok(table.columns.some(c=>c.key===key));
 assert.equal(table.rows[0].rank,1);assert.equal(table.rows[0].deviceCount,1);
 assert.equal(table.rows[0].weakestCondition.name,'工况一'); // 两案最弱工况均为 c1
});

test('real deployment example scores consistently with its metrics',()=>{
 const report=JSON.parse(readFileSync(new URL('../public/deployment-example.json',import.meta.url)));
 const scored=scorePlans({plans:report.plans,conditions:report.conditions});
 assert.ok(report.plans.some(p=>p.id===scored.recommendedId));
 assert.equal(scored.plans.length,report.plans.length);
 for(const p of scored.plans){
  const source=report.plans.find(q=>q.id===p.id);
  assert.ok(Math.abs(p.indicators.coverage-Math.min(...source.metrics.map(m=>m.coverageRate)))<1e-12);
  assert.ok(Math.abs(p.indicators.blindRatio-source.metrics.reduce((s,m)=>s+m.blindRate,0)/source.metrics.length)<1e-12);
  assert.equal(p.indicators.cost,source.cost);
  assert.ok(p.indicators.feasibility>=0&&p.indicators.feasibility<=1);
  assert.equal(p.deviceCount,source.devices.length);
  for(const v of Object.values(p.normalized))assert.ok(v>=0&&v<=1);
 }
 const table=comparisonTable(scored,report.conditions);
 assert.equal(table.rows.length,report.plans.length);
});
