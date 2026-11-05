import {writeFile} from 'node:fs/promises';
import {readJson,escapeHtml,num,pct,pp,embedImage,table,groupedBarChart,flowSvg,documentShell} from './task3_doc_shared.js';

const evidence=await readJson('artifacts/task3/mobile-repair-evidence.json');
if(evidence.schema!=='task3-blind-evidence/1.0')throw Error('补盲证据 schema 无效');
const baselineExport=await readJson(evidence.paths.baseline),derivedExport=await readJson(evidence.paths.derived),run=await readJson(evidence.paths.run);
const baselineReport=baselineExport.report,derivedReport=derivedExport.report,planId=evidence.planId,conditionId=evidence.conditionId;
const baselinePlan=baselineReport.plans.find(plan=>plan.id===planId),derivedPlan=derivedReport.plans.find(plan=>plan.id===planId);
const ci=derivedReport.conditions.findIndex(condition=>condition.id===conditionId);
if(!baselinePlan||!derivedPlan||ci<0)throw Error('补盲文档缺少方案或工况');
const E=evidence.elimination,R=evidence.repair.summary,conditionName=derivedReport.conditions[ci].name;
const beforeIds=new Set(baselineReport.blindspots[planId][ci].points.map(point=>point.sampleId)),afterIds=new Set(derivedReport.blindspots[planId][ci].points.map(point=>point.sampleId));
const removed=[...beforeIds].filter(id=>!afterIds.has(id)),remaining=[...beforeIds].filter(id=>afterIds.has(id));
if(removed.length!==E.count||E.before-E.after!==E.count)throw Error('补盲消除集合与摘要不一致');
if(E.before&&(E.count/E.before)!==E.ratio)throw Error('补盲消除比例不一致');

const categoryNames={gap:'楼栋夹缝',corner:'围墙边角',lowFacade:'低空贴楼',shadow:'建筑背面阴影',other:'其他'};
const categoryRows=Object.keys(categoryNames).map(key=>{
 const before=evidence.baseline.blindStats.byCategory[key]??0,after=evidence.derived.blindStats.byCategory[key]??0,count=before-after;
 return {key,before,after,count,ratio:before?count/before:null};
});
const conditionRows=derivedReport.conditions.map((condition,index)=>{
 const before=evidence.baseline.blindspots[index].stats.total,after=evidence.derived.blindspots[index].stats.total,bm=evidence.baseline.metrics[index],am=evidence.derived.metrics[index];
 return {id:condition.id,name:condition.name,before,after,count:before-after,ratio:before?(before-after)/before:null,beforeCoverage:bm.coverageRate,afterCoverage:am.coverageRate,gainPp:(am.coverageRate-bm.coverageRate)*100};
});
const sampleIndex=new Map(derivedReport.sampling.samples.map((sample,index)=>[sample.id,index]));
const sampleRows=[...E.removedPoints.map(point=>({...point,state:'已消除'})),...E.remainingPoints.map(point=>({...point,state:'仍保留'}))].map(point=>{
 const index=sampleIndex.get(point.sampleId),before=baselinePlan.coverage[ci][index],after=derivedPlan.coverage[ci][index];
 const devices=R.actions.filter(action=>action.action==='deploy-mobile-radar'&&action.newlyCoveredSampleIds.includes(point.sampleId)).map(action=>action.deviceId);
 return {...point,before,after,devices};
});
const heights=[...new Set(sampleRows.map(point=>point.agl))].sort((a,b)=>a-b).map(agl=>{
 const rows=sampleRows.filter(point=>point.agl===agl),before=rows.length,after=rows.filter(point=>point.state==='仍保留').length;
 return {agl,before,after,count:before-after,ratio:before?(before-after)/before:null};
});

const bounds=derivedReport.sampling.bounds,pad=42,mapWidth=880,mapHeight=500;
const X=x=>pad+(x-bounds.west)/(bounds.east-bounds.west)*(mapWidth-pad*2),Y=z=>mapHeight-pad-(z-bounds.south)/(bounds.north-bounds.south)*(mapHeight-pad*2);
const point=(p,color,r,label)=>`<circle cx="${X(p[0])}" cy="${Y(p[2])}" r="${r}" fill="${color}" stroke="#0e1922" stroke-width="1"><title>${escapeHtml(label)}</title></circle>`;
const mapSvg=`<figure><svg class="chart" viewBox="0 0 ${mapWidth} ${mapHeight}" role="img" aria-label="补盲前后样本与移动设备点位"><rect x="${pad}" y="${pad}" width="${mapWidth-pad*2}" height="${mapHeight-pad*2}" fill="#101f29" stroke="var(--line)"/><circle cx="${X(bounds.core[0])}" cy="${Y(bounds.core[2])}" r="${derivedReport.settings.coreRadius/(bounds.east-bounds.west)*(mapWidth-pad*2)}" fill="none" stroke="var(--gold)" stroke-dasharray="6 5"/>${sampleRows.map(p=>point(p.position,p.state==='已消除'?'var(--accent)':'var(--bad)',6,`${p.sampleId} · ${p.state} · AGL ${p.agl}m · ${p.before}→${p.after}`)).join('')}${R.selected.map(item=>`${point(item.position,'var(--gold)',9,`${item.deviceId} · ${item.frequencyGHz}GHz`)}<text x="${X(item.position[0])+10}" y="${Y(item.position[2])-8}" class="label">${escapeHtml(item.deviceId)}</text>`).join('')}<text x="${pad+8}" y="${pad+20}" class="axis">黄圈：核心权重区；绿：已消除；红：残余；黄点：新增移动雷达</text></svg><figcaption>点位使用报告 ENU 坐标直接投影，北向向上；不是施工地图或道路可达性证明。</figcaption></figure>`;

const images=await Promise.all(evidence.screenshots.map(path=>embedImage(path)));
const actionRows=R.actions.map(action=>action.action==='deploy-mobile-radar'?[
 action.step,'部署移动雷达',action.deviceId,`${num(action.position[0],1)} / ${num(-action.position[2],1)} / ${num(action.position[1],1)}`,`${action.frequencyGHz} GHz`,action.searchPhase,action.newlyCoveredSampleIds.join('、'),`${action.emcCounts.fail} / ${action.emcCounts.warning}`
]:[action.step,'EMC 拒绝候选',action.candidateId,`${num(action.position[0],1)} / ${num(-action.position[2],1)} / ${num(action.position[1],1)}`,action.attemptedFrequenciesGHz.join('、'),action.anchorSampleId,'所有频道均新增 fail','—']);
const searchRows=Object.entries(R.search).map(([key,value])=>[key,value]);
const deviceRows=evidence.repair.addedDevices.map(device=>{
 const action=R.selected.find(item=>item.deviceId===device.id);
 return [device.id,device.name,device.presetId,`${num(device.position[0],2)} / ${num(-device.position[2],2)} / ${num(device.position[1],2)}`,`${device.parameters.frequencyGHz} GHz`,`${device.mobileRepair.mountHeightM} m（${device.mobileRepair.mountHeightSource}）`,action.newlyCoveredSampleIds.length,device.mobileRepair.roadReachabilityVerified?'已验证':'未验证道路可达'];
});

const analysis={conditionRows,categoryRows,heights,sampleRows,actionRows};
const documentData={schema:'task3-blind-doc/1.0',source:{runId:evidence.runId,requestId:evidence.requestId,planId,conditionId,paths:evidence.paths},evidence,analysis};
const body=`
<section id="scope"><h2>一、统计口径与计算公式</h2><div class="notice">本批次：${escapeHtml(evidence.runId)} · 方案 ${escapeHtml(planId)} · ${escapeHtml(conditionName)}。所有数字来自同一浏览器推演及导出报告，采样消除率不是连续空域面积消除率。</div><div class="formula">B0 = 基线盲点集合；B1 = 移动补盲后盲点集合
已消除集合 = B0 − B1；残余集合 = B0 ∩ B1
消除数 = |B0| − |B1| = ${E.count}
消除比例 = (|B0| − |B1|) / |B0| = ${E.count} / ${E.before} = ${pct(E.ratio)}
覆盖率提升 = 后覆盖率 − 前覆盖率 = ${pp(E.coverageGainPp)}
若 |B0|=0，消除比例显示“不适用”，不得写成 100%。</div><p>覆盖判定沿用 <code>src/task3/mobile-repair.js</code>：within-model 且 margin ≥ 预留裕量；补盲后对全部设备、全部采样和全部工况重新计算，不用插值遮盖残余盲点。</p></section>
<section id="logic"><h2>二、盲区归因与补盲运行逻辑</h2>${flowSvg([{title:'① 识别盲点',detail:'coverageRow=0，并保留 sampleId、AGL、核心权重与位置'},{title:'② 四类几何归因',detail:'夹缝 → 背面阴影 → 低空贴楼 → 围墙边角 → 其他'},{title:'③ 地表候选搜索',detail:'粗圆环 + 剩余盲点细网格；surface=ground 才接受开阔地表代理'},{title:'④ 真实覆盖与 EMC 双门槛',detail:'逐点实判覆盖；所有合法频道会新增 fail 的候选直接拒绝'},{title:'⑤ 贪心部署与全量复核',detail:'按新增盲点覆盖数选择，随后重算全设备×全采样×全工况'}],{title:'移动补盲实际执行链'})}<div class="box"><strong>搜索过程记录</strong>${table(['字段','实际值'],searchRows)}</div></section>
<section id="results"><h2>三、盲区消除统计与实际效果</h2><div class="cards"><div class="card"><div class="num">${E.before} → ${E.after}</div><div class="label">当前工况盲点采样数</div></div><div class="card"><div class="num">${E.count}</div><div class="label">真实消除采样数</div></div><div class="card"><div class="num">${pct(E.ratio)}</div><div class="label">采样盲点消除比例</div></div><div class="card"><div class="num">${pp(E.coverageGainPp)}</div><div class="label">覆盖率提升</div></div><div class="card"><div class="num">+${R.addedDeviceCount}</div><div class="label">新增移动雷达 / 成本 +${num(R.addedCost,1)}</div></div><div class="card"><div class="num">${R.emc.newFailCount}</div><div class="label">新增 fail 级 EMC 冲突</div></div></div>${groupedBarChart({title:'各工况盲点：基线 vs 移动补盲后',rows:conditionRows.map(row=>({label:row.name,values:[row.before,row.after]})),series:[{name:'基线',color:'var(--bad)'},{name:'补盲后',color:'var(--accent)'}],valueDigits:0})}${table(['工况','前盲点','后盲点','消除数','消除比例','前覆盖率','后覆盖率','提升'],conditionRows.map(row=>[row.name,row.before,row.after,row.count,pct(row.ratio),pct(row.beforeCoverage),pct(row.afterCoverage),pp(row.gainPp)]))}<h3>按盲区类别</h3>${groupedBarChart({title:'当前工况分类盲点变化',rows:categoryRows.map(row=>({label:categoryNames[row.key],values:[row.before,row.after]})),series:[{name:'基线',color:'var(--warn)'},{name:'补盲后',color:'var(--accent)'}],valueDigits:0})}${table(['类别','前盲点','后盲点','消除数','消除比例'],categoryRows.map(row=>[categoryNames[row.key],row.before,row.after,row.count,pct(row.ratio)]))}<h3>按离地高度层</h3>${table(['AGL / m','前盲点','后盲点','消除数','消除比例'],heights.map(row=>[row.agl,row.before,row.after,row.count,pct(row.ratio)]))}${mapSvg}</section>
<section id="samples"><h2>四、逐样本、逐设备与逐步动作复核</h2><h3>已消除与残余样本（完整集合）</h3>${table(['样本','状态','类别','AGL / m','前覆盖设备数','后覆盖设备数','关联新增设备'],sampleRows.map(point=>[point.sampleId,point.state,categoryNames[point.category]??point.category,point.agl,point.before,point.after,point.devices.join('、')||'—']))}<h3>新增移动设备</h3>${table(['设备 ID','型号','预设','东 / 北 / 高 / m','频道','挂载高度','新增覆盖样本','道路条件'],deviceRows)}<h3>全部补盲动作</h3>${table(['步','动作','设备/候选','东 / 北 / 高 / m','频道/尝试频道','锚点/阶段','新增样本/拒绝原因','EMC fail/warning'],actionRows)}</section>
<section id="validation"><h2>五、实际界面与回归验证</h2><div class="grid2"><figure><img src="${images[0]}" alt="移动补盲后地图与设备"><figcaption>移动补盲后：新增设备、真实覆盖贡献和 EMC 状态。</figcaption></figure><figure><img src="${images[2]}" alt="取消补盲恢复基线"><figcaption>取消补盲后恢复基线：设备、盲点、EMC 与原报告一致，可视为基线界面复核。</figcaption></figure></div><figure><img src="${images[1]}" alt="切换工况后的补盲状态"><figcaption>切换其他工况后仍保留派生状态；每个工况使用各自重算指标。</figcaption></figure>${table(['验证项','实测结果'],[['已消除集合 = B0−B1',evidence.validation.setEquality?'通过':'失败'],['原已覆盖采样零回退',evidence.validation.originalCoverageNonRegression?'通过':'失败'],['新增 EMC fail',R.emc.newFailCount],['重复勾选不叠加设备',`通过（设备数 ${evidence.validation.duplicateDeviceCount}）`],['取消后盲点恢复',`${evidence.validation.restored.blindStats.total}，与基线一致`],['取消后方案与 run 恢复',evidence.validation.restored.planMatchesBaseline&&evidence.validation.restored.runMatchesBaseline?'通过':'失败']])}</section>
<section id="limits"><h2>六、边界与改进路径</h2>${table(['当前边界','影响','可落地改进','验收指标'],[['候选仅为开阔地表几何代理，未验证道路可达','不能直接作为停车/施工坐标','接入道路网、禁停区和现场勘测，保留候选审核状态','道路可达率、现场审核通过率'],['车载挂载 2 m 为模型假设','高度变化会改变遮挡和裕量','使用车辆与支架实测高度重跑','实测高度覆盖复核偏差'],['派生方案未自动重算原方案排名和威胁结果','不能宣称移动方案已完成威胁鲁棒性验证','对派生方案重跑三威胁与评分，并单独保存报告','派生威胁结果与评分批次一致'],['采样消除率不是连续面积率','采样之间仍可能存在空洞','自适应加密残余盲点邻域并做连续射线抽检','加密采样残余率、抽检覆盖率']])}</section>`;
const html=documentShell({title:'任务三 · 盲区消除与效果验证',kicker:'创意科目二 · 子任务三 · 真实补盲批次',subtitle:`${conditionName}：从 ${E.before} 个盲点到 ${E.after} 个盲点，消除比例 ${pct(E.ratio)}`,meta:`<span class="badge">runId ${escapeHtml(evidence.runId)}</span><span class="badge">request ${escapeHtml(evidence.requestId)}</span><span class="badge">方案 ${escapeHtml(planId)}</span>`,toc:[['scope','统计口径与公式'],['logic','归因与补盲逻辑'],['results','消除统计与图表'],['samples','逐样本/设备复核'],['validation','实际界面与回归'],['limits','边界与改进']].map(([id,label])=>({id,label})),body,data:documentData,dataId:'blind-doc-data'});
await writeFile('任务三盲区消除与效果验证.html',html,'utf8');
console.log(JSON.stringify({output:'任务三盲区消除与效果验证.html',runId:evidence.runId,before:E.before,after:E.after,ratio:E.ratio,samples:sampleRows.length,actions:actionRows.length,images:images.length},null,2));
