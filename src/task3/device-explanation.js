import {createDeviceDisplayMap} from './device-display.js';
import {EQUIPMENT_FACTS} from './constants.js';
import {fieldsFor} from '../sensors/presets.js';

const TASKS={radar:'主动发射并接收回波，用来发现和跟踪空中目标',radio:'接收目标无线电信号，帮助发现有发射活动的目标',optical:'利用可见光或热成像观察目标，帮助确认目标外观',acoustic:'接收目标产生的声音，补充近距离感知'};
const text=value=>value===null||value===undefined?'未提供':String(value);
const finite=value=>Number.isFinite(value)?value.toFixed(1):'未提供';
export function createDeviceExplanation({report,run,activePlanId,conditionId='nominal',deviceIds,generatedAt=new Date().toISOString()}){
 const plan=report?.plans?.find(p=>p.id===activePlanId);
 if(!plan||!run?.runId)throw Error('缺少有效方案或运行记录，请重新生成方案');
 if(!Array.isArray(deviceIds)||!deviceIds.length)throw Error('请至少勾选一台设备');
 const selected=new Set(deviceIds);if([...selected].some(id=>!plan.devices.some(d=>d.id===id)))throw Error('已勾选设备不属于当前方案，请重新选择');
 const condition=report.conditions.find(c=>c.id===conditionId);if(!condition)throw Error('当前工况不在方案中');
 const display=createDeviceDisplayMap(plan.devices),core=report.sampling.bounds.core,emc=report.emc?.[plan.id];
 const devices=plan.devices.flatMap((device,index)=>{
  if(!selected.has(device.id))return [];
  const entry=display.details(device.id),site=plan.sites?.[index]??device.deployment??{},mobile=device.mobileRepair?.platform==='police-car',facts=EQUIPMENT_FACTS[device.presetId];
  const distance=Math.hypot(device.position[0]-core[0],device.position[2]-core[2]);
  const contributions=report.conditions.map(c=>{
   const row=plan.coverageContributions?.[device.id]?.find(r=>r.condition===c.id),metric=plan.metrics.find(m=>m.condition===c.id);
   return {condition:c.id,name:c.name,coveredSamples:row?.coveredSamples??null,independentSamples:row?.independentSamples??null,totalSamples:metric?.total??null};
  });
  const current=contributions.find(c=>c.condition===conditionId),conflicts=emc?.conflicts?.filter(c=>c.a===device.id||c.b===device.id)??[];
  const actions=(plan.emcRemediation?.actions??[]).filter(a=>a.deviceId===device.id||a.replacementDeviceId===device.id);
  const mobileAction=plan.derivation?.selected?.find(a=>a.deviceId===device.id);
  const technique=[
   `部署方式：${site.installation??'未提供'}；点位：${site.name??'未提供'}。`,
   `模型坐标（米）：东 ${finite(device.position[0])}、北 ${finite(-device.position[2])}、上 ${finite(device.position[1])}；距核心中心 ${finite(distance)} 米。`,
   `覆盖判据：同一感知模型逐设备、逐工况实判，覆盖裕量门槛 ${text(report.settings.marginReserveDb)} dB；表中贡献来自最终实际设备位置与参数的覆盖矩阵。`,
   `电磁兼容：${emc?`涉及本设备的严重冲突 ${conflicts.filter(c=>c.severity==='fail').length} 项，提示 ${conflicts.filter(c=>c.severity==='warning').length} 项`:'未提供'}。`,
  ];
  if(plan.optimizationTrace)technique.push(`方案生成记录：候选变体 ${plan.optimizationTrace.poolSize} 个；本方案预算 ${text(plan.budget)} 相对单位、设备上限 ${text(plan.maxDevices)} 台；候选按覆盖收益与相对成本迭代选择，并执行电磁兼容复核。`);
  if(facts?.source)technique.push(`装备资料来源：${typeof facts.source==='string'?facts.source:JSON.stringify(facts.source)}。`);
  if(mobileAction)technique.push(`移动补盲记录：新增覆盖 ${mobileAction.newlyCoveredSampleIds?.length??0} 个启动补盲工况盲点；搜索阶段 ${text(mobileAction.searchPhase)}；道路可达性未验证。`);
  for(const action of actions)technique.push(`电磁处置记录：${action.action==='retune'?'换频':'移位'}；${action.reason??'详见运行记录'}。`);
  const plain=[
   `这台${entry.typeName}的任务是${TASKS[device.type]??'参与当前场景感知'}。`,
   `${distance<=report.settings.coreRadius?'这个点位位于核心防护区内，便于参与核心周边观察':'这个点位在核心区外围，可参与外围观察'}。${mobile?'它是后加的车载补盲设备，停车和道路通行条件仍需现场确认。':'楼顶高度与周边建筑会影响观察方向，实际安装条件仍需现场确认。'}`,
   current?.coveredSamples===null?'该设备的逐项覆盖贡献未提供，无法判断它在当前工况下具体负责多少采样位置。':`在“${condition.name}”下，它能观察 ${current.coveredSamples} 个离散测试位置。其中 ${current.independentSamples} 个在当前覆盖矩阵中仅由它覆盖，其余与其他设备重叠；重叠意味着这些位置有多台设备参与观察。`,
   current?.coveredSamples===0?'当前工况下没有达到模型覆盖门槛的采样点；不能据此声称该设备已消除盲区。':'采样位置是计算时布置的空中检查点，数量不等于实际建筑数量，也不代表两个检查点之间处处可见。',
   device.type==='radio'?'目标不发射无线电信号时，这种设备可能无法提供有效贡献；需结合静默工况查看。':device.type==='optical'?'雨雾、光照和遮挡会影响成像；远处有目标不等于能够识别清楚。':device.type==='acoustic'?'街道噪声和距离会影响声音感知，周边环境改变后应重新评估。':'距离、目标回波、遮挡和干扰会影响探测，应结合不同工况查看。',
  ];
  const definitions=fieldsFor(device.type),keys=['maxRange','minRange','heading','pitch','azimuthFov','frequencyGHz','bandMinGHz','bandMaxGHz','capacity','updateSeconds','wideHfov','narrowHfov','minLux','thresholdSpl','thresholdDb'];
  const parameterRows=keys.filter(key=>device.parameters?.[key]!==undefined&&definitions[key]).map(key=>({label:definitions[key].label,value:text(device.parameters[key]),unit:definitions[key].unit}));
  return [{id:device.id,...entry,position:[...device.position],siteName:site.name??'未提供',mobile,parameters:structuredClone(device.parameters??{}),parameterRows,contributions,technical:technique,plain,conflicts:structuredClone(conflicts)}];
 });
 return {schema:'task3-device-explanation/1.0',runId:run.runId,planId:plan.id,planName:plan.name,conditionId,conditionName:condition.name,generatedAt,buildingExclusions:structuredClone(report.settings.buildingExclusions??{buildingIds:[]}),devices,limitations:['说明依据本次仿真和资料参数，不代表实测性能、现场施工许可或频谱合规认证。','选点来自候选点、覆盖收益、预算和电磁兼容等约束下的启发式计算，不构成全局最优证明。','独立覆盖说明当前矩阵的覆盖关系，不替代移除设备后重新计算干扰和覆盖的完整评估。']};
}
