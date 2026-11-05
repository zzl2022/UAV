// 标准默认方案与当前方案的离线布设文档。所有数值直接来自 report/run，规则来自真实多轮过程数据。
import {TYPES} from '../sensors/presets.js';
import {createDeviceDisplayMap} from './device-display.js';

export const DEPLOYMENT_DOC_SCHEMA='task3-deployment-doc/1.0';
const VERDICT={pass:'通过',degraded:'降额',fail:'不通过'};
const percent=value=>`${(value*100).toFixed(2)}%`;
const number=(value,digits=1)=>Number(value).toFixed(digits);
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function representativeCases(report,plan,conditionId,maxCases=4){
 const condition=report.conditions.find(item=>item.id===conditionId)??report.conditions[0];
 if(!condition)throw Error('报告缺少覆盖工况，无法选择代表点');
 const display=createDeviceDisplayMap(plan.devices),core=report.sampling.bounds.core,coreRadius=report.settings.coreRadius;
 const metric=plan.metrics.find(item=>item.condition===condition.id);
 if(!metric)throw Error(`方案 ${plan.id} 缺少 ${condition.id} 工况指标`);
 const rows=plan.devices.map((device,index)=>{
  const contribution=plan.coverageContributions?.[device.id]?.find(item=>item.condition===condition.id);
  if(!contribution)return null;
  const site=plan.sites[index]??device.deployment??{},mobile=device.mobileRepair?.platform==='police-car';
  const distanceToCoreM=Math.hypot(device.position[0]-core[0],device.position[2]-core[2]);
  return {device,index,site,mobile,contribution,distanceToCoreM,display:display.details(device.id)};
 }).filter(Boolean);
 if(!rows.length)throw Error('当前方案缺少逐设备覆盖贡献，不能编造代表点原因');
 const ranked=[...rows].sort((a,b)=>b.contribution.independentSamples-a.contribution.independentSamples||b.contribution.coveredSamples-a.contribution.coveredSamples||a.distanceToCoreM-b.distanceToCoreM||a.index-b.index);
 const target=Math.min(5,Math.max(1,Math.min(maxCases,ranked.length))),selected=[];
 const add=row=>{if(row&&!selected.includes(row)&&selected.length<target)selected.push(row);};
 add(ranked[0]);
 for(const row of ranked)if(selected.length<Math.min(3,target)&&!selected.some(item=>item.device.type===row.device.type))add(row);
 const mobile=ranked.find(row=>row.mobile);
 if(mobile&&!selected.includes(mobile)){
  if(selected.length>=target){const removable=[...selected].reverse().find(row=>!row.mobile);if(removable)selected.splice(selected.indexOf(removable),1);}
  add(mobile);
 }
 for(const row of ranked)add(row);
 const cases=selected.sort((a,b)=>a.index-b.index).map(row=>{
  const {device,index,site,mobile,contribution,distanceToCoreM}=row,entry=row.display;
  const reasons=[`${condition.name}下实际覆盖 ${contribution.coveredSamples}/${metric.total} 个采样，其中 ${contribution.independentSamples} 个由该设备独立覆盖。`];
  if(mobile){
   const action=plan.derivation?.selected?.find(item=>item.deviceId===device.id);
   reasons.push(`移动补盲过程记录显示，该设备新增覆盖 ${action?.newlyCoveredSampleIds?.length??0} 个 ${plan.derivation?.conditionId===condition.id?condition.name:'启动补盲时所选工况'}盲点；点位是开阔地表几何代理，道路可达性未验证。`);
  }else{
   reasons.push(`点位距核心中心 ${number(distanceToCoreM)} m，${distanceToCoreM<=coreRadius?'位于核心权重区内':'位于核心权重区外，承担外围采样覆盖'}；部署依据为 ${site.installation??'流水线真实候选点安装代理'}。`);
   reasons.push(contribution.independentSamples>0?'该点具有独立覆盖采样，因而优先作为解释方案空间覆盖构成的代表点。':'该点与其他设备形成重叠覆盖，用于解释当前方案的冗余覆盖构成。');
  }
  return {
   deviceId:device.id,displayName:entry.displayName,type:device.type,typeName:TYPES[device.type]??device.type,modelName:entry.modelName,
   position:[...device.position],siteName:site.name??(mobile?'开阔地表几何代理点（未验证道路可达）':'流水线实际候选点'),installation:site.installation??'流水线实际候选点安装代理',mobile,
   conditionId:condition.id,coveredSamples:contribution.coveredSamples,independentSamples:contribution.independentSamples,totalSamples:metric.total,distanceToCoreM,reasons,
  };
 });
 return {condition:{...condition},cases};
}

export function createDeploymentDocument({report,run,activePlanId=report?.recommendedId,rules=[],conditionId='nominal',documentKind='current',generatedAt=new Date().toISOString()}){
 if(!report||!run?.runId)throw Error('生成布设文档需要完整 report 和带 runId 的 run');
 const plan=report.plans.find(item=>item.id===activePlanId);
 if(!plan)throw Error(`当前方案 ${activePlanId} 不在报告中`);
 if(!Array.isArray(plan.devices)||!plan.devices.length)throw Error('当前方案没有可解释的设备点位');
 const {condition,cases}=representativeCases(report,plan,conditionId);
 const scope=report.scope??report.sampling.dataCoverage??{};
 const settings=report.settings,derived=Boolean(plan.derivation),emc=report.emc[plan.id];
 if(!emc)throw Error(`方案 ${plan.id} 缺少 EMC 结果`);
 const scoring=report.scoring?.plans?.find(item=>item.id===plan.id);
 const usableRules=(Array.isArray(rules)?rules:rules.rules??[]).filter(rule=>rule?.evidence?.samples>0&&rule.evidence.runIds&&rule.evidence.method).map(rule=>({id:rule.id,title:rule.title,text:rule.text,evidence:{samples:rule.evidence.samples,runIds:rule.evidence.runIds,method:rule.evidence.method}}));
 const limitations=[...report.limitations];
 if(derived){
  limitations.push('当前为警车移动补盲派生方案：覆盖、盲区、设备贡献与 EMC 已按新增设备重算；原方案比较排名和威胁推演未对派生方案重算，不得当作移动方案的威胁验证结果。',...plan.derivation.assumptions??[]);
 }else limitations.push('本次仅包含固定点位流水线结果，未启用警车移动补盲；本文不包含也不声称任何移动补盲效果。');
 return {
  schema:DEPLOYMENT_DOC_SCHEMA,documentKind,generatedAt,
  source:{runId:run.runId,runCreatedAt:run.createdAt,reportCreatedAt:report.createdAt,activePlanId:plan.id,recommendedId:report.recommendedId,origin:report.origin,inputHashes:report.inputHashes},
  scope:{widthM:scope.widthM??settings.scopeWidthM,depthM:scope.depthM??settings.scopeDepthM,clipped:Boolean(scope.clipped),note:scope.note??'采样仅使用实际 GIS/DEM 数据，不外推无数据区域覆盖。'},
  grid:{spacingM:settings.spacing,siteSpacingM:settings.siteSpacing,heightsM:[...settings.heights],sampleCount:report.sampling.samples.length,candidateCount:report.candidateCount,siteCount:report.siteCount,marginReserveDb:settings.marginReserveDb,excluded:{...report.sampling.excluded}},
  plan:{id:plan.id,name:plan.name,deviceCount:plan.devices.length,cost:plan.cost,typeCounts:{...plan.typeCounts},recommended:plan.id===report.recommendedId,derived},
  metrics:{conditions:plan.metrics.map(metric=>({...metric})),averageBlindRate:plan.metrics.reduce((sum,metric)=>sum+metric.blindRate,0)/plan.metrics.length,weakestConditionId:[...plan.metrics].sort((a,b)=>a.coverageRate-b.coverageRate)[0].condition,...(scoring?{originalScore:scoring.score,originalRank:scoring.rank}:{})},
  emc:{verdict:emc.verdict,counts:{...emc.counts}},rules:usableRules,caseCondition:condition,cases,
  mobileRepair:derived?{enabled:true,basePlanId:plan.derivation.basePlanId,addedDeviceCount:plan.derivation.addedDeviceCount,conditionId:plan.derivation.conditionId,status:plan.derivation.status}:{enabled:false},
  limitations,
 };
}

function sourceRows(model){
 return Object.entries(model.source.inputHashes??{}).map(([file,hash])=>`<tr><td>${escapeHtml(file)}</td><td><code>${escapeHtml(hash)}</code></td></tr>`).join('');
}

export function renderDeploymentDocument(model){
 if(model?.schema!==DEPLOYMENT_DOC_SCHEMA)throw Error('布设文档模型 schema 无效');
 const standard=model.documentKind==='standard',plan=model.plan,metrics=model.metrics;
 const metricRows=metrics.conditions.map(row=>`<tr><td>${escapeHtml(row.name)}</td><td>${row.covered}/${row.total}</td><td>${percent(row.coverageRate)}</td><td>${percent(row.blindRate)}</td><td>${percent(row.coreCoverageRate)}</td><td>${percent(row.coreRedundantRate)}</td></tr>`).join('');
 const rules=model.rules.map(rule=>`<article class="rule" data-rule-id="${escapeHtml(rule.id)}"><h3>${escapeHtml(rule.id)} · ${escapeHtml(rule.title)}</h3><p>${escapeHtml(rule.text)}</p><p class="evidence">样本量 ${rule.evidence.samples}；统计口径：${escapeHtml(rule.evidence.method)}；来源 runId：${escapeHtml(rule.evidence.runIds)}</p></article>`).join('');
 const cases=model.cases.map(item=>`<article class="case" data-device-id="${escapeHtml(item.deviceId)}"><div class="case-head"><span>${escapeHtml(item.displayName)} · ${escapeHtml(item.typeName)}</span><strong>${escapeHtml(item.modelName)}</strong></div><dl><div><dt>点位</dt><dd>${escapeHtml(item.siteName)}</dd></div><div><dt>模型坐标 / m</dt><dd>东 ${number(item.position[0])}，上 ${number(item.position[1])}，北 ${number(-item.position[2])}</dd></div><div><dt>实际覆盖贡献</dt><dd>${item.coveredSamples}/${item.totalSamples}；独立覆盖 ${item.independentSamples}</dd></div><div><dt>部署状态</dt><dd>${item.mobile?'警车移动补盲新增设备':'原流水线固定点位设备'}</dd></div></dl><ol>${item.reasons.map(reason=>`<li>${escapeHtml(reason)}</li>`).join('')}</ol></article>`).join('');
 const embedded=JSON.stringify(model).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 return `<!-- Generated by Trae Work -->
<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${standard?'任务三标准默认方案':'任务三当前推演方案'} · 布设规则与案例</title>
<style>
:root{--bg:#0e1922;--panel:#152635;--ink:#e6f1f7;--muted:#9ab6c5;--line:#2a4553;--accent:#5fd4b8;--gold:#ffd783;--case-ink:#cfe0e8;--notice:#262b29}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.75 "Microsoft YaHei","PingFang SC",sans-serif}.wrap{max-width:1080px;margin:auto;padding:0 26px 64px}header{padding:48px 0 26px;border-bottom:1px solid var(--line)}.kicker{color:var(--accent);letter-spacing:.12em;font-size:13px}h1{font-size:30px;line-height:1.4;margin:10px 0}h2{margin:42px 0 12px;padding-left:12px;border-left:4px solid var(--accent);font-size:22px}h3{font-size:17px;margin:0 0 8px;color:var(--gold)}p{margin:8px 0}.muted,.evidence{color:var(--muted);font-size:13px}.badge{display:inline-block;padding:2px 10px;border:1px solid var(--accent);border-radius:99px;color:var(--accent);font-size:12px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}.card,.rule,.case,section.box{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px}.card .num{font-size:24px;color:var(--accent);font-weight:700}.card .label{color:var(--muted);font-size:12px}.table-wrap{overflow-x:auto;overflow-y:auto;max-height:600px;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px 11px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);white-space:nowrap}td code{font-size:11px;overflow-wrap:anywhere;word-break:break-all}.rule{margin:12px 0;border-left:4px solid var(--accent)}.evidence{border-top:1px dashed var(--line);padding-top:8px;overflow-wrap:anywhere}.cases{display:grid;grid-template-columns:1fr 1fr;gap:14px}.case{padding:16px}.case-head{display:flex;justify-content:space-between;gap:12px;color:var(--accent);font-weight:700}.case-head strong{color:var(--gold);text-align:right}dl{margin:12px 0}dl div{display:grid;grid-template-columns:104px 1fr;gap:8px;border-bottom:1px dashed var(--line);padding:5px 0}dt{color:var(--muted)}dd{margin:0}.case ol{padding-left:20px;color:var(--case-ink)}.notice{border-left:4px solid var(--gold);background:var(--notice);padding:12px 16px;margin:14px 0}.limits li{margin:8px 0}footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:720px){.cases{grid-template-columns:1fr}.wrap{padding:0 16px 40px}h1{font-size:25px}.case-head{display:block}.case-head strong{display:block;text-align:left}}
</style></head><body data-run-id="${escapeHtml(model.source.runId)}" data-plan-id="${escapeHtml(plan.id)}"><main class="wrap">
<header><div class="kicker">创意科目二 · 子任务三 · 真实流水线导出</div><h1>${standard?'标准默认方案':'当前推演方案'}<br>布设规则与代表点案例</h1><span class="badge">${standard?'2400 × 2400 m / 500 m 标准默认':'随当前 report / run 生成'}</span>${plan.derived?' <span class="badge">移动补盲派生状态</span>':''}<p class="muted">方案：${escapeHtml(plan.name)}${plan.recommended?'（本次推荐方案）':'（当前选中方案，非推荐方案）'} · runId：<code>${escapeHtml(model.source.runId)}</code></p><p class="muted">报告时间 ${escapeHtml(model.source.reportCreatedAt)}；文档生成时间 ${escapeHtml(model.generatedAt)}</p></header>
<section id="overview"><h2>一、方案与关键指标</h2><div class="cards"><div class="card"><div class="num">${plan.deviceCount} 台</div><div class="label">当前方案实际设备数</div></div><div class="card"><div class="num">${percent(metrics.conditions.find(row=>row.condition===model.caseCondition.id).coverageRate)}</div><div class="label">${escapeHtml(model.caseCondition.name)}采样覆盖率</div></div><div class="card"><div class="num">${percent(metrics.averageBlindRate)}</div><div class="label">各工况平均采样盲区占比</div></div><div class="card"><div class="num">${number(plan.cost)}</div><div class="label">相对成本，非人民币报价</div></div><div class="card"><div class="num">${VERDICT[model.emc.verdict]}</div><div class="label">EMC：严重 ${model.emc.counts.fail} / 提示 ${model.emc.counts.warning}</div></div></div><div class="table-wrap"><table><thead><tr><th>工况</th><th>覆盖采样</th><th>覆盖率</th><th>盲区占比</th><th>核心区覆盖</th><th>核心二重覆盖</th></tr></thead><tbody>${metricRows}</tbody></table></div>${metrics.originalScore===undefined?'':`<p class="muted">原流水线综合得分 ${number(metrics.originalScore,3)}，原排名 ${metrics.originalRank}；移动派生状态不重算原方案排名。</p>`}</section>
<section id="scope"><h2>二、真实 GIS 范围与网格口径</h2><div class="box"><p><strong>请求范围：东西 ${number(model.scope.widthM,0)} m × 南北 ${number(model.scope.depthM,0)} m。</strong>覆盖网格间距 ${number(model.grid.spacingM,0)} m，屋顶候选抽稀间距 ${number(model.grid.siteSpacingM,0)} m，离地高度层 ${model.grid.heightsM.join(' / ')} m。</p><p>有效空域采样 ${model.grid.sampleCount} 个；候选 ${model.grid.candidateCount} 个；初始屋顶站点 ${model.grid.siteCount} 个；覆盖裕量门槛 ${number(model.grid.marginReserveDb)} dB。</p><p>${escapeHtml(model.scope.note)}</p><p class="muted">来源 runId：${escapeHtml(model.source.runId)}。GIS/DEM 输入以 SHA-256 锁定，覆盖不是手写指标或外推结果。</p><details><summary>查看真实输入文件与哈希</summary><div class="table-wrap"><table><thead><tr><th>输入文件</th><th>SHA-256</th></tr></thead><tbody>${sourceRows(model)}</tbody></table></div></details></div></section>
<section id="rules"><h2>三、多轮仿真提炼的布设规则</h2><p class="muted">只列出具有实际样本、统计口径和 runId 的规则；样本不足的规则不生成。</p>${rules||'<p>当前多轮记录没有满足样本量要求的规则。</p>'}</section>
<section id="cases"><h2>四、当前实际方案代表点（${model.cases.length} 个）</h2><p class="muted">从当前${plan.recommended?'推荐':'选中'}方案的 ${escapeHtml(model.caseCondition.name)} 逐设备真实贡献中选取：优先独立覆盖，并补充设备类型与移动派生代表性。</p><div class="cases">${cases}</div></section>
<section id="limitations"><h2>五、必要假设与模型限制</h2><ol class="limits">${model.limitations.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ol><div class="notice">覆盖率是离散有效采样的计算结果，不是连续空域无盲区证明；施工、道路可达与电磁合规仍需现场实测。</div></section>
<footer>本文档为单个自包含 HTML，样式与数据均内联，无网络、字体、图片或脚本依赖。内嵌结构化数据与当前导出 report/run 使用同一来源，可离线复核。</footer>
</main><script type="application/json" id="deployment-doc-data">${embedded}</script></body></html>`;
}

export function createDeploymentHtml(input){
 return renderDeploymentDocument(createDeploymentDocument(input));
}
