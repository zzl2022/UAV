export const VERSION='student-capabilities-1';
export function buildRequest(catalog,devices,target,trace){
 if(!catalog?.scene)throw Error('请先连接 Python 模型服务');
 return {version:VERSION,mode:'dataset_only',origin:[...catalog.scene.origin],scene_hash:catalog.scene.hash,
  devices:devices.map(d=>({...structuredClone(d),context:trace(d.position,target.position)})),target:structuredClone(target)};
}
export const statusText={provided:'资料提供',derived:'由输入计算',assumed:'用户假设',missing:'缺失',not_evaluated:'本阶段未评估',conditional:'按平台几何解释'};
export const unitText=unit=>({boolean:'',deg:'°',degC:'℃',ratio:'倍',count:'个','1':''}[unit]??unit);
export function valueText(value){
 if(value===null||value===undefined)return '未知／未提供';
 if(typeof value==='boolean')return value?'是':'否';
 if(typeof value==='number')return Number.isInteger(value)?String(value):value.toFixed(3).replace(/\.?0+$/,'');
 if(Array.isArray(value))return value.map(valueText).join(' × ');
 return String(value);
}
const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function presentationNotes(result){
 const notes=['设备与目标位置为仿真场景设定。','遮挡结果依据当前三维场景计算，场景高程基准待核验。'];
 if(result.type==='optical'){
  const fov=result.raw_result?.fov;
  notes.push(fov?.value==null?'光学视场参数待补充，暂不能判断视场覆盖。':fov.status==='assumed'?'当前视场采用用户设定值。':'当前视场由设备参数计算。');
 }else{
  notes.push('标称距离用于条件比较，实际探测能力待验证。');
  if(result.geometry.state==='blocked')notes.push('直达路径受遮挡；反射和绕射的传播强度尚未评估。');
  notes.push('声源及噪声数据待补充，暂不评估探测概率和定位误差。');
 }
 return notes;
}
export function snapshotHTML(snapshots){
 const parts=snapshots.map(s=>`<section><h2>${escape(s.name)}</h2>${s.payload.results.map(r=>`<h3>${escape(r.device)}</h3><p>建筑直达路径：${escape({clear:'当前平台网格未检出遮挡',blocked:'当前平台网格存在遮挡',unknown:'无法判断'}[r.geometry.state])}（依据当前三维场景）</p><table><tr><th>指标</th><th>数值</th><th>单位</th><th>来源状态</th></tr>${r.metrics.map(m=>`<tr><td>${escape(m.label)}</td><td>${escape(valueText(m.value))}</td><td>${escape(unitText(m.unit))}</td><td>${escape(statusText[m.status]??m.status)}</td></tr>`).join('')}</table><ul>${presentationNotes(r).map(n=>'<li>'+escape(n)+'</li>').join('')}</ul>`).join('')}<details><summary>完整计算与输入</summary><pre>${escape(JSON.stringify(s.payload,null,2))}</pre></details></section>`);
 const compare=snapshots.flatMap(s=>s.payload.results.map(r=>{const distance=r.metrics.find(m=>m.label==='目标距离');return `<tr><td>${escape(s.name)}</td><td>${escape(r.device)}</td><td>${escape(valueText(distance?.value))} m</td><td>${escape({clear:'平台网格未检出遮挡',blocked:'平台网格有遮挡',unknown:'未知'}[r.geometry.state])}</td><td>${r.type==='optical'?'光学视场需完整参数，识别率未评估':'仅标称条件比较，检出率未评估'}</td></tr>`;})).join('');
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>平台光电与声学场景对比</title><style>body{font-family:"Microsoft YaHei",sans-serif;max-width:1100px;margin:32px auto;padding:20px;line-height:1.8;color:#21374a}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #ccd8e4;padding:10px;text-align:left}th{background:#edf3f8}section{margin-top:35px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:10px}@media print{button{display:none}}</style><h1>光电与声学 · 比赛资料基础模型</h1><button onclick="window.print()">打印／另存为 PDF</button><p>本报告基于设备资料与三维场景生成，设备位置和工作设置为仿真设定。未标定指标不作实际探测或识别结论；未知值不代表零。</p><h2>场景对比</h2><table><tr><th>场景</th><th>设备</th><th>距离</th><th>几何直达路径</th><th>结论边界</th></tr>${compare}</table>${parts.join('')}</html>`;
}
export async function requestJSON(path,options={}){
 const res=await fetch(path,options);
 const text=await res.text();let value;
 try{value=JSON.parse(text);}catch{throw Error('Python 模型服务未连接，请先运行 python backend/server.py（端口8765）');}
 if(!res.ok)throw Error(value.error??`HTTP ${res.status}`);
 return value;
}
