// The presentation layer never substitutes zero for an unavailable measurement.
import {buildRequest} from '../student-capabilities/api.js';

export const supported = device => ['optical','acoustic'].includes(device?.type);
export const hasValue = value => value !== null && value !== undefined &&
 (typeof value !== 'number' || Number.isFinite(value)) &&
 (!Array.isArray(value) || value.length > 0 && value.every(hasValue));
const omitted = new Set(['missing','not_evaluated','unavailable']);
export function availableMetrics(result){
 return (result?.metrics ?? []).filter(m => hasValue(m.value) && !omitted.has(m.status) &&
  !(result.type === 'acoustic' && m.label === '资料频率范围（仅110 cm）' &&
    result.configuration?.parameters?.array_diameter?.value !== 1.1));
}
export function displayValue(value,label=''){
 if(!hasValue(value))return '';
 if(typeof value === 'boolean')return value ? '是' : '否';
 if(typeof value === 'number')return Number.isInteger(value)?String(value):Number(value.toFixed(3)).toString();
 if(Array.isArray(value))return value.map(v=>displayValue(v)).join(/范围|区间/.test(label)?' ～ ':' × ');
 return String(value);
}
export const displayUnit = unit => ({boolean:'',deg:'°',degC:'℃',ratio:'倍',count:'个','1':''}[unit]??unit);
export const displayStatus = status => ({provided:'资料参数',derived:'几何计算',assumed:'场景假设',conditional:'场景计算',calibrated:'标定参数'}[status]??'计算结果');
export const pathLabel = result => ({clear:'直达路径畅通',blocked:'直达路径受阻'}[result?.geometry?.state]??'');
export function assessmentSummary(result){
 if(!result)return '正在评估';
 if(result.type==='optical'){
  if(result.raw_result?.mechanical_orientation_valid?.value===false)return '请调整云台朝向';
  if(result.geometry?.state==='blocked')return '直达路径受阻';
  const inside=result.raw_result?.target_in_fov?.value;
  if(inside===false)return '目标在视场外';
  if(inside===true)return '目标在视场内';
  return '基础几何评估';
 }
 const inRange=result.raw_result?.within_nominal_range?.value;
 return inRange===false?'超出标称距离':inRange===true?'位于标称距离内':'基础几何评估';
}
export function resultExplanation(result){
 const text=[];
 if(pathLabel(result))text.push(pathLabel(result)+'，依据当前三维场景。');
 if(result.type==='acoustic' && result.geometry?.state==='blocked')
  text.push('声波可经反射和绕射传播，直达路径受阻不等于完全无法感知。');
 if(result.type==='acoustic')text.push('距离区间用于核对资料标称条件。');
 if(result.raw_result?.fov?.status==='assumed')text.push('视场结果采用本场景设定的固定角度。');
 return text;
}
export function ensureSettings(state){
 for(const d of state.devices.filter(supported)){
  const defaults=d.type==='optical'?{channel:'visible',focal_mm:6.5,use_custom_fov:false,custom_fov_deg:[20,15]}:{array_diameter_m:1.1};
  d.capability??={};for(const [key,value] of Object.entries(defaults))if(d.capability[key]===undefined)d.capability[key]=structuredClone(value);
 }
 state.target.capability??={};for(const [key,value] of Object.entries({width_m:state.target.size,height_m:state.target.size,check_band:false,band_hz:[500,2000]}))
  if(state.target.capability[key]===undefined)state.target.capability[key]=structuredClone(value);
 return state;
}
export function requestForScenario(catalog,state,trace){
 const t=state.target.capability??{};
 const devices=state.devices.filter(supported).map(d=>{
  const s=d.capability??{};
  if(d.type==='optical')return {id:d.id,type:d.type,position:[...d.position],
   channel:s.channel??'visible',focal_mm:s.focal_mm??6.5,
   heading_deg:d.parameters.heading,pitch_deg:d.parameters.pitch,
   ...(s.use_custom_fov?{direct_fov_deg:structuredClone(s.custom_fov_deg)}:{})};
  return {id:d.id,type:d.type,position:[...d.position],array_diameter_m:s.array_diameter_m??1.1};
 });
 return buildRequest(catalog,devices,{position:[...state.target.position],width_m:t.width_m??null,
  height_m:t.height_m??null,band_hz:t.check_band?structuredClone(t.band_hz):null},trace);
}
const parameterNames={resolution:'通道分辨率',focal_range:'镜头焦距范围',sensor_size:'有效传感器宽高',direct_fov:'光学视场',
 minimum_illuminance:'最低工作照度',recognition_pixels:'识别像素判据',effective_range:'有效识别距离',
 yaw_range:'云台水平转动范围',pitch_range:'云台俯仰转动范围',temperature_range:'工作温度范围',
 optical_zoom:'光学变焦倍数',maximum_power:'功率上限',maximum_mass:'质量上限',dimensions_wdh:'外形尺寸',
 nominal_range:'标称距离区间',array_diameter:'当前阵列直径',frequency_range:'110 cm阵列资料频带',
 microphone_count:'麦克风数量',array_options:'阵列规格',spl_range:'资料声压级范围',maximum_dynamic_range:'资料动态范围上限',
 azimuth_error:'方位误差尺度',elevation_error:'俯仰误差尺度',battery_life:'资料续航时间'};
export function parameterRows(result){
 if(!result)return [];
 const c=result.configuration,channel=result.raw_result?.channel??'visible';
 const groups=result.type==='optical'?[c?.channels?.[channel],c?.mechanical,c?.reported_claims]:[c?.parameters,c?.reported_claims];
 return groups.flatMap(group=>Object.entries(group??{}).filter(([key,m])=>parameterNames[key]&&m&&hasValue(m.value)&&!omitted.has(m.status)&&
  !(key==='frequency_range'&&c.parameters?.array_diameter?.value!==1.1))
  .map(([key,m])=>({label:parameterNames[key],...m})));
}
const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function comparisonRows(snapshots){
 return snapshots.flatMap(s=>s.payload.results.map(r=>({scene:s.name,id:r.id,device:r.name??r.device,
  channel:r.raw_result?.channel==='visible'?'可见光':r.raw_result?.channel==='thermal'?'热成像':'声学',
  distance:r.raw_result?.distance?.value,path:pathLabel(r),summary:assessmentSummary(r)})));
}
export function comparisonHTML(snapshots){
 const rows=comparisonRows(snapshots);
 const path=rows.some(r=>r.path);
 return `<table><thead><tr><th>场景</th><th>设备／通道</th><th>距离 / m</th>${path?'<th>直达路径</th>':''}<th>评估摘要</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escape(r.scene)}</td><td>${escape(r.device)} · ${escape(r.channel)}</td><td>${escape(displayValue(r.distance))}</td>${path?`<td>${escape(r.path)}</td>`:''}<td>${escape(r.summary)}</td></tr>`).join('')}</tbody></table>`;
}
export function reportHTML(snapshots){
 const sections=snapshots.map(s=>`<section><h2>${escape(s.name)}</h2>${s.payload.results.map(r=>`<h3>${escape(r.name??r.device)} · ${escape(assessmentSummary(r))}</h3><p>${resultExplanation(r).map(escape).join(' ')}</p><table><tr><th>指标</th><th>数值</th><th>单位</th><th>依据</th></tr>${availableMetrics(r).map(m=>`<tr><td>${escape(m.label)}</td><td>${escape(displayValue(m.value,m.label))}</td><td>${escape(displayUnit(m.unit))}</td><td>${escape(displayStatus(m.status))}</td></tr>`).join('')}</table>`).join('')}</section>`).join('');
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>装备建模 · 光电与声学场景对比</title><style>body{font-family:"Microsoft YaHei",sans-serif;max-width:1150px;margin:36px auto;padding:24px;color:#203d4b;line-height:1.8}h1{color:#176c68}table{width:100%;border-collapse:collapse;margin:16px 0 28px;font-size:14px}th,td{padding:10px;border:1px solid #c6d9de;text-align:left}th{background:#eef6f5}section{margin-top:36px;break-inside:avoid}button{padding:8px 16px}@media print{button{display:none}}</style><h1>装备建模 · 光电与声学场景对比</h1><p>基于设备资料、仿真点位与当前三维场景进行条件比较。几何关系与标称参数核对结果用于建模展示，不作为实测检出率或识别率。</p><button onclick="window.print()">打印／另存为 PDF</button><h2>场景对比</h2>${comparisonHTML(snapshots)}${sections}</html>`;
}
