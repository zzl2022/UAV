// 正式明细版式：复用项目 A4、思源黑体和分级标题；使用连续排版与可分页表格。
export const DEVICE_DOCUMENT_STYLE={font:'NotoSansSC',body:10.5,table:8.5,title:22,heading:14,subheading:11,margin:[42,50,42,44]};
const INK='#1f2937',MUTED='#52616b',ACCENT='#0f766e',LINE='#cbd5dc';
const number=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'未提供';
const value=v=>v===null||v===undefined?'未提供':String(v);
const percent=v=>Number.isFinite(v)?`${(v*100).toFixed(2)}%`:'未提供';
const body=(text,extra={})=>({text,margin:[0,0,0,6],...extra});
const note=text=>body(text,{fontSize:8.5,color:MUTED});
const heading=(text,level=1)=>({text,headlineLevel:level,fontSize:level===1?14:11,bold:true,color:level===1?INK:ACCENT,margin:[0,level===1?16:10,0,6]});
function table(headers,rows,widths,fontSize=DEVICE_DOCUMENT_STYLE.table){
 return {margin:[0,2,0,8],table:{headerRows:1,dontBreakRows:true,widths,body:[headers.map(text=>({text,bold:true,color:INK})),...rows.map(row=>row.map(cell=>({text:value(cell)})))]},fontSize,lineHeight:1.15,
  layout:{hLineWidth:i=>i<2?.6:.3,hLineColor:()=>LINE,vLineWidth:()=>0,fillColor:i=>i===0?'#edf2f5':null,paddingTop:()=>4,paddingBottom:()=>4,paddingLeft:()=>5,paddingRight:()=>5}};
}
const coverageRow=c=>[c.name,c.coveredSamples===null?'未提供':c.coveredSamples,c.independentSamples===null?'未提供':c.independentSamples,c.totalSamples===null?'未提供':c.totalSamples];
const conditionNames={nominal:'基线',silent:'静默',weather:'雨雾噪声',interference:'电磁干扰'};

function buildContext(model){
 const c=model.context,s=c.settings,plan=c.plan,weights=c.weights;
 return [
  heading('一 文档用途与本次数据基线'),
  body(`本明细用于说明当前方案中已勾选设备“为什么放在该位置、如何经过优化进入方案、与其他型号和点位相比有哪些证据、还需完成哪些验证”。文档按问题、原理、参数、实际代入、判定和复核组织，逐台对应真实运行记录。`),
  body(`本次查看方案为“${model.planName}”，整套方案有 ${plan.deviceCount} 台设备，本文件展开其中 ${model.devices.length} 台。${plan.derived?'当前为移动补盲派生结果，原方案比较和威胁验证未对派生设备重算。':plan.recommended?'该方案为本轮参与比较的方案中的推荐结果。':'当前方案不一定是本轮推荐方案，需结合第三部分的实际排序理解。'}`),
  table(['记录项','本次取值'],[
   ['运行编号 / 方案',`${model.runId} / ${model.planId}`],['当前解读工况',model.conditionName],
   ['范围与采样',`东西 ${number(c.scope.widthM,0)} m × 南北 ${number(c.scope.depthM,0)} m；网格 ${value(s.spacing)} m；离地高度层 ${(s.heights??[]).join(' / ')||'未提供'} m；有效采样 ${value(c.sampleCount)} 个`],
   ['核心与候选',`核心半径 ${value(s.coreRadius)} m、核心权重 ${value(s.coreWeight)}；初始站点 ${value(c.siteCount)} 个，候选变体 ${value(c.candidateCount)} 个`],
   ['约束与成本',`本方案预算 ${value(plan.budget)}、设备上限 ${value(plan.maxDevices)}；最终成本 ${number(plan.cost,3)} 相对单位；禁部署源建筑 ${model.buildingExclusions.buildingIds.length} 个`],
   ['评分权重',`覆盖 ${value(weights.coverage)}；盲区 ${value(weights.blind)}；成本 ${value(weights.cost)}；施工 ${value(weights.feasibility)}`],
  ],[95,'*']),
  note(c.scope.note),
  heading('二 部署前置条件与优化原理'),
  ...model.prerequisites.map((text,i)=>body(`${i+1}. ${text}`)),
  heading('2.1 从输入到结果的八个环节',2),
  table(['环节','处理逻辑与本次证据'],model.workflow.map(row=>[`${row.step} ${row.name}`,`${row.description}\n${row.evidence}`]),[101,'*'],9),
  heading('2.2 收益 成本与评分的计算口径',2),
  body('本明细对应任务三的 JavaScript 部署推演链路。装备建模中光电与声学的 Python 资料基础评估是独立链路，本文不将 JavaScript 工程假设结果表述为 Python 实测或标定结论。'),
  ...model.methods.flatMap(([title,text])=>[body(`${title}：${text}`)]),
  body('解释顺序应先看实际入选时刻，再看最终贡献。先前未覆盖的位置在加入设备后产生新增收益；后续设备可能覆盖相同位置，因此入选增益、最终总覆盖、最终独立覆盖是三个不同量。'),
  heading('三 方案对比与当前方案的取舍'),
  ...(c.comparisons.length?[
   table(['排名与方案','设备数','覆盖指标','平均盲区','成本','综合分'],c.comparisons.map(row=>[`${value(row.rank)} ${row.name}${row.id===c.recommendedId?'（推荐）':''}`,row.deviceCount,percent(row.coverage),percent(row.blindRatio),number(row.cost,3),number(row.score,3)]),['*',35,56,56,48,44]),
   note('覆盖指标包含基线核心二重覆盖奖励，不能直接当作最弱工况覆盖率；平均盲区为离散采样比例，成本为相对单位。只生成一套方案时，归一化无法证明其优于未参与比较的方案。'),
   table(['方案','原始综合分','EMC 因子','严重 / 提示','施工代理'],c.comparisons.map(row=>[row.name,number(row.scoring?.scoreRaw,3),number(row.scoring?.emcFactor,3),row.emc?`${row.emc.fail} / ${row.emc.warning}`:'未提供',number(row.feasibility,3)]),['*',64,58,64,64]),
  ]:[body('当前历史报告没有保存多方案对比表，不能补写其他方案分值。应在方案生成中选择多套方案后重新运行。')]),
  heading('3.1 当前方案各工况的最终覆盖',2),
  table(['工况','覆盖 / 有效采样','覆盖率','核心覆盖','核心二重'],c.metrics.map(row=>[row.name??conditionNames[row.condition]??row.condition,`${value(row.covered)}/${value(row.total)}`,percent(row.coverageRate),percent(row.coreCoverageRate),percent(row.coreRedundantRate)]),['*',88,65,65,65]),
  ...(c.blindspots.length?[table(['工况','残余盲点','主要归因计数'],c.blindspots.map(row=>[conditionNames[row.conditionId]??row.conditionId,row.stats?.total,Object.entries(row.stats?.byCategory??{}).map(([key,count])=>`${({gap:'夹缝',corner:'边角',lowFacade:'贴楼',shadow:'背影',other:'其他'})[key]??key} ${count}`).join('；')]),[65,60,'*'])]:[]),
  ...(c.threats.length?[heading('3.2 动态威胁复核',2),table(['场景','目标数','平均检出占比','容量溢出目标'],c.threats.map(row=>[({single:'单机',multi:'多方向',swarm:'蜂群'})[row.key]??row.key,row.summary?.targetCount,percent(row.summary?.meanDetectedFraction),row.summary?.overflowedTargets]),['*',60,110,110]),note(c.plan.derived?'此表为原方案威胁结果；派生方案不能据此声称完成了新增设备后的动态验证。':'静态覆盖与动态逐帧检出是不同验证，容量溢出按本轮模型真实记录列出。')]:[]),
 ];
}

function buildDevice(device,index,model){
 const e=device.evidence,selection=device.selectionEvent,coverage=device.contributions,conditions=model.context.metrics;
 const sections=[
  heading(`4.${index+1} ${device.displayName} ${device.typeName} ${device.modelName}`,2),
  ...device.plain.filter((_,i)=>i!==4).map(text=>body(text)),
  heading(`4.${index+1}.1 该点位的优势与真实入选依据`,2),
  table(['坐标或安装项','本次设备记录'],[
   ['实际位置',`东 ${number(device.position[0],1)} m，北 ${number(-device.position[2],1)} m，上 ${number(device.position[1],1)} m`],
   ['站点与方式',`${device.siteName}；${device.site.installation??'未提供'}`],
   ['安装离地高度',e?.site?.aboveGroundM!==null&&e?.site?.aboveGroundM!==undefined?`${number(e.site.aboveGroundM,1)} m（由安装代理反推，非现场测量）`:device.mobile?`${value(device.site.mountHeightM)} m（车载模型挂载假设）`:'历史报告未提供，不能把上坐标直接当作离地高度'],
   ['实际朝向与频谱',`方位 ${value(device.parameters.heading)}°；俯仰 ${value(device.parameters.pitch)}°；${device.type==='radar'?`模型载频 ${value(device.parameters.frequencyGHz)} GHz`:device.type==='radio'?'无源接收，接收频带或离散频点按型号参数核查':'不适用射频载频（光电或声学感知）'}`],
  ],[101,'*']),
  ...(selection?[
   table(['真实事件','新增加权收益','相对成本','收益成本比','累计成本'],[[`第 ${selection.step} 步`,number(selection.gain,3),number(selection.cost,3),number(selection.gainPerCost,3),number(selection.cumulativeCost,3)]],[65,90,70,90,'*']),
   body(`本次代入：q = ${number(selection.gain,3)} / ${number(selection.cost,3)} = ${number(selection.gainPerCost,3)}。${e?.selection?`当时剩余预算为 ${number(e.selection.budgetRemainingBefore,3)}，满足预算且尚未入选的候选有 ${e.selection.eligibleCandidateCount} 个；全池最高比值为 ${number(e.selection.bestGainPerCost,3)}。`:'旧报告未保存当时全池候选快照，无法复核全池排序。'}`),
  ]:[body('本设备没有可用的普通选点事件。移动设备应查看移动补盲记录；历史固定设备应重新推演取得入选证据。')]),
  ...device.technical.filter(text=>!['部署依据采用','本设备模型坐标','真实入选发生','本步加入前'].some(prefix=>text.startsWith(prefix))).map(text=>body(text)),
  heading(`4.${index+1}.2 为什么未在同一点换用其他设备`,2),
  ...(device.alternatives.length?[
   table(['型号与俯仰','本步增益','成本','增益成本比','本步判读'],device.alternatives.map(row=>[`${row.modelName}\n俯仰 ${value(row.pitch)}°`,number(row.gain,2),number(row.cost,3),number(row.gainPerCost,3),row.reason]),['*',50,48,65,118]),
   note(e?.migration?.length?'上表对应移位前设备实际入选时刻；最终点位由 EMC 迁移产生，不能混为同一点的贪心比较。':'上表为同点位型号与姿态的实际候选比较。表中“未入选”仅针对该步，候选可能在其他步骤或其他点位入选。'),
  ]:[body('没有保留同点位候选比较数值。本文只列已知的策略和装备选择约束，不补写未经计算的替代性能。')]),
  table(['类型','本轮参与与取舍原因'],device.typeChoices.map(row=>[row.name,`${row.configured.length?`已配置：${row.configured.join('、')}。`:''}${row.reason}`]),[55,'*']),
  heading(`4.${index+1}.3 附近同型备选点的证据边界`,2),
  ...(e?.otherSites?.length?[
   table(['附近备选站点','平面距离','相对成本','四工况候选覆盖数'],e.otherSites.map(row=>[`${row.siteName??row.siteId}\n俯仰 ${value(row.pitch)}°`,`${number(row.distanceM,1)} m`,number(row.cost,3),row.coveredSamples.map(c=>`${conditionNames[c.condition]??c.condition} ${c.covered}/${c.total}`).join('；')]),['*',64,64,180]),
   note('附近备选按相同型号和俯仰、不同站点筛选，按与当前点的距离列出，数值来自 EMC 最终复核前的候选矩阵。没有执行“替换该设备后整套方案重优化”的反事实计算，不能仅凭单台总覆盖数断言哪个点位更优。'),
  ]:[body('当前未保留符合相同型号、相同俯仰要求的其他站点比较值，不能补写附近选址的优劣结论。')]),
  heading(`4.${index+1}.4 最终覆盖贡献与电磁复核`,2),
  table(['工况','本设备覆盖','仅本设备覆盖','有效采样总数'],coverage.map(coverageRow),['*',88,100,100]),
  note('覆盖总数可能与其他设备重叠；独立覆盖只描述最终固定矩阵中的唯一覆盖。若实际删除、换型或迁移，需重新计算整个组合。'),
  body(device.modelPrinciple??'此明细快照未保留型号原理说明，请通过当前版本重新生成解释文件。',{fontSize:9}),
  ...buildLinkExamples(device,model.conditionId,model.context.plan.derived),
  ...(device.conflicts.length?[table(['涉及的另一设备','规则','严重度','间距 / m','处置建议'],device.conflicts.map(row=>[row.peerName??row.a+' / '+row.b,row.kindName,row.severity==='fail'?'严重':'提示',number(row.distanceM,1),row.recommendation??'未提供']),[72,72,40,56,'*'])]:[body(model.context.emc?'当前规则未发现涉及本设备的电磁冲突；这不等于现场频谱和施工条件已经通过认证。':'本轮没有提供设备电磁兼容结果，不能填写“通过”。')]),
  heading(`4.${index+1}.5 全部实际参数与来源`,2),
  body('以下列出本轮实际使用的感知与物理链路参数。参数定义来自项目装备模型；“文档”表示预设来源，用户保存的快照与优化输出共同决定本次最终数值。工程假设需要后续标定。'),
 ];
 for(const group of [...new Set(device.parameterRows.map(row=>row.group))]){
  sections.push(body(`${group}参数`,{bold:true,color:ACCENT}),table(['参数','实际取值','单位','来源口径'],device.parameterRows.filter(row=>row.group===group).map(row=>[row.label,row.value,row.unit||'无量纲',row.source.replace('本轮装备快照；预设来源：','快照 / ').replace('本轮物理链路快照；工程假设须标定','链路快照 / 工程假设')]),[132,70,52,'*']));
 }
 if(!conditions.length)sections.push(note('缺少整套方案的工况指标，单台贡献不能替代方案验收。'));
 sections.push(note(`追溯标识：${model.runId}；方案 ${model.planId}；设备 ${device.id}。${device.references.join('。')}`));
 return sections;
}

function buildLinkExamples(device,conditionId,derived){
 const examples=(device.linkExamples??[]).filter(row=>row.condition===conditionId);
 if(derived)return [note('移动补盲后已重算上表最终覆盖贡献；原固定方案的逐点链路示例不沿用，以免将旧干扰条件下的数值当作派生方案的实判。')];
 if(!examples.length)return [note('本设备未保留当前工况的逐采样链路证据；不能从覆盖汇总反推信噪比或具体遮挡原因。重新生成方案后可查看实际判定代入。')];
 return [body('当前工况的实际链路判定示例',{bold:true,color:ACCENT}),
  ...examples.flatMap(row=>{
   const threshold=row.extras?.requiredSnrDb??device.parameters.thresholdDb;
   const criterion=device.type==='optical'?`有效像素 ${number(row.extras?.effectivePixels,2)} / 识别门槛 ${value(row.extras?.recognitionThresholdPixels)}，裕量 = 20 log10(比值) = ${number(row.marginDb,2)} dB`:
    Number.isFinite(row.snrDb)&&Number.isFinite(threshold)?`裕量 = 信噪比 ${number(row.snrDb,2)} − 门槛 ${number(threshold,2)} = ${number(row.marginDb,2)} dB`:'目标静默或频段不符，本次不形成有效无线电链路，信噪比与裕量不输出';
   return [body(`采样 ${row.sampleId}（${row.core?'核心区':'外围'}，三维距离 ${number(row.geometry?.distance,1)} m）：${criterion}；要求裕量 ≥ ${value(row.marginReserveDb)} dB。`,{fontSize:9}),
    body(`几何数据${row.geometry?.known?'有效':'不足'}，${row.geometry?.blocked?'存在实体遮挡':'未报告实体遮挡'}，穿越建筑 ${value(row.geometry?.buildingCount)} 个；附加 EMC 损耗 ${number(row.emcPenaltyDb,2)} dB。实际判定：${row.covered?'计入覆盖':'不计入覆盖'}。${row.reasons?.length?`失效原因：${row.reasons.join('；')}。`:Number.isFinite(row.marginDb)&&row.marginDb<row.marginReserveDb?'模型条件成立，但没有达到本轮预留裕量。':'模型状态与本轮覆盖裕量均满足。'}`,{fontSize:9})];
  }),note('示例优先取核心区的一个覆盖点和一个未覆盖点；只有一种结果时只列实际存在项，不代表该设备全部采样分布。信噪比、像素和损耗均为本轮模型计算值。')];
}

export function buildDeviceExplanationDocument(model){
 if(!model?.context||!model?.devices?.length)throw Error('明细缺少完整上下文，请使用当前版本重新生成方案并导出');
 const timestamp=new Date(model.generatedAt),time=Number.isNaN(timestamp.getTime())?model.generatedAt:timestamp.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 const content=[
  {text:'设备部署解释明细',fontSize:22,bold:true,color:INK,margin:[0,0,0,8]},
  body('反无装备优化部署与仿真推演平台  技术论证与操作验收',{fontSize:11,color:ACCENT}),
  note(`运行 ${model.runId}  |  方案 ${model.planName}\n解读工况 ${model.conditionName}  |  生成时间 ${time}（北京时间）`),
  ...buildContext(model),heading('四 已勾选设备的逐台部署证据'),
  ...model.devices.flatMap((device,index)=>buildDevice(device,index,model)),
  heading('五 分步操作 参数配置与异常处理'),
  table(['操作阶段','平台内操作与复核要点'],model.operations,[89,'*'],9),
  heading('5.1 本轮目标与环境参数',2),
  model.context.target.length?table(['目标参数','本轮取值','单位'],model.context.target.map(row=>[row.label,row.value,row.unit||'无量纲']),['*',175,80]):body('本轮未提供目标参数快照。'),
  model.context.environment.length?table(['环境参数','本轮取值','单位'],model.context.environment.map(row=>[row.label,row.value,row.unit||'无量纲']),['*',175,80]):body('本轮未提供环境参数快照。'),
  heading('5.2 异常处置与重新计算要求',2),table(['异常或不满足项','处理办法'],model.exceptions,[105,'*'],9),
  heading('六 验证验收与复现依据'),table(['验收项','标准与本轮记录'],model.acceptance.map(row=>[row.item,`${row.standard}\n本轮记录：${row.result}`]),[90,'*'],9),
  heading('6.1 复核方法与数据来源',2),
  body('复现时应使用同一地图与数据版本、同一已保存装备快照、相同环境目标和方案约束，重新执行方案生成。先核对采样数、候选数和方案策略，再逐项复核本文件的入选事件、候选取舍、最终贡献及电磁处置，不能将历史示例批次的数值代入本轮结论。'),
  body(`本轮输入来源：${Object.keys(model.context.inputHashes).length?Object.entries(model.context.inputHashes).map(([key,hash])=>`${key}：${hash}`).join('；'):'报告未提供源数据哈希，应补充留存输入版本。'}`,{fontSize:8.5,color:MUTED}),
  heading('6.2 适用范围与必要限制',2),...model.limitations.map(text=>body(text)),
 ];
 return {pageSize:'A4',pageMargins:DEVICE_DOCUMENT_STYLE.margin,defaultStyle:{font:DEVICE_DOCUMENT_STYLE.font,fontSize:DEVICE_DOCUMENT_STYLE.body,color:INK,lineHeight:1.25},info:{title:'设备部署解释明细',subject:`${model.planName} ${model.runId}`,author:'反无装备优化部署与仿真推演平台'},
  header:()=>({text:'反无装备优化部署与仿真推演平台  /  设备部署解释明细',fontSize:8.5,color:MUTED,margin:[42,21,42,0]}),
  footer:(page,total)=>({text:`第 ${page} / ${total} 页`,alignment:'center',fontSize:8.5,color:MUTED,margin:[0,16,0,0]}),
  pageBreakBefore:(node,container)=>!!node.headlineLevel&&container.getFollowingNodesOnPage().length===0,content};
}
