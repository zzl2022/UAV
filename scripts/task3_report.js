// 任务三命令行报告：以真实 GIS 数据跑多轮流水线迭代，过程数据落盘 artifacts/task3/runs/，
// 并据此生成 docs/task3 的四份数据驱动交付文档（方案对比/威胁验证/EMC/布设规则）。
// 用法：node scripts/task3_report.js [--quick]
//   --quick 只跑默认一轮（用于快速验证）；默认跑 6 轮多配置迭代（规则提炼的数据来源）。
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {DEFAULT_SETTINGS} from '../src/planning/optimizer.js';
import {runTask3Pipeline} from '../src/task3/pipeline.js';
import {validateRun} from '../src/task3/runs.js';
import {extractRules,rulesToMarkdown} from '../src/task3/rules.js';
import {METRIC_WEIGHTS,THREAT_SCENARIOS} from '../src/task3/constants.js';

const root=new URL('../',import.meta.url);
const quick=process.argv.includes('--quick');
const city=JSON.parse(await readFile(new URL('public/data/city.json',root)));
const terrain=JSON.parse(await readFile(new URL('public/data/terrain.json',root)));
const query=createSceneQuery(createModel(city,terrain));
const yieldTask=()=>new Promise(resolve=>setImmediate(resolve));
const quiet=()=>{};

// 多轮迭代配置：默认轮 + 网格/预算/高度层变体（过程数据即布设规则的数据基础）。
const variants=[
 {label:'baseline',over:{}},
 {label:'fine-grid',over:{spacing:350}},
 {label:'coarse-grid',over:{spacing:700}},
 {label:'low-budget',over:{budget:400}},
 {label:'high-budget',over:{budget:800}},
 {label:'low-layers',over:{heights:[20,45,60]}},
];
const runsDir=new URL('artifacts/task3/runs/',root),docsDir=new URL('docs/task3/',root);
await mkdir(runsDir,{recursive:true});await mkdir(docsDir,{recursive:true});

const runs=[];let main=null;
for(const [i,v] of (quick?variants.slice(0,1):variants).entries()){
 const settings={...DEFAULT_SETTINGS,scope:'core',siteSpacing:500,...v.over};
 const t0=Date.now();
 const {report,run}=await runTask3Pipeline({city,query,settings,weights:{...METRIC_WEIGHTS},progress:quiet,yieldTask,withThreatFrames:!i||!quick?true:true});
 const record=validateRun({...run,label:v.label});
 await writeFile(new URL(`${record.runId}.json`,runsDir),JSON.stringify(record));
 runs.push(record);
 if(i===0)main={report,run:record};
 console.log(`[${i+1}/${quick?1:variants.length}] ${v.label}: runId=${record.runId} 方案=${record.summary.plans.map(p=>`${p.id}:${p.devices}台/成本${p.cost.toFixed(0)}/rank${p.rank}`).join(' ')} 推荐=${record.summary.recommendedId} 耗时 ${((Date.now()-t0)/1000).toFixed(1)}s`);
}
await writeFile(new URL('artifacts/task3/latest-report.json',root),JSON.stringify(main.report));

// —— 文档生成（全部数据来自上述真实轮次）——
const fmt=x=>typeof x==='number'?x.toFixed(3):x;
const rep=main.report,scored=rep.scoring,rec=rep.plans.find(p=>p.id===rep.recommendedId);

// 1) 方案对比
{
 const t=rep.comparison,lines=['# 任务三 · 多套候选部署方案评估对比','',`数据来源：\`${main.run.runId}\`（${rep.createdAt}，范围：河南博物院周边 ${rep.settings.scope==='core'?'2.4×2.4 km':'全城'}，网格 ${rep.settings.spacing} m，高度层 ${rep.settings.heights.join('/')} m，候选 ${rep.candidateCount} 个、有效采样 ${rep.sampling.samples.length} 个）。`,'','> 成本为**相对成本单位，非人民币报价**（装备参数.doc 未提供价格）；施工可行性为依据文档重量/尺寸/架设方式/安装高度的代理分。覆盖完整性取四工况最小值（稳健口径）。','',`| 排名 | 方案 | 设备数 | 覆盖完整性(最弱工况) | 盲区面积占比(均值) | 相对成本 | 施工可行性 | EMC | 综合得分 |`,`| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |`];
 for(const r of t.rows){
  const plan=rep.plans.find(p=>p.id===r.id),emc=rep.emc[r.id];
  lines.push(`| ${r.rank} | ${r.name}${r.id===rep.recommendedId?' **（推荐）**':''} | ${r.deviceCount} | ${(r.coverage*100).toFixed(2)}%（${r.weakestCondition.name}） | ${(r.blindRatio*100).toFixed(2)}% | ${r.cost.toFixed(1)} | ${r.feasibility.toFixed(3)} | ${{pass:'通过',degraded:'降额',fail:'不通过'}[emc.verdict]} | ${r.score.toFixed(3)} |`);
 }
 lines.push('','## 各工况采样覆盖','','| 方案 | 工况 | 覆盖 | 盲区占比 | 核心区覆盖 |','| --- | --- | ---: | ---: | ---: |');
 for(const p of rep.plans)for(const m of p.metrics)lines.push(`| ${p.name} | ${m.name} | ${m.covered}/${m.total} | ${(m.blindRate*100).toFixed(2)}% | ${(m.coreCoverageRate*100).toFixed(1)}% |`);
 lines.push('','## 四类盲区分布（推荐方案）','','| 工况 | 楼栋夹缝 | 围墙边角 | 低空贴楼 | 背面阴影 | 其他 | 合计 |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
 for(const row of rep.blindspots[rep.recommendedId])lines.push(`| ${rep.conditions.find(c=>c.id===row.conditionId)?.name??row.conditionId} | ${row.stats.byCategory.gap} | ${row.stats.byCategory.corner} | ${row.stats.byCategory.lowFacade} | ${row.stats.byCategory.shadow} | ${row.stats.byCategory.other} | ${row.stats.total} |`);
 lines.push('','## 推荐方案设备构成','',`| 类型 | 数量 |`,`| --- | ---: |`,...Object.entries(rec.typeCounts??{}).map(([k,v])=>`| ${k} | ${v} |`),'','> 覆盖率仅针对所列有效空域采样点，非连续空间无盲区证明。择优口径见 scoring.method 与 scoring.methodEmc（报告 JSON）。','');
 await writeFile(new URL('plans-comparison.md',docsDir),lines.join('\n'));
}
// 2) 威胁验证
{
 const lines=['# 任务三 · 三类威胁场景鲁棒性验证','',`验证对象：推荐方案「${rec.name}」（${rec.devices.length} 台设备）。数据来源：\`${main.run.runId}\`。检出全部来自感知模型对真实几何遮挡的逐帧实判，帧间隔 2 s；设备并发容量按帧截取，溢出如实计数。`];
 for(const key of ['single','multi','swarm']){
  const th=rep.threats[key],s=th.summary,cfg=THREAT_SCENARIOS[key];
  lines.push('','',`## ${cfg.name}（${key}）`,'','| 指标 | 数值 |','| --- | ---: |',
   `| 目标数 | ${s.targetCount} |`,
   `| 被真实检出目标 | ${rep.threats[key].perTarget.filter(p=>p.firstDetectionTime!==null).length} |`,
   `| 平均首报时间 | ${s.meanFirstDetectionTime===null?'—':s.meanFirstDetectionTime.toFixed(1)+' s'} |`,
   `| 平均检出占比 | ${(s.meanDetectedFraction*100).toFixed(1)}% |`,
   `| 最低检出占比 | ${(s.minDetectedFraction*100).toFixed(1)}% |`,
   `| 全部目标同帧检出帧数 | ${s.framesWithAllDetected}/${s.totalFrames} |`,
   `| 容量溢出架次 | ${s.overflowEvents} |`,
   `| 涉及溢出目标 | ${s.overflowedTargets} |`,'',
   `结论：${th.text}`);
 }
 lines.push('','> 蜂群场景目标数（42）超出 TDOA-X1B(35)/OA-X1Bmini(30)/X1C(15) 的文档并发容量，溢出与漏探为模型真实输出，未做美化。','');
 await writeFile(new URL('threats-validation.md',docsDir),lines.join('\n'));
}
// 3) EMC 报告
{
 const lines=['# 任务三 · 电磁兼容性校核报告','',`依据装备参数.doc 频段/功率参数（雷达 X≈9.4 / Ku≈15 GHz 收发；无线电 100MHz–6GHz 或 0.9/1.2/2.4/5.2/5.8GHz 无源接收；光电/声学无射频）执行设备对级校核。规则为工程代理（同频 <0.1GHz 且 <600m、邻频 <0.5GHz 且 <300m、发射落入接收频段、≥1000W 发射距接收机 <50m、同点位 <10m），**不是频谱合规认证**。数据来源：\`${main.run.runId}\`。`,'','| 方案 | 结论 | 严重冲突 | 提示 |','| --- | --- | ---: | ---: |'];
 for(const p of rep.plans){const e=rep.emc[p.id];lines.push(`| ${p.name}${p.id===rep.recommendedId?'（推荐）':''} | ${{pass:'通过',degraded:'降额',fail:'不通过'}[e.verdict]} | ${e.counts.fail} | ${e.counts.warning} |`);}
 const all=Object.entries(rep.emc).flatMap(([pid,e])=>e.conflicts.map(c=>({plan:pid,...c})));
 lines.push('','## 冲突清单','');
 if(!all.length)lines.push('全部方案均未发现装备间射频冲突。');
 else{lines.push('| 方案 | 设备对 | 类型 | 严重度 | 距离/m | 频差/GHz | 附加损耗/dB | 建议 |','| --- | --- | --- | --- | ---: | ---: | ---: | --- |');for(const c of all)lines.push(`| ${c.plan} | ${c.a} ↔ ${c.b} | ${c.kind} | ${c.severity} | ${c.distanceM.toFixed(0)} | ${c.detailGHz?.toFixed(3)??'—'} | ${c.penaltyDb?.toFixed(1)??'—'} | ${c.recommendation} |`);}
 lines.push('','## 结论','',rep.emc[rep.recommendedId].text,'','EMC 结论已回写方案择优（fail 每例得分 ×0.85 下限 0.7，degraded ×0.97）。','');
 await writeFile(new URL('emc-report.md',docsDir),lines.join('\n'));
}
// 4) 布设规则（多轮统计）
{
 const {rules,stats}=extractRules({runs,report:rep,city});
 await writeFile(new URL('deployment-rules.md',docsDir),rulesToMarkdown({rules,stats}));
 console.log(`rules: ${rules.length} 条（${rules.map(r=>r.id).join('/')}）`);
}
console.log(JSON.stringify({runs:runs.length,latest:'artifacts/task3/latest-report.json',docs:['plans-comparison.md','threats-validation.md','emc-report.md','deployment-rules.md'],recommended:rep.recommendedId,threats:Object.fromEntries(Object.entries(rep.threats).map(([k,v])=>[k,v.summary])),durationMs:rep.durationMs},null,2));
