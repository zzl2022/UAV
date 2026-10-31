import {requestJSON} from '../student-capabilities/api.js';
import {supported,ensureSettings,requestForScenario,availableMetrics,parameterRows,displayValue,displayUnit,
 displayStatus,pathLabel,assessmentSummary,resultExplanation,comparisonHTML,reportHTML} from './capability-data.js';

// Shares equipment, target, coordinate frame and scene query with mountSensorUI.
export function mountCapabilityAssessment({panel,city,getState,getSelected,getQuery,isVisible,onChange,onUpdate}){
 const workspace=document.createElement('section');workspace.id='capability-workspace';
 workspace.innerHTML=`<h2>光电／声学评估</h2><label>评估方式<select id="capability-mode"><option value="dataset">比赛资料 · 基础评估</option><option value="simulation">假设参数 · 环境仿真</option></select></label><p class="hint" id="capability-mode-note"></p><label id="capability-nominal-row" hidden><input id="capability-nominal" type="checkbox">显示假设范围示意</label><div id="capability-settings"></div><div class="buttons"><button id="capability-reload">刷新设备资料</button><button id="capability-aim">朝向当前目标</button></div><p id="capability-message" role="status" class="hint"></p>`;
 panel.querySelector('details').before(workspace);
 const compare=document.createElement('section');compare.id='capability-comparison';
 compare.innerHTML=`<h2>光电／声学场景对比</h2><label>场景名称<input id="capability-scene-name" maxlength="80" value="场景1"></label><button id="capability-save" disabled>保存当前场景</button><div id="capability-table" class="capability-table" tabindex="0" aria-label="可横向滚动的场景对比表"></div><div class="buttons"><button id="capability-export-html" disabled>导出中文报告</button><button id="capability-export-json" disabled>导出对比数据</button></div><button id="capability-clear">清空对比记录</button><p class="hint">表格可横向滚动，完整对比见中文报告。记录保留在本次页面会话，刷新前请导出。</p>`;
 panel.querySelector('.sensor-io').before(compare);
 const $=id=>panel.querySelector('#'+id);
 let mode='dataset',catalog=null,payload=null,sequence=0,controller=null,snapshots=[],loading=null;
 const selected=()=>getState().devices.find(d=>d.id===getSelected());
 const isDataset=d=>supported(d)&&mode==='dataset';
 function diagnostics(){window.equipmentCapabilityDiagnostics={mode,pending:!payload,connected:!!catalog,results:payload?.results??[],snapshots:snapshots.length,
  configurationHashes:payload?.configuration_hashes,sceneHash:payload?.scene_hash};}
 function invalidate(){sequence++;controller?.abort();payload=null;$('capability-save').disabled=true;
  $('capability-message').textContent='';diagnostics();}
 function number(container,label,value,min,max,step,set){
  const row=document.createElement('label');row.className='sensor-field';row.textContent=label;
  const input=document.createElement('input');input.type='number';input.value=value;input.min=min;input.max=max;input.step='any';input.setAttribute('aria-label',label);
  input.oninput=()=>{invalidate();input.setCustomValidity('');if(!input.value.trim()||!input.checkValidity()){input.setCustomValidity('请输入范围内的数值');$('capability-message').textContent='请检查工作设置后重新计算。';onUpdate();return;}
   input.setCustomValidity('');set(Number(input.value));onChange();};
  row.append(input);container.append(row);
 }
 function checkbox(container,id,label,value,set){const row=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.id=id;input.checked=value;input.onchange=()=>{set(input.checked);form();onChange();};row.append(input,document.createTextNode(label));container.append(row);}
 function form(){
  mode=getState().assessmentMode??'dataset';
  ensureSettings(getState());const d=selected(),box=$('capability-settings');box.replaceChildren();
  workspace.hidden=!supported(d);compare.hidden=mode!=='dataset'&&!snapshots.length;
  $('capability-nominal-row').hidden=mode!=='simulation';$('capability-nominal').checked=$('detection-nominal').checked;
  $('capability-save').hidden=mode!=='dataset';$('capability-scene-name').parentElement.hidden=mode!=='dataset';
  $('capability-mode').value=mode;
  $('capability-mode-note').textContent=mode==='dataset'?'共用地图点位与目标，按设备资料核对基础条件。':'使用可调整的假设系数进行环境仿真，结果用于趋势分析。';
  $('capability-reload').hidden=mode!=='dataset';$('capability-aim').hidden=d?.type!=='optical';
  if(!supported(d)||mode!=='dataset')return;
  const s=d.capability,t=getState().target.capability;
  if(d.type==='optical'){
   const label=document.createElement('label');label.textContent='成像通道';const select=document.createElement('select');select.id='capability-channel';
   select.add(new Option('可见光','visible'));select.add(new Option('热成像','thermal'));select.value=s.channel;
   select.onchange=()=>{s.channel=select.value;s.use_custom_fov=false;const range=catalog?.devices.optical.channels[s.channel].focal_range.value;s.focal_mm=range?.[0]??(s.channel==='thermal'?75:6.5);form();onChange();};label.append(select);box.append(label);
   const range=catalog?.devices.optical.channels[s.channel].focal_range.value??(s.channel==='thermal'?[75,75]:[6.5,312]);
   number(box,'工作焦距 / mm',s.focal_mm,range[0],range[1],.1,v=>s.focal_mm=v);
   number(box,'方位指向 / °',d.parameters.heading,0,360,.1,v=>d.parameters.heading=v);
   number(box,'俯仰指向 / °',d.parameters.pitch,-90,90,.1,v=>d.parameters.pitch=v);
   number(box,'目标宽度 / m',t.width_m,.001,100,.001,v=>t.width_m=v);
   number(box,'目标高度 / m',t.height_m,.001,100,.001,v=>t.height_m=v);
   checkbox(box,'capability-custom-fov','启用自定义视场试算（场景假设）',s.use_custom_fov,v=>s.use_custom_fov=v);
   if(s.use_custom_fov){number(box,'水平视场 / °',s.custom_fov_deg[0],.001,179.999,.001,v=>s.custom_fov_deg[0]=v);
    number(box,'垂直视场 / °',s.custom_fov_deg[1],.001,179.999,.001,v=>s.custom_fov_deg[1]=v);
    const hint=document.createElement('p');hint.className='hint';hint.textContent='固定视场由本场景设定，焦距调整不改变该固定角度。';box.append(hint);}
  }else{
   const label=document.createElement('label');label.textContent='阵列规格';const select=document.createElement('select');select.id='capability-array';
   for(const value of [.3,.7,1.1])select.add(new Option(`${Math.round(value*100)} cm`,value));select.value=s.array_diameter_m;
   select.onchange=()=>{s.array_diameter_m=Number(select.value);form();onChange();};label.append(select);box.append(label);
   if(s.array_diameter_m===1.1){checkbox(box,'capability-check-band','核对目标频带',t.check_band,v=>t.check_band=v);
    if(t.check_band){number(box,'目标频带下限 / Hz',t.band_hz[0],1,100000,1,v=>t.band_hz[0]=v);number(box,'目标频带上限 / Hz',t.band_hz[1],1,100000,1,v=>t.band_hz[1]=v);}}
  }
 }
 async function load(){
  if(loading)return loading;
  loading=requestJSON('/api/capabilities/catalog').then(value=>{
   if(JSON.stringify(value.scene.origin)!==JSON.stringify(city.metadata.origin))throw Error('场景版本不一致，请重新启动平台。');
   catalog=value;return value;
  }).finally(()=>loading=null);return loading;
 }
 async function refresh(){
  invalidate();const ticket=sequence;
  if(mode!=='dataset'||!isVisible()||!getState().devices.some(supported)){onUpdate();return;}
  if(workspace.querySelector('input:invalid')){$('capability-message').textContent='请检查工作设置后重新计算。';onUpdate();return;}
  $('capability-message').textContent='正在评估…';onUpdate();
  try{
   if(!catalog){await load();if(ticket!==sequence)return;form();}
   const request=requestForScenario(catalog,getState(),(a,b)=>getQuery().trace(a,b));
   controller=new AbortController();const value=await requestJSON('/api/capabilities/evaluate',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal});
   if(ticket!==sequence||!isVisible())return;
   const names=new Map(getState().devices.map(d=>[d.id,d.name]));for(const r of value.results)r.name=names.get(r.id);
   payload=value;$('capability-save').disabled=false;$('capability-message').textContent='评估已更新 · 与当前地图点位一致';diagnostics();onUpdate();
  }catch(error){if(error.name==='AbortError'||ticket!==sequence)return;
   $('capability-message').textContent='本次评估未完成。'+error.message;diagnostics();onUpdate();}
 }
 function renderMetrics(parent,r){
  const row=(label,value)=>{const node=document.createElement('div');node.className='sensor-metric';const a=document.createElement('span'),b=document.createElement('strong');a.textContent=label;b.textContent=value;node.append(a,b);parent.append(node);};
  if(!r){const p=document.createElement('p');p.className='hint';p.textContent='请完成工作设置后进行评估。';parent.append(p);return;}
  row('评估摘要',assessmentSummary(r));if(pathLabel(r))row('建筑／地形直达路径',pathLabel(r));
  for(const m of availableMetrics(r))row(m.label,`${displayValue(m.value,m.label)} ${displayUnit(m.unit)} · ${displayStatus(m.status)}`);
  for(const text of resultExplanation(r)){const p=document.createElement('p');p.className='hint';p.textContent=text;parent.append(p);}
 }
 function renderParameters(parent){parent.replaceChildren();const r=payload?.results.find(r=>r.id===getSelected());
  for(const m of parameterRows(r)){const node=document.createElement('div');node.className='sensor-metric';const label=document.createElement('span'),value=document.createElement('strong');label.textContent=m.label;value.textContent=`${displayValue(m.value,m.label)} ${displayUnit(m.unit)} · ${displayStatus(m.status)}`;node.append(label,value);parent.append(node);}}
 function comparisons(){$('capability-table').innerHTML=snapshots.length?comparisonHTML(snapshots):'';for(const id of ['capability-export-html','capability-export-json','capability-clear'])$(id).disabled=!snapshots.length;diagnostics();}
 function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('capability-mode').onchange=()=>{mode=$('capability-mode').value;getState().assessmentMode=mode;invalidate();form();onChange(true);};
 $('capability-nominal').onchange=()=>{$('detection-nominal').checked=$('capability-nominal').checked;$('detection-nominal').dispatchEvent(new Event('change',{bubbles:true}));};
 $('capability-reload').onclick=async()=>{invalidate();catalog=null;try{await load();form();onChange();}catch(error){$('capability-message').textContent=error.message;}};
 $('capability-aim').onclick=()=>{const d=selected(),p=getState().target.position.map((v,i)=>v-d.position[i]);d.parameters.heading=(Math.atan2(p[0],-p[2])*180/Math.PI+360)%360;d.parameters.pitch=Math.atan2(p[1],Math.hypot(p[0],p[2]))*180/Math.PI;form();onChange(true);};
 $('capability-save').onclick=()=>{if(!payload)return;if(snapshots.length>=30){$('capability-message').textContent='已保存30组，请导出后清空记录。';return;}
  snapshots.push({name:$('capability-scene-name').value.trim()||`场景${snapshots.length+1}`,scenario:structuredClone(getState()),payload:structuredClone(payload)});
  $('capability-scene-name').value=`场景${snapshots.length+1}`;comparisons();};
 $('capability-export-html').onclick=()=>download(reportHTML(snapshots),'装备建模_光电声学场景对比.html','text/html;charset=utf-8');
 $('capability-export-json').onclick=()=>download(JSON.stringify({version:'equipment-assessment-1',mode:'dataset_only',scenarios:snapshots},null,2),'装备建模_光电声学场景对比.json','application/json');
 $('capability-clear').onclick=()=>{snapshots=[];comparisons();form();};
 comparisons();
 return {isDataset,form,refresh,invalidate,renderMetrics,renderParameters,
  result:id=>payload?.results.find(r=>r.id===id),exportData:()=>payload?structuredClone(payload):null,
  exportMode:()=>mode};
}
