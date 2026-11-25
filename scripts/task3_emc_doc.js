import {writeFile} from 'node:fs/promises';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {evaluate,angles} from '../src/sensors/engine.js';
import {scenarios} from '../src/planning/optimizer.js';
import {emcAnalysis} from '../src/task3/emc.js';
import {EQUIPMENT_FACTS,EMC_RULES,EQUIPMENT_CHANNELS_GHZ} from '../src/task3/constants.js';
import {readJson,escapeHtml,num,pct,embedImage,table,groupedBarChart,flowSvg,documentShell} from './task3_doc_shared.js';

const report=await readJson('artifacts/task3/latest-report.json'),source=await readJson('artifacts/task3/latest-source.json'),run=await readJson(source.runPath);
if(source.runId!==run.runId)throw Error('EMC 文档来源批次不一致');
const kindNames={'co-channel':'同频干扰','adjacent-channel':'邻频干扰','receiver-overlap':'发射→接收耦合','frontend-block':'前端阻塞','co-site':'共址过密'};
const verdictNames={pass:'通过',degraded:'降额',fail:'不通过'};
const nullable=(value,digits=2)=>Number.isFinite(value)?num(value,digits):'—';
const plans=report.plans.map(plan=>({plan,remediation:report.emc[plan.id].remediation??plan.emcRemediation,emc:report.emc[plan.id]}));
const countKinds=(snapshot,kind)=>snapshot.conflicts.filter(conflict=>conflict.kind===kind).length;
const conflictTypes=Object.keys(kindNames).map(kind=>({kind,name:kindNames[kind],before:plans.reduce((sum,item)=>sum+countKinds(item.remediation.before,kind),0),after:plans.reduce((sum,item)=>sum+countKinds(item.remediation.after,kind),0)}));
const actionRows=plans.flatMap(({plan,remediation})=>remediation.actions.map(action=>[plan.name,action.step,action.action==='retune'?'合法换频':'局部同型号移位',action.deviceId,action.action==='retune'?`${nullable(action.before.frequencyGHz,3)} → ${nullable(action.after.frequencyGHz,3)} GHz`:`${action.before.siteId??'—'} → ${action.after.siteId??'—'}`,action.action==='relocate'?action.after.position.map((v,i)=>num(i===2?-v:v,1)).join(' / '):action.after.position.map((v,i)=>num(i===2?-v:v,1)).join(' / '),`${action.before.emcCounts.fail} → ${action.after.emcCounts.fail}`,`${action.before.emcCounts.warning} → ${action.after.emcCounts.warning}`,nullable(action.coverageLoss,3)]));
const coverageRows=plans.flatMap(({plan,remediation})=>{
 const before=remediation.coverageReview?.before,after=remediation.coverageReview?.after??[];
 return after.map((metric,index)=>{const b=before?.[index];return [plan.name,report.conditions.find(condition=>condition.id===metric.condition)?.name??metric.condition,b?`${b.covered}/${report.sampling.samples.length}`:'无需处置',`${metric.covered}/${report.sampling.samples.length}`,b?pct(b.coverageRate):'—',pct(metric.coverageRate),b?`${(100*(metric.coverageRate-b.coverageRate)).toFixed(2)} pp`:'—'];});
});
const finalConflictRows=plans.flatMap(({plan,emc})=>emc.conflicts.map(conflict=>[plan.name,`${conflict.a} ↔ ${conflict.b}`,kindNames[conflict.kind]??conflict.kind,conflict.severity,nullable(conflict.distanceM,2),nullable(conflict.detailGHz,3),nullable(conflict.penaltyDb,3),conflict.recommendation]));

// 逆向恢复处置前设备，用同一感知模型对真实采样做点级前后复核。
const [city,terrain]=await Promise.all([readJson('public/data/city.json'),readJson('public/data/terrain.json')]);
const query=createSceneQuery(createModel(city,terrain)),condition=scenarios(report.environment)[0];
function initialDevices(plan){
 const devices=structuredClone(plan.devices),actions=plan.emcRemediation?.actions??[];
 for(const action of [...actions].reverse()){
  if(action.action==='retune'){
   const device=devices.find(item=>item.id===action.deviceId);if(!device)throw Error(`无法恢复换频前设备 ${action.deviceId}`);device.parameters.frequencyGHz=action.before.frequencyGHz;
  }else{
   const index=devices.findIndex(item=>item.id===action.replacementDeviceId);if(index<0)throw Error(`无法恢复移位前设备 ${action.replacementDeviceId}`);
   devices[index].id=action.deviceId;devices[index].position=[...action.before.position];devices[index].parameters.frequencyGHz=action.before.frequencyGHz;
  }
 }
 return devices;
}
let sampleReview=null;
const reviewed=plans.find(({remediation})=>remediation.actions.length);
if(reviewed){
 const {plan,remediation}=reviewed,beforeDevices=initialDevices(plan),beforeEmc=emcAnalysis(beforeDevices),afterEmc=emcAnalysis(plan.devices),action=remediation.actions[0];
 const afterDevice=plan.devices.find(device=>device.id===(action.action==='retune'?action.deviceId:action.replacementDeviceId)),beforeDevice=beforeDevices.find(device=>device.id===action.deviceId);
 if(!beforeDevice||!afterDevice)throw Error('EMC 点级复核缺少前后设备');
 const beforePenalty=beforeEmc.penalties[beforeDevice.id]??0,afterPenalty=afterEmc.penalties[afterDevice.id]??0,candidates=[];
 for(const sample of report.sampling.samples){
  const evaluateCase=(device,penalty)=>{
   const target={...report.target,...condition.target,position:sample.position},environment={...condition.environment,cochannelDb:condition.environment.cochannelDb+penalty},context=query.trace(device.position,sample.position),result=evaluate(device,target,environment,context);
   return {marginDb:result.marginDb,eligible:result.status==='within-model'&&result.marginDb!==null&&result.marginDb>=report.settings.marginReserveDb,ghostRiskIndex:result.extras?.ghostRiskIndex??null,reasons:result.reasons,distanceM:angles(device.position,sample.position).distance};
  };
  const before=evaluateCase(beforeDevice,beforePenalty),after=evaluateCase(afterDevice,afterPenalty),rank=(after.eligible&&!before.eligible?1e9:0)+Math.abs((after.marginDb??-1e6)-(before.marginDb??-1e6));
  candidates.push({sample,before,after,rank});
 }
 candidates.sort((a,b)=>b.rank-a.rank);const selected=candidates[0];
 sampleReview={planId:plan.id,action:action.action,beforeDeviceId:beforeDevice.id,afterDeviceId:afterDevice.id,beforeFrequency:action.before.frequencyGHz,afterFrequency:action.after.frequencyGHz,beforePosition:action.before.position,afterPosition:action.after.position,beforePenalty,afterPenalty,sampleId:selected.sample.id,...selected};
}

const spectrumRows=source.presetIds.map(id=>{const fact=EQUIPMENT_FACTS[id];return [id,fact.band??'非射频/不适用',fact.emissionGHz?.join('、')||'无',fact.receiveRangeGHz?.join('–')||fact.receiveDiscreteGHz?.join('、')||'无',fact.powerW??'未提供',fact.source];});
const channelRows=Object.entries(EQUIPMENT_CHANNELS_GHZ).filter(([id])=>source.presetIds.includes(id)).map(([id,channels])=>[id,channels.join('、'),'模型离散频道，非厂家频道声明']);
const emcImage=await embedImage('artifacts/task3/showcase/task3-emc.png');
const documentData={schema:'task3-emc-doc/1.0',source:{runId:source.runId,reportPath:'artifacts/task3/latest-report.json',runPath:source.runPath},plans:plans.map(({plan,remediation,emc})=>({id:plan.id,before:remediation.before,after:remediation.after,status:remediation.status,actions:remediation.actions,coverageReview:remediation.coverageReview,emcCounts:emc.counts})),conflictTypes,actionRows,coverageRows,finalConflictRows,sampleReview};
const body=`
<section id="spectrum"><h2>一、装备频谱事实与模型假设</h2><div class="notice">runId：${escapeHtml(source.runId)}。文档事实、模型频道与工程代理分栏展示；EMC 结果不是频谱合规认证。</div>${table(['装备','波段','发射 / GHz','接收 / GHz','功率 / W','来源'],spectrumRows)}<h3>优化器允许使用的离散频道</h3>${table(['装备','模型频道 / GHz','性质'],channelRows)}<div class="formula">设备对距离 = 三维欧氏距离；频差 = 双方发射频点最小 |Δf|
同频附加损耗（每台每对）= 6 × (1 − d / ${EMC_RULES.coChannelMinDistanceM}) dB
只有明确的发射机 → 接收机关系且处于工程耦合距离内才判 fail；光电/声学无射频互扰。</div></section>
<section id="dimensions"><h2>二、全部 EMC 考量维度</h2>${table(['维度','判定条件','严重度与后果','规避建议'],[['同频干扰',`双方均发射，Δf < ${EMC_RULES.coChannelSeparationGHz} GHz 且 d < ${EMC_RULES.coChannelMinDistanceM} m`,'fail；双方累积 penalty，进入感知重算','换频 ≥0.1 GHz 或拉距 ≥600 m'],['邻频干扰',`Δf < ${EMC_RULES.adjacentChannelGHz} GHz 且 d < ${EMC_RULES.adjacentMinDistanceM} m`,'warning；保留残余风险提示','拉距 ≥300 m 或换频'],['发射→接收耦合',`发射落入接收频段 ±0.02 GHz 且 d < ${EMC_RULES.receiverOverlapMinDistanceM} m`,'fail；按双向设备关系分别检查','换频或拉距至规定距离'],['前端阻塞',`发射功率 ≥ ${EMC_RULES.frontendBlockPowerW} W 且距无线电接收机 < ${EMC_RULES.frontendBlockDistanceM} m`,'warning；提示接收机前端风险','大功率雷达与无源接收机间距 ≥50 m'],['共址过密',`至少一方发射且 d < ${EMC_RULES.coSiteMinDistanceM} m`,'warning；安装过密提示','错开安装点位 ≥10 m']])}<p><code>src/task3/emc.js · emcAnalysis</code> 遍历全部无序设备对，并双向检查发射/接收关系；任何 fail 使方案不通过，仅 warning 为降额。</p></section>
<section id="strategy"><h2>三、优化阶段的自动规避策略</h2>${flowSvg([{title:'① 初始频道分配',detail:'同频冲突权重 ×10、邻频 ×1，逐台选择代价最低模型频道'},{title:'② 优先合法换频',detail:'只使用装备既有离散频道；每一步必须减少 fail，状态签名去重'},{title:'③ 真实候选点局部移位',detail:'换频无改进时，同型号同俯仰在既有候选点内替代，保留合法载频'},{title:'④ 动作排序',detail:'先 fail，再 warning，再覆盖损失和移动距离；不牺牲覆盖盲目换点'},{title:'⑤ 覆盖重算与评分回写',detail:'按实际载频/位置重算受影响设备；残余 fail 不隐藏并影响推荐排序'}],{title:'EMC 处置如何进入优化主流程'})}<div class="formula">移位搜索半径 ≤ ${EMC_RULES.relocationSearchRadiusM} m；单设备局部候选 ≤ ${EMC_RULES.maxRelocationCandidates} 个
fail 每例：综合得分 ×0.85（累计下限 0.7）；仅 warning：×0.97
推荐排序先比较是否存在未解决 fail，再比较回写后得分和成本。</div></section>
<section id="results"><h2>四、真实处置前后结果</h2>${groupedBarChart({title:'各方案 fail 级冲突：处置前 vs 处置后',rows:plans.map(({plan,remediation})=>({label:plan.name,values:[remediation.before.counts.fail,remediation.after.counts.fail]})),series:[{name:'处置前',color:'var(--bad)'},{name:'处置后',color:'var(--accent)'}],valueDigits:0})}${groupedBarChart({title:'各方案 warning：处置前 vs 处置后',rows:plans.map(({plan,remediation})=>({label:plan.name,values:[remediation.before.counts.warning,remediation.after.counts.warning]})),series:[{name:'处置前',color:'var(--warn)'},{name:'处置后',color:'var(--gold)'}],valueDigits:0})}${table(['方案','前 fail/warning','后 fail/warning','状态','动作数','未解决 fail'],plans.map(({plan,remediation})=>[plan.name,`${remediation.before.counts.fail} / ${remediation.before.counts.warning}`,`${remediation.after.counts.fail} / ${remediation.after.counts.warning}`,remediation.status,remediation.actions.length,remediation.unresolved.length]))}<h3>按冲突类型汇总</h3>${table(['冲突类型','处置前','处置后','变化'],conflictTypes.map(row=>[row.name,row.before,row.after,row.after-row.before]))}<h3>全部自动处置动作</h3>${actionRows.length?table(['方案','步','动作','设备','频道/站点变化','后东/北/高 / m','fail 变化','warning 变化','覆盖权重损失'],actionRows):'<div class="notice">本批次所有方案均无需自动处置，未生成换频或移位动作。</div>'}<h3>最终冲突与残余风险（完整清单）</h3>${finalConflictRows.length?table(['方案','设备对','类型','严重度','距离 / m','频差 / GHz','损耗 / dB','建议'],finalConflictRows):'<div class="notice">最终方案未发现设备间射频冲突。</div>'}</section>
<section id="detection"><h2>五、对探测失效、漏探与误探风险的作用</h2><div class="formula">环境同频损耗 = 原工况 cochannelDb + emc.penalties[deviceId]
覆盖成立 ⟺ status=within-model 且 marginDb ≥ ${report.settings.marginReserveDb} dB
因此，换频/移位只有经同一感知模型重算后，才能声称对漏探或覆盖产生实际改善。</div><h3>处置前后覆盖复核</h3>${coverageRows.length?table(['方案','工况','前覆盖','后覆盖','前覆盖率','后覆盖率','变化'],coverageRows):'<div class="notice">本批次没有需要前后对照的 fail 处置覆盖记录。</div>'}<h3>真实设备—采样点级复核</h3>${sampleReview?`<div class="box"><p>方案 <strong>${escapeHtml(sampleReview.planId)}</strong>，动作 ${escapeHtml(sampleReview.action)}；设备 ${escapeHtml(sampleReview.beforeDeviceId)} → ${escapeHtml(sampleReview.afterDeviceId)}，样本 ${escapeHtml(sampleReview.sampleId)}。该样本由“后覆盖且前未覆盖优先，其次裕量变化绝对值”自动选取，不是手写示例。</p>${table(['指标','处置前','处置后'],[['设备 ID',sampleReview.beforeDeviceId,sampleReview.afterDeviceId],['载频 / GHz',nullable(sampleReview.beforeFrequency,3),nullable(sampleReview.afterFrequency,3)],['同频 penalty / dB',nullable(sampleReview.beforePenalty,3),nullable(sampleReview.afterPenalty,3)],['设备—样本距离 / m',nullable(sampleReview.before.distanceM,2),nullable(sampleReview.after.distanceM,2)],['margin / dB',nullable(sampleReview.before.marginDb,3),nullable(sampleReview.after.marginDb,3)],['覆盖判定',sampleReview.before.eligible?'覆盖':'未覆盖',sampleReview.after.eligible?'覆盖':'未覆盖'],['ghostRiskIndex（风险代理）',nullable(sampleReview.before.ghostRiskIndex,4),nullable(sampleReview.after.ghostRiskIndex,4)],['判定原因',sampleReview.before.reasons.join('、')||'无',sampleReview.after.reasons.join('、')||'无']])}</div>`:'<div class="notice">本批次无自动处置动作，因此不构造“恢复探测”样本。</div>'}<div class="notice bad"><strong>误探证据边界：</strong>当前 EMC 代理没有实测虚警真值，不能给出真实误探率下降百分比。ghostRiskIndex 只用于说明干扰/多径驱动的重影风险代理；降低 penalty 不等于已经完成虚警认证。后续需注入标注目标与非目标样本，以虚警率、漏警率和混淆矩阵验收。</div></section>
<section id="validation"><h2>六、界面实测与评分回写</h2><figure><img src="${emcImage}" alt="当前电磁兼容界面"><figcaption>当前优化推演 EMC 界面：结论、设备冲突、距离、频差与处置建议。</figcaption></figure>${table(['方案','原始得分','EMC 因子','最终得分','排名','最终 EMC'],report.scoring.plans.map(row=>[row.name,nullable(row.scoreRaw??row.score,4),nullable(row.emcFactor??1,4),nullable(row.score,4),row.rank,verdictNames[row.emcVerdict]??row.emcVerdict]))}</section>
<section id="limits"><h2>七、残余风险与改进路径</h2>${table(['缺口','当前影响','可落地改进','验收指标'],[['天线方向图、调制、占空比缺失','无法做认证级耦合和时域互扰分析','接入厂家方向图/波形并替换五规则代理','与实测耦合损耗误差'],['谐波、互调、带外发射未建模','可能漏掉非共址干扰','增加发射谱模板和接收机选择性模型','干扰案例召回率'],['接收机动态范围未知','前端阻塞仅为功率/距离提示','实测 P1dB、阻塞门限和噪声系数','阻塞预测准确率'],['缺少误探真值','不能声称虚警率改善','建立含非目标的标注集并输出混淆矩阵','虚警率、漏警率、F1'],['施工与频谱合规未实测','可部署含义仅限模型','现场频谱扫描、电磁测试和合规审查','现场 fail/warning 复核一致率']])}</section>`;
const html=documentShell({title:'任务三 · 电磁兼容优化与验证',kicker:'创意科目二 · 子任务三 · EMC 真实处置批次',subtitle:'从同频/互扰识别，到换频、移位、覆盖重算和推荐排序的完整证据链',meta:`<span class="badge">runId ${escapeHtml(source.runId)}</span><span class="badge">${plans.length} 套方案</span><span class="badge">${actionRows.length} 步实际处置</span>`,toc:[['spectrum','频谱事实与假设'],['dimensions','全部考量维度'],['strategy','自动规避策略'],['results','处置前后结果'],['detection','探测影响与误探边界'],['validation','界面与评分验证'],['limits','风险与改进']].map(([id,label])=>({id,label})),body,data:documentData,dataId:'emc-doc-data'});
await writeFile('任务三电磁兼容优化与验证.html',html,'utf8');
console.log(JSON.stringify({output:'任务三电磁兼容优化与验证.html',runId:source.runId,actions:actionRows.length,conflicts:finalConflictRows.length,sampleReview:sampleReview?.sampleId??null},null,2));
