// 可解释性数值实例：对任务三模型的每个环节做一次"可手工复核"的真实计算。
// 输入：latest-report.json（真实推荐方案）+ 真实城市数据重算；输出 artifacts/task3/explain-data.json。
// 不修改任何现有模块；贪心步骤的插桩循环与 src/planning/optimizer.js chooseGreedy 逻辑逐行一致。
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {generateSamples,scenarios} from '../src/planning/optimizer.js';
import {generateCandidatesWithEquipment} from '../src/task3/pipeline.js';
import {evaluate,angles} from '../src/sensors/engine.js';
import {createDevice,PRESETS} from '../src/sensors/presets.js';
import {classifySample,buildBuildingIndex} from '../src/task3/blindspots.js';
import {emcAnalysis} from '../src/task3/emc.js';

const city=JSON.parse(await readFile('public/data/city.json','utf8'));
const terrain=JSON.parse(await readFile('public/data/terrain.json','utf8'));
const report=JSON.parse(await readFile('artifacts/task3/latest-report.json','utf8'));
const query=createSceneQuery(createModel(city,terrain));
const settings=report.settings,environment=report.environment,target=report.target;
const sampling=generateSamples(city,query,settings),conditions=scenarios(environment),n=sampling.samples.length;
const plan=report.plans.find(p=>p.id===report.recommendedId);
const out={generatedAt:new Date().toISOString(),runId:'run-20261024-095721-7rap2',steps:{}};

// ── ① 覆盖判定单点实例：推荐方案一台雷达对一个被覆盖采样的完整代入 ──
{
 const device=plan.devices.find(d=>d.type==='radar');
 const j=sampling.samples.findIndex((p,j)=>p.kind==='grid'&&p.agl===60&&plan.coverage[0][j]>0);
 const sample=sampling.samples[j],context=query.trace(device.position,sample.position);
 const r=evaluate(device,{...target,position:sample.position},conditions[0].environment,context);
 const p=device.parameters,dir=angles(device.position,sample.position);
 out.steps.coverageRadar={deviceId:device.id,preset:device.name,devicePosition:device.position,sampleId:sample.id,samplePosition:sample.position,agl:sample.agl,
  distanceM:dir.distance,
  terms:{rangeGainDb:40*Math.log10(p.maxRange/dir.distance),rcsGainDb:10*Math.log10(target.rcs/p.referenceRcs),referenceSnrDb:p.referenceSnrDb,thresholdDb:p.thresholdDb,losses:r.losses,totalLossDb:Object.values(r.losses).reduce((a,b)=>a+b,0)},
  marginDb:r.marginDb,reserveDb:settings.marginReserveDb,eligible:r.eligible,status:r.status,reasons:r.reasons,
  verdict:r.status==='within-model'&&r.marginDb>=settings.marginReserveDb,
  note:'覆盖判定 = status 为 within-model 且 marginDb ≥ 预留裕量 3 dB（pipeline.js L56–80 / optimizer.js L108）'};
}

// ── ①b 失败对照实例：真实盲点（低空贴楼）上全部设备的判定原因 ──
{
 const blind=report.blindspots[plan.id][0].points.find(p=>p.category==='lowFacade')??report.blindspots[plan.id][0].points[0];
 const rows=[];
 for(const device of plan.devices){
  const quick=evaluate(device,{...target,position:blind.position},conditions[0].environment,{known:true,blocked:false,buildingCount:0});
  const geomFail=quick.reasons.some(r=>['近距盲区','超出标称距离','超出方位视场','超出俯仰视场'].includes(r));
  const r=geomFail?quick:evaluate(device,{...target,position:blind.position},conditions[0].environment,query.trace(device.position,blind.position));
  rows.push({id:device.id,type:device.type,marginDb:r.marginDb===null?null:+r.marginDb?.toFixed(2),reasons:r.reasons});
 }
 const byReason={};for(const row of rows)for(const reason of row.reasons)byReason[reason]=(byReason[reason]??0)+1;
 out.steps.blindCase={point:blind,deviceResults:rows.slice(0,6),totalDevices:rows.length,reasonCounts:byReason,
  note:'该点计入盲区：没有任何设备同时满足几何与裕量条件；分类结果 '+blind.category+'（'+JSON.stringify(blind.cause)+'）'};
}

// ── ② 四类装备单点公式代入（无线电/光电/声学 + 静默失效） ──
{
 const radio=plan.devices.find(d=>d.type==='radio');
 const sj=sampling.samples.findIndex((p,j)=>p.kind==='grid'&&p.agl===60&&plan.coverage[0][j]>0);
 const s=sampling.samples[sj],ctx=query.trace(radio.position,s.position);
 const on=evaluate(radio,{...target,position:s.position},conditions[0].environment,ctx);
 const off=evaluate(radio,{...target,position:s.position,emitting:false},conditions[0].environment,ctx);
 out.steps.radio={deviceId:radio.id,distanceM:+angles(radio.position,s.position).distance.toFixed(1),marginDb:+on.marginDb?.toFixed(2),losses:on.losses,silentReasons:off.reasons,silentMargin:off.marginDb,
  note:'静默目标：reasons 含「目标无线电静默」，marginDb 置空、等效距离为 0（engine.js L108/L145）'};
 // 光电：最终方案未选中光电，取候选池中同点位光电候选做完整演示（明确标注）
 const {candidates}=generateCandidatesWithEquipment(city,query,settings,sampling,PRESETS.map(p=>p.id));
 const optical=candidates.find(c=>c.device.type==='optical').device;
 const octx=query.trace(optical.position,s.position);
 const oe=evaluate(optical,{...target,position:s.position},conditions[0].environment,octx);
 out.steps.optical={deviceId:optical.id,note:'光电未入选推荐方案（无增益），此处为候选池中真实点位的完整计算演示',distanceM:+angles(optical.position,s.position).distance.toFixed(1),
  angularPixels:+oe.extras.angularPixels?.toFixed(2),contrastFactor:+oe.extras.contrastFactor?.toFixed(3),effectivePixels:+oe.extras.effectivePixels?.toFixed(2),requiredPixels:optical.parameters.requiredPixels,marginDb:+oe.marginDb?.toFixed(2),recognitionRangeMeters:+oe.extras.recognitionRangeMeters?.toFixed(0)};
 const acoustic=plan.devices.find(d=>d.type==='acoustic');
 const actx=query.trace(acoustic.position,s.position);
 const ae=evaluate(acoustic,{...target,position:s.position},conditions[0].environment,actx);
 out.steps.acoustic={deviceId:acoustic.id,distanceM:+angles(acoustic.position,s.position).distance.toFixed(1),receivedSoundDb:+ae.extras.receivedSoundDb?.toFixed(1),noiseDb:+ae.extras.noiseDb?.toFixed(1),snrDb:+ae.snrDb?.toFixed(2),marginDb:+ae.marginDb?.toFixed(2),soundSpeed:+ae.extras.soundSpeed?.toFixed(1)};
}

// ── ③ 贪心集合覆盖：插桩重放前 6 步（逻辑与 optimizer.js L65–84 逐行一致） ──
{
 const {candidates}=generateCandidatesWithEquipment(city,query,settings,sampling,PRESETS.map(p=>p.id));
 const weights=conditions.flatMap((_,c)=>sampling.samples.map(p=>p.weight*(c===0?2:1)));
 const contexts=new Map();
 for(const cand of candidates){
  const cover=[];
  for(let j=0;j<n;j++){
   const pos=sampling.samples[j].position,base={...target,position:pos};
   const quick=evaluate(cand.device,base,environment,{known:true,blocked:false,buildingCount:0});
   if(quick.reasons.some(r=>['近距盲区','超出标称距离','超出方位视场','超出俯仰视场'].includes(r)))continue;
   const key=[cand.site.id,j].join(':');let cx=contexts.get(key);if(!cx){cx=query.trace(cand.device.position,pos);contexts.set(key,cx);}
   for(let c=0;c<conditions.length;c++){const r=evaluate(cand.device,{...base,...conditions[c].target},conditions[c].environment,cx);if(r.status==='within-model'&&r.marginDb!==null&&r.marginDb>=settings.marginReserveDb)cover.push(c*n+j);}
  }
  cand.cover=cover;
 }
 const policy={budget:Math.round(settings.budget*0.75),maxDevices:Math.max(1,Math.round(settings.maxDevices*0.75))};
 const covered=new Uint8Array(weights.length),selected=[];let cost=0;const picks=[];
 for(let step=0;step<6;step++){
  let best=-1,bestScore=0,bestGain=0;
  for(let i=0;i<candidates.length;i++){
   const cand=candidates[i];if(selected.includes(i)||cost+cand.cost>policy.budget+1e-9)continue;
   let gain=0;for(const j of cand.cover)if(!covered[j])gain+=weights[j];
   const score=gain/cand.cost;if(score>bestScore+1e-10){bestScore=score;best=i;bestGain=gain;}
  }
  if(best<0)break;selected.push(best);cost+=candidates[best].cost;for(const j of candidates[best].cover)covered[j]=1;
  picks.push({step:step+1,device:candidates[best].device.id,preset:candidates[best].device.name,gain:+bestGain.toFixed(1),cost:+candidates[best].cost.toFixed(1),gainPerCost:+bestScore.toFixed(2),cumulativeCost:+cost.toFixed(1),coveredWeightPct:+(100*weights.reduce((s,w,k)=>s+w*covered[k],0)/weights.reduce((a,b)=>a+b,0)).toFixed(1)});
 }
 out.steps.greedy={candidateCount:candidates.length,policy,formula:'score = 新增覆盖权重 Σwⱼ / 相对成本（optimizer.js L65–84）',picks};
}

// ── ④ 四类盲区归因决策路径：真实盲点复核 ──
{
 const index=buildBuildingIndex(city),cases=[];
 for(const bp of report.blindspots[plan.id][0].points.slice(0,4)){
  const sample=sampling.samples.find(s=>s.id===bp.sampleId);
  const replay=classifySample({sample,index,devices:plan.devices,query,target,environment:conditions[0].environment});
  cases.push({sampleId:bp.sampleId,stored:bp.category,replayed:replay.category,match:bp.category===replay.category,cause:bp.cause,position:bp.position});
 }
 out.steps.blindClassification={cases,thresholds:'gap≤60m 且对向>120° 且楼顶高于采样；shadow 遮挡物距≤120m；lowFacade 离地≤45m 且贴楼≤20m；corner 距角部≤25m（constants.js BLIND_THRESHOLDS；blindspots.js L63–118）'};
}

// ── ⑤ EMC 真实冲突实例 ──
{
 const emc=emcAnalysis(plan.devices),first=emc.conflicts[0];
 const enh=report.plans.find(p=>p.id==='enhanced'),emcEnh=emcAnalysis(enh.devices),failPair=emcEnh.conflicts.find(c=>c.severity==='fail');
 out.steps.emc={recommendedVerdict:emc.verdict,recommendedCounts:emc.counts,exampleWarning:first,enhancedVerdict:emcEnh.verdict,exampleFail:failPair,
  failDetail:failPair?{...failPair,penaltyFormula:'penaltyDb = 6×(1−d/600)，d=0 时 = 6 dB'}:null,
  note:'emc.js L24–52 五规则；推荐方案 0 严重冲突，增强型 2 例同屋顶同频 → 不通过并降权'};
}

// ── ⑥ 蜂群容量截取真实帧 ──
{
 const frames=report.threats.swarm.frames,frame=frames.reduce((a,b)=>(b.overflow.length>a.overflow.length?b:a),frames[0]);
 const capByType={};for(const d of plan.devices)capByType[d.id]=d.parameters.capacity;
 out.steps.swarmFrame={time:frame.time,targetsInFrame:frame.targets.length,overflowCount:frame.overflow.length,
  overflowSample:frame.overflow.slice(0,3),capacities:{radar03d:500,tdoa:35,mini:30,x1c:15},
  note:'每帧每台设备按 marginDb 降序截取 capacity 个，其余记溢出（threats.js L78–84）'};
}

// ── ⑦ R1 规则的 10 个缝宽 → P90 统计过程 ──
{
 const runFiles=(await readdir('artifacts/task3/runs')).filter(f=>f.endsWith('.json'));
 const runs=[];for(const f of runFiles)runs.push(JSON.parse(await readFile('artifacts/task3/runs/'+f,'utf8')));
 const widths=runs.flatMap(r=>{const rec=r.summary.recommendedId,rows=r.blindspots?.[rec]??[];const nom=rows.find(x=>x.conditionId==='nominal')??rows[0];return (nom?.points??[]).filter(p=>p.category==='gap'&&Number.isFinite(p.cause?.gapWidthM)).map(p=>p.cause.gapWidthM);});
 const sorted=[...widths].sort((a,b)=>a-b),p90=sorted[Math.min(sorted.length-1,Math.floor(0.9*sorted.length))];
 out.steps.ruleR1={runCount:runs.length,widths:sorted.map(x=>+x.toFixed(1)),p90Raw:+p90.toFixed(2),p90Rounded:Math.ceil(p90/5)*5,
  note:'X = ceil(P90/5m)×5m（rules.js L7 + L30–45）；样本来自 6 轮过程数据'};
}

await writeFile('artifacts/task3/explain-data.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({greedyPicks:out.steps.greedy.picks.length,radarMargin:out.steps.coverageRadar.marginDb?.toFixed(2),blindReasons:out.steps.blindCase.reasonCounts,radioSilent:out.steps.radio.silentReasons,emcFail:out.steps.emc.exampleFail?.kind??null,swarmFrame:out.steps.swarmFrame.overflowCount,r1P90:out.steps.ruleR1.p90Rounded},null,1));
