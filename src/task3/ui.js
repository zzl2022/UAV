import * as THREE from 'three';
import {PRESETS,TYPES} from '../sensors/presets.js';
import {BLIND_COLORS,BLIND_CATEGORIES,TASK3_VERSION,METRIC_WEIGHTS,METRIC_LABELS,THREAT_SCENARIOS,DEFAULT_THREAT_CONFIGS,EQUIPMENT_FACTS} from './constants.js';
import {STAGE_NAMES,resolveTask3EquipmentSelection} from './pipeline.js';
import {parseTask3Spacing,resolveTask3Settings} from './scope.js';
import {createTask3RequestSnapshot,createTask3RunScheduler} from './live-optimization.js';
import {createDeviceDisplayMap} from './device-display.js';
import {createDeviceHover} from './device-hover.js';
import {applyMobileRepairResult,restoreMobileRepairSnapshot} from './mobile-repair.js';
import {exportDeploymentPdf} from './deployment-pdf.js';
import {normalizeThreatConfig} from './threats.js';
import {createDroneMesh} from '../planning/drone-mesh.js';
import {flightTelemetry} from '../planning/telemetry.js';
import {terrainSampler} from '../sensors/terrain-query.js';
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

export function mountTask3UI({app,city,terrain,scene,camera,controls,renderer,sensors,model,workspace,getSite,simulation=null}){
 const panel=document.createElement('div');panel.id='task3-panel';panel.hidden=true;
 panel.innerHTML=`<div class="brand"><span class="mark">◇</span> 任务三 · 优化部署推演</div>
 <p id="task3-result-freshness" class="task3-result-freshness" role="status" hidden></p>
 <nav class="task3-tabs" aria-label="功能类别">
  <button type="button" data-tab="input" aria-selected="true">推演输入</button>
  <button type="button" data-tab="plans" aria-selected="false">方案对比</button>
  <button type="button" data-tab="blindspots" aria-selected="false">盲区分布</button>
  <button type="button" data-tab="emc" aria-selected="false">电磁兼容</button>
  <button type="button" data-tab="flight" aria-selected="false">飞行演示</button>
 </nav>
 <div class="task3-body">
  <nav class="task3-subnav" aria-label="子模块"></nav>
  <div class="task3-content"></div>
 </div>
 <div class="task3-footer">
  <button id="task3-restore-defaults">恢复默认</button>
  <button id="task3-export-pdf" disabled>导出部署方案 PDF ↓</button>
 </div>`;
 workspace.mountSidebarPanel(panel,'task3');
 const $=id=>app.querySelector('#'+id);
 // 推演入口统一放在主界面左下角信息栏，面板内不再重复放置开始/取消按钮。
 const sceneInfo=app.querySelector('.ac8-scene-info');
 if(sceneInfo){
  const sideRun=document.createElement('div');sideRun.className='ac8-info-runbar';sideRun.innerHTML=`<div class="ac8-info-run-head"><span class="ac8-info-label">[推演]</span><span id="task3-status-side" class="ac8-info-run-status" role="status">待命</span></div><div class="ac8-info-run-actions"><button id="task3-run-side" type="button" class="ac8-info-run-primary">▶ 开始推演</button><button id="task3-cancel-side" type="button" disabled>取消</button></div><progress id="task3-progress-side" max="1" value="0"></progress>`;
  sceneInfo.append(sideRun);
  $('task3-run-side').onclick=()=>{if(!busy)scheduler.start('手动推演');};
  $('task3-cancel-side').onclick=()=>{
   const wasMobile=mobilePending;if(!wasMobile)scheduler.cancel();activePipelineRequest=null;worker?.terminate();worker=null;busy=false;mobilePending=false;mobileReportRequestId=null;mobileRequestId++;
   if(wasMobile){$('task3-mobile-repair').checked=false;restoreMobileRepair();setMobileStatus('已取消移动补盲，原方案与盲点保持不变。');if(report&&plan){renderAll();publishSimulation();}}
   setStatus(wasMobile?'已取消移动补盲。':report?'已取消推演，保留上一轮成功结果（非最新参数结果）。':'已取消。');controlsEnabled();updateDiagnostics();
  };
 }
 const button=app.querySelector('#toggle-task3');button.disabled=false;
 const layer=new THREE.Group();layer.name='Task3_Pipeline';layer.visible=false;scene.add(layer);
 const view=renderer.domElement.parentElement;
 const threatHud=document.createElement('section');threatHud.id='threat-hud';threatHud.hidden=true;
 threatHud.innerHTML=`<div class="ac8-flight-block"><span class="ac8-flight-label">[场景]</span><div class="ac8-flight-target"><span id="threat-name">威胁推演</span><strong id="threat-live-state">待命</strong></div></div><div class="ac8-flight-block"><span class="ac8-flight-label">[目标]</span><div class="ac8-flight-value"><span id="threat-count">—</span><small>架</small></div></div><div class="ac8-flight-block"><span class="ac8-flight-label">[高度]</span><div class="ac8-flight-value"><span id="threat-agl">—</span><small>m</small></div></div><div class="ac8-flight-block"><span class="ac8-flight-label">[坐标]</span><div id="threat-coordinates">—</div></div><div class="ac8-flight-block"><span class="ac8-flight-label">[检出]</span><div class="ac8-flight-value"><span id="threat-detected">—</span><small>架</small></div></div>`;
 view.append(threatHud);
 const contentBox=panel.querySelector('.task3-content');
 const subnav=panel.querySelector('.task3-subnav');
 const equipPane=document.createElement('div');equipPane.className='task3-pane task3-pane-top';equipPane.innerHTML=`<section class="task3-selected-equipment"><h3>装备建模已选型号</h3><div id="task3-equipment"></div><p class="hint">型号随装备建模选择自动更新；优化计算直接采用对应已保存参数，无需在此重复选择。</p></section>`;
 const scopePane=document.createElement('div');scopePane.className='task3-pane';scopePane.innerHTML=`<div class="task3-inputs">
  <label>东西宽度 / m<input id="task3-scope-width" type="number" min="1" step="100" value="2400"></label>
  <label>南北深度 / m<input id="task3-scope-depth" type="number" min="1" step="100" value="2400"></label>
  <label>网格间距 / m<input id="task3-spacing" type="number" min="150" max="1000" step="1" value="500" aria-describedby="task3-spacing-hint"></label>
  <label>预算 / 相对单位<input id="task3-budget" type="number" min="100" max="1000" step="50" value="600"></label>
  <label>设备上限<input id="task3-max-devices" type="number" min="4" max="64" step="1" value="64"></label>
 </div>
 <p class="hint" id="task3-spacing-hint">网格间距可输入 150–1000 米。范围以河南博物院为中心；采样与覆盖仅使用实际 GIS/DEM 数据，不外推无数据区域。</p><div id="task3-scope-status" class="hint" role="status">默认范围：东西 2400 m × 南北 2400 m。</div>`;
 const weightsPane=document.createElement('div');weightsPane.className='task3-pane';weightsPane.innerHTML=`<div class="task3-inputs" id="task3-weights">
  <label>覆盖完整性<input type="number" data-weight="coverage" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.coverage}"></label>
  <label>盲区占比<input type="number" data-weight="blind" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.blind}"></label>
  <label>成本<input type="number" data-weight="cost" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.cost}"></label>
  <label>施工可行性<input type="number" data-weight="feasibility" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.feasibility}"></label>
 </div><p class="hint">成本为相对单位，<strong>非人民币报价</strong>。</p>
 <div class="task3-inputs" id="task3-costs">
  <label>雷达<input type="number" data-cost="radar" min="0.1" max="100" step="0.1" value="12"></label>
  <label>无线电<input type="number" data-cost="radio" min="0.1" max="100" step="0.1" value="5"></label>
  <label>光电<input type="number" data-cost="optical" min="0.1" max="100" step="0.1" value="4"></label>
  <label>声学<input type="number" data-cost="acoustic" min="0.1" max="100" step="0.1" value="2"></label>
 </div><p class="hint">直接参与方案成本与择优计算，并随报告和过程数据导出。</p>`;
 const threatPane=document.createElement('div');threatPane.className='task3-pane';threatPane.innerHTML=`<label>威胁场景<select id="task3-threat"></select></label>
  <div class="task3-threat-config" id="task3-threat-config">
   <label>目标数量 / 架<input id="task3-threat-count" type="number" min="1" max="128" step="1"></label>
   <label>攻击来向方位角 / °<input id="task3-threat-azimuths" type="text" inputmode="decimal" aria-describedby="task3-threat-coordinate-hint"></label>
   <label>离地高度 AGL / m<input id="task3-threat-agl" type="text" inputmode="decimal"></label>
   <label>飞行速度 / (m/s)<input id="task3-threat-speed" type="number" min="0.1" max="100" step="0.1"></label>
   <button id="task3-threat-defaults" type="button">恢复当前场景默认配置</button>
   <p class="hint" id="task3-threat-coordinate-hint">以核心目标正北为 0°，顺时针增加；多个角度、高度用逗号分隔。高度为离地高度，速度为轨迹标称速度。</p>
  </div>`;
 const mobilePane=document.createElement('div');mobilePane.className='task3-pane';mobilePane.innerHTML=`<label class="task3-mobile-toggle"><input id="task3-mobile-repair" type="checkbox" disabled>警车部署可移动雷达</label>
  <div id="task3-mobile-status" class="task3-mobile-status" role="status">完成推演后可启用移动补盲。</div>
  <p class="hint">只复用本次已选雷达预设。挂载高度 2 m 为模型假设；候选仅为开阔地表几何代理，现有数据不能验证道路可达。</p>`;
 const plansPane=document.createElement('div');plansPane.className='task3-pane';plansPane.innerHTML=`<div id="task3-plans-table"></div><label>当前方案<select id="task3-plan"></select></label><div id="task3-plan-detail"></div><details><summary>当前方案设备（类型 / 型号）</summary><div id="task3-device-list"></div></details>`;
 const blindspotsPane=document.createElement('div');blindspotsPane.className='task3-pane';blindspotsPane.innerHTML=`<label>覆盖工况<select id="task3-condition"></select></label>
  <div id="task3-blind-legend" class="task3-legend">${Object.entries(BLIND_CATEGORIES).map(([key,name])=>`<label><input type="checkbox" data-category="${key}" checked><i style="background:#${BLIND_COLORS[key].toString(16).padStart(6,'0')}"></i>${name}<b data-count="${key}"></b></label>`).join('')}</div>
  <div id="task3-blind-list"></div>`;
 const emcPane=document.createElement('div');emcPane.className='task3-pane';emcPane.innerHTML='<div id="task3-emc"></div>';
 const flightPane=document.createElement('div');flightPane.className='task3-pane task3-flight-pane';if(simulation?.panel)flightPane.append(simulation.panel);
 else flightPane.innerHTML='<p class="hint">飞行模块未挂载。</p>';
 const threatViewPane=document.createElement('div');threatViewPane.className='task3-pane';threatViewPane.innerHTML=`<label>威胁场景<select id="task3-threat-view"></select></label>
  <div id="task3-threat-summary"></div>
  <div class="buttons"><button id="task3-threat-play" class="primary" disabled>▶ 播放推演</button><button id="task3-threat-reset" disabled>↺ 回到起点</button></div>
  <input id="task3-threat-seek" type="range" min="0" max="1000" value="0" aria-label="推演进度"><div id="task3-threat-clock">00:00 / 00:00</div><div id="task3-threat-list"></div>
  <p class="hint">推演目标与警报按离散模型帧更新，运动按轨迹插值；事件记录见方案对比或导出 JSON。</p>`;
 const TABS={input:{subs:[['scope','范围参数',scopePane],['weights','权重成本',weightsPane],['threat','威胁场景',threatPane]],top:equipPane},plans:{subs:[],pane:plansPane},blindspots:{subs:[['blind','盲区分布',blindspotsPane],['mobile','警车部署',mobilePane]]},emc:{subs:[],pane:emcPane},flight:{subs:[['flight','单机飞行警报',flightPane],['threat','威胁推演',threatViewPane]],pane:flightPane}};
 let activeTab='input',activeSub='scope',task3WindowVisible=false,mapActive=true;
 contentBox.append(equipPane,scopePane,weightsPane,threatPane,mobilePane,plansPane,blindspotsPane,emcPane,flightPane,threatViewPane);
 function applyTab(){
  const tab=TABS[activeTab];subnav.replaceChildren();
  for(const [key,name] of tab.subs){const b=document.createElement('button');b.type='button';b.className='task3-subnav-btn';b.dataset.sub=key;b.setAttribute('aria-selected',String(key===activeSub));b.textContent=name;subnav.append(b);}
  subnav.hidden=!tab.subs.length;
  for(const btn of panel.querySelectorAll('.task3-tabs button'))btn.setAttribute('aria-selected',String(btn.dataset.tab===activeTab));
  for(const pane of contentBox.children)pane.hidden=true;
  if(tab.top)tab.top.hidden=false;
  if(tab.subs.length){const cur=tab.subs.find(s=>s[0]===activeSub);if(cur?.[2])cur[2].hidden=false;}
  else if(tab.pane)tab.pane.hidden=false;
  const flying=activeTab==='flight'&&activeSub==='flight';
  simulation?.setActive?.(flying&&!panel.hidden);
  if(activeTab!=='flight'||activeSub!=='threat'){stopThreatPlayback();hideThreatVisuals();}
  else if(report?.threats?.[threatKey()]){for(const line of threatRouteLines)line.visible=true;rebuildThreatRoutes();installThreatFrame();}
  updateLayerVisibility();
  updateDiagnostics();
 }
 for(const btn of panel.querySelectorAll('.task3-tabs button'))btn.onclick=()=>{activeTab=btn.dataset.tab;activeSub=TABS[activeTab].subs[0]?.[0]??null;applyTab();};
 subnav.addEventListener('click',event=>{const b=event.target.closest('[data-sub]');if(!b)return;activeSub=b.dataset.sub;applyTab();});
 const setStatus=(text,tone='')=>{const status=$('task3-status-side');status.textContent=text;status.dataset.tone=tone;};
 function renderEquipmentSelection(equipmentSnapshot=sensors.getEquipmentSnapshot()){
  const presetIds=resolveTask3EquipmentSelection(equipmentSnapshot);
  $('task3-equipment').replaceChildren(...presetIds.map(id=>{const preset=PRESETS.find(p=>p.id===id),row=document.createElement('div');row.className='task3-equip';row.dataset.presetId=id;row.textContent=`${TYPES[preset.type]} · ${preset.name}`;return row;}));
  return presetIds;
 }
 let report=null,run=null,originalRun=null,worker=null,busy=false,plan=null,blindMeshes={},deviceMeshes=[],deviceDisplay=createDeviceDisplayMap(),mobileSnapshots=new Map(),mobileRequestId=0,mobilePending=false,mobileReportRequestId=null,activePipelineRequest=null,lastRequestSnapshot=null,threatConfigs=structuredClone(DEFAULT_THREAT_CONFIGS);
 let threatPlaying=false,threatFrameIndex=0,threatFrameTime=0,threatLastStamp=0,threatRafId=0,targetMeshes=[],threatDrones=new Map(),threatDetectLines=null,threatRouteLines=[],threatSpeed=10,threatHudTimer=null,pendingThreatKey=null,task3SceneKey='recon';
 const setMobileStatus=(text,tone='')=>{const status=$('task3-mobile-status');status.textContent=text;status.dataset.tone=tone;};
 const parseThreatList=value=>String(value).split(/[,，\s]+/).filter(Boolean).map(Number);
function renderThreatConfig(){
  const config=threatConfigs[$('task3-threat').value];if(!config)return;
  $('task3-threat-count').value=config.count;$('task3-threat-azimuths').value=config.azimuthsDeg.join(',');$('task3-threat-agl').value=config.aglM.join(',');$('task3-threat-speed').value=config.speedMps;
}
function saveThreatConfigForm(){
  const key=$('task3-threat').value,azimuthsDeg=parseThreatList($('task3-threat-azimuths').value),aglM=parseThreatList($('task3-threat-agl').value);
  threatConfigs[key]={...threatConfigs[key],count:Number($('task3-threat-count').value),directions:azimuthsDeg.length,azimuthsDeg,aglM,speedMps:Number($('task3-threat-speed').value)};
}
function resolveThreatConfigs(){saveThreatConfigForm();return Object.fromEntries(Object.keys(THREAT_SCENARIOS).map(key=>[key,normalizeThreatConfig(key,threatConfigs[key])]));}
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
 function focus(position,span=700){controls.target.fromArray(position);camera.position.fromArray(position).add(new THREE.Vector3(span*.55,span*.9,span*.75));controls.update();}
 function updateLayerVisibility(){layer.visible=!!report&&!!plan&&mapActive&&!(activeTab==='flight'&&activeSub==='flight');}
 function destroyLayer(){deviceHover.hide();for(const child of [...layer.children]){child.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});layer.remove(child);}blindMeshes={};deviceMeshes=[];targetMeshes=[];threatDrones.clear();threatDetectLines=null;threatRouteLines=[];updateLayerVisibility();}
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
   mesh.position.fromArray(markerPositions[index]);mesh.name=deviceDisplay.nameOf(d.id);mesh.userData={deviceId:d.id,deviceType:d.type,deployment,actualPosition:[...d.position],displayName:display.displayName,typeName:display.typeName,modelName:display.modelName,isMobile:mobile};
   const halo=new THREE.Mesh(new THREE.RingGeometry(32,43,24),new THREE.MeshBasicMaterial({color:0xff675b,transparent:true,opacity:.8,depthTest:false,side:THREE.DoubleSide}));halo.visible=false;mesh.add(halo);mesh.userData.halo=halo;layer.add(mesh);deviceMeshes.push(mesh);
  }
  // 盲区点：按类别分 InstancedMesh，图例开关控制可见性
  const rows=report.blindspots[plan.id]??[],row=rows[conditionIndex()]??rows[0];
  const byCat={};for(const p of row?.points??[])(byCat[p.category]??=[]).push(p);
  for(const [cat,points] of Object.entries(byCat)){
   const mesh=new THREE.InstancedMesh(new THREE.SphereGeometry(15,6,4),new THREE.MeshBasicMaterial({color:BLIND_COLORS[cat],depthTest:false,transparent:true,opacity:.85}),points.length);
   const m4=new THREE.Matrix4();points.forEach((p,i)=>{m4.makeTranslation(...p.position);mesh.setMatrixAt(i,m4);});
   mesh.visible=app.querySelector(`input[data-category="${cat}"]`)?.checked??true;layer.add(mesh);blindMeshes[cat]={mesh,points};
  }
  renderBlindList(row);updateLayerVisibility();
 }
 function renderBlindList(row){
  const counts=row?.stats.byCategory??{};for(const [key] of Object.entries(BLIND_CATEGORIES)){const el=app.querySelector(`b[data-count="${key}"]`);if(el)el.textContent=counts[key]?` ${counts[key]}`:' 0';}
  const list=$('task3-blind-list');list.replaceChildren();
  if(!row?.points?.length){list.innerHTML='<p class="hint">当前工况采样点全部覆盖，无盲区。</p>';return;}
  for(const p of row.points){const b=document.createElement('button');b.className='task3-blind-item';b.style.borderLeftColor=`#${BLIND_COLORS[p.category].toString(16).padStart(6,'0')}`;
   const cause=p.category==='gap'?`缝宽 ${p.cause.gapWidthM.toFixed(0)} m`:p.category==='shadow'?`遮挡距 ${p.cause.blockerDistanceM.toFixed(0)} m`:p.category==='lowFacade'?`贴楼 ${p.cause.distanceToFacadeM.toFixed(1)} m · 离地 ${p.agl} m`:p.category==='corner'?`距角部 ${p.cause.cornerDistanceM.toFixed(1)} m`:'不满足四类几何特征';
   b.textContent=`${BLIND_CATEGORIES[p.category]} · ${cause}`;b.onclick=()=>focus(p.position,500);list.append(b);}
 }
 function threatKey(){return $('task3-threat-view').value||$('task3-threat').value;}
 function threatLabel(){return THREAT_SCENARIOS[threatKey()]?.name??'威胁推演';}
 function renderThreatOptions(){
  const select=$('task3-threat-view');if(!select)return;
  const current=select.value;
  select.replaceChildren(...Object.entries(THREAT_SCENARIOS).map(([k,s])=>new Option(s.name,k)));
  select.value=current&&THREAT_SCENARIOS[current]?current:$('task3-threat').value;
 }
 let threatGroundAt=null;
 function showThreatHud(){
  if(threatHudTimer){clearTimeout(threatHudTimer);threatHudTimer=null;}
  threatHud.hidden=false;requestAnimationFrame(()=>threatHud.classList.add('is-visible'));
 }
 function hideThreatHud(delay=0){
  if(threatHudTimer)clearTimeout(threatHudTimer);
  const retract=()=>{threatHud.classList.remove('is-visible');threatHudTimer=setTimeout(()=>{if(!threatHud.classList.contains('is-visible'))threatHud.hidden=true;threatHudTimer=null;},560);};
  if(delay>0)threatHudTimer=setTimeout(retract,delay);else{threatHudTimer=null;retract();}
 }
 function updateThreatHud(frame){
  if(!frame)return;
  const detected=frame.targets.filter(t=>t.detectedBy.length).length,primary=frame.targets[0];
  $('threat-name').textContent=threatLabel();
  $('threat-live-state').textContent=detected?'发现目标 · 报警':primary?'未检出':'待命';
  $('threat-count').textContent=String(frame.targets.length);
  $('threat-detected').textContent=String(detected);
  threatHud.dataset.alarm=detected?'alarm':'clear';
  if(primary){
   let telemetry=null;
   try{threatGroundAt??=terrainSampler(model.ground.geometry);telemetry=flightTelemetry(primary.position,city.metadata?.ecefTransform,threatGroundAt);}catch{}
   $('threat-agl').textContent=telemetry?.agl==null?'未知':telemetry.agl.toFixed(1);
   $('threat-coordinates').textContent=telemetry?`东经 ${telemetry.longitude.toFixed(6)}° · 北纬 ${telemetry.latitude.toFixed(6)}°`:'—';
  }
 }
 function renderThreatSummary(){
  if(!report)return;
  renderThreatOptions();
  const th=report.threats[threatKey()];if(!th)return;
  const s=th.summary,box=$('task3-threat-summary');box.innerHTML='';
  for(const [k,v] of [['推演目标',`${s.targetCount} 架`],['被真实检出',`${th.perTarget.filter(p=>p.firstDetectionTime!==null).length} 架`],['平均首报',s.meanFirstDetectionTime===null?'—':`${s.meanFirstDetectionTime.toFixed(1)} s`],['平均检出占比',percent(s.meanDetectedFraction)],['容量溢出架次',`${s.overflowEvents}`]]){const d=document.createElement('div');d.className='sensor-metric';d.innerHTML=`<span>${k}</span><strong>${v}</strong>`;box.append(d);}
  const mobileThreatNote=plan?.derivation?' 当前处于移动补盲派生状态；以上威胁结果仍采用原推荐方案，未对移动派生方案重新计算。':'';
  box.insertAdjacentHTML('beforeend',`<p class="hint">${th.text}${mobileThreatNote}</p>`);
  $('task3-threat-list').replaceChildren(...th.perTarget.map(p=>{const b=document.createElement('button');b.className='task3-blind-item';b.textContent=`${p.id} · 首报 ${p.firstDetectionTime===null?'未检出':clock(p.firstDetectionTime)} · 检出 ${percent(p.detectedFraction)}`;return b;}));
  if(activeTab==='flight'&&activeSub==='threat'){rebuildThreatRoutes();installThreatFrame();}
 }
 function hideThreatVisuals(){for(const drone of threatDrones.values())drone.visible=false;if(threatDetectLines)threatDetectLines.visible=false;for(const line of threatRouteLines)line.visible=false;}
 function disposeTargets(){
  for(const mesh of threatDrones.values()){layer.remove(mesh);mesh.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});}
  threatDrones.clear();targetMeshes=[];
 }
 function rebuildThreatRoutes(){
  for(const line of threatRouteLines){layer.remove(line);line.geometry.dispose();line.material.dispose();}
  threatRouteLines=[];
  const th=report?.threats?.[threatKey()];if(!th?.frames?.length)return;
  for(const id of th.frames[0].targets.map(t=>t.id)){
   const pts=[];
   for(let i=0;i<th.frames.length;i+=3){const target=th.frames[i].targets.find(t=>t.id===id);if(target)pts.push(new THREE.Vector3(...target.position));}
   if(pts.length>1){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xff7a4a,transparent:true,opacity:.28,depthTest:false}));line.renderOrder=57;layer.add(line);threatRouteLines.push(line);}
  }
 }
 function installThreatFrame(){
  if(!report)return;
  const th=report.threats[threatKey()];if(!th?.frames?.length)return;
  const frames=th.frames,index=Math.min(frames.length-1,threatFrameIndex),frame=frames[index];
  disposeTargets();
  const nextFrame=frames[Math.min(frames.length-1,index+1)],prevFrame=frames[Math.max(0,index-1)],detectedIds=new Set(),seen=new Set();
  for(const t of frame.targets){
   let drone=threatDrones.get(t.id);
   if(!drone){drone=createDroneMesh();drone.scale.setScalar(5);drone.userData.targetId=t.id;threatDrones.set(t.id,drone);layer.add(drone);}
   drone.visible=true;drone.position.fromArray(t.position);seen.add(t.id);
   const next=nextFrame.targets.find(x=>x.id===t.id),prev=prevFrame.targets.find(x=>x.id===t.id);
   const direction=new THREE.Vector3();
   if(next)direction.fromArray(next.position).sub(drone.position);
   if(direction.lengthSq()<1e-6&&prev)direction.copy(drone.position).sub(new THREE.Vector3(...prev.position));
   if(direction.lengthSq()>1e-6)drone.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction.normalize());
   for(const d of t.detectedBy)detectedIds.add(d.id);
  }
  for(const [id,drone] of threatDrones)if(!seen.has(id))drone.visible=false;
  targetMeshes=[...threatDrones.values()].filter(drone=>drone.visible);
  if(threatDetectLines){layer.remove(threatDetectLines);threatDetectLines.geometry.dispose();threatDetectLines.material.dispose();threatDetectLines=null;}
  const pts=[];for(const t of frame.targets)for(const d of t.detectedBy){const device=plan?.devices.find(x=>x.id===d.id);if(device)pts.push(device.position,t.position);}
  if(pts.length){threatDetectLines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:0xff776d,transparent:true,opacity:.55}));layer.add(threatDetectLines);}
  for(const mesh of deviceMeshes){const on=detectedIds.has(mesh.userData.deviceId);mesh.userData.halo.visible=on;if(on)mesh.userData.halo.material.opacity=.78;}
  const dur=frames.at(-1).time;$('task3-threat-clock').textContent=`${clock(frame.time)} / ${clock(dur)}`;$('task3-threat-seek').value=dur?frame.time/dur*1000:0;
  updateThreatHud(frame);
  updateDiagnostics();
 }
 function pauseThreatPlayback(){threatPlaying=false;threatLastStamp=0;cancelAnimationFrame(threatRafId);const b=$('task3-threat-play');if(b)b.textContent='▶ 播放推演';updateDiagnostics();}
 function stopThreatPlayback(){pauseThreatPlayback();hideThreatHud(0);}
 function threatPlayLoop(stamp){
  if(!threatPlaying)return;
  const th=report?.threats?.[threatKey()];if(!th?.frames?.length){threatPlaying=false;return;}
  if(threatLastStamp)threatFrameTime+=Math.min(.2,(stamp-threatLastStamp)/1000)*threatSpeed;threatLastStamp=stamp;
  for(const drone of targetMeshes)for(const rotor of drone.userData.rotors??[])rotor.rotation.y+=0.42;
  const dur=th.frames.at(-1).time;
  if(threatFrameTime>=dur){threatFrameTime=dur;threatPlaying=false;$('task3-threat-play').textContent='↺ 再次播放';hideThreatHud(1500);updateDiagnostics();}
  const idx=Math.min(th.frames.length-1,th.frames.findIndex(f=>f.time>=threatFrameTime));
  if(idx!==threatFrameIndex&&idx>=0){threatFrameIndex=idx;installThreatFrame();}
  if(threatPlaying)threatRafId=requestAnimationFrame(threatPlayLoop);
 }
 function beginThreatPlayback(){
  const th=report?.threats?.[threatKey()];if(!th?.frames?.length)return false;
  const dur=th.frames.at(-1).time;
  if(threatFrameTime>=dur){threatFrameTime=0;threatFrameIndex=0;}
  rebuildThreatRoutes();showThreatHud();installThreatFrame();
  threatPlaying=true;threatLastStamp=0;$('task3-threat-play').textContent='Ⅱ 暂停';threatRafId=requestAnimationFrame(threatPlayLoop);
  updateDiagnostics();return true;
 }
 function startThreatSimulation(key){
  if(!THREAT_SCENARIOS[key])key='single';
  $('task3-threat').value=key;$('task3-threat-view').value=key;renderThreatConfig();
  activeTab='flight';activeSub='threat';applyTab();setTask3Visibility(true);
  if(!report?.threats?.[key]?.frames?.length){
   pendingThreatKey=key;threatFrameIndex=0;threatFrameTime=0;showThreatHud();
   $('threat-name').textContent=THREAT_SCENARIOS[key].name;$('threat-live-state').textContent='准备推演';$('threat-count').textContent='—';$('threat-detected').textContent='—';$('threat-agl').textContent='—';$('threat-coordinates').textContent='—';threatHud.dataset.alarm='clear';
   if(!busy)scheduler.start('威胁推演');
   return false;
  }
  pendingThreatKey=null;
  return beginThreatPlayback();
 }
 function pauseThreatSimulation(){if(!threatPlaying){pendingThreatKey=null;hideThreatHud(0);}pauseThreatPlayback();}
 function getThreatPlayback(){
  const th=report?.threats?.[threatKey()];
  return {enabled:!!th?.frames?.length,playing:threatPlaying,time:threatFrameTime,duration:th?.frames?.at(-1)?.time??0,speed:threatSpeed,key:threatKey()};
 }
 function setThreatSpeed(value){threatSpeed=Math.max(1,Number(value)||10);updateDiagnostics();}
 function setThreatProgress(value){
  const th=report?.threats?.[threatKey()];if(!th?.frames?.length)return;
  pauseThreatPlayback();showThreatHud();
  threatFrameTime=Math.max(0,Math.min(1,Number(value)/1000))*(th.frames.at(-1).time);
  const idx=th.frames.findIndex(f=>f.time>=threatFrameTime);threatFrameIndex=Math.max(0,Math.min(th.frames.length-1,idx));
  installThreatFrame();
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
 function updateDiagnostics(){
  const view=renderer.domElement.parentElement,requestState=scheduler.getState(),freshness=$('task3-result-freshness');camera.updateMatrixWorld();
  freshness.hidden=!requestState.staleResult||!report;freshness.textContent=freshness.hidden?'':'当前展示为上一轮成功结果，非最新参数结果。';
  window.task3Diagnostics={
   ready:!!report,busy,mobilePending,version:TASK3_VERSION,plans:report?.plans.map(p=>({id:p.id,devices:p.devices.length,cost:p.cost})),recommendedId:report?.recommendedId,planId:plan?.id,blindStats:report&&plan?report.blindspots[plan.id]?.[conditionIndex()]?.stats:null,mobileRepair:report?.mobileRepair??null,emcVerdict:report&&plan?report.emc[plan.id].verdict:null,emcCounts:report&&plan?{...report.emc[plan.id].counts}:null,condition:$('task3-condition').value,threatScenario:threatKey(),threatSummary:report?.threats?.[threatKey()]?.summary??null,threatPlaying,threatFrameIndex,playing:threatPlaying,frameIndex:threatFrameIndex,activeTab,activeSub,
   requestId:requestState.requestId,reportRequestId:report?.requestId??null,layerVisible:layer.visible,mapActive,updateReason:requestState.updateReason,staleResult:requestState.staleResult,lastError:requestState.lastError,lastSuccessfulRequestId:requestState.lastSuccessfulRequestId,autoUpdatePending:requestState.pending,pendingUpdateReasons:requestState.pendingUpdateReasons,lastEquipmentSnapshot:lastRequestSnapshot?.equipmentSnapshot??report?.equipmentSnapshot??null,inputSummary:lastRequestSnapshot?{settings:lastRequestSnapshot.settings,weights:lastRequestSnapshot.weights,presetIds:lastRequestSnapshot.presetIds,environment:lastRequestSnapshot.environment,target:lastRequestSnapshot.target}:null,
   deviceMarkers:deviceMeshes.map(mesh=>{const p=mesh.position.clone().project(camera);return {deviceId:mesh.userData.deviceId,isMobile:mesh.userData.isMobile,deployment:mesh.userData.deployment?.deployment??null,x:(p.x+1)/2*view.clientWidth,y:(1-p.y)/2*view.clientHeight,visible:p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1,scale:mesh.scale.x};}),
   threatTargets:targetMeshes.map(mesh=>{const p=mesh.position.clone().project(camera);return {id:mesh.userData.targetId,x:(p.x+1)/2*view.clientWidth,y:(1-p.y)/2*view.clientHeight,visible:mesh.visible&&p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1};}),
  };
  // 供浏览器冒烟测试读取完整数据（替代已移除的 JSON 导出按钮）。
  window.__task3Report=report;window.__task3Run=run;window.__task3Export=()=>({report,activePlanId:plan?.id,deviceDisplay:deviceDisplay.toJSON()});
 }
 function controlsEnabled(){
  $('task3-run-side').disabled=busy;$('task3-cancel-side').disabled=!busy;for(const id of ['task3-plan','task3-condition','task3-export-pdf'])$(id).disabled=busy||!report;
  $('task3-mobile-repair').disabled=busy||!report;
  const threatReady=!busy&&!!report?.threats?.[threatKey()]?.frames?.length;
  $('task3-threat-play').disabled=!threatReady;$('task3-threat-reset').disabled=!threatReady;$('task3-threat-view').disabled=!report;
 }
 function mobileFail(text){worker?.terminate();worker=null;busy=false;mobilePending=false;mobileReportRequestId=null;mobileRequestId++;$('task3-mobile-repair').checked=false;restoreMobileRepair();setMobileStatus(`移动补盲失败：${text}`,'error');setStatus('移动补盲未完成，已保留原方案。','error');controlsEnabled();renderAll();publishSimulation();}
 function clearMobileRepairState(){
  mobilePending=false;mobileReportRequestId=null;mobileRequestId++;$('task3-mobile-repair').checked=false;
  if(report){
   for(const snapshot of mobileSnapshots.values())restoreMobileRepairSnapshot(report,snapshot);
   plan=report.plans.find(p=>p.id===plan?.id)??report.plans.find(p=>p.id===report.recommendedId);run=originalRun??run;
  }else{run=null;originalRun=null;}
  mobileSnapshots=new Map();setMobileStatus('重新推演中，移动补盲及其派生状态已清理。');
 }
 function failPipeline(text,requestId){
  if(!scheduler.fail(requestId,text))return;
  activePipelineRequest=null;worker?.terminate();worker=null;busy=false;pendingThreatKey=null;hideThreatHud(0);
  const preserved=report?' 已保留上一轮成功结果（非最新参数结果）。':'';
  setStatus(`${scheduler.getState().updateReason}失败：${friendlyError(text)}${preserved}`,'error');controlsEnabled();updateDiagnostics();
 }
 function getWorker(){
  if(worker)return worker;
  const instance=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});worker=instance;
  instance.onmessage=({data})=>{
   if(instance!==worker)return;
   if(data.type==='progress'){
    const request=activePipelineRequest;if(!request||data.requestId!==request.id||!scheduler.isCurrent(request.id))return;
    const v=data.value;$('task3-progress-side').value=v.total?v.completed/v.total:0;setStatus(`${request.updateReason} · ${STAGE_NAMES[v.stage]??v.stage} ${v.completed}/${v.total}`);
   }else if(data.type==='report'){
    const request=activePipelineRequest;if(!request||data.requestId!==request.id||!scheduler.succeed(request.id))return;
    activePipelineRequest=null;busy=false;mobilePending=false;mobileReportRequestId=null;mobileRequestId++;mobileSnapshots=new Map();report=data.report;run=data.run;
    report.requestId=request.id;report.updateReason=request.updateReason;report.equipmentSnapshot=request.snapshot.equipmentSnapshot;run.requestId=request.id;run.updateReason=request.updateReason;run.equipmentSnapshot=request.snapshot.equipmentSnapshot;
    originalRun=run;plan=report.plans.find(p=>p.id===report.recommendedId);threatConfigs=structuredClone(report.settings.threatConfigs);$('task3-mobile-repair').checked=false;
    $('task3-progress-side').value=1;$('task3-condition').replaceChildren(...report.conditions.map(c=>new Option(c.name,c.id)));renderAll();publishSimulation();
    if(pendingThreatKey){const pending=pendingThreatKey;pendingThreatKey=null;startThreatSimulation(pending);}
    setMobileStatus('可勾选启用；只搜索当前方案、当前工况的盲点。');setStatus(`推演完成 · ${request.updateReason} · ${report.candidateCount} 候选 / ${report.sampling.samples.length} 采样 / ${(report.durationMs/1000).toFixed(1)} s · 推荐「${plan.name}」`);controlsEnabled();updateDiagnostics();
   }else if(data.type==='mobile-progress'){
    if(data.requestId!==mobileRequestId||!mobilePending)return;const v=data.value,label={search:'搜索地表候选并逐点实判','fine-search':'警车移位细搜剩余盲点（25 米网格）',select:'贪心选择并校核 EMC',recalculate:'重算全部工况与设备贡献'}[v.stage]??'移动补盲';
    setMobileStatus(`${label} ${v.completed}/${v.total}`);setStatus(`移动补盲后台计算中：${label} ${v.completed}/${v.total}`);updateDiagnostics();
   }else if(data.type==='mobile-repair-result'){
    if(data.requestId!==mobileRequestId||!mobilePending||mobileReportRequestId!==report?.requestId)return;const result=data.result;if(result.planId!==plan.id){mobileFail('方案已变化，结果未应用');return;}
    const snapshot=applyMobileRepairResult(report,result);mobileSnapshots.set(result.planId,snapshot);plan=result.plan;busy=false;mobilePending=false;mobileReportRequestId=null;
    run={...originalRun,mobileRepair:{summary:result.summary,plan:result.plan,blindspots:result.blindspots,emc:result.emc}};
    renderAll();publishSimulation();setMobileStatus(result.summary.message,['no-radar','no-candidate','emc-unavailable'].includes(result.summary.status)?'warning':'');setStatus(result.summary.message);controlsEnabled();updateDiagnostics();
   }else if(data.type==='error'){
    if(data.operation==='mobile-repair'){if(data.requestId===mobileRequestId&&mobilePending)mobileFail(data.message);}
    else if(data.operation==='pipeline'&&activePipelineRequest?.id===data.requestId)failPipeline(data.message,data.requestId);
   }
  };
  instance.onerror=event=>{
   if(instance!==worker)return;
   if(mobilePending)mobileFail(event.message||'后台移动补盲失败');
   else if(activePipelineRequest)failPipeline(event.message||'后台计算失败',activePipelineRequest.id);
  };
  return instance;
 }
 function renderScopeStatus(){
  const scope=report?.scope??report?.sampling?.dataCoverage,status=$('task3-scope-status');if(!scope)return;
  const size=`东西 ${scope.widthM.toFixed(0)} m × 南北 ${scope.depthM.toFixed(0)} m`;status.dataset.tone=scope.clipped?'warning':'';
  status.textContent=scope.clipped?`地形数据未覆盖全部请求范围，已按有效区域裁切（${size}）；仅计算有数据的区域，不外推覆盖。`:`本次范围：${size}。采样与覆盖未外推无数据区域。`;
 }
 function renderAll(){deviceDisplay=createDeviceDisplayMap(plan.devices);renderScopeStatus();renderPlans();renderEmc();drawCommon();renderThreatSummary();updateDiagnostics();}
 // 飞行模块由 planning/ui.js 独立维护，任务三只负责推演与工况数据。
 function publishSimulation(){}
 function startPipeline({requestId,updateReason}){
  activePipelineRequest=null;worker?.terminate();worker=null;busy=false;clearMobileRepairState();
  if(report&&plan)renderAll();else destroyLayer();
  const weights={};
  for(const input of app.querySelectorAll('#task3-weights input'))weights[input.dataset.weight]=Number(input.value);
  const widthInput=$('task3-scope-width'),depthInput=$('task3-scope-depth'),spacingInput=$('task3-spacing'),widthText=widthInput.value.trim(),depthText=depthInput.value.trim(),scopeWidthM=Number(widthText),scopeDepthM=Number(depthText);
  for(const input of [widthInput,depthInput,spacingInput])input.removeAttribute('aria-invalid');
  if(!widthText||!depthText||!Number.isFinite(scopeWidthM)||!Number.isFinite(scopeDepthM)||scopeWidthM<=0||scopeDepthM<=0){
   if(!widthText||!Number.isFinite(scopeWidthM)||scopeWidthM<=0)widthInput.setAttribute('aria-invalid','true');
   if(!depthText||!Number.isFinite(scopeDepthM)||scopeDepthM<=0)depthInput.setAttribute('aria-invalid','true');
   if(updateReason.includes('手动'))(widthInput.getAttribute('aria-invalid')?widthInput:depthInput).focus();
   failPipeline('东西宽度和南北深度都必须是大于 0 的有效数字。',requestId);return;
  }
  let snapshot;
  try{
   const spacing=parseTask3Spacing(spacingInput.value),custom=scopeWidthM!==2400||scopeDepthM!==2400;
   const costs=Object.fromEntries([...app.querySelectorAll('#task3-costs input')].map(input=>[input.dataset.cost,Number(input.value)]));
   const normalizedThreatConfigs=resolveThreatConfigs();threatConfigs=structuredClone(normalizedThreatConfigs);
   const settings=resolveTask3Settings({scope:custom?'custom':'core',scopeWidthM,scopeDepthM,spacing,heights:[30,60,100],siteSpacing:500,maxSites:192,maxDevices:Number($('task3-max-devices').value),budget:Number($('task3-budget').value),costs,threatConfigs:normalizedThreatConfigs,coreRadius:700,coreWeight:3,marginReserveDb:3});
   const equipmentSnapshot=sensors.getEquipmentSnapshot(),presetIds=renderEquipmentSelection(equipmentSnapshot);
   snapshot=createTask3RequestSnapshot({settings,weights,presetIds,equipmentSnapshot,scenarioSnapshot:sensors.getScenarioSnapshot()});
  }catch(error){
   if(/网格间距/.test(error.message)){spacingInput.setAttribute('aria-invalid','true');if(updateReason.includes('手动'))spacingInput.focus();}
   failPipeline(error.message,requestId);return;
  }
  lastRequestSnapshot=snapshot;const request={id:requestId,updateReason,snapshot};activePipelineRequest=request;busy=true;$('task3-progress-side').value=0;controlsEnabled();updateDiagnostics();
  setStatus(`${updateReason}：后台计算中，地图仍可操作。${report?' 当前展示结果为上一轮参数，完成后自动替换。':''}`);
  try{getWorker().postMessage({type:'pipeline',site:getSite?.()??null,requestId,baseURL:new URL('./',location.href).href,settings:snapshot.settings,weights:snapshot.weights,presetIds:snapshot.presetIds,equipmentSnapshot:snapshot.equipmentSnapshot,environment:snapshot.environment,target:snapshot.target});}
  catch(error){failPipeline(error.message,requestId);}
 }
 const scheduler=createTask3RunScheduler({run:startPipeline,hasCurrentResult:()=>!!report});
 const schedulePipeline=reason=>{scheduler.schedule(reason);updateDiagnostics();};
 sensors.subscribeEquipmentChanges(()=>{renderEquipmentSelection();schedulePipeline('装备选型/参数自动更新');});
 sensors.subscribeScenarioChanges(()=>schedulePipeline('城市目标/环境应用自动更新'));
 // 事件
 function setTask3Visibility(visible,reason){
  task3WindowVisible=visible;
  simulation?.setActive?.(visible&&activeTab==='flight'&&activeSub==='flight');
  updateLayerVisibility();
  deviceHover.hide();
  if(!visible)stopThreatPlayback();
 }
 button.onclick=()=>{workspace.activateView('task3');setTask3Visibility(true);};
 app.addEventListener('view-change',event=>setTask3Visibility(event.detail==='task3'));
 $('task3-threat').replaceChildren(...Object.entries(THREAT_SCENARIOS).map(([k,s])=>new Option(s.name,k)));
 $('task3-threat').onchange=()=>{renderThreatConfig();const view=$('task3-threat-view');if(view)view.value=$('task3-threat').value;stopThreatPlayback();threatFrameIndex=0;threatFrameTime=0;renderThreatSummary();controlsEnabled();};
 $('task3-threat-view').onchange=()=>{stopThreatPlayback();threatFrameIndex=0;threatFrameTime=0;$('task3-threat').value=$('task3-threat-view').value;renderThreatConfig();renderThreatSummary();controlsEnabled();};
 $('task3-threat-play').onclick=()=>{if(threatPlaying){pauseThreatPlayback();return;}beginThreatPlayback();};
 $('task3-threat-reset').onclick=()=>{pauseThreatPlayback();showThreatHud();threatFrameIndex=0;threatFrameTime=0;installThreatFrame();};
 $('task3-threat-seek').oninput=()=>setThreatProgress(Number($('task3-threat-seek').value));
 for(const id of ['task3-threat-count','task3-threat-azimuths','task3-threat-agl','task3-threat-speed']){
  $(id).addEventListener('input',saveThreatConfigForm);$(id).addEventListener('change',()=>{saveThreatConfigForm();schedulePipeline('威胁场景配置自动更新');});
 }
 $('task3-threat-defaults').onclick=()=>{const key=$('task3-threat').value;threatConfigs[key]=structuredClone(DEFAULT_THREAT_CONFIGS[key]);renderThreatConfig();schedulePipeline('威胁场景默认配置恢复');};
 $('task3-restore-defaults').onclick=()=>{
  $('task3-scope-width').value=2400;$('task3-scope-depth').value=2400;$('task3-spacing').value=500;$('task3-budget').value=600;$('task3-max-devices').value=64;
  for(const input of app.querySelectorAll('#task3-weights input'))input.value=METRIC_WEIGHTS[input.dataset.weight];
  const COST_DEFAULTS={radar:12,radio:5,optical:4,acoustic:2};for(const input of app.querySelectorAll('#task3-costs input'))input.value=COST_DEFAULTS[input.dataset.cost];
  threatConfigs=structuredClone(DEFAULT_THREAT_CONFIGS);renderThreatConfig();
  schedulePipeline('恢复默认推演参数');
 };
 $('task3-plan').onchange=()=>{restoreMobileRepair();$('task3-mobile-repair').checked=false;setMobileStatus('已切换方案并清理移动补盲，可按当前方案重新启用。');plan=report.plans.find(p=>p.id===$('task3-plan').value);renderAll();publishSimulation();};
 $('task3-condition').onchange=()=>{renderPlans();drawCommon();publishSimulation();updateDiagnostics();};
 $('task3-mobile-repair').onchange=()=>{
  const checkbox=$('task3-mobile-repair');if(busy||!report||!plan){checkbox.checked=mobilePending;return;}
  if(!checkbox.checked){restoreMobileRepair();renderAll();publishSimulation();setMobileStatus('已取消移动补盲，恢复原方案设备、盲点、覆盖贡献与 EMC。');setStatus('已恢复原方案。');return;}
  if(mobileSnapshots.has(plan.id))return; // 重复勾选不叠加设备或重复请求。
  busy=true;mobilePending=true;mobileReportRequestId=report.requestId;const requestId=++mobileRequestId;deviceHover.hide();setMobileStatus('正在后台搜索当前盲点附近的有效地表候选…');setStatus('移动补盲后台计算中，不会重跑整套流水线。');controlsEnabled();updateDiagnostics();
  getWorker().postMessage({type:'mobile-repair',site:getSite?.()??null,requestId,baseURL:new URL('./',location.href).href,equipmentSnapshot:report.equipmentSnapshot,input:{plan,sampling:report.sampling,equipment:report.equipment,settings:report.settings,environment:report.environment,target:report.target,conditionId:$('task3-condition').value,equipmentSnapshot:report.equipmentSnapshot}});
 };
 for(const cb of app.querySelectorAll('#task3-blind-legend input'))cb.onchange=()=>{for(const [cat,{mesh}] of Object.entries(blindMeshes))mesh.visible=app.querySelector(`input[data-category="${cat}"]`).checked;};
 let documentRules=null;
 async function loadDocumentRules(){
  if(documentRules)return documentRules;
  const response=await fetch(new URL('data/task3-doc-rules.json',new URL('./',location.href)));if(!response.ok)throw Error('缺少真实多轮规则数据，请先运行 node scripts/task3_standard_doc.js');
  const data=await response.json();if(data.schema!=='task3-deployment-rules/1.0'||!Array.isArray(data.rules))throw Error('多轮规则数据格式无效');documentRules=data.rules;return documentRules;
 }
 $('task3-export-pdf').onclick=async()=>{
  if(!report||!run||!plan)return;const button=$('task3-export-pdf');button.disabled=true;setStatus('正在生成部署方案 PDF…');
  try{
   const rules=await loadDocumentRules(),conditionId=report.conditions[conditionIndex()]?.id??'nominal';
   await exportDeploymentPdf({report,run,activePlanId:plan.id,rules,conditionId});
   setStatus(`已按当前 ${plan.name} 与 ${run.runId} 生成部署方案 PDF。`);
  }catch(error){setStatus(`无法生成部署方案 PDF：${error.message}`,'error');}
  finally{controlsEnabled();}
 };
 function setScene(site){
  const key=site?.base??'recon';if(key===task3SceneKey)return;task3SceneKey=key;
  report=null;run=null;originalRun=null;plan=null;mobileSnapshots=new Map();mobilePending=false;busy=false;pendingThreatKey=null;threatGroundAt=null;stopThreatPlayback();destroyLayer();
  for(const id of ['task3-plans-table','task3-plan','task3-plan-detail','task3-emc','task3-threat-summary','task3-threat-list','task3-blind-list']){const node=$(id);if(node)node.replaceChildren();}
  $('task3-progress-side').value=0;setStatus(site?'场景已切换，请重新推演。':'待命');controlsEnabled();updateDiagnostics();
 }
 applyTab();renderThreatConfig();renderEquipmentSelection();controlsEnabled();updateDiagnostics();
 return {panel,layer,setStatus,setScene,showTab(id){if(!TABS[id])return;activeTab=id;activeSub=TABS[id].subs[0]?.[0]??null;applyTab();},showFlight(){activeTab='flight';activeSub='flight';applyTab();},startThreatSimulation,pauseThreatSimulation,getThreatPlayback,setThreatSpeed,setThreatProgress,setMapActive(value){mapActive=!!value;updateLayerVisibility();updateDiagnostics();},update(stamp){
  if(!layer.visible)return;
  for(const mesh of deviceMeshes){mesh.material.color.set(mesh.userData.isMobile?0xff9f5a:COLORS[mesh.userData.deviceType]);mesh.userData.halo.visible=false;mesh.userData.halo.quaternion.copy(camera.quaternion);}
  updateDiagnostics();
 }};
}
