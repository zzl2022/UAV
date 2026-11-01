import * as THREE from 'three';
import {PRESETS,TYPES} from '../sensors/presets.js';
import {BLIND_COLORS,BLIND_CATEGORIES,TASK3_VERSION,METRIC_WEIGHTS,METRIC_LABELS,THREAT_SCENARIOS,EQUIPMENT_FACTS} from './constants.js';
import {PIPELINE_STAGES,STAGE_NAMES} from './pipeline.js';
import {createDeviceDisplayMap} from './device-display.js';
import {createFloatingWindow} from './floating-window.js';
import {createDeviceHover} from './device-hover.js';
import {applyMobileRepairResult,restoreMobileRepairSnapshot} from './mobile-repair.js';
import {createDeploymentHtml} from './deployment-doc.js';
import './ui.css';

const COLORS={radar:0x70d6ff,radio:0xb89aff,optical:0xffd783,acoustic:0x69e2bd};
const percent=x=>`${(x*100).toFixed(1)}%`;
const clock=t=>`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const VERDICT={pass:'通过',degraded:'降额',fail:'不通过'};
const EMC_KIND={'co-channel':'同频干扰','adjacent-channel':'邻频提示','receiver-overlap':'发射信号落入接收频段','frontend-block':'前端阻塞','co-site':'同点过密'};
const EMC_SEVERITY={fail:'严重',warning:'提示'};
const formatEmcDistance=value=>{const distance=Number(value);if(!Number.isFinite(distance)||distance<0)return '—';if(distance===0)return '0（同点部署）';return distance<1?distance.toFixed(2):distance.toFixed(1);};
const friendlyError=text=>{
 if(/有限正数/.test(text))return '范围尺寸必须是大于 0 的有效数字。';
 if(/无法安全采样/.test(text))return '范围过大，无法安全计算。请缩小东西宽度或南北深度。';
 if(/超出 DEM 数据边界/.test(text))return '所选范围超出地形数据，无法计算。请缩小或移动范围。';
 if(/没有可用空域采样点/.test(text))return '所选范围内没有可用采样点，请调整范围或网格间距。';
 return text;
};
const formatCoordinate=value=>Number.isFinite(value)?`${value.toFixed(1)} m`:'未提供';
function formatWorkingBand(device){
 const facts=EQUIPMENT_FACTS[device.presetId],tuned=device.parameters?.frequencyGHz;
 if(Number.isFinite(tuned))return `${facts?.band?`${facts.band} 波段 · `:''}当前模型频点 ${tuned} GHz`;
 if(facts?.receiveRangeGHz)return `${facts.receiveRangeGHz.join('–')} GHz（接收）`;
 if(facts?.receiveDiscreteGHz)return `${facts.receiveDiscreteGHz.join(' / ')} GHz（接收）`;
 if(facts?.emissionGHz?.length)return `${facts.band?`${facts.band} 波段 · `:''}${facts.emissionGHz.join(' / ')} GHz`;
 if(facts&&!facts.emissionGHz?.length&&!facts.receiveGHz?.length)return '不适用（无射频工作频段）';
 return '未提供';
}
function formatDeviceEmc(emc,deviceId){
 if(!emc)return '未提供';
 const conflicts=emc.conflicts.filter(c=>c.a===deviceId||c.b===deviceId),fail=conflicts.filter(c=>c.severity==='fail').length,warning=conflicts.filter(c=>c.severity==='warning').length;
 if(fail)return `不通过（严重 ${fail} · 提示 ${warning}）`;
 if(warning)return `降额（提示 ${warning}）`;
 return '通过（未发现涉及该设备的冲突）';
}

export function mountTask3UI({app,city,terrain,scene,camera,controls,renderer,sensors,model,workspace}){
 const panel=document.createElement('div');panel.id='task3-panel';panel.hidden=true;
 panel.innerHTML=`<div class="brand"><span class="mark">◇</span> 任务三 · 优化部署推演</div><button id="task3-back" class="back-button">← 返回城市建模</button>
 <p class="task3-note">核心防护目标：<strong>河南博物院</strong>。距离与范围单位：米。</p>
 <nav class="task3-shortcuts" aria-label="推演模块浮窗">
  <button type="button" id="task3-open-input" aria-haspopup="dialog" aria-controls="task3-window-input" aria-expanded="false">推演输入 <span aria-hidden="true">↗</span></button>
  <button type="button" id="task3-open-pipeline" aria-haspopup="dialog" aria-controls="task3-window-pipeline" aria-expanded="false">流水线 <span aria-hidden="true">↗</span></button>
  <button type="button" id="task3-open-plans" aria-haspopup="dialog" aria-controls="task3-window-plans" aria-expanded="false">方案对比 <span aria-hidden="true">↗</span></button>
  <button type="button" id="task3-open-emc" aria-haspopup="dialog" aria-controls="task3-window-emc" aria-expanded="false">电磁兼容 <span aria-hidden="true">↗</span></button>
 </nav>
 <details class="task3-sidebar-section"><summary>盲区分布</summary><div class="task3-details-body"><label>覆盖工况<select id="task3-condition"></select></label>
  <div id="task3-blind-legend" class="task3-legend">${Object.entries(BLIND_CATEGORIES).map(([key,name])=>`<label><input type="checkbox" data-category="${key}" checked><i style="background:#${BLIND_COLORS[key].toString(16).padStart(6,'0')}"></i>${name}<b data-count="${key}"></b></label>`).join('')}</div>
  <label class="task3-mobile-toggle"><input id="task3-mobile-repair" type="checkbox" disabled>警车部署可移动雷达</label>
  <div id="task3-mobile-status" class="task3-mobile-status" role="status">完成推演后可启用移动补盲。</div>
  <p class="hint">只复用本次已选雷达预设。挂载高度 2 m 为模型假设；候选仅为开阔地表几何代理，现有数据不能验证道路可达。</p>
  <div id="task3-blind-list"></div></div></details>
 <details class="task3-sidebar-section"><summary>威胁推演</summary><div class="task3-details-body"><label>威胁场景<select id="task3-threat"></select></label>
  <div id="task3-threat-summary"></div><div class="buttons"><button id="task3-threat-play" class="primary" disabled>▶ 播放推演</button><button id="task3-threat-reset" disabled>↺</button></div>
  <input id="task3-threat-seek" type="range" min="0" max="1000" value="0" aria-label="推演进度"><div id="task3-threat-clock">00:00 / 00:00</div><div id="task3-threat-list"></div></div></details>
 <details class="task3-sidebar-section task3-io"><summary>导出与过程数据</summary><div class="task3-details-body"><button id="task3-export-default-doc">下载标准默认方案 HTML ↓</button><button id="task3-export-current-doc" disabled>下载当前方案 HTML ↓</button><button id="task3-export">导出推演报告 JSON ↓</button><button id="task3-export-run">导出过程数据（规则依据）↓</button></div></details>`;
 workspace.mountSidebarPanel(panel,'task3');
 const $=id=>app.querySelector('#'+id);
 const button=app.querySelector('#toggle-task3');
 const layer=new THREE.Group();layer.name='Task3_Pipeline';layer.visible=false;scene.add(layer);
 const floatingLayer=document.createElement('div');floatingLayer.id='task3-floating-layer';floatingLayer.hidden=true;app.querySelector('main').append(floatingLayer);
 const inputModule=document.createElement('section');inputModule.className='task3-floating-module';inputModule.innerHTML=`
  <details><summary>装备类型（七款）</summary><div id="task3-equipment"></div></details>
  <div class="task3-inputs">
   <label>东西宽度 / m<input id="task3-scope-width" type="number" min="1" step="100" value="2400"></label>
   <label>南北深度 / m<input id="task3-scope-depth" type="number" min="1" step="100" value="2400"></label>
   <label>网格间距 / m<select id="task3-spacing"><option value="350">350（细）</option><option value="500" selected>500（标准）</option><option value="700">700（快）</option></select></label>
   <label>预算 / 相对单位<input id="task3-budget" type="number" min="100" max="1000" step="50" value="600"></label>
   <label>设备上限<input id="task3-max-devices" type="number" min="4" max="64" step="1" value="64"></label>
  </div>
  <p class="hint">范围以河南博物院为中心。采样与覆盖仅使用实际 GIS/DEM 数据，不外推无数据区域。</p><div id="task3-scope-status" class="hint" role="status">默认范围：东西 2400 m × 南北 2400 m。</div>
  <details><summary>四指标权重（和为 1）</summary><div class="task3-inputs" id="task3-weights">
   <label>覆盖完整性<input type="number" data-weight="coverage" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.coverage}"></label>
   <label>盲区占比<input type="number" data-weight="blind" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.blind}"></label>
   <label>成本<input type="number" data-weight="cost" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.cost}"></label>
   <label>施工可行性<input type="number" data-weight="feasibility" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.feasibility}"></label>
  </div><p class="hint">成本为相对单位，<strong>非人民币报价</strong>。</p></details>
  <div class="buttons"><button id="task3-run" class="primary">▶ 开始推演</button><button id="task3-cancel" disabled>取消</button></div>
  <progress id="task3-progress" max="1" value="0"></progress><div id="task3-status" role="status">待命</div>`;
 const pipelineModule=document.createElement('section');pipelineModule.className='task3-floating-module';pipelineModule.innerHTML=`<ol id="task3-pipeline" class="task3-pipeline">${PIPELINE_STAGES.map(s=>`<li data-stage="${s}">${STAGE_NAMES[s]}</li>`).join('')}</ol>`;
 const plansModule=document.createElement('section');plansModule.className='task3-floating-module';plansModule.innerHTML=`<div id="task3-plans-table"></div><label>当前方案<select id="task3-plan"></select></label><div id="task3-plan-detail"></div><details><summary>当前方案设备（类型 / 型号）</summary><div id="task3-device-list"></div></details>`;
 const emcModule=document.createElement('section');emcModule.className='task3-floating-module';emcModule.innerHTML='<div id="task3-emc"></div>';
 const windows={};
 for(const [key,triggerId,id,title,content,width,height] of [
  ['input','task3-open-input','task3-window-input','推演输入',inputModule,480,620],
  ['pipeline','task3-open-pipeline','task3-window-pipeline','流水线',pipelineModule,360,500],
  ['plans','task3-open-plans','task3-window-plans','方案对比',plansModule,720,580],
  ['emc','task3-open-emc','task3-window-emc','电磁兼容',emcModule,680,540],
 ]){
  const trigger=$(triggerId);windows[key]=createFloatingWindow({container:floatingLayer,id,title,content,width,height,returnFocus:trigger,onOpen:()=>trigger.setAttribute('aria-expanded','true'),onClose:()=>trigger.setAttribute('aria-expanded','false')});
  trigger.onclick=()=>windows[key].open();
 }
 const setStatus=(text,tone='')=>{const status=$('task3-status');status.textContent=text;status.dataset.tone=tone;};
 // 装备勾选
 $('task3-equipment').replaceChildren(...PRESETS.map(p=>{const l=document.createElement('label');l.className='task3-equip';const c=document.createElement('input');c.type='checkbox';c.checked=true;c.value=p.id;l.append(c,document.createTextNode(`${TYPES[p.type]} · ${p.name}`));return l;}));
 $('task3-threat').replaceChildren(...Object.entries(THREAT_SCENARIOS).map(([k,s])=>new Option(s.name,k)));
 let report=null,run=null,originalRun=null,worker=null,busy=false,plan=null,blindMeshes={},targetMeshes=[],detectLines=null,deviceMeshes=[],playing=false,frameIndex=0,rafId=0,lastStamp=0,deviceDisplay=createDeviceDisplayMap(),mobileSnapshots=new Map(),mobileRequestId=0,mobilePending=false;
 const setMobileStatus=(text,tone='')=>{const status=$('task3-mobile-status');status.textContent=text;status.dataset.tone=tone;};
 function restoreMobileRepair(){
  if(!report||!plan)return false;const snapshot=mobileSnapshots.get(plan.id);if(!snapshot)return false;
  restoreMobileRepairSnapshot(report,snapshot);mobileSnapshots.delete(plan.id);plan=snapshot.plan;run=originalRun;return true;
 }
 const conditionIndex=()=>report?report.conditions.findIndex(c=>c.id===$('task3-condition').value):0;
 function deviceHoverDetails({deviceId,deployment}){
  const index=plan?.devices.findIndex(d=>d.id===deviceId)??-1;if(index<0||!report)return null;
  const device=plan.devices[index],display=deviceDisplay.details(deviceId),site=device.deployment??deployment??plan.sites[index],condition=report.conditions[conditionIndex()];
  const contribution=plan.coverageContributions?.[deviceId]?.find(row=>row.condition===condition?.id),total=plan.metrics.find(row=>row.condition===condition?.id)?.total;
  const coverage=contribution?`覆盖 ${contribution.coveredSamples}${Number.isFinite(total)?`/${total}`:''} 个采样；独立覆盖 ${contribution.independentSamples} 个`:'未提供';
  return {title:display?.displayName??'未提供',rows:[
   {label:'中文类型',value:display?.typeName??'未提供'},{label:'型号',value:display?.modelName??'未提供'},
   {label:'东坐标',value:formatCoordinate(device.position?.[0])},{label:'北坐标',value:formatCoordinate(Number.isFinite(device.position?.[2])?-device.position[2]:null)},{label:'上坐标',value:formatCoordinate(device.position?.[1])},
   {label:'部署位置',value:typeof site==='string'?site:site?.name??site?.location??'未提供'},{label:'部署方式',value:typeof site==='object'?site?.installation??site?.method??'未提供':'未提供'},
   {label:'适用工作频段',value:formatWorkingBand(device)},{label:`覆盖贡献 · ${condition?.name??'当前工况'}`,value:coverage},{label:'该设备 EMC 状态',value:formatDeviceEmc(report.emc?.[plan.id],deviceId)},
  ]};
 }
 const deviceHover=createDeviceHover({canvas:renderer.domElement,camera,container:renderer.domElement.parentElement,getTargets:()=>deviceMeshes,getDetails:deviceHoverDetails,isEnabled:()=>!panel.hidden&&!busy&&layer.visible});
 function stage(id,cls){for(const li of app.querySelectorAll('#task3-pipeline li'))if(li.dataset.stage===id)li.className=cls;}
 function resetStages(){for(const li of app.querySelectorAll('#task3-pipeline li'))li.className='';}
 function focus(position,span=700){controls.target.fromArray(position);camera.position.fromArray(position).add(new THREE.Vector3(span*.55,span*.9,span*.75));controls.update();}
 function destroyLayer(){deviceHover.hide();for(const child of [...layer.children]){child.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});layer.remove(child);}blindMeshes={};targetMeshes=[];detectLines=null;deviceMeshes=[];}
 function drawCommon(){
  destroyLayer();if(!report||!plan)return;
  const b=report.sampling.bounds,core=[];for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;core.push([b.core[0]+Math.cos(a)*report.settings.coreRadius,b.core[1]+8,b.core[2]+Math.sin(a)*report.settings.coreRadius]);}
  layer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(core.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:0xffd783,transparent:true,opacity:.7})));
  // 共址设备仅以标记小幅水平错位避免互相遮挡；详情、计算和导出始终使用设备原始坐标。
  const positionGroups=new Map();for(const [index,d] of plan.devices.entries()){const key=d.position.join(','),group=positionGroups.get(key)??[];group.push(index);positionGroups.set(key,group);}
  const markerPositions=plan.devices.map(d=>[...d.position]);
  for(const group of positionGroups.values())if(group.length>1){const radius=group.length===2?26:25/Math.sin(Math.PI/group.length);for(const [slot,index] of group.entries()){const angle=slot/group.length*Math.PI*2;markerPositions[index][0]+=Math.cos(angle)*radius;markerPositions[index][2]+=Math.sin(angle)*radius;}}
  for(const [index,d] of plan.devices.entries()){
   const display=deviceDisplay.details(d.id),deployment=d.deployment??plan.sites[index]??null,mobile=d.mobileRepair?.platform==='police-car'||deployment?.deployment==='police-car';
   const geometry=mobile?new THREE.ConeGeometry(25,46,4):new THREE.SphereGeometry(22,10,7),material=new THREE.MeshBasicMaterial({color:mobile?0xff9f5a:COLORS[d.type],depthTest:false}),mesh=new THREE.Mesh(geometry,material);
   mesh.position.fromArray(markerPositions[index]);mesh.name=deviceDisplay.nameOf(d.id);mesh.userData={deviceId:d.id,deployment,actualPosition:[...d.position],displayName:display.displayName,typeName:display.typeName,modelName:display.modelName,isMobile:mobile};layer.add(mesh);deviceMeshes.push(mesh);
  }
  // 盲区点：按类别分 InstancedMesh，图例开关控制可见性
  const rows=report.blindspots[plan.id]??[],row=rows[conditionIndex()]??rows[0];
  const byCat={};for(const p of row?.points??[])(byCat[p.category]??=[]).push(p);
  for(const [cat,points] of Object.entries(byCat)){
   const mesh=new THREE.InstancedMesh(new THREE.SphereGeometry(15,6,4),new THREE.MeshBasicMaterial({color:BLIND_COLORS[cat],depthTest:false,transparent:true,opacity:.85}),points.length);
   const m4=new THREE.Matrix4();points.forEach((p,i)=>{m4.makeTranslation(...p.position);mesh.setMatrixAt(i,m4);});
   mesh.visible=app.querySelector(`input[data-category="${cat}"]`)?.checked??true;layer.add(mesh);blindMeshes[cat]={mesh,points};
  }
  renderBlindList(row);
 }
 function renderBlindList(row){
  const counts=row?.stats.byCategory??{};for(const [key] of Object.entries(BLIND_CATEGORIES)){const el=app.querySelector(`b[data-count="${key}"]`);if(el)el.textContent=counts[key]?` ${counts[key]}`:' 0';}
  const list=$('task3-blind-list');list.replaceChildren();
  if(!row?.points?.length){list.innerHTML='<p class="hint">当前工况采样点全部覆盖，无盲区。</p>';return;}
  for(const p of row.points){const b=document.createElement('button');b.className='task3-blind-item';b.style.borderLeftColor=`#${BLIND_COLORS[p.category].toString(16).padStart(6,'0')}`;
   const cause=p.category==='gap'?`缝宽 ${p.cause.gapWidthM.toFixed(0)} m`:p.category==='shadow'?`遮挡距 ${p.cause.blockerDistanceM.toFixed(0)} m`:p.category==='lowFacade'?`贴楼 ${p.cause.distanceToFacadeM.toFixed(1)} m · 离地 ${p.agl} m`:p.category==='corner'?`距角部 ${p.cause.cornerDistanceM.toFixed(1)} m`:'不满足四类几何特征';
   b.textContent=`${BLIND_CATEGORIES[p.category]} · ${cause}`;b.onclick=()=>focus(p.position,500);list.append(b);}
 }
 function renderPlans(){
  const t=report.comparison,table=document.createElement('table');table.className='task3-table';
  table.innerHTML=`<thead><tr><th>排名</th><th>方案</th><th>设备</th><th>覆盖完整性</th><th>盲区占比</th><th>成本*</th><th>可行性</th><th>EMC</th><th>得分</th></tr></thead>`;
  const tbody=document.createElement('tbody');
  for(const r of t.rows){const tr=document.createElement('tr');if(r.id===report.recommendedId)tr.className='recommended';const emc=mobileSnapshots.get(r.id)?.emc??report.emc[r.id];
   tr.innerHTML=`<td>${r.rank}</td><td>${r.name}${r.id===report.recommendedId?' ★':''}</td><td>${r.deviceCount}</td><td>${percent(r.coverage)}</td><td>${percent(r.blindRatio)}</td><td>${r.cost.toFixed(1)}</td><td>${r.feasibility.toFixed(2)}</td><td>${VERDICT[emc.verdict]}</td><td>${r.score.toFixed(3)}</td>`;
   tbody.append(tr);}
  table.append(tbody);$('task3-plans-table').replaceChildren(table);
  $('task3-plans-table').insertAdjacentHTML('beforeend',`<p class="hint">* 相对成本单位，非人民币报价。上表始终是原方案比较结果。${plan.derivation?' 当前为后加移动补盲派生方案，新增设备与成本不参与原排名。':''}</p>`);
  $('task3-plan').replaceChildren(...report.plans.map(p=>new Option(`${p.name}${p.derivation?' + 移动补盲':''} · ${p.devices.length} 台`,p.id,false,p.id===plan.id)));
  const s=report.scoring.plans.find(r=>r.id===plan.id),m=plan.metrics[conditionIndex()],derived=plan.derivation;
  $('task3-plan-detail').innerHTML='';const rows=[['当前工况采样覆盖',`${m.covered}/${m.total} · ${percent(m.coverageRate)}`],['采样盲区占比',percent(m.blindRate)],['核心区覆盖 / 二重覆盖',`${percent(m.coreCoverageRate)} / ${percent(m.coreRedundantRate)}`],[derived?'原方案施工可行性代理':'施工可行性代理',s.indicators.feasibility.toFixed(3)],['EMC 结论',`${VERDICT[report.emc[plan.id].verdict]}（严重 ${report.emc[plan.id].counts.fail} · 提示 ${report.emc[plan.id].counts.warning}）`]];
  if(derived)rows.push(['派生状态',`原方案 + 警车移动补盲 · 新增 ${derived.addedDeviceCount} 台`],['成本口径',`${derived.baseCost.toFixed(1)} + ${derived.addedCost.toFixed(1)} = ${derived.totalCost.toFixed(1)} 相对单位（后加，不参与原排名）`]);
  else rows.push(['方案成本',`${plan.cost.toFixed(1)} 相对单位`]);
  for(const [k,v] of rows){const d=document.createElement('div');d.className='sensor-metric';d.innerHTML=`<span>${k}</span><strong>${v}</strong>`;$('task3-plan-detail').append(d);}
  const devices=document.createElement('table');devices.className='task3-table task3-device-table';devices.innerHTML='<thead><tr><th>设备</th><th>类型</th><th>型号</th><th>部署</th></tr></thead>';
  const deviceRows=document.createElement('tbody');for(const [index,entry] of deviceDisplay.entries.entries()){const tr=document.createElement('tr'),mobile=plan.devices[index].mobileRepair?.platform==='police-car';tr.innerHTML=`<td>${entry.displayName}</td><td>${entry.typeName}</td><td>${entry.modelName}</td><td>${mobile?'警车移动部署':'原方案'}</td>`;deviceRows.append(tr);}devices.append(deviceRows);$('task3-device-list').replaceChildren(devices);
 }
 function renderEmc(){
  const e=report.emc[plan.id],box=$('task3-emc');box.replaceChildren();
  const banner=document.createElement('div');banner.className=`task3-emc-banner ${e.verdict}`;banner.textContent=e.text;box.append(banner);
  if(e.conflicts.length){const t=document.createElement('table');t.className='task3-table';t.innerHTML='<thead><tr><th>设备对</th><th>类型</th><th>严重度</th><th>距离/m</th><th>建议</th></tr></thead>';const tb=document.createElement('tbody');
   for(const c of e.conflicts.slice(0,50)){const tr=document.createElement('tr');tr.innerHTML=`<td>${deviceDisplay.nameOf(c.a)} ↔ ${deviceDisplay.nameOf(c.b)}</td><td>${EMC_KIND[c.kind]??c.kind}</td><td>${EMC_SEVERITY[c.severity]??c.severity}</td><td>${formatEmcDistance(c.distanceM)}</td><td>${c.recommendation}</td>`;tb.append(tr);}t.append(tb);box.append(t);
   if(e.conflicts.length>50)box.insertAdjacentHTML('beforeend',`<p class="hint">仅列前 50 条，共 ${e.conflicts.length} 条，完整清单见导出 JSON。</p>`);}
  box.insertAdjacentHTML('beforeend',`<p class="hint">${e.mobileRepair?`已按原方案 + ${plan.derivation?.addedDeviceCount??0} 台移动设备重算；新增 fail ${e.mobileRepair.newFailCount} 项。`:''} ${e.notes.join('；')||''} 工程代理规则，非频谱合规认证。</p>`);
 }
 function renderThreatSummary(){
  const key=$('task3-threat').value,th=report.threats[key],s=th.summary;
  $('task3-threat-summary').innerHTML='';
  for(const [k,v] of [['推演目标',`${s.targetCount} 架`],['被真实检出',`${th.perTarget.filter(p=>p.firstDetectionTime!==null).length} 架`],['平均首报',s.meanFirstDetectionTime===null?'—':`${s.meanFirstDetectionTime.toFixed(1)} s`],['平均检出占比',percent(s.meanDetectedFraction)],['容量溢出架次',`${s.overflowEvents}`]]){const d=document.createElement('div');d.className='sensor-metric';d.innerHTML=`<span>${k}</span><strong>${v}</strong>`;$('task3-threat-summary').append(d);}
  const mobileThreatNote=plan.derivation?' 当前处于移动补盲派生状态；以上威胁结果仍采用原推荐方案，未对移动派生方案重新计算。':'';
  $('task3-threat-summary').insertAdjacentHTML('beforeend',`<p class="hint">${th.text}${mobileThreatNote}</p>`);
  $('task3-threat-list').replaceChildren(...th.perTarget.map(p=>{const b=document.createElement('button');b.className='task3-blind-item';b.textContent=`${p.id} · 首报 ${p.firstDetectionTime===null?'未检出':clock(p.firstDetectionTime)} · 检出 ${percent(p.detectedFraction)}`;return b;}));
 }
 function installThreatFrame(){
  const key=$('task3-threat').value,th=report.threats[key];if(!th?.frames?.length)return;
  const frames=th.frames,index=Math.min(frames.length-1,frameIndex),frame=frames[index];
  for(const mesh of targetMeshes){layer.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
  targetMeshes=[];
  for(const t of frame.targets){
   const mesh=new THREE.Mesh(new THREE.SphereGeometry(t.detectedBy.length?12:9,10,7),new THREE.MeshBasicMaterial({color:t.detectedBy.length?0xff776d:0xffd783,depthTest:false}));mesh.position.fromArray(t.position);layer.add(mesh);targetMeshes.push(mesh);
  }
  if(detectLines){layer.remove(detectLines);detectLines.geometry.dispose();detectLines.material.dispose();detectLines=null;}
  const pts=[];for(const t of frame.targets)for(const d of t.detectedBy){const device=plan.devices.find(x=>x.id===d.id);if(device){pts.push(device.position,t.position);}}
  if(pts.length){detectLines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:0xff776d,transparent:true,opacity:.55}));layer.add(detectLines);}
  const dur=frames.at(-1).time;$('task3-threat-clock').textContent=`${clock(frame.time)} / ${clock(dur)}`;$('task3-threat-seek').value=dur?frame.time/dur*1000:0;
  updateDiagnostics();
 }
 function threatPlayLoop(stamp){
  if(!playing)return;
  const key=$('task3-threat').value,th=report.threats[key];if(!th?.frames?.length){playing=false;return;}
  if(lastStamp)frameTime+=Math.min(0.2,(stamp-lastStamp)/1000)*10;lastStamp=stamp;
  const dur=th.frames.at(-1).time;
  if(frameTime>=dur){frameTime=dur;playing=false;$('task3-threat-play').textContent='↺ 再次播放';}
  const idx=Math.min(th.frames.length-1,th.frames.findIndex(f=>f.time>=frameTime));
  if(idx!==frameIndex&&idx>=0){frameIndex=idx;installThreatFrame();}
  rafId=requestAnimationFrame(threatPlayLoop);
 }
 let frameTime=0;
 function stopPlayback(){playing=false;lastStamp=0;cancelAnimationFrame(rafId);$('task3-threat-play').textContent='▶ 播放推演';updateDiagnostics();}
 function updateDiagnostics(){const view=renderer.domElement.parentElement;camera.updateMatrixWorld();window.task3Diagnostics={ready:!!report,busy,mobilePending,version:TASK3_VERSION,plans:report?.plans.map(p=>({id:p.id,devices:p.devices.length,cost:p.cost})),recommendedId:report?.recommendedId,planId:plan?.id,blindStats:report&&plan?report.blindspots[plan.id]?.[conditionIndex()]?.stats:null,mobileRepair:report?.mobileRepair??null,threatScenario:$('task3-threat').value,threatSummary:report?.threats?.[$('task3-threat').value]?.summary??null,emcVerdict:report&&plan?report.emc[plan.id].verdict:null,emcCounts:report&&plan?{...report.emc[plan.id].counts}:null,playing,frameIndex,condition:$('task3-condition').value,deviceMarkers:deviceMeshes.map(mesh=>{const p=mesh.position.clone().project(camera);return {deviceId:mesh.userData.deviceId,isMobile:mesh.userData.isMobile,deployment:mesh.userData.deployment?.deployment??null,x:(p.x+1)/2*view.clientWidth,y:(1-p.y)/2*view.clientHeight,visible:p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1};})};}
 function controlsEnabled(){
  $('task3-run').disabled=busy;$('task3-cancel').disabled=!busy;for(const id of ['task3-plan','task3-condition','task3-threat','task3-export-current-doc','task3-export','task3-export-run'])$(id).disabled=busy||!report;
  $('task3-mobile-repair').disabled=busy||!report;$('task3-threat-play').disabled=busy||!report?.threats?.[$('task3-threat').value]?.frames?.length;$('task3-threat-reset').disabled=$('task3-threat-play').disabled;
 }
 function mobileFail(text){worker?.terminate();worker=null;busy=false;mobilePending=false;$('task3-mobile-repair').checked=false;restoreMobileRepair();setMobileStatus(`移动补盲失败：${text}`,'error');setStatus('移动补盲未完成，已保留原方案。','error');controlsEnabled();renderAll();}
 function getWorker(){if(worker)return worker;worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
   if(data.type==='progress'){const v=data.value;$('task3-progress').value=v.total?v.completed/v.total:0;stage(v.stage,'running');setStatus(`${STAGE_NAMES[v.stage]??v.stage} ${v.completed}/${v.total}`);}
   else if(data.type==='report'){
    busy=false;mobilePending=false;mobileRequestId++;mobileSnapshots=new Map();({report,run}=data);originalRun=run;plan=report.plans.find(p=>p.id===report.recommendedId);$('task3-mobile-repair').checked=false;
    for(const s of PIPELINE_STAGES)stage(s,'done');$('task3-condition').replaceChildren(...report.conditions.map(c=>new Option(c.name,c.id)));stopPlayback();frameIndex=0;frameTime=0;renderAll();
    setMobileStatus('可勾选启用；只搜索当前方案、当前工况的盲点。');setStatus(`推演完成 · ${report.candidateCount} 候选 / ${report.sampling.samples.length} 采样 / ${(report.durationMs/1000).toFixed(1)} s · 推荐「${plan.name}」`);controlsEnabled();updateDiagnostics();
   }else if(data.type==='mobile-progress'){
    if(data.requestId!==mobileRequestId||!mobilePending)return;const v=data.value,label={search:'搜索地表候选并逐点实判',select:'贪心选择并校核 EMC',recalculate:'重算全部工况与设备贡献'}[v.stage]??'移动补盲';
    setMobileStatus(`${label} ${v.completed}/${v.total}`);setStatus(`移动补盲后台计算中：${label} ${v.completed}/${v.total}`);updateDiagnostics();
   }else if(data.type==='mobile-repair-result'){
    if(data.requestId!==mobileRequestId||!mobilePending)return;const result=data.result;if(result.planId!==plan.id){mobileFail('方案已变化，结果未应用');return;}
    const snapshot=applyMobileRepairResult(report,result);mobileSnapshots.set(result.planId,snapshot);plan=result.plan;busy=false;mobilePending=false;
    run={...originalRun,mobileRepair:{summary:result.summary,plan:result.plan,blindspots:result.blindspots,emc:result.emc}};
    renderAll();setMobileStatus(result.summary.message,['no-radar','no-candidate','emc-unavailable'].includes(result.summary.status)?'warning':'');setStatus(result.summary.message);controlsEnabled();updateDiagnostics();
   }else if(data.type==='error'){if(data.operation==='mobile-repair'){if(data.requestId===mobileRequestId&&mobilePending)mobileFail(data.message);}else fail(data.message);}
  };
  worker.onerror=e=>{if(mobilePending)mobileFail(e.message||'后台移动补盲失败');else fail(e.message||'后台计算失败');};return worker;}
 function renderScopeStatus(){
  const scope=report?.scope??report?.sampling?.dataCoverage,status=$('task3-scope-status');if(!scope)return;
  const size=`东西 ${scope.widthM.toFixed(0)} m × 南北 ${scope.depthM.toFixed(0)} m`;status.dataset.tone=scope.clipped?'warning':'';
  status.textContent=scope.clipped?`地形数据未覆盖全部请求范围，已按有效区域裁切（${size}）；仅计算有数据的区域，不外推覆盖。`:`本次范围：${size}。采样与覆盖未外推无数据区域。`;
 }
 function fail(text){worker?.terminate();worker=null;busy=false;resetStages();setStatus(`无法完成推演：${friendlyError(text)}`,'error');controlsEnabled();updateDiagnostics();}
 function renderAll(){deviceDisplay=createDeviceDisplayMap(plan.devices);renderScopeStatus();renderPlans();renderEmc();renderThreatSummary();drawCommon();updateDiagnostics();}
 // 事件
 button.onclick=()=>{workspace.activateView('task3');floatingLayer.hidden=false;layer.visible=true;};
 app.addEventListener('view-change',event=>{if(event.detail!=='task3'){deviceHover.hide();panel.hidden=true;floatingLayer.hidden=true;layer.visible=false;stopPlayback();}});
 $('task3-back').onclick=()=>{workspace.showWindow('city');deviceHover.hide();floatingLayer.hidden=true;layer.visible=false;stopPlayback();};
 $('task3-run').onclick=()=>{if(busy)return;const presetIds=[...app.querySelectorAll('#task3-equipment input:checked')].map(c=>c.value);
  const weights={};for(const input of app.querySelectorAll('#task3-weights input'))weights[input.dataset.weight]=Number(input.value);
  const widthInput=$('task3-scope-width'),depthInput=$('task3-scope-depth'),widthText=widthInput.value.trim(),depthText=depthInput.value.trim(),scopeWidthM=Number(widthText),scopeDepthM=Number(depthText);
  widthInput.removeAttribute('aria-invalid');depthInput.removeAttribute('aria-invalid');
  if(!widthText||!depthText||!Number.isFinite(scopeWidthM)||!Number.isFinite(scopeDepthM)||scopeWidthM<=0||scopeDepthM<=0){
   if(!widthText||!Number.isFinite(scopeWidthM)||scopeWidthM<=0)widthInput.setAttribute('aria-invalid','true');
   if(!depthText||!Number.isFinite(scopeDepthM)||scopeDepthM<=0)depthInput.setAttribute('aria-invalid','true');
   setStatus('无法开始：东西宽度和南北深度都必须是大于 0 的有效数字。','error');(widthInput.getAttribute('aria-invalid')?widthInput:depthInput).focus();return;
  }
  const current=sensors.getScenario(),custom=scopeWidthM!==2400||scopeDepthM!==2400;
  const settings={scope:custom?'custom':'core',scopeWidthM,scopeDepthM,spacing:Number($('task3-spacing').value),heights:[30,60,100],siteSpacing:500,maxSites:192,maxDevices:Number($('task3-max-devices').value),budget:Number($('task3-budget').value),costs:{radar:12,radio:5,optical:4,acoustic:2},coreRadius:700,coreWeight:3,marginReserveDb:3};
  restoreMobileRepair();mobileSnapshots=new Map();mobilePending=false;mobileRequestId++;originalRun=null;run=null;$('task3-mobile-repair').checked=false;setMobileStatus('重新推演中，移动补盲已清理。');
  busy=true;resetStages();destroyLayer();report=null;controlsEnabled();updateDiagnostics();setStatus('后台计算中，地图仍可操作。');
  getWorker().postMessage({type:'pipeline',baseURL:new URL('./',location.href).href,settings,weights,presetIds,environment:current.environment,target:current.target});};
 $('task3-cancel').onclick=()=>{const wasMobile=mobilePending;worker?.terminate();worker=null;busy=false;mobilePending=false;mobileRequestId++;if(wasMobile){$('task3-mobile-repair').checked=false;restoreMobileRepair();setMobileStatus('已取消移动补盲，原方案与盲点保持不变。');if(report&&plan)renderAll();}resetStages();setStatus('已取消。');controlsEnabled();updateDiagnostics();};
 $('task3-plan').onchange=()=>{restoreMobileRepair();$('task3-mobile-repair').checked=false;setMobileStatus('已切换方案并清理移动补盲，可按当前方案重新启用。');plan=report.plans.find(p=>p.id===$('task3-plan').value);stopPlayback();frameIndex=0;frameTime=0;renderAll();};
 $('task3-condition').onchange=()=>{renderPlans();drawCommon();updateDiagnostics();};
 $('task3-threat').onchange=()=>{stopPlayback();frameIndex=0;frameTime=0;renderThreatSummary();installThreatFrame();controlsEnabled();};
 $('task3-threat-play').onclick=()=>{if(!report)return;if(playing){stopPlayback();return;}const th=report.threats[$('task3-threat').value];if(frameTime>=th.frames.at(-1).time){frameTime=0;frameIndex=0;}playing=true;lastStamp=0;$('task3-threat-play').textContent='Ⅱ 暂停';rafId=requestAnimationFrame(threatPlayLoop);};
 $('task3-threat-reset').onclick=()=>{stopPlayback();frameIndex=0;frameTime=0;installThreatFrame();};
 $('task3-threat-seek').oninput=()=>{const th=report?.threats?.[$('task3-threat').value];if(!th?.frames?.length)return;stopPlayback();frameTime=Number($('task3-threat-seek').value)/1000*th.frames.at(-1).time;const idx=th.frames.findIndex(f=>f.time>=frameTime);frameIndex=Math.max(0,Math.min(th.frames.length-1,idx));installThreatFrame();};
 $('task3-mobile-repair').onchange=()=>{
  const checkbox=$('task3-mobile-repair');if(busy||!report||!plan){checkbox.checked=mobilePending;return;}
  if(!checkbox.checked){restoreMobileRepair();renderAll();setMobileStatus('已取消移动补盲，恢复原方案设备、盲点、覆盖贡献与 EMC。');setStatus('已恢复原方案。');return;}
  if(mobileSnapshots.has(plan.id))return; // 重复勾选不叠加设备或重复请求。
  busy=true;mobilePending=true;const requestId=++mobileRequestId;deviceHover.hide();stopPlayback();setMobileStatus('正在后台搜索当前盲点附近的有效地表候选…');setStatus('移动补盲后台计算中，不会重跑整套流水线。');controlsEnabled();updateDiagnostics();
  getWorker().postMessage({type:'mobile-repair',requestId,baseURL:new URL('./',location.href).href,input:{plan,sampling:report.sampling,equipment:report.equipment,settings:report.settings,environment:report.environment,target:report.target,conditionId:$('task3-condition').value}});
 };
 for(const cb of app.querySelectorAll('#task3-blind-legend input'))cb.onchange=()=>{for(const [cat,{mesh}] of Object.entries(blindMeshes))mesh.visible=app.querySelector(`input[data-category="${cat}"]`).checked;};
 let documentRules=null;
 async function loadDocumentRules(){
  if(documentRules)return documentRules;
  const response=await fetch(new URL('data/task3-doc-rules.json',new URL('./',location.href)));if(!response.ok)throw Error('缺少真实多轮规则数据，请先运行 node scripts/task3_standard_doc.js');
  const data=await response.json();if(data.schema!=='task3-deployment-rules/1.0'||!Array.isArray(data.rules))throw Error('多轮规则数据格式无效');documentRules=data.rules;return documentRules;
 }
 $('task3-export-default-doc').onclick=()=>{const a=document.createElement('a');a.href=new URL('task3-standard-deployment.html',new URL('./',location.href)).href;a.download='任务三标准布设方案.html';document.body.append(a);a.click();a.remove();};
 $('task3-export-current-doc').onclick=async()=>{
  if(!report||!run||!plan)return;const currentButton=$('task3-export-current-doc');currentButton.disabled=true;
  try{
   const rules=await loadDocumentRules(),conditionId=report.conditions[conditionIndex()]?.id??'nominal';
   const html=createDeploymentHtml({report,run,activePlanId:plan.id,rules,conditionId,documentKind:'current'}),blob=new Blob([html],{type:'text/html;charset=utf-8'}),a=document.createElement('a');
   a.href=URL.createObjectURL(blob);a.download=`任务三当前布设方案-${run.runId}-${plan.id}.html`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);setStatus(`已按当前 ${plan.name} 与 ${run.runId} 生成离线 HTML。`);
  }catch(error){setStatus(`无法生成当前方案 HTML：${error.message}`,'error');}
  finally{controlsEnabled();}
 };
 $('task3-export').onclick=()=>{if(!report)return;const blob=new Blob([JSON.stringify({report,activePlanId:plan.id,deviceDisplay:deviceDisplay.toJSON()},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='task3-deployment-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
 $('task3-export-run').onclick=()=>{if(!run)return;const blob=new Blob([JSON.stringify(run,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${run.runId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
 controlsEnabled();updateDiagnostics();
 return {panel,layer,setStatus};
}
