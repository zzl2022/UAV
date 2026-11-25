import {createDeviceDisplayMap} from './device-display.js';
import {EQUIPMENT_FACTS,EMC_RULES} from './constants.js';
import {fieldsFor,PRESETS,ENV_FIELDS,TARGET_FIELDS,TYPES} from '../sensors/presets.js';
import {PHYSICS_FIELDS} from '../sensors/physics.js';

const TASKS={radar:'主动发射并接收回波，承担目标发现与跟踪，并在无线电静默工况下提供补充覆盖',radio:'接收目标发射的无线电信号，以较低相对成本形成较大范围的感知覆盖',optical:'通过可见光或热成像补充方向性观察，结合视场、像素和光照条件核验目标',acoustic:'通过声音传播与声压裕量判定补充近距离感知，重点核查距离、噪声和频带条件'};
const PHASES={greedy:'首轮贪心选点',refill:'反向删点后的再次补选',redundancy:'二重覆盖增强', 'reverse-delete':'反向冗余删除'};
const EMC_NAMES={'co-channel':'同频干扰','adjacent-channel':'邻频提示','receiver-overlap':'发射落入接收频带','frontend-block':'接收前端阻塞','co-site':'同点位过密'};
const finite=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'未提供';
const text=v=>v===null||v===undefined?'未提供':typeof v==='boolean'?v?'是':'否':typeof v==='object'?JSON.stringify(v):String(v);
const percentage=v=>Number.isFinite(v)?`${(v*100).toFixed(2)}%`:'未提供';
const clone=v=>structuredClone(v);
const sensorPrinciple=device=>device.type==='radar'?(device.physics?
 '本设备采用脉冲能量雷达方程：线性信噪比正比于峰值功率×脉宽×收发线性增益×波长平方×目标 RCS×积累脉冲数，反比于 (4π)³×距离四次方×k×290 K×噪声及系统线性损耗。再扣除雨、云雾、杂波、多径、立面反射与电磁损耗；近距盲区还由脉宽和收发切换时间共同决定。':
 '本设备未保存物理链路参数，采用参考距离/RCS 的相对裕量模型：距离项按 40 log10(参考距离/实际距离) 变化，再叠加参考信噪比、阈值和环境损耗；不得写成已使用发射功率的能量方程。'):
 device.type==='radio'?(device.physics?
 '本设备采用接收功率预算：接收功率=目标 EIRP+接收增益−馈线损耗−自由空间损耗−场景损耗；噪声功率=−174+噪声系数+10 log10(带宽 Hz)。信噪比再加入由参考距离和参考波形反推的处理增益；该增益是模型校准量，并非厂商实测值。检出门槛由本轮假设的 Pd/Pfa 计算；跳频时另受观测窗口限制。':
 '本设备未保存物理链路参数，采用参考距离、目标 EIRP、路径损耗指数及环境损耗的相对信噪比模型；目标静默或信号不在接收频带时不计覆盖。'):
 device.type==='optical'?'本设备按瞬时视场计算目标像素：像素数=图像宽度×目标尺寸/[2×距离×tan(水平视场/2)]；再乘雨雾衰减与可见光照度或热对比系数，裕量=20 log10(有效像素/识别像素门槛)。建筑/地形遮挡、视场外目标和可见光照度不足可直接使判定失效。':
 '本设备按声级预算计算：接收声级=目标 1 m 声级−几何扩散−空气吸收−穿透/绕射−多径及折射等损耗；交通、施工、人群、风雨与参考噪声按能量相加，不直接相加分贝。信噪比为接收声级减合成噪声，还需检查输入声压上下限、视场与模型阈值。';

function parameterRows(device){
 const preset=PRESETS.find(p=>p.id===device.presetId),definitions=fieldsFor(device.type),rows=[];
 for(const [group,values,fields] of [['感知模型',device.parameters,definitions],['物理链路',device.physics,PHYSICS_FIELDS[device.type]??{}]]){
  for(const [key,value] of Object.entries(values??{})){
   const field=fields[key],optimization=group==='感知模型'&&['heading','pitch','frequencyGHz'].includes(key);
   rows.push({key:`${group==='感知模型'?'parameters':'physics'}.${key}`,label:field?.label??`扩展参数 ${key}`,value:text(value),unit:field?.unit??'',group,
    source:optimization?'本轮布设优化输出':group==='物理链路'?'本轮物理链路快照；工程假设须标定':preset?.parameters?.[key]!==undefined&&preset.parameters[key]!==value?'快照与预设有差异，需核对保存记录':`本轮装备快照；预设来源：${preset?.provenance?.[key]??field?.source??'未提供'}`});
  }
 }
 return rows;
}

function alternativeReason(row,event){
 if(row.selectedAtThisStep)return '本步实际入选';
 if(!row.allowed)return '不在本方案允许型号集合';
 if(row.alreadySelected)return '此前已入选，不重复部署';
 if(row.budgetFits===false)return '按本步剩余预算不可加入';
 if(row.gain===0)return '本步无新增覆盖或冗余收益';
 if(Number.isFinite(row.gainPerCost)&&Number.isFinite(event?.gainPerCost))return row.gainPerCost<event.gainPerCost-1e-9?'本步增益成本比低于入选候选':Math.abs(row.gainPerCost-event.gainPerCost)<1e-9?'本步比值并列，按既有候选顺序处理':'本步比值较高，需结合全池约束复核';
 return '仅保留候选预评估，缺少本步边际比较';
}

export function createDeviceExplanation({report,run,activePlanId,conditionId='nominal',deviceIds,generatedAt=new Date().toISOString()}){
 const plan=report?.plans?.find(p=>p.id===activePlanId);
 if(!plan||!run?.runId)throw Error('缺少有效方案或运行记录，请重新生成方案');
 if(!Array.isArray(deviceIds)||!deviceIds.length)throw Error('请至少勾选一台设备');
 const selected=new Set(deviceIds);if([...selected].some(id=>!plan.devices.some(d=>d.id===id)))throw Error('已勾选设备不属于当前方案，请重新选择');
 const condition=report.conditions.find(c=>c.id===conditionId);if(!condition)throw Error('当前工况不在方案中');
 const display=createDeviceDisplayMap(plan.devices),core=report.sampling.bounds.core,settings=report.settings,emc=report.emc?.[plan.id],derived=!!plan.derivation;
 const devices=plan.devices.flatMap((device,index)=>{
  if(!selected.has(device.id))return [];
  const entry=display.details(device.id),site=plan.sites?.[index]??device.deployment??{},mobile=device.mobileRepair?.platform==='police-car',facts=EQUIPMENT_FACTS[device.presetId];
  const evidence=plan.decisionEvidence?.[device.id]??run.decisionEvidence?.[plan.id]?.[device.id]??null,selection=evidence?.selection,event=selection?.event??plan.optimizationTrace?.events?.filter(e=>e.type==='select'&&e.deviceId===device.id).at(-1)??null;
  const distance=Math.hypot(device.position[0]-core[0],device.position[2]-core[2]);
  const contributions=report.conditions.map(c=>{
   const row=plan.coverageContributions?.[device.id]?.find(r=>r.condition===c.id),metric=plan.metrics.find(m=>m.condition===c.id);
   return {condition:c.id,name:c.name,coveredSamples:row?.coveredSamples??null,independentSamples:row?.independentSamples??null,totalSamples:metric?.total??null};
  });
  const current=contributions.find(c=>c.condition===conditionId),conflicts=emc?.conflicts?.filter(c=>c.a===device.id||c.b===device.id)??[];
  const actionIds=new Set([device.id,evidence?.originDeviceId]);
  const actions=(plan.emcRemediation?.actions??[]).filter(a=>actionIds.has(a.deviceId)||a.replacementDeviceId===device.id);
  const mobileAction=plan.derivation?.selected?.find(a=>a.deviceId===device.id),independent=contributions.filter(c=>Number.isFinite(c.independentSamples));
  const strongest=independent.length?[...independent].sort((a,b)=>b.independentSamples-a.independentSamples)[0]:null;
  const technical=[
   `部署依据采用“实际场景与安装表面—型号及姿态候选—四工况覆盖矩阵—边际收益与成本选择—电磁处置—最终覆盖复核”的完整计算链。点位名称为${site.name??'未提供'}，安装方式为${site.installation??'未提供'}。`,
   `本设备模型坐标为东 ${finite(device.position[0],1)} m、北 ${finite(-device.position[2],1)} m、上 ${finite(device.position[1],1)} m；距核心中心 ${finite(distance,1)} m。上坐标是当前局部模型竖直坐标，不能直接当作设备离地高度。`,
   `覆盖成立条件为模型状态满足 within-model 且裕量不小于 ${text(settings.marginReserveDb)} dB；距离、视场、建筑与地形、目标特征和环境损耗共同参与判定，不能用标称半径替代。`,
   `电磁兼容复核${emc?`记录涉及本设备的严重冲突 ${conflicts.filter(c=>c.severity==='fail').length} 项、提示 ${conflicts.filter(c=>c.severity==='warning').length} 项`:'结果未提供'}；最终贡献统计使用处置后的实际位置、载频与干扰损耗。`,
  ];
  if(event)technical.push(`真实入选发生在第 ${event.step} 个事件，阶段为${PHASES[event.phase]??event.phase}：新增加权收益 ${finite(event.gain)}，相对成本 ${finite(event.cost,3)}，收益成本比 ${finite(event.gainPerCost,3)}，入选后累计成本 ${finite(event.cumulativeCost,3)}。收益是多工况加权矩阵项，不是新增建筑数或实际面积。`);
  else technical.push(mobile?'该设备属于后加移动补盲，选入依据以移动搜索和实际消除盲点记录为准。':'当前历史报告未保留该设备的真实入选事件，不能据最终坐标反推选入步次或边际收益；请按当前版本重新生成方案。');
  if(selection)technical.push(`本步加入前剩余预算 ${finite(selection.budgetRemainingBefore,3)}，全池有 ${selection.eligibleCandidateCount} 个满足预算且尚未入选的候选，全池最高收益成本比为 ${finite(selection.bestGainPerCost,3)}。同点位型号与姿态对比见本设备的候选比较表。`);
  if(Number.isFinite(settings.costs?.[device.type])&&Number.isFinite(site.installationProxy))technical.push(`本设备相对成本代入：${finite(settings.costs[device.type],3)} + 0.2 × ${finite(site.installationProxy,3)} = ${finite(settings.costs[device.type]+0.2*site.installationProxy,3)}；后一项为安装代理，不是实测施工报价。`);
  if(facts?.source)technical.push(`型号资料口径：${facts.source}。实际模型载频和姿态以本次参数表为准；资料中的初始模型频点不得覆盖优化后的实际输出。`);
  if(mobileAction)technical.push(`移动搜索阶段为 ${mobileAction.searchPhase==='fine-grid'?'25 m 细网格搜索':'粗圆环搜索'}，以盲点 ${mobileAction.anchorSampleId??'未提供'} 为锚点，本设备新增覆盖 ${mobileAction.newlyCoveredSampleIds?.length??0} 个启动补盲工况盲点；挂载高度 ${text(mobileAction.mountHeightM)} m 为模型假设，道路可达性未验证。`);
  for(const action of actions)technical.push(`电磁处置第 ${action.step} 步执行${action.action==='retune'?'换频':'局部移位'}：${action.reason??'原因未提供'}；频点 ${text(action.before?.frequencyGHz)} → ${text(action.after?.frequencyGHz)} GHz，严重冲突 ${text(action.before?.emcCounts?.fail)} → ${text(action.after?.emcCounts?.fail)} 项。`);
  const plain=[
   `本设备选择的是${entry.modelName}，主要任务为${TASKS[device.type]??'参与本次场景感知'}。`,
   `${distance<=settings.coreRadius?'该点位处于核心权重区内，覆盖核心采样点可获得更高优化收益':'该点位处于核心权重区外，可用来补充外围观察方向'}；这只解释其空间角色，最终选址仍由同一步的实际覆盖增益、成本和约束共同决定。`,
   current?.coveredSamples===null?'该设备的逐项覆盖贡献未提供，无法判断它在当前工况下具体负责多少采样位置。':`在“${condition.name}”下，该设备覆盖 ${current.coveredSamples} 个检查位置，其中 ${current.independentSamples} 个在当前矩阵中仅由本设备覆盖，其余为重叠观察位置。检查位置是空域采样点，不等于建筑数量。`,
   current?.coveredSamples===0?'当前工况没有达到模型覆盖门槛的采样点，不能声称本设备已消除本工况盲区。':strongest?`从全部工况看，“${strongest.name}”有 ${strongest.independentSamples} 个位置仅由本设备覆盖；应连同其他工况判断价值，不能只凭当前工况的单一数值删减设备。`:'缺少跨工况独立贡献，不能判断删减该设备后的覆盖变化。',
   event?`它并非因为“型号更高级”就被放在这里，而是在${PHASES[event.phase]??event.phase}的第 ${event.step} 步，以当时的新增收益与成本比进入当前组合。后续设备加入可能产生重叠，所以最终独立覆盖数与入选时新增收益并不相等。`:'当前报告没有完整入选证据，对“为什么没有换另一台设备”只能依据已保留的条件说明，不能给出未经计算的优劣结论。',
   device.type==='radio'?'目标不发射无线电信号时，无线电侦测可能失去覆盖；静默场景应由其他感知类型补位。':device.type==='optical'?'光电需要同时满足视场、目标像素和光照条件；云台可转动不代表一个时刻能观察整个方向范围。':device.type==='acoustic'?'声学有效范围受目标声源和街道噪声影响，标称声级能力不是无人机检出的现场保证。':'雷达在本模型中仍受近距盲区、俯仰视场、遮挡和干扰制约；安装越高并不自动意味着效果越好。',
  ];
  const alternatives=(selection?.sameSiteAlternatives??evidence?.finalSiteAlternatives??[]).map(row=>({...clone(row),modelName:PRESETS.find(p=>p.id===row.presetId)?.name??row.name??row.presetId,reason:alternativeReason(row,event)}));
  const typeChoices=['radar','radio','optical','acoustic'].map(type=>{
   const configured=(report.equipment??[]).filter(e=>e.type===type),available=configured.filter(e=>(plan.presetSubset??[]).includes(e.id)),rows=alternatives.filter(a=>a.type===type),typeCount=plan.devices.filter(d=>d.type===type).length;
   let reason;
   if(mobile&&type!=='radar')reason='当前移动补盲实现只搜索已选雷达型号，其他类型未进入车载候选；这不是对其实际车载能力的否定。';
   else if(!report.equipment)reason='历史报告缺少本轮装备选型快照，无法判断是否参与候选生成。';
   else if(!configured.length)reason='本轮未选择该类型型号，没有进入候选生成，不能解释为性能不合格。';
   else if(!available.length&&plan.presetSubset)reason='本轮已配置，但当前方案策略未纳入其型号；属于策略限制。';
   else if(rows.length)reason=`同点位存在 ${rows.length} 个型号或姿态候选；${typeCount?`当前整套方案已部署该类型 ${typeCount} 台，未在本点入选不代表完全不用。`:'当前整套方案未部署该类型，应结合本步候选收益与成本判断。'}`;
   else reason='本报告没有保存该类型在本点的候选比较值，不能断言其被遮挡、成本更高或效果更差。';
   return {type,name:TYPES[type],configured:configured.map(e=>e.name??e.id),reason};
  });
  return [{id:device.id,...entry,position:[...device.position],siteName:site.name??'未提供',site:clone(site),mobile,parameters:clone(device.parameters??{}),physics:clone(device.physics??{}),modelPrinciple:sensorPrinciple(device),parameterRows:parameterRows(device),linkExamples:clone(derived?[]:plan.linkExamples?.[device.id]??run.linkExamples?.[plan.id]?.[device.id]??[]),contributions,technical,plain,conflicts:clone(conflicts).map(c=>({...c,kindName:EMC_NAMES[c.kind]??c.kind,peerName:display.nameOf(c.a===device.id?c.b:c.a)})),evidence:clone(evidence),selectionEvent:clone(event),alternatives,typeChoices,
   advantages:[`${distance<=settings.coreRadius?'核心区内':'核心区外'}的空间角色已由实际坐标确定，距核心中心 ${finite(distance,1)} m。`,event?`本轮选择记录给出收益成本比 ${finite(event.gainPerCost,3)}，能够追溯到具体事件和预算。`:'历史记录未提供选址收益比，应重新推演取得完整依据。',strongest?`“${strongest.name}”下独立覆盖 ${strongest.independentSamples} 个采样，为该设备在当前组合中的作用提供证据。`:'独立覆盖证据未提供。',emc?`最终涉及本设备严重冲突 ${conflicts.filter(c=>c.severity==='fail').length} 项；${conflicts.length?'仍需处理表列提示和限制':'当前代理规则未发现涉及该设备的冲突'}。`:'缺少电磁兼容复核结果。'],
   references:[`报告 plans[${plan.id}].devices[${device.id}] / sites[${index}]`,`最终覆盖：coverageContributions[${device.id}]；入选事件：optimizationTrace.events；替代候选：decisionEvidence[${device.id}]`]}];
 });
 const rows=report.comparison?.rows??[],scoreRows=report.scoring?.plans??[],metrics=plan.metrics??[];
 const scope=report.scope??report.sampling.dataCoverage??{};
 const context={scope:{widthM:scope.widthM??settings.scopeWidthM,depthM:scope.depthM??settings.scopeDepthM,clipped:!!scope.clipped,note:scope.note??'仅统计有效场景数据内的离散采样。'},settings:clone(settings),sampleCount:report.sampling.samples?.length??metrics[0]?.total??null,candidateCount:report.candidateCount??null,siteCount:report.siteCount??null,coreSampleCount:report.sampling.samples?report.sampling.samples.filter(p=>p.core).length:null,
  equipment:clone(report.equipment??[]),environment:Object.entries(report.environment??{}).map(([key,value])=>({key,label:ENV_FIELDS[key]?.label??key,value:text(value),unit:ENV_FIELDS[key]?.unit??''})),target:Object.entries(report.target??{}).filter(([key])=>key!=='position').map(([key,value])=>({key,label:TARGET_FIELDS[key]?.label??({emitting:'目标无线电发射',opticalMode:'光电观察模式',acousticFrequencyHz:'目标声学频率',fhss:'跳频信号'})[key]??key,value:key==='opticalMode'?({wide:'广角可见光',narrow:'长焦可见光',thermal:'热成像'})[value]??text(value):text(value),unit:TARGET_FIELDS[key]?.unit??(key==='acousticFrequencyHz'?'Hz':'')})),weights:clone(report.weights??report.comparison?.weights??{}),
  recommendedId:report.recommendedId,plan:{id:plan.id,name:plan.name,deviceCount:plan.devices.length,cost:plan.cost,budget:plan.budget??plan.optimizationTrace?.policy?.budget??null,maxDevices:plan.maxDevices??plan.optimizationTrace?.policy?.maxDevices??null,presetSubset:clone(plan.presetSubset??[]),redundancy:plan.optimizationTrace?.policy?.redundancy??null,recommended:report.recommendedId===plan.id,derived,deployable:plan.deployable??null},
  comparisons:rows.map(row=>({...clone(row),scoring:clone(scoreRows.find(s=>s.id===row.id)??null),emc:clone(report.emc?.[row.id]?.counts??null)})),metrics:clone(metrics),
  optimization:{events:clone(plan.optimizationTrace?.events??[]),poolSize:plan.optimizationTrace?.poolSize??null,selectCount:plan.optimizationTrace?.events?.filter(e=>e.type==='select').length??null,deleteCount:plan.optimizationTrace?.events?.filter(e=>e.type==='delete').length??null},
  emc:emc?{verdict:emc.verdict,counts:clone(emc.counts),remediation:clone(emc.remediation??plan.emcRemediation??null)}:null,
  blindspots:(report.blindspots?.[plan.id]??[]).map(row=>({conditionId:row.conditionId,stats:clone(row.stats)})),
  threats:Object.entries(report.threatsByPlan?.[plan.id]??{}).map(([key,value])=>({key,summary:clone(value.summary),text:value.text})),derivation:clone(plan.derivation??null),inputHashes:clone(report.inputHashes??run.inputHashes??{}),reportCreatedAt:report.createdAt??null};
 const prerequisites=[
  '核对当前地图、核心防护目标和建筑/地形数据版本，确认目标区域落在有效 GIS/DEM 范围；缺少数据时先补齐场景，不能外推无数据区域。',
  '在装备建模中保存拟参与优化的型号、感知参数和物理链路参数，确认文档事实、工程假设和用户设置的来源；未选择的型号不会自动参加优化。',
  '确认范围、网格、高度层、预算、设备数上限、四指标权重和威胁输入；成本为相对单位，权重应非负且合计为 1。',
  '在建筑权重中标出禁部署建筑，并核对真实几何连通单元；修改选择后旧方案失效，必须重新生成。',
  '模型点位用于方案论证。实际施工前另行核查产权许可、承重、供电、通信、雷击防护、安装净空及频谱条件；车载点另核查道路可达和停车条件。'];
 const workflow=[
  {step:'1',name:'场景与输入冻结',description:'加载当前地图和已保存装备参数，形成独立请求快照，登记范围、约束、环境、目标及数据版本。',evidence:`本次运行编号 ${run.runId}；有效采样 ${context.sampleCount} 个。`},
  {step:'2',name:'有效空域与候选生成',description:'采样排除建筑内部与 DEM 空缺；候选从真实安装表面产生，先排除禁部署区域，再按网格保留高低建筑、组合型号与姿态。',evidence:`初始站点 ${text(context.siteCount)} 个，含补点的候选变体 ${text(context.candidateCount)} 个；屋顶安装表面上方 2 m 为当前模型约定。`},
  {step:'3',name:'逐候选四工况实判',description:'先检查距离和视场，再查询建筑、地形及数据有效性，计算环境下的感知裕量。未覆盖采样从邻近表面补点，不放宽建筑硬约束。',evidence:`覆盖门槛 ${text(settings.marginReserveDb)} dB；四工况采用同一感知判定内核。`},
  {step:'4',name:'选择 删除 再补选与增强',description:'在各方案类型池、预算和数量上限内比较新增加权收益/成本；反向删除冗余候选，再次补选。增强型追加二重覆盖收益。',evidence:`当前方案记录选择 ${text(context.optimization.selectCount)} 次、删除 ${text(context.optimization.deleteCount)} 次；最终设备 ${plan.devices.length} 台。`},
  {step:'5',name:'电磁换频 移位与覆盖复核',description:'先分配模型频道，再处理同频、邻频、接收耦合、前端阻塞和共址问题；只接受减少严重冲突的处置，并按最终位置与载频重算覆盖。',evidence:emc?`最终严重 ${emc.counts?.fail??0} 项，提示 ${emc.counts?.warning??0} 项；残余严重冲突不得签为可部署。`:'本报告未提供电磁结论。'},
  {step:'6',name:'盲区归因与多方案择优',description:'对未覆盖采样归因，计算最弱工况覆盖、平均盲区、相对成本和施工代理，跨方案归一化后加权，并回写 EMC 降权与可部署优先序。',evidence:`当前方案${context.plan.recommended?'为本轮推荐方案':'为当前查看方案，未必是推荐方案'}；派生补盲不重排原方案名次。`},
  {step:'7',name:'动态威胁与可选移动补盲',description:'逐帧验证单机、多方向和蜂群入侵并记录容量溢出。警车补盲另做当前盲点粗搜、必要时细搜，选择后重算全工况贡献与 EMC。',evidence:derived?'本报告为移动补盲派生方案；原威胁和排名未对新增设备重算。':'当前为固定点位方案；移动部署须以实际启用后的派生记录为依据。'},
  {step:'8',name:'勾选导出与逐项验收',description:'勾选需解释的设备，导出冻结快照，复核设备身份、点位、过程事件、替代比较、覆盖贡献和异常处置，保留运行编号以便复现。',evidence:`本文件仅逐台展开已勾选的 ${devices.length} 台设备；方案对比仍保留本轮所有生成方案。`}];
 const operations=[['准备与配置','启动平台 → 三维环境建模：选择场景、核对核心位置、环境和仿真目标；装备建模：选择型号并保存参数。'],['设置部署约束','部署仿真推演 → 推演输入：填写范围、网格、预算和设备上限；权重成本：校验四项权重，在建筑权重中选择禁部署建筑。'],['配置与生成','威胁场景：设置目标数量、来向、高度、速度；方案生成：勾选方案类型并点击生成方案，等待本轮计算结束。'],['复核与迭代','方案对比：核对当前方案、型号、实际点位和工况；盲区分析与电磁兼容：处理残余问题。改变输入后重新生成，禁止把旧结果当作新结果。'],['移动补盲与下载','需要移动补盲时在盲区分析的警车部署中启用，复核新增设备和成本；回到方案对比勾选设备，点击设备部署解释明细下载。']];
 const exceptions=[['没有候选或范围无数据','检查地图和 GIS/DEM、范围交集、禁部署选择与装备集合；调整后重新生成，不自动解除禁部署。'],['参数非法或计算取消','核对数值范围、权重之和和型号保存状态；取消后保留的旧报告只能作历史参考。'],['零贡献或静默退化','分别查看四工况、近距盲区、视场、遮挡与目标发射状态；不根据单个工况的零值直接判定设备无效。'],['仍有严重电磁冲突','只在模型已有频道内换频或允许的候选点内移位；仍未解决时调整布设并重新推演，不签发可部署结论。'],['移动搜索无解或只有部分补盲','核对地表代理、合法频道和实际覆盖，保留剩余盲点；没有道路网时不得宣称车载点可到达。'],['旧报告缺少候选比较','明确标为证据缺失；使用当前版本重新生成方案后取得同点位候选和真实入选步骤，不能补写虚构数值。'],['字体或下载失败','检查中文字体资源和浏览器下载权限，恢复访问后重试；空勾选、计算中或失效报告应保持下载按钮禁用。']];
 const acceptance=[
  {item:'设备与版本一致性',standard:'导出设备 ID 与勾选集合一致，不漏项、不混入未勾选设备；报告与运行记录使用同一场景、批次和参数。',result:`本次已展开 ${devices.length} 台设备，运行 ${run.runId}。`},
  {item:'建筑硬约束',standard:'初始候选、补点、EMC 移位、移动搜索与最终设备均不进入所选建筑占地；建筑遮挡作用继续保留。',result:`本次记录禁部署源建筑 ${(settings.buildingExclusions?.buildingIds??[]).length} 个；历史空字段仅表示未记录该约束。`},
  {item:'成本与设备数',standard:'复核最终成本、预算与设备数；EMC 移位和后加移动设备可能改变成本，应按最终值重新审查。',result:`最终相对成本 ${finite(plan.cost,3)}；本方案预算 ${text(context.plan.budget)}；设备数 ${plan.devices.length}/${text(context.plan.maxDevices)}。`},
  {item:'覆盖贡献一致性',standard:'每台各工况覆盖数应不小于独立覆盖数且不大于有效采样数；独立数只表示当前矩阵中的唯一覆盖关系。',result:devices.every(d=>d.contributions.every(c=>c.coveredSamples===null||c.independentSamples===null||c.totalSamples===null||c.coveredSamples>=c.independentSamples&&c.coveredSamples<=c.totalSamples))?'已提供的贡献计数关系通过检查；缺失值仍按未提供处理。':'发现计数不一致，需重新计算，不能按正式结果验收。'},
  {item:'电磁与残余盲区',standard:'可部署代理结论要求无未解决 fail；warning、残余盲点和蜂群容量溢出须逐项说明，不虚设统一合格覆盖率。',result:emc?`严重 ${emc.counts?.fail??0}、提示 ${emc.counts?.warning??0}；覆盖是否达标由本项目任务门槛与各工况结果共同判定。`:'未提供，不能完成本项验收。'},
  {item:'现场工程确认',standard:'承重、产权、供电、网络、安装净空、实际频谱和车载可达性需现场或专项验证。',result:'本次为数字仿真报告，不代替现场施工和实测验收。'}];
 return {schema:'task3-device-explanation/2.0',runId:run.runId,planId:plan.id,planName:plan.name,conditionId,conditionName:condition.name,generatedAt,buildingExclusions:clone(settings.buildingExclusions??{buildingIds:[]}),context,devices,prerequisites,workflow,operations,exceptions,acceptance,
  methods:[['候选与覆盖','候选由安装表面、型号、参数和姿态共同构成。A(c,s,j)=1 当且仅当候选 c 对工况 s 的采样 j 满足模型状态及裕量门槛；否则为 0。'],['加权边际收益','w(s,j)=采样权重 × 工况权重，基线工况系数为 2，其余为 1。普通选择仅计未覆盖项；增强阶段还以 0.5 系数计当前仅一重覆盖项。q(c)=新增加权收益/候选相对成本。'],['候选相对成本','候选成本 κ(c)=设备类型相对成本+0.2×安装代理。屋顶代理=1+楼高/100；补点代理按表面与地面的高度差计算。成本不是人民币报价。'],['冗余删除与再补选','若移除设备后其所有已覆盖矩阵项仍有其他设备覆盖，则反向删除、释放成本，再次补选；普通选择最多 4 轮。删除与选入使用同一轮覆盖矩阵。'],['多方案评分','覆盖指标=min(各工况覆盖率)+0.15×基线核心二重覆盖率，上限为 1；盲区为各工况采样盲区比例均值。覆盖/施工正向、盲区/成本反向 min-max 归一化，再按本轮权重合成。'],['EMC 与推荐','有严重冲突的因子为 max(0.70,0.85^fail)，仅提示为 0.97，无冲突为 1；无严重冲突方案优先，再按回写得分与成本排序。所有结果都是本轮候选集合内的相对结论。']],
  emcRules:[`同频频差 <${EMC_RULES.coChannelSeparationGHz} GHz 且三维间距 <${EMC_RULES.coChannelMinDistanceM} m 时触发严重冲突；邻频与共址等阈值按当前模型规则复核。`],
  limitations:['所有数字必须对应同一运行批次；历史示例不得当作本次结果。','候选比较是本轮预评估及真实选择时刻的边际收益，不等于替换设备后整套方案的反事实结果。','采样覆盖不是连续空域无盲区证明；启发式推荐不是数学全局最优证明。','独立覆盖是固定矩阵中的唯一覆盖关系；移除设备后需重算干扰、覆盖和整个方案，不能据此直接预测现场变化。','装备资料、推导取值、模型频道、用户快照和优化输出须分清；未标定参数不转写为实测性能。',...(derived?['移动补盲后的覆盖与 EMC 已重算，原排名及原威胁验证不自动等同于派生方案验证。']:[]) ]};
}
