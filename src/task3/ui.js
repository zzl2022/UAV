import * as THREE from 'three';
import {PRESETS,TYPES} from '../sensors/presets.js';
import {BLIND_COLORS,BLIND_CATEGORIES,TASK3_VERSION,METRIC_WEIGHTS,THREAT_SCENARIOS,DEFAULT_THREAT_CONFIGS,EQUIPMENT_FACTS} from './constants.js';
import {STAGE_NAMES,resolveTask3EquipmentSelection} from './pipeline.js';
import {parseTask3Spacing,resolveTask3Settings} from './scope.js';
import {createTask3RequestSnapshot,createTask3RunScheduler} from './live-optimization.js';
import {createPlanChatSummary} from './plan-chat-context.js';
import {resolvePlanChatDevice} from './device-chat-context.js';
import {createDeviceDisplayMap} from './device-display.js';
import {createDeviceHover} from './device-hover.js';
import {applyMobileRepairResult,restoreMobileRepairSnapshot} from './mobile-repair.js';
import {exportDeploymentPdf,exportDeviceExplanationPdf} from './deployment-pdf.js';
import {mountBuildingSelector} from './building-selector.js';
import {normalizeThreatConfig} from './threats.js';
import {createDroneMesh} from '../planning/drone-mesh.js';
import {flightTelemetry} from '../planning/telemetry.js';
import {bindDetectionVoice} from '../planning/voice.js';
import './ui.css';

const COLORS={radar:0x70d6ff,radio:0xb89aff,optical:0xffd783,acoustic:0x69e2bd};
const percent=x=>`${(x*100).toFixed(1)}%`;
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

export function mountTask3UI({app,city,model,scene,camera,controls,renderer,sensors,workspace,getSite,getGroundAt,getBuildingContext,onMapPickMode,getActiveModel}){
 const panel=document.createElement('div');panel.id='task3-panel';panel.hidden=true;
 panel.innerHTML=`<div class="brand"><span class="mark">◇</span> 优化部署推演</div>
 <p id="task3-result-freshness" class="task3-result-freshness" role="status" hidden></p>
 <nav class="task3-tabs" aria-label="功能类别">
  <button type="button" data-tab="input" aria-selected="true">推演输入</button>
  <button type="button" data-tab="plans" aria-selected="false">方案对比</button>
  <button type="button" data-tab="blindspots" aria-selected="false">盲区分析</button>
  <button type="button" data-tab="emc" aria-selected="false">电磁兼容</button>
 </nav>
 <div class="task3-body">
  <nav class="task3-subnav" aria-label="子模块"></nav>
  <div class="task3-content"></div>
 </div>
 <div class="task3-footer">
  <button id="task3-restore-defaults">恢复默认</button>
  <button id="task3-export-pdf" hidden disabled tabindex="-1">导出已生成方案 PDF ↓</button>
 </div>`;
 workspace.mountSidebarPanel(panel,'task3');
 const $=id=>app.querySelector('#'+id);
 const button=app.querySelector('#toggle-task3');button.disabled=false;
 const layer=new THREE.Group();layer.name='Task3_Pipeline';layer.visible=false;scene.add(layer);
 const customEditLayer=new THREE.Group();customEditLayer.name='Task3_Custom_Route_Editor';customEditLayer.visible=false;scene.add(customEditLayer);
 const view=renderer.domElement.parentElement;
 const customEditPanel=document.createElement('aside');customEditPanel.id='task3-custom-editor';customEditPanel.hidden=true;customEditPanel.setAttribute('aria-label','自定义单机轨迹编辑');
 customEditPanel.innerHTML=`<h3>自定义单机轨迹</h3><p class="task3-custom-hint">右键功能暂时无效，当前左键替代原右键功能</p><p class="task3-custom-help">在当前地图左键单击建筑或地表，按顺序生成红点与连线；拖动视角不会加点。</p><div class="task3-custom-count">已输入 <strong id="task3-custom-count">0</strong> 个路点</div><div class="task3-custom-actions"><button id="task3-custom-complete" class="primary" type="button">完成并计算</button><button id="task3-custom-clear" type="button">清除轨迹</button><button id="task3-custom-cancel" type="button">取消编辑</button><button id="task3-custom-restore" type="button">恢复默认八方位</button></div><div id="task3-custom-status" role="status">请至少单击两个不同位置。</div>`;
 view.append(customEditPanel);
 const ce$=id=>customEditPanel.querySelector('#'+id);
 const threatHud=document.createElement('section');threatHud.id='threat-hud';threatHud.hidden=true;
 threatHud.innerHTML=`<div class="ac8-flight-block"><span class="ac8-flight-label">[场景]</span><div class="ac8-flight-target"><span id="threat-name">威胁推演</span><strong id="threat-live-state">待命</strong></div></div><div class="ac8-flight-block"><span class="ac8-flight-label">[目标]</span><div class="ac8-flight-value"><span id="threat-count">—</span><small>架</small></div></div><div class="ac8-flight-block"><span class="ac8-flight-label">[高度]</span><div class="ac8-flight-value"><span id="threat-agl">—</span><small>m</small></div></div><div class="ac8-flight-block"><span class="ac8-flight-label">[坐标]</span><div id="threat-coordinates">—</div></div><div class="ac8-flight-block"><span class="ac8-flight-label">[检出]</span><div class="ac8-flight-value"><span id="threat-detected">—</span><small>架</small></div></div><div class="ac8-flight-actions"><button id="threat-track" type="button" aria-pressed="false">跟踪目标</button><button id="threat-voice" type="button" aria-pressed="false">开启语音播报</button><button id="threat-voice-preview" type="button" hidden>试听</button></div><div id="threat-voice-status" role="status">语音关闭</div>`;
 view.append(threatHud);
 const th$=id=>threatHud.querySelector('#'+id);
 let threatDetected=false;
 const threatVoice=bindDetectionVoice({toggle:th$('threat-voice'),preview:th$('threat-voice-preview'),
  status:th$('threat-voice-status'),getTarget:()=>({detected:threatDetected,telemetry:lastThreatTelemetry})});
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
 <p class="hint" id="task3-spacing-hint">网格间距可输入 150–1000 米。范围以当前地图核心区为中心，采样限于有数据的区域。</p><div id="task3-scope-status" class="hint" role="status">默认范围：东西 2400 m × 南北 2400 m。</div>`;
 const weightsPane=document.createElement('div');weightsPane.className='task3-pane';weightsPane.innerHTML=`<div class="task3-inputs" id="task3-weights">
  <label>覆盖完整性<input type="number" data-weight="coverage" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.coverage}"></label>
  <label>盲区面积占比<input type="number" data-weight="blind" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.blind}"></label>
  <label>装备配置成本<input type="number" data-weight="cost" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.cost}"></label>
  <label>现场施工可行性<input type="number" data-weight="feasibility" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.feasibility}"></label>
 </div><p class="hint">成本为相对单位，<strong>非人民币报价</strong>。</p>
 <h3 class="task3-group-title">装备配置成本</h3>
 <div class="task3-inputs" id="task3-costs">
  <label>雷达<input type="number" data-cost="radar" min="0.1" max="100" step="0.1" value="12"></label>
  <label>无线电<input type="number" data-cost="radio" min="0.1" max="100" step="0.1" value="5"></label>
  <label>光电<input type="number" data-cost="optical" min="0.1" max="100" step="0.1" value="4"></label>
  <label>声学<input type="number" data-cost="acoustic" min="0.1" max="100" step="0.1" value="2"></label>
 </div><p class="hint">直接参与方案成本与择优计算，并随报告和过程数据导出。</p><section class="task3-building-settings"><h3>建筑权重</h3><p class="hint">选中的独立连通建筑为禁部署区域；更改后需重新生成方案。</p><button id="task3-building-select" type="button" aria-pressed="false">建筑权重 · 选择建筑</button><button id="task3-building-clear" type="button">清空选择</button><p id="task3-building-count" role="status">已选择 0 栋 · 粉红色高亮表示禁止部署</p></section>`;
 const threatPane=document.createElement('div');threatPane.className='task3-pane';threatPane.innerHTML=`<label>威胁场景<select id="task3-threat"></select></label>
  <div class="task3-threat-config" id="task3-threat-config">
   <label>目标数量 / 架<input id="task3-threat-count" type="number" min="1" max="128" step="1"></label>
   <label>攻击来向方位角 / °<input id="task3-threat-azimuths" type="text" inputmode="decimal" aria-describedby="task3-threat-coordinate-hint"></label>
   <label>离地高度 AGL / m<input id="task3-threat-agl" type="text" inputmode="decimal"></label>
   <label>飞行速度 / (m/s)<input id="task3-threat-speed" type="number" min="0.1" max="100" step="0.1"></label>
   <button id="task3-custom-route" type="button">自定义轨迹</button>
   <button id="task3-threat-defaults" type="button">恢复当前场景默认配置</button>
   <p class="hint" id="task3-threat-coordinate-hint">以核心目标正北为 0°，顺时针增加；多个角度、高度用逗号分隔。高度为离地高度，速度为轨迹标称速度。</p>
  </div>`;
 const mobilePane=document.createElement('div');mobilePane.className='task3-pane';mobilePane.innerHTML=`<label class="task3-mobile-toggle"><input id="task3-mobile-repair" type="checkbox" disabled>警车部署可移动雷达</label>
  <div id="task3-mobile-status" class="task3-mobile-status" role="status">完成推演后可启用移动补盲。</div>
  <p class="hint">只复用本次已选雷达预设。挂载高度 2 m 为模型假设；候选仅为开阔地表几何代理，现有数据不能验证道路可达。</p>`;
 const generatePane=document.createElement('div');generatePane.className='task3-pane';generatePane.innerHTML=`<div class="task3-plan-types" id="task3-plan-types">
  <label><input type="checkbox" data-plan-type="economy" checked>经济型</label>
  <label><input type="checkbox" data-plan-type="balanced" checked>均衡型</label>
  <label><input type="checkbox" data-plan-type="enhanced" checked>增强型</label>
 </div>
 <p class="hint">选择一套或多套方案后生成；未勾选的方案不会进入方案对比、威胁验证和 PDF 导出。</p>
 <div class="buttons"><button id="task3-run-side" class="primary" type="button">▶ 生成方案</button><button id="task3-cancel-side" type="button" disabled>取消</button></div>
 <progress id="task3-progress-side" max="1" value="0"></progress>
 <div id="task3-status-side" class="hint" role="status">待命</div>`;
 const plansPane=document.createElement('div');plansPane.className='task3-pane';plansPane.innerHTML=`<div id="task3-plans-table"></div><label>当前方案<select id="task3-plan"></select></label><div id="task3-plan-detail"></div><details><summary>当前方案设备（类型 / 型号）</summary><div id="task3-device-list"></div><button id="task3-device-explanation" type="button" disabled>设备部署解释明细下载</button><p id="task3-device-explanation-status" class="hint" role="status">请勾选需要解释的设备。</p></details>`;
 const blindspotsPane=document.createElement('div');blindspotsPane.className='task3-pane';blindspotsPane.innerHTML=`<label>覆盖工况<select id="task3-condition"></select></label>
  <div id="task3-blind-compare" class="task3-blind-compare"></div>
  <div id="task3-blind-legend" class="task3-legend">${Object.entries(BLIND_CATEGORIES).map(([key,name])=>`<label><input type="checkbox" data-category="${key}" checked><i style="background:#${BLIND_COLORS[key].toString(16).padStart(6,'0')}"></i>${name}<b data-count="${key}"></b></label>`).join('')}</div>
  <div id="task3-blind-list"></div>`;
 const emcPane=document.createElement('div');emcPane.className='task3-pane';emcPane.innerHTML='<div id="task3-emc"></div>';
 const TABS={input:{subs:[['scope','参数约束',scopePane],['weights','权重成本',weightsPane],['threat','威胁场景',threatPane],['generate','方案生成',generatePane]],top:equipPane},plans:{subs:[],pane:plansPane},blindspots:{subs:[['blind','盲区分析',blindspotsPane],['mobile','警车部署',mobilePane]]},emc:{subs:[],pane:emcPane}};
 let activeTab='input',activeSub='scope',task3WindowVisible=false,mapActive=true,mapSwitching=false;
 contentBox.append(equipPane,scopePane,weightsPane,threatPane,mobilePane,generatePane,plansPane,blindspotsPane,emcPane);
 $('task3-run-side').onclick=()=>{if(!busy&&!mapSwitching)scheduler.start('方案生成');};
 $('task3-cancel-side').onclick=()=>{
  const wasMobile=mobilePending;if(!wasMobile)scheduler.cancel();activePipelineRequest=null;worker?.terminate();worker=null;busy=false;mobilePending=false;mobileReportRequestId=null;mobileRequestId++;
  if(wasMobile){$('task3-mobile-repair').checked=false;restoreMobileRepair();setMobileStatus('已取消移动补盲，原方案与盲点保持不变。');if(report&&plan){renderAll();publishSimulation();}}
  setStatus(wasMobile?'已取消移动补盲。':report?'已取消推演，保留上一轮成功结果（非最新参数结果）。':'已取消。');controlsEnabled();updateDiagnostics();
 };
 function applyTab(){
  if(activeTab!=='input'||activeSub!=='weights')stopBuildingSelection();
  const tab=TABS[activeTab];subnav.replaceChildren();
  for(const [key,name] of tab.subs){if(key==='threat'&&getSite?.()?.custom)continue;const b=document.createElement('button');b.type='button';b.className='task3-subnav-btn';b.dataset.sub=key;b.setAttribute('aria-selected',String(key===activeSub));b.textContent=name;subnav.append(b);}
  subnav.hidden=!tab.subs.length;
  for(const btn of panel.querySelectorAll('.task3-tabs button'))btn.setAttribute('aria-selected',String(btn.dataset.tab===activeTab));
  for(const pane of contentBox.children)pane.hidden=true;
  if(tab.top)tab.top.hidden=false;
  if(tab.subs.length){const cur=tab.subs.find(s=>s[0]===activeSub);if(cur?.[2])cur[2].hidden=false;}
  else if(tab.pane)tab.pane.hidden=false;
  updatePdfVisibility();
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
 let task3SceneKey='recon',constraintsInvalid=false,explanationExporting=false;
 let lastPlanChatStatus;
 const buildingContexts=new Map([['recon',{sceneKey:'recon',city,model}]]);
 let buildingLoad=null,buildingError='';
 const selectedDevices=new Set();
 let threatPlaying=false,threatFrameIndex=0,threatFrameTime=0,threatLastStamp=0,threatRafId=0,targetMeshes=[],threatDrones=new Map(),threatDetectLines=null,threatRouteLines=[],threatSpeed=10,threatHudTimer=null,pendingThreatKey=null,threatGroundAt=null,threatTracking=false,detectedDeviceIds=new Set(),lastThreatTelemetry=null;
 let customWorker=null,customPending=null,customRequestId=0,customDefaultSingles=new Map();
 const customEdit={active:false,waypoints:[],pointer:null,scene:'recon',planId:null};
 const setMobileStatus=(text,tone='')=>{const status=$('task3-mobile-status');status.textContent=text;status.dataset.tone=tone;};
 const parseThreatList=value=>String(value).split(/[,，\s]+/).filter(Boolean).map(Number);
function renderThreatConfig(){
  const key=$('task3-threat').value,config=threatConfigs[key];if(!config)return;
  $('task3-custom-route').hidden=key!=='single';
  $('task3-threat-count').value=config.count;$('task3-threat-azimuths').value=config.azimuthsDeg.join(',');$('task3-threat-agl').value=config.aglM.join(',');$('task3-threat-speed').value=config.speedMps;
}
function saveThreatConfigForm(){
  const key=$('task3-threat').value,azimuthsDeg=parseThreatList($('task3-threat-azimuths').value),aglM=parseThreatList($('task3-threat-agl').value);
  threatConfigs[key]={...threatConfigs[key],count:Number($('task3-threat-count').value),directions:azimuthsDeg.length,azimuthsDeg,aglM,speedMps:Number($('task3-threat-speed').value)};
}
function resolveThreatConfigs(){saveThreatConfigForm();return Object.fromEntries(Object.keys(THREAT_SCENARIOS).map(key=>[key,normalizeThreatConfig(key,threatConfigs[key])]));}
 function setCustomStatus(text,tone=''){ce$('task3-custom-status').textContent=text;ce$('task3-custom-status').dataset.tone=tone;}
 function syncCustomEditor(){
  app.classList.toggle('task3-custom-editing',customEdit.active);customEditPanel.hidden=!customEdit.active;customEditPanel.dataset.pending=String(!!customPending);
  ce$('task3-custom-count').textContent=String(customEdit.waypoints.length);
  ce$('task3-custom-complete').disabled=!!customPending;
 }
 function disposeCustomEditVisuals(){
  for(const child of [...customEditLayer.children]){child.traverse(object=>{object.geometry?.dispose();if(Array.isArray(object.material))object.material.forEach(material=>material.dispose());else object.material?.dispose();});customEditLayer.remove(child);}
  customEditLayer.visible=false;
 }
 function drawCustomEdit(){
  disposeCustomEditVisuals();if(!customEdit.active)return;
  const points=customEdit.waypoints.map(point=>new THREE.Vector3(point[0],point[1]+4,point[2]));
  for(const [index,point] of points.entries()){
   const marker=new THREE.Mesh(new THREE.SphereGeometry(12,12,8),new THREE.MeshBasicMaterial({color:0xff342e,depthTest:false}));
   marker.position.copy(point);marker.renderOrder=68;marker.name=`Custom_Waypoint_${index+1}`;marker.userData={customWaypoint:true,index};customEditLayer.add(marker);
  }
  if(points.length>1){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xff443d,transparent:true,opacity:.95,depthTest:false}));line.renderOrder=67;line.name='Custom_Waypoint_Connections';line.userData.customConnection=true;customEditLayer.add(line);}
  customEditLayer.visible=true;customEditLayer.userData.scene=customEdit.scene;syncCustomEditor();updateDiagnostics();
 }
 function cancelCustomRequest(){
  customRequestId++;customPending=null;
  if(customWorker){customWorker.terminate();customWorker=null;}
 }
 function resetCustomEditing(){
  cancelCustomRequest();customEdit.active=false;customEdit.pointer=null;customEdit.waypoints=[];customEdit.planId=null;
  if(renderer.domElement.dataset.buildingSelecting!=='true')renderer.domElement.style.cursor='';disposeCustomEditVisuals();syncCustomEditor();
 }
 function enterCustomEditor(){
  stopBuildingSelection();
  if(threatKey()!=='single')return;
  resetCustomEditing();window.__ac8DeploymentMenu?.close?.();
  const mainToggle=$('ac8-main-menu-toggle');if(mainToggle?.getAttribute('aria-expanded')!=='false')mainToggle?.click();
  customEdit.active=true;customEdit.scene=task3SceneKey;customEdit.planId=plan?.id??null;mapActive=true;updateLayerVisibility();
  renderer.domElement.style.cursor='crosshair';setCustomStatus(report&&plan?'请在当前地图单击至少两个不同位置，完成后后台计算自定义帧。':'可以编辑路点；完成计算前请先生成部署方案。');drawCustomEdit();
 }
 function customSurfaceAt(clientX,clientY){
  const activeModel=getActiveModel?.();if(!activeModel?.ground)return null;
  const rect=renderer.domElement.getBoundingClientRect();if(!rect.width||!rect.height)return null;
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),camera);ray.firstHitOnly=true;
  return ray.intersectObjects([activeModel.buildings,activeModel.ground].filter(Boolean))[0]??null;
 }
 renderer.domElement.addEventListener('pointerdown',event=>{
  if(!customEdit.active||customPending||event.button!==0)return;
  customEdit.pointer={id:event.pointerId,x:event.clientX,y:event.clientY,dragged:false};
 },true);
 renderer.domElement.addEventListener('pointermove',event=>{
  const down=customEdit.pointer;if(!customEdit.active||!down||down.id!==event.pointerId)return;
  if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)down.dragged=true;
 },true);
 renderer.domElement.addEventListener('pointerup',event=>{
  const down=customEdit.pointer;customEdit.pointer=null;
  if(!customEdit.active||customPending||event.button!==0||!down||down.id!==event.pointerId||down.dragged||Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)return;
  if(customEdit.scene!==task3SceneKey){resetCustomEditing();return;}
  const hit=customSurfaceAt(event.clientX,event.clientY);if(!hit){setCustomStatus('未选中当前模型的建筑或地表，请重新单击。','warning');return;}
  // 不可拦截 pointerup：OrbitControls 在 document 上监听 pointerup 来结束旋转，
  // 若在此吞掉事件，轨道控制器会停留在旋转状态，松开左键后镜头仍随鼠标移动。
  customEdit.waypoints.push(hit.point.toArray());drawCustomEdit();setCustomStatus(customEdit.waypoints.length<2?'再单击一个不同位置后即可完成。':`已输入 ${customEdit.waypoints.length} 个路点，可继续加点或完成计算。`);
 },true);
 renderer.domElement.addEventListener('pointercancel',()=>{customEdit.pointer=null;},true);
 ce$('task3-custom-complete').onclick=()=>completeCustomRoute();
 ce$('task3-custom-clear').onclick=()=>{if(!customEdit.active)return;cancelCustomRequest();customEdit.waypoints=[];drawCustomEdit();setCustomStatus('已清除未提交的路点，请重新单击至少两个位置。');};
 ce$('task3-custom-cancel').onclick=()=>{resetCustomEditing();setStatus('已取消自定义轨迹编辑，已生成方案保持不变。');updateDiagnostics();};
 ce$('task3-custom-restore').onclick=()=>{restoreDefaultSingle();};
 $('task3-custom-route').onclick=enterCustomEditor;
 function restoreDefaultSingle(){
  resetCustomEditing();if(!report||!plan)return false;
  const baseline=customDefaultSingles.get(plan.id);if(!baseline){setStatus('当前单机威胁已使用原八方位默认结果。');updateDiagnostics();return false;}
  report.threatsByPlan??={};report.threatsByPlan[plan.id]??={};report.threatsByPlan[plan.id].single=structuredClone(baseline);
  if(report.recommendedId===plan.id)report.threats={...report.threats,single:report.threatsByPlan[plan.id].single};
  resetThreatVisuals();setStatus('已恢复原八方位单机航线；多方向和蜂群结果保持不变。');updateDiagnostics();return true;
 }
 function failCustomRequest(requestId,text){
  if(!customPending||customPending.id!==requestId)return;
  cancelCustomRequest();syncCustomEditor();setCustomStatus(`自定义帧计算失败：${friendlyError(text)}。路点已保留，可调整后重试。`,'error');setStatus(`自定义单机威胁计算失败：${friendlyError(text)}`,'error');updateDiagnostics();
 }
 function getCustomWorker(){
  if(customWorker)return customWorker;
  const instance=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});customWorker=instance;
  instance.onmessage=({data})=>{
   if(instance!==customWorker)return;
   const pending=customPending;
   if(data.type==='custom-single-threat-result'){
    if(!pending||data.requestId!==pending.id)return;
    const result=data.result,valid=report&&plan&&task3SceneKey===pending.scene&&report.requestId===pending.reportRequestId&&plan.id===pending.planId&&result?.planId===pending.planId&&result?.scenarioKey==='single'&&result.single?.frames?.length;
    if(!valid){resetCustomEditing();setStatus('方案或场景已变化，旧自定义计算结果未应用。','warning');updateDiagnostics();return;}
    customPending=null;
    report.threatsByPlan??={};report.threatsByPlan[plan.id]??={};report.threatsByPlan[plan.id].single=result.single;
    if(report.recommendedId===plan.id)report.threats={...report.threats,single:result.single};
    resetThreatVisuals();syncCustomEditor();
    setCustomStatus(`已生成 ${result.single.frames.length} 帧自定义单机威胁数据，请通过主页面“仿真模拟”播放。`);setStatus('自定义单机轨迹计算完成，已绑定当前方案；未启动完整优化。');updateDiagnostics();
   }else if(data.type==='error'&&data.operation==='custom-single-threat')failCustomRequest(data.requestId,data.message);
  };
  instance.onerror=event=>{if(instance!==customWorker)return;event.preventDefault?.();if(customPending)failCustomRequest(customPending.id,event.message||'后台自定义计算失败');};
  return instance;
 }
 function completeCustomRoute(){
  if(!customEdit.active||customPending)return;
  if(customEdit.scene!==task3SceneKey){resetCustomEditing();return;}
  if(!report||!plan){setCustomStatus('请先在“推演输入 → 方案生成”中生成方案，再完成自定义帧计算。','warning');return;}
  if(customEdit.waypoints.length<2){setCustomStatus('至少需要两个不同有效路点，请继续在当前地图单击。','warning');return;}
  let config;
  try{saveThreatConfigForm();config=normalizeThreatConfig('single',threatConfigs.single);}catch(error){setCustomStatus(`无法计算：${friendlyError(error.message)}`,'error');return;}
  const baseline=report.threatsByPlan?.[plan.id]?.single??(report.recommendedId===plan.id?report.threats?.single:null);
  if(baseline&&!baseline.custom&&!customDefaultSingles.has(plan.id))customDefaultSingles.set(plan.id,structuredClone(baseline));
  const requestId=++customRequestId;
  customPending={id:requestId,planId:plan.id,scene:task3SceneKey,reportRequestId:report.requestId};customEdit.planId=plan.id;
  const condition=report.conditions?.[0]??{};
  const input={plan,waypoints:customEdit.waypoints.map(point=>[...point]),aglM:config.aglM[0],speedMps:config.speedMps,target:{...report.target,...condition.target},environment:{...report.environment,...condition.environment},core:report.sampling.bounds.core,coreRadius:report.settings.coreRadius,interval:2};
  syncCustomEditor();setCustomStatus('正在后台生成路线与单机威胁帧，请勿切换场景或方案；清除/取消可中止。');setStatus('自定义单机威胁后台计算中，不会启动完整优化。');updateDiagnostics();
  try{getCustomWorker().postMessage({type:'custom-single-threat',site:getSite?.()??null,requestId,baseURL:new URL('./',location.href).href,input});}
  catch(error){failCustomRequest(requestId,error.message);}
 }
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
 function focus(position,span=700){const point=position?.isVector3?position.toArray():position;if(!Array.isArray(point)||point.length!==3)return;controls.target.fromArray(point);camera.position.fromArray(point).add(new THREE.Vector3(span*.55,span*.9,span*.75));controls.update();}
 function updateLayerVisibility(){
  layer.visible=!!report&&!!plan&&mapActive&&!mapSwitching&&!constraintsInvalid;
  if(!layer.visible)deviceHover.hide();
 }
 function clearDetectedDevices(){
  detectedDeviceIds=new Set();
  for(const mesh of deviceMeshes){const halo=mesh.userData.halo;if(!halo)continue;halo.visible=false;halo.material.opacity=0;halo.scale.setScalar(1);}
 }
 function rebuildThreatGround(){threatGroundAt=null;try{threatGroundAt=getGroundAt?.()??null;}catch{}}
 function destroyLayer(){deviceHover.hide();resetCustomEditing();clearDetectedDevices();lastThreatTelemetry=null;for(const child of [...layer.children]){child.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});layer.remove(child);}blindMeshes={};deviceMeshes=[];targetMeshes=[];threatDrones.clear();threatDetectLines=null;threatRouteLines=[];updateLayerVisibility();}
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
  renderBlindList(row);renderBlindCompare();updateLayerVisibility();
 }
 function renderBlindList(row){
  const counts=row?.stats.byCategory??{};for(const [key] of Object.entries(BLIND_CATEGORIES)){const el=app.querySelector(`b[data-count="${key}"]`);if(el)el.textContent=counts[key]?` ${counts[key]}`:' 0';}
  const list=$('task3-blind-list');list.replaceChildren();
  list.insertAdjacentHTML('beforeend',`<p class="hint">当前方案：${plan?.name??'未选择'} · 工况：${report?.conditions[conditionIndex()]?.name??'未选择'}</p>`);
  if(!row?.points?.length){list.insertAdjacentHTML('beforeend','<p class="hint">当前工况采样点全部覆盖，无盲区。</p>');return;}
  for(const p of row.points){const b=document.createElement('button');b.className='task3-blind-item';b.style.borderLeftColor=`#${BLIND_COLORS[p.category].toString(16).padStart(6,'0')}`;
   const cause=p.category==='gap'?`缝宽 ${p.cause.gapWidthM.toFixed(0)} m`:p.category==='shadow'?`遮挡距 ${p.cause.blockerDistanceM.toFixed(0)} m`:p.category==='lowFacade'?`贴楼 ${p.cause.distanceToFacadeM.toFixed(1)} m · 离地 ${p.agl} m`:p.category==='corner'?`距角部 ${p.cause.cornerDistanceM.toFixed(1)} m`:'不满足四类几何特征';
   b.textContent=`${BLIND_CATEGORIES[p.category]} · ${cause}`;b.onclick=()=>focus(p.position,500);list.append(b);}
 }
 function renderBlindCompare(){
  const box=$('task3-blind-compare');if(!box)return;
  if(!report||!plan){box.replaceChildren();return;}
  const ci=conditionIndex(),table=document.createElement('table');table.className='task3-table task3-blind-compare-table';
  const rows=report.plans.map(p=>{
   const stats=report.blindspots?.[p.id]?.[ci]?.stats,by=stats?.byCategory??{};
   return `<tr${p.id===plan.id?' class="selected-plan"':''}><td>${p.name}${p.id===report.recommendedId?' ★':''}${p.id===plan.id?' · 当前':''}</td><td>${stats?.total??'—'}</td>${Object.keys(BLIND_CATEGORIES).map(key=>`<td>${by[key]??0}</td>`).join('')}</tr>`;
  }).join('');
  table.innerHTML=`<thead><tr><th>方案</th><th>盲区</th>${Object.values(BLIND_CATEGORIES).map(name=>`<th>${name}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>`;
  const totals=report.plans.map(p=>report.blindspots?.[p.id]?.[ci]?.stats?.total);
  const same=totals.every(value=>value===totals[0]);
  box.replaceChildren(table);
  box.insertAdjacentHTML('beforeend',`<p class="hint">${same?'当前工况下各方案盲区数量相同；切换“覆盖工况”可查看差异。':'当前工况下各方案盲区数量不同，选中行已高亮。'}</p>`);
 }
 // 威胁场景播放：底部“单机单点入侵 / 多方向同步入侵 / 蜂群饱和攻击”共用。
 function threatKey(){return $('task3-threat').value;}
 const threatsForPlan=()=>report?(report.threatsByPlan?.[plan?.id]??report.threats):null;
 const threatForPlan=()=>threatsForPlan()?.[threatKey()]??null;
 function threatLabel(){return THREAT_SCENARIOS[threatKey()]?.name??'威胁推演';}
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
  const detectedTargets=frame.targets.filter(target=>target.detectedBy.length);
  const detected=detectedTargets.length,primary=detectedTargets[0]??frame.targets[0];
  threatDetected=detected>0;
  th$('threat-name').textContent=threatLabel();
  th$('threat-live-state').textContent=detected?'发现目标 · 报警':primary?'未检出':'待命';
  th$('threat-count').textContent=String(frame.targets.length);
  th$('threat-detected').textContent=String(detected);
  threatHud.dataset.alarm=detected?'alarm':'clear';
  const telemetry=primary?flightTelemetry(primary.position,city.metadata?.ecefTransform,threatGroundAt):null;
  lastThreatTelemetry=telemetry;
  th$('threat-agl').textContent=telemetry?.agl==null?'未知':telemetry.agl.toFixed(1);
  th$('threat-coordinates').textContent=telemetry?.longitude!=null?`东经 ${telemetry.longitude.toFixed(6)}° · 北纬 ${telemetry.latitude.toFixed(6)}°`:'未知';
 }
 function hideThreatVisuals(){for(const drone of threatDrones.values())drone.visible=false;if(threatDetectLines)threatDetectLines.visible=false;for(const line of threatRouteLines)line.visible=false;}
 function disposeTargets(){
  for(const mesh of threatDrones.values()){layer.remove(mesh);mesh.traverse(object=>{object.geometry?.dispose();if(Array.isArray(object.material))object.material.forEach(material=>material.dispose());else object.material?.dispose();});}
  threatDrones.clear();targetMeshes=[];
 }
 function rebuildThreatRoutes(){
  for(const line of threatRouteLines){layer.remove(line);line.geometry.dispose();line.material.dispose();}
  threatRouteLines=[];
  const threat=threatForPlan();if(!threat?.frames?.length)return;
  for(const id of threat.frames[0].targets.map(target=>target.id)){
   const points=[];
   for(let index=0;index<threat.frames.length;index+=3){const target=threat.frames[index].targets.find(item=>item.id===id);if(target)points.push(new THREE.Vector3(...target.position));}
   if(points.length>1){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xff7a4a,transparent:true,opacity:.28,depthTest:false}));line.renderOrder=57;layer.add(line);threatRouteLines.push(line);}
  }
 }
 function installThreatFrame(){
  if(!report){clearDetectedDevices();return;}
  const threat=threatForPlan();if(!threat?.frames?.length){clearDetectedDevices();return;}
  const frames=threat.frames,index=Math.min(frames.length-1,threatFrameIndex),frame=frames[index];
  disposeTargets();
  const nextFrame=frames[Math.min(frames.length-1,index+1)],prevFrame=frames[Math.max(0,index-1)],detectedIds=new Set(),seen=new Set();
  for(const target of frame.targets){
   let drone=threatDrones.get(target.id);
   if(!drone){drone=createDroneMesh();drone.scale.setScalar(5);drone.userData.targetId=target.id;threatDrones.set(target.id,drone);layer.add(drone);}
   drone.visible=true;drone.position.fromArray(target.position);seen.add(target.id);
   const next=nextFrame.targets.find(item=>item.id===target.id),prev=prevFrame.targets.find(item=>item.id===target.id);
   const direction=new THREE.Vector3();
   if(next)direction.fromArray(next.position).sub(drone.position);
   if(direction.lengthSq()<1e-6&&prev)direction.copy(drone.position).sub(new THREE.Vector3(...prev.position));
   if(direction.lengthSq()>1e-6)drone.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction.normalize());
   for(const device of target.detectedBy)detectedIds.add(device.id);
  }
  for(const [id,drone] of threatDrones)if(!seen.has(id))drone.visible=false;
  targetMeshes=[...threatDrones.values()].filter(drone=>drone.visible);
  if(threatDetectLines){layer.remove(threatDetectLines);threatDetectLines.geometry.dispose();threatDetectLines.material.dispose();threatDetectLines=null;}
  const points=[];for(const target of frame.targets)for(const device of target.detectedBy){const found=plan?.devices.find(item=>item.id===device.id);if(found)points.push(found.position,target.position);}
  if(points.length){threatDetectLines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points.map(point=>new THREE.Vector3(...point))),new THREE.LineBasicMaterial({color:0xff776d,transparent:true,opacity:.55}));layer.add(threatDetectLines);}
  detectedDeviceIds=detectedIds;
  for(const mesh of deviceMeshes){const halo=mesh.userData.halo,on=detectedDeviceIds.has(mesh.userData.deviceId);halo.visible=on;halo.material.opacity=on ? .78 : 0;halo.scale.setScalar(1);}
  updateThreatHud(frame);
  updateDiagnostics();
 }
 function pauseThreatPlayback(){threatPlaying=false;threatLastStamp=0;cancelAnimationFrame(threatRafId);threatVoice.stop();updateDiagnostics();}
 function stopThreatPlayback(){pauseThreatPlayback();threatDetected=false;lastThreatTelemetry=null;hideThreatHud(0);}
 function threatPlayLoop(stamp){
  if(!threatPlaying)return;
  const threat=threatForPlan();if(!threat?.frames?.length){stopThreatPlayback();return;}
  if(threatLastStamp)threatFrameTime+=Math.min(.2,(stamp-threatLastStamp)/1000)*threatSpeed;threatLastStamp=stamp;
  for(const drone of targetMeshes)for(const rotor of drone.userData.rotors??[])rotor.rotation.y+=0.42;
  const duration=threat.frames.at(-1).time;
  if(threatFrameTime>=duration){threatFrameTime=duration;threatPlaying=false;threatVoice.stop();hideThreatHud(1500);updateDiagnostics();}
  const index=Math.min(threat.frames.length-1,threat.frames.findIndex(frame=>frame.time>=threatFrameTime));
  if(index!==threatFrameIndex&&index>=0){threatFrameIndex=index;installThreatFrame();}
  if(threatPlaying){threatVoice.update(threatDetected,lastThreatTelemetry);threatRafId=requestAnimationFrame(threatPlayLoop);}
 }
 function beginThreatPlayback(){
  if(mapSwitching||buildingSelector.diagnostics().active||constraintsInvalid)return false;
  const threat=threatForPlan();if(!threat?.frames?.length)return false;
  if(customEdit.active)resetCustomEditing();
  const duration=threat.frames.at(-1).time;
  if(threatFrameTime>=duration){threatFrameTime=0;threatFrameIndex=0;}
  rebuildThreatRoutes();showThreatHud();installThreatFrame();
  threatPlaying=true;threatLastStamp=0;threatVoice.update(threatDetected,lastThreatTelemetry);threatRafId=requestAnimationFrame(threatPlayLoop);
  updateDiagnostics();return true;
 }
 function selectThreatScenario(key){
  if(!THREAT_SCENARIOS[key])return;
  const changed=key!==threatKey();if(changed)resetCustomEditing();
  $('task3-threat').value=key;renderThreatConfig();
  if(changed)resetThreatVisuals();else pauseThreatSimulation();
  updateDiagnostics();
 }
 function startThreatSimulation(key){
  if(mapSwitching||buildingSelector.diagnostics().active)return false;
  if(constraintsInvalid){setStatus('建筑禁部署约束已变化，请先重新生成方案。','warning');return false;}
  if(!THREAT_SCENARIOS[key])key='single';
  if(key!=='single')resetCustomEditing();
  $('task3-threat').value=key;renderThreatConfig();
  mapActive=true;updateLayerVisibility();
  if(!threatsForPlan()?.[key]?.frames?.length){
   threatVoice.stop();threatDetected=false;lastThreatTelemetry=null;
   pendingThreatKey=key;threatFrameIndex=0;threatFrameTime=0;showThreatHud();
   th$('threat-name').textContent=THREAT_SCENARIOS[key].name;th$('threat-live-state').textContent=busy?'等待方案生成':'缺少威胁帧';th$('threat-count').textContent='—';th$('threat-detected').textContent='—';th$('threat-agl').textContent='—';th$('threat-coordinates').textContent='—';threatHud.dataset.alarm='clear';
   setStatus(busy?'威胁帧尚未就绪，请等待本次方案生成完成。':report?'当前方案缺少该场景威胁帧，请重新生成方案。':'尚未生成方案及威胁帧，请先在“推演输入 → 方案生成”中点击“生成方案”。','warning');
   return false;
  }
  pendingThreatKey=null;
  return beginThreatPlayback();
 }
 function pauseThreatSimulation(){if(!threatPlaying){pendingThreatKey=null;hideThreatHud(0);}pauseThreatPlayback();}
 function getThreatPlayback(){
  const threat=threatForPlan();
  return {enabled:!mapSwitching&&!buildingSelector.diagnostics().active&&!constraintsInvalid&&!!threat?.frames?.length,playing:threatPlaying,time:threatFrameTime,duration:threat?.frames?.at(-1)?.time??0,speed:threatSpeed,key:threatKey()};
 }
 function getThreatResult(){
  if(constraintsInvalid)return null;
  const threat=threatForPlan();if(!threat?.summary||!plan)return null;
  const metric=plan.metrics?.[0]??{};
  return {planId:plan.id,planName:plan.name,conditionId:threatKey(),conditionName:THREAT_SCENARIOS[threatKey()]?.name??threatKey(),deviceCount:plan.devices.length,cost:plan.cost,coverageRate:metric.coverageRate,blindRate:metric.blindRate,coreCoverageRate:metric.coreCoverageRate,detectedFraction:threat.summary.meanDetectedFraction,firstDetectionTime:threat.summary.meanFirstDetectionTime,lossEvents:threat.perTarget.reduce((sum,item)=>sum+(item.lossEvents??0),0),routeDuration:threat.frames?.at(-1)?.time??0,speed:threatSpeed,createdAt:Date.now()};
 }
 function setThreatSpeed(value){threatSpeed=Math.max(1,Number(value)||10);updateDiagnostics();}
 function setThreatProgress(value){
  if(!getThreatPlayback().enabled)return;
  const threat=threatForPlan();
  pauseThreatPlayback();showThreatHud();
  threatFrameTime=Math.max(0,Math.min(1,Number(value)/1000))*(threat.frames.at(-1).time);
  const index=threat.frames.findIndex(frame=>frame.time>=threatFrameTime);threatFrameIndex=Math.max(0,Math.min(threat.frames.length-1,index));
  installThreatFrame();
 }
 function setThreatTracking(enabled){
  threatTracking=enabled;
  th$('threat-track').setAttribute('aria-pressed',String(enabled));
  th$('threat-track').textContent=enabled?'停止跟踪':'跟踪目标';
  if(enabled&&targetMeshes[0])focus(targetMeshes[0].position,1600);
 }
 th$('threat-track').onclick=()=>setThreatTracking(!threatTracking);
 function renderPlans(){
  const t=report.comparison,table=document.createElement('table');table.className='task3-table';
  table.innerHTML=`<thead><tr><th>排名</th><th>方案</th><th>设备</th><th>覆盖完整性</th><th>盲区占比</th><th>成本*</th><th>可行性</th><th>EMC</th><th>得分</th></tr></thead>`;
  const tbody=document.createElement('tbody');
  for(const r of t.rows){const tr=document.createElement('tr');if(r.id===report.recommendedId)tr.classList.add('recommended');if(r.id===plan.id)tr.classList.add('selected-plan');const emc=mobileSnapshots.get(r.id)?.emc??report.emc[r.id];
   tr.innerHTML=`<td>${r.rank}</td><td>${r.name}${r.id===report.recommendedId?' ★':''}${r.id===plan.id?' · 当前':''}</td><td>${r.deviceCount}</td><td>${percent(r.coverage)}</td><td>${percent(r.blindRatio)}</td><td>${r.cost.toFixed(1)}</td><td>${r.feasibility.toFixed(2)}</td><td>${VERDICT[emc.verdict]}</td><td>${r.score.toFixed(3)}</td>`;
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
  const deviceRows=document.createElement('tbody');for(const [index,entry] of deviceDisplay.entries.entries()){const tr=document.createElement('tr'),mobile=plan.devices[index].mobileRepair?.platform==='police-car';tr.innerHTML=`<td><label class="task3-device-choice"><input type="checkbox">${entry.displayName}</label></td><td>${entry.typeName}</td><td>${entry.modelName}</td><td>${mobile?'警车移动部署':'原方案'}</td>`;const checkbox=tr.querySelector('input');checkbox.dataset.deviceId=plan.devices[index].id;checkbox.setAttribute('aria-label',`选择 ${entry.displayName} 部署解释`);checkbox.checked=selectedDevices.has(plan.devices[index].id);deviceRows.append(tr);}devices.append(deviceRows);$('task3-device-list').replaceChildren(devices);
  for(const id of selectedDevices)if(!plan.devices.some(d=>d.id===id))selectedDevices.delete(id);updateExplanationButton();
 }
 function renderEmc(){
  const e=report.emc[plan.id],box=$('task3-emc');box.replaceChildren();
  const banner=document.createElement('div');banner.className=`task3-emc-banner ${e.verdict}`;banner.textContent=e.text;box.append(banner);
  box.insertAdjacentHTML('beforeend',`<p class="hint">当前方案：${plan.name} · ${plan.devices.length} 台设备</p>`);
  if(e.conflicts.length){const t=document.createElement('table');t.className='task3-table';t.innerHTML='<thead><tr><th>设备对</th><th>类型</th><th>严重度</th><th>距离/m</th><th>建议</th></tr></thead>';const tb=document.createElement('tbody');
   for(const c of e.conflicts.slice(0,50)){const tr=document.createElement('tr');tr.innerHTML=`<td>${deviceDisplay.nameOf(c.a)} ↔ ${deviceDisplay.nameOf(c.b)}</td><td>${EMC_KIND[c.kind]??c.kind}</td><td>${EMC_SEVERITY[c.severity]??c.severity}</td><td>${formatEmcDistance(c.distanceM)}</td><td>${c.recommendation}</td>`;tb.append(tr);}t.append(tb);box.append(t);
   if(e.conflicts.length>50)box.insertAdjacentHTML('beforeend',`<p class="hint">仅列前 50 条，共 ${e.conflicts.length} 条，完整清单见导出 JSON。</p>`);}
  box.insertAdjacentHTML('beforeend',`<p class="hint">${e.mobileRepair?`已按原方案 + ${plan.derivation?.addedDeviceCount??0} 台移动设备重算；新增 fail ${e.mobileRepair.newFailCount} 项。`:''} ${e.notes.join('；')||''} 工程代理规则，非频谱合规认证。</p>`);
 }
 function planChatStatus(requestState){
  if(mapSwitching)return 'switching';
  if(busy)return 'working';
  if(!report||!plan)return 'none';
  return constraintsInvalid||requestState.staleResult?'stale':'ready';
 }
 function getPlanChatContext(){
  const status=planChatStatus(scheduler.getState());
  return {
   revision:report?.requestId,
   summary:createPlanChatSummary({status,report,activePlan:plan,conditionId:$('task3-condition').value,mobileSnapshots}),
   lookupDevice:status==='ready'?(question,previous)=>resolvePlanChatDevice({
    question,previous,report,activePlan:plan,activeDisplay:deviceDisplay,checkedIds:selectedDevices,
   }):null,
  };
 }
 function updateDiagnostics(){
  const view=renderer.domElement.parentElement,requestState=scheduler.getState(),freshness=$('task3-result-freshness');camera.updateMatrixWorld();
  freshness.hidden=!requestState.staleResult||!report;freshness.textContent=freshness.hidden?'':constraintsInvalid?'建筑禁部署约束已变化，旧设备已隐藏，请重新生成方案。':'当前展示为上一轮成功结果，非最新参数结果。';
  const selection=buildingSelector.diagnostics();
  const count=$('task3-building-count');
  count.textContent=buildingLoad?'正在加载当前地图的建筑明细…':buildingError||'已选择 '+selection.count+' 组 · 粉红色高亮表示禁止部署';
  $('task3-building-select').disabled=mapSwitching||!!buildingLoad;
  $('task3-building-clear').disabled=mapSwitching||!selection.count;
  window.task3Diagnostics={
   buildingSelection:selection,constraintsInvalid,selectedDeviceIds:[...selectedDevices],cameraPosition:camera.position.toArray(),
   ready:!!report,busy,mobilePending,version:TASK3_VERSION,plans:report?.plans.map(p=>({id:p.id,devices:p.devices.length,cost:p.cost})),recommendedId:report?.recommendedId,planId:plan?.id,blindStats:report&&plan?report.blindspots[plan.id]?.[conditionIndex()]?.stats:null,mobileRepair:report?.mobileRepair??null,emcVerdict:report&&plan?report.emc[plan.id].verdict:null,emcCounts:report&&plan?{...report.emc[plan.id].counts}:null,condition:$('task3-condition').value,threatScenario:threatKey(),threatPlaying,threatFrameIndex,threatFrameTime,threatSpeed,threatDuration:threatForPlan()?.frames?.at(-1)?.time??0,threatRouteCount:threatRouteLines.length,threatDetectionSegments:(threatDetectLines?.geometry.attributes.position.count??0)/2,detectedDeviceIds:[...detectedDeviceIds].sort(),sceneKey:task3SceneKey,threatGroundAvailable:typeof threatGroundAt==='function',threatTelemetry:lastThreatTelemetry?{...lastThreatTelemetry,position:[...lastThreatTelemetry.position]}:null,threatTargets:targetMeshes.map(mesh=>({id:mesh.userData.targetId,position:mesh.position.toArray(),quaternion:mesh.quaternion.toArray()})),activeTab,activeSub,
   requestId:requestState.requestId,reportRequestId:report?.requestId??null,layerVisible:layer.visible,mapActive,updateReason:requestState.updateReason,staleResult:requestState.staleResult,lastError:requestState.lastError,lastSuccessfulRequestId:requestState.lastSuccessfulRequestId,autoUpdatePending:requestState.pending,pendingUpdateReasons:requestState.pendingUpdateReasons,lastEquipmentSnapshot:lastRequestSnapshot?.equipmentSnapshot??report?.equipmentSnapshot??null,inputSummary:lastRequestSnapshot?{settings:lastRequestSnapshot.settings,weights:lastRequestSnapshot.weights,presetIds:lastRequestSnapshot.presetIds,planTypes:lastRequestSnapshot.planTypes,environment:lastRequestSnapshot.environment,target:lastRequestSnapshot.target}:null,
   customEditor:{active:customEdit.active,pending:!!customPending,requestId:customPending?.id??null,scene:customEdit.scene,planId:customEdit.planId,waypointCount:customEdit.waypoints.length,waypoints:customEdit.waypoints.map(point=>[...point]),lineCount:customEditLayer.children.filter(child=>child.userData.customConnection).length,appliedCustom:!!report?.threatsByPlan?.[plan?.id]?.single?.custom,defaultAvailable:customDefaultSingles.has(plan?.id),markers:customEditLayer.children.filter(child=>child.userData.customWaypoint).map(mesh=>{const p=mesh.position.clone().project(camera);return {index:mesh.userData.index,x:(p.x+1)/2*view.clientWidth,y:(1-p.y)/2*view.clientHeight,position:mesh.position.toArray(),visible:customEditLayer.visible&&p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1};})},
   deviceMarkers:deviceMeshes.map(mesh=>{const p=mesh.position.clone().project(camera),halo=mesh.userData.halo;return {deviceId:mesh.userData.deviceId,isMobile:mesh.userData.isMobile,deployment:mesh.userData.deployment?.deployment??null,x:(p.x+1)/2*view.clientWidth,y:(1-p.y)/2*view.clientHeight,visible:p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1,scale:mesh.scale.x,detected:detectedDeviceIds.has(mesh.userData.deviceId),haloVisible:halo.visible,haloOpacity:halo.material.opacity,haloScale:halo.scale.x};}),
  };
  // 供浏览器冒烟测试读取完整数据（替代已移除的 JSON 导出按钮）。
  window.__task3Report=report;window.__task3Run=run;window.__task3Export=()=>({report,activePlanId:plan?.id,deviceDisplay:deviceDisplay.toJSON()});
  const chatStatus=planChatStatus(requestState);
  if(chatStatus!==lastPlanChatStatus){
   lastPlanChatStatus=chatStatus;
   app.dispatchEvent(new CustomEvent('project-chat-plan-status',{detail:chatStatus}));
  }
 }
 let pdfExporting=false;
 function updatePdfVisibility(){
  const button=$('task3-export-pdf'),visible=activeTab==='plans'||(activeTab==='input'&&activeSub==='generate'),enabled=visible&&!busy&&!pdfExporting&&!!report&&!constraintsInvalid;
  button.hidden=!visible;button.disabled=!enabled;button.tabIndex=enabled?0:-1;
 }
 function controlsEnabled(){
  $('task3-run-side').disabled=busy||mapSwitching;$('task3-cancel-side').disabled=!busy;for(const id of ['task3-plan','task3-condition'])$(id).disabled=busy||!report;
  $('task3-custom-route').disabled=busy||constraintsInvalid||!!getSite?.()?.custom;$('task3-mobile-repair').disabled=busy||!report||constraintsInvalid;updatePdfVisibility();updateExplanationButton();
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
  activePipelineRequest=null;worker?.terminate();worker=null;busy=false;pendingThreatKey=null;stopThreatPlayback();
  const preserved=report?' 已保留上一轮成功结果（非最新参数结果）。':'';
  setStatus(`${scheduler.getState().updateReason}失败：${friendlyError(text)}${preserved}`,'error');controlsEnabled();updateDiagnostics();
 }
 function resetThreatVisuals(){
  stopThreatPlayback();threatFrameIndex=0;threatFrameTime=0;clearDetectedDevices();lastThreatTelemetry=null;disposeTargets();
  if(threatDetectLines){layer.remove(threatDetectLines);threatDetectLines.geometry.dispose();threatDetectLines.material.dispose();threatDetectLines=null;}
  rebuildThreatRoutes();
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
    activePipelineRequest=null;busy=false;mobilePending=false;mobileReportRequestId=null;mobileRequestId++;mobileSnapshots=new Map();report=data.report;run=data.run;constraintsInvalid=false;selectedDevices.clear();
    report.requestId=request.id;report.updateReason=request.updateReason;report.equipmentSnapshot=request.snapshot.equipmentSnapshot;run.requestId=request.id;run.updateReason=request.updateReason;run.equipmentSnapshot=request.snapshot.equipmentSnapshot;
    const previousPlanId=plan?.id;originalRun=run;plan=report.plans.find(p=>p.id===previousPlanId)??report.plans.find(p=>p.id===report.recommendedId)??report.plans[0];
    if(!scheduler.getState().staleResult)threatConfigs=structuredClone(report.settings.threatConfigs);
    $('task3-mobile-repair').checked=false;
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
 function renderAll(){deviceDisplay=createDeviceDisplayMap(plan.devices);renderScopeStatus();renderPlans();renderEmc();drawCommon();updateDiagnostics();}
 // 飞行模块由 planning/ui.js 独立维护，任务三只负责推演与工况数据。
 function publishSimulation(){}
 function startPipeline({requestId,updateReason}){
  stopBuildingSelection();
  resetCustomEditing();customDefaultSingles=new Map();
  activePipelineRequest=null;worker?.terminate();worker=null;busy=false;clearMobileRepairState();
  if(report&&plan)renderAll();else destroyLayer();
  const weights={};
  for(const input of app.querySelectorAll('#task3-weights input'))weights[input.dataset.weight]=Number(input.value);
  const planTypes=[...app.querySelectorAll('#task3-plan-types input:checked')].map(input=>input.dataset.planType);
  if(!planTypes.length){failPipeline('请至少选择一套方案（经济型/均衡型/增强型）。',requestId);return;}
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
   const customSite=getSite?.()?.custom;
   const normalizedThreatConfigs=customSite?DEFAULT_THREAT_CONFIGS:resolveThreatConfigs();
   if(!customSite)threatConfigs=structuredClone(normalizedThreatConfigs);
   const settings=resolveTask3Settings({buildingExclusions:buildingSelector.snapshot(),scope:custom?'custom':'core',scopeWidthM,scopeDepthM,spacing,heights:[30,60,100],siteSpacing:500,maxSites:192,maxDevices:Number($('task3-max-devices').value),budget:Number($('task3-budget').value),costs,threatConfigs:normalizedThreatConfigs,coreRadius:700,coreWeight:3,marginReserveDb:3});
   const equipmentSnapshot=sensors.getEquipmentSnapshot(),presetIds=renderEquipmentSelection(equipmentSnapshot);
   snapshot=createTask3RequestSnapshot({settings,weights,presetIds,equipmentSnapshot,scenarioSnapshot:sensors.getScenarioSnapshot(),planTypes});
  }catch(error){
   if(/网格间距/.test(error.message)){spacingInput.setAttribute('aria-invalid','true');if(updateReason.includes('手动'))spacingInput.focus();}
   failPipeline(error.message,requestId);return;
  }
  lastRequestSnapshot=snapshot;const request={id:requestId,updateReason,snapshot};activePipelineRequest=request;busy=true;$('task3-progress-side').value=0;controlsEnabled();updateDiagnostics();
  setStatus(`${updateReason}：后台计算中，地图仍可操作。${report?' 当前展示结果为上一轮参数，完成后自动替换。':''}`);
  try{getWorker().postMessage({type:'pipeline',site:getSite?.()??null,requestId,baseURL:new URL('./',location.href).href,settings:snapshot.settings,weights:snapshot.weights,presetIds:snapshot.presetIds,equipmentSnapshot:snapshot.equipmentSnapshot,environment:snapshot.environment,target:snapshot.target,planTypes:snapshot.planTypes});}
  catch(error){failPipeline(error.message,requestId);}
 }
 const scheduler=createTask3RunScheduler({run:startPipeline,hasCurrentResult:()=>!!report});
 const buildingSelector=mountBuildingSelector({canvas:renderer.domElement,camera,controls,scene,getContext:()=>buildingContexts.get(task3SceneKey)??{sceneKey:task3SceneKey},container:view,onChange:()=>{
  activePipelineRequest=null;worker?.terminate();worker=null;scheduler.cancel();scheduler.markStale();busy=false;mobilePending=false;mobileReportRequestId=null;mobileRequestId++;
  constraintsInvalid=!!report;selectedDevices.clear();resetCustomEditing();setThreatTracking(false);stopThreatPlayback();pendingThreatKey=null;
  $('task3-mobile-repair').checked=false;
  updateLayerVisibility();controlsEnabled();updateDiagnostics();setStatus('建筑禁部署选择已更新，请点击“生成方案”应用新约束。','warning');
 },onModeChange:active=>{
  $('task3-building-select').setAttribute('aria-pressed',String(active));
  $('task3-building-select').textContent=active?'退出建筑选择':'建筑权重 · 选择建筑';
  app.classList.toggle('task3-building-selecting',active);onMapPickMode?.(active);updateDiagnostics();
  const navigation=app.querySelector('.navigation');if(navigation)navigation.textContent=active?'左键选择 / 涂选 · 右键旋转 · 滚轮缩放':'左键旋转 · 右键平移 · 滚轮缩放';
 }});
 function stopBuildingSelection(){
  if(buildingLoad){
   buildingLoad.abort();buildingLoad=null;updateDiagnostics();
  }
  buildingSelector.setActive(false);
 }
 buildingSelector.refresh();
 $('task3-building-select').onclick=async()=>{
  if(mapSwitching||buildingLoad||!task3WindowVisible||activeTab!=='input'||activeSub!=='weights')return;
  if(buildingSelector.diagnostics().active){stopBuildingSelection();return;}
  buildingError='';
  const controller=new AbortController();
  buildingLoad=controller;updateDiagnostics();
  try{
   if(!buildingContexts.has(task3SceneKey)){
    const context=await getBuildingContext(controller.signal);
    controller.signal.throwIfAborted();
    if(context.sceneKey!==task3SceneKey)throw Error('地图已切换，请重新选择建筑。');
    buildingContexts.set(task3SceneKey,context);
   }
   resetCustomEditing();setThreatTracking(false);stopThreatPlayback();pendingThreatKey=null;
   buildingSelector.setActive(true);
  }catch(error){if(!controller.signal.aborted)buildingError=error.message;}
  finally{
   if(buildingLoad===controller){buildingLoad=null;updateDiagnostics();}
  }
 };
 $('task3-building-clear').onclick=()=>{
  buildingError='';buildingSelector.clear();updateDiagnostics();
 };
 window.addEventListener('blur',stopBuildingSelection);
 function updateExplanationButton(){
  const valid=!!report&&!!plan&&!busy&&!constraintsInvalid&&!scheduler.getState().staleResult;
  $('task3-device-explanation').disabled=!valid||!selectedDevices.size||explanationExporting;
  for(const input of $('task3-device-list').querySelectorAll('input'))input.disabled=!valid||explanationExporting;
  $('task3-device-explanation-status').textContent=explanationExporting?'正在生成中文 PDF…':!valid?'请先生成当前参数下的有效方案。':`已勾选 ${selectedDevices.size} 台设备，下载包含技术说明与通俗解释的合并 PDF。`;
 }
 $('task3-device-list').addEventListener('change',event=>{const id=event.target.dataset.deviceId;if(!id)return;if(event.target.checked)selectedDevices.add(id);else selectedDevices.delete(id);updateExplanationButton();updateDiagnostics();});
 $('task3-device-explanation').onclick=async()=>{
  if(!report||!plan||busy||constraintsInvalid||scheduler.getState().staleResult||!selectedDevices.size||explanationExporting)return;
  const input=structuredClone({report,run,activePlanId:plan.id,conditionId:report.conditions[conditionIndex()].id,deviceIds:[...selectedDevices]});
  explanationExporting=true;updateExplanationButton();
  try{const result=await exportDeviceExplanationPdf(input);setStatus(`已下载 ${result.devices.length} 台设备的部署解释明细。`);}
  catch(error){setStatus(`解释明细下载失败：${error.message}`,'error');}
  finally{explanationExporting=false;updateExplanationButton();}
 };
 const markInputsChanged=()=>{scheduler.markStale();controlsEnabled();updateDiagnostics();};
 sensors.subscribeEquipmentChanges(()=>{renderEquipmentSelection();markInputsChanged();});
 sensors.subscribeScenarioChanges(markInputsChanged);
 const pipelineInputSelector='#task3-scope-width,#task3-scope-depth,#task3-spacing,#task3-budget,#task3-max-devices,#task3-weights input,#task3-costs input,#task3-plan-types input,#task3-threat-count,#task3-threat-azimuths,#task3-threat-agl,#task3-threat-speed';
 panel.addEventListener('input',event=>{if(event.target.matches(pipelineInputSelector))markInputsChanged();});
 // 事件
 function setTask3Visibility(visible){
  task3WindowVisible=visible;
  if(!visible){resetCustomEditing();stopBuildingSelection();}
  updateLayerVisibility();
  deviceHover.hide();
 }
 button.onclick=()=>{workspace.activateView('task3');setTask3Visibility(true);};
 app.addEventListener('view-change',event=>setTask3Visibility(event.detail==='task3'));
 $('task3-threat').replaceChildren(...Object.entries(THREAT_SCENARIOS).map(([k,s])=>new Option(s.name,k)));
 $('task3-threat').onchange=()=>selectThreatScenario($('task3-threat').value);
 for(const id of ['task3-threat-count','task3-threat-azimuths','task3-threat-agl','task3-threat-speed']){
  $(id).addEventListener('input',saveThreatConfigForm);$(id).addEventListener('change',saveThreatConfigForm);
 }
 $('task3-threat-defaults').onclick=()=>{const key=$('task3-threat').value;if(key==='single')restoreDefaultSingle();else resetCustomEditing();threatConfigs[key]=structuredClone(DEFAULT_THREAT_CONFIGS[key]);renderThreatConfig();markInputsChanged();};
 $('task3-restore-defaults').onclick=()=>{
  stopBuildingSelection();buildingSelector.clear();
  $('task3-scope-width').value=2400;$('task3-scope-depth').value=2400;$('task3-spacing').value=500;$('task3-budget').value=600;$('task3-max-devices').value=64;
  for(const input of app.querySelectorAll('#task3-weights input'))input.value=METRIC_WEIGHTS[input.dataset.weight];
  const COST_DEFAULTS={radar:12,radio:5,optical:4,acoustic:2};for(const input of app.querySelectorAll('#task3-costs input'))input.value=COST_DEFAULTS[input.dataset.cost];
  resetThreatVisuals();threatConfigs=structuredClone(DEFAULT_THREAT_CONFIGS);renderThreatConfig();
  markInputsChanged();
 };
 $('task3-plan').onchange=()=>{selectedDevices.clear();restoreMobileRepair();$('task3-mobile-repair').checked=false;setMobileStatus('已切换方案并清理移动补盲，可按当前方案重新启用。');plan=report.plans.find(p=>p.id===$('task3-plan').value);renderAll();publishSimulation();setStatus(`已切换到「${plan.name}」：地图、盲区、EMC、方案详情已同步更新。`);};
 $('task3-condition').onchange=()=>{renderPlans();drawCommon();publishSimulation();updateDiagnostics();};
 $('task3-mobile-repair').onchange=()=>{
  const checkbox=$('task3-mobile-repair');if(busy||!report||!plan||constraintsInvalid){checkbox.checked=mobilePending;return;}
  if(!checkbox.checked){restoreMobileRepair();renderAll();publishSimulation();setMobileStatus('已取消移动补盲，恢复原方案设备、盲点、覆盖贡献与 EMC。');setStatus('已恢复原方案。');return;}
  if(mobileSnapshots.has(plan.id))return; // 重复勾选不叠加设备或重复请求。
  busy=true;mobilePending=true;mobileReportRequestId=report.requestId;const requestId=++mobileRequestId;deviceHover.hide();setMobileStatus('正在后台搜索当前盲点附近的有效地表候选…');setStatus('移动补盲后台计算中，不会重跑整套流水线。');controlsEnabled();updateDiagnostics();
  getWorker().postMessage({type:'mobile-repair',site:getSite?.()??null,requestId,baseURL:new URL('./',location.href).href,equipmentSnapshot:report.equipmentSnapshot,input:{plan,sampling:report.sampling,equipment:report.equipment,settings:report.settings,environment:report.environment,target:report.target,conditionId:$('task3-condition').value,equipmentSnapshot:report.equipmentSnapshot}});
 };
 for(const cb of app.querySelectorAll('#task3-blind-legend input'))cb.onchange=()=>{for(const [cat,{mesh}] of Object.entries(blindMeshes))mesh.visible=app.querySelector(`input[data-category="${cat}"]`).checked;};
 $('task3-export-pdf').onclick=async()=>{
  if(!report||!run||busy||pdfExporting||constraintsInvalid)return;
  const exportingRun=run;
  pdfExporting=true;updatePdfVisibility();setStatus('正在生成已选方案的完整 PDF…');
  try{
   const conditionId=report.conditions[conditionIndex()]?.id??'nominal';
   await exportDeploymentPdf({report,run:exportingRun,planIds:'all',activePlanId:plan?.id,rules:[],conditionId});
   if(run===exportingRun)setStatus(`已按 ${exportingRun.runId} 生成所选方案的完整 PDF。`);
  }catch(error){if(run===exportingRun)setStatus(`无法生成部署方案 PDF：${error.message}`,'error');}
  finally{pdfExporting=false;updatePdfVisibility();}
 };
 function setScene(site,{coreChanged=false}={}){
  const key=site?.base??'recon';if(key===task3SceneKey&&!coreChanged)return;task3SceneKey=key;
  if(site?.custom&&activeSub==='threat')activeSub='scope';
  generatePane.querySelector('.hint').textContent=site?.custom?'自定义区域支持覆盖评估、方案对比和电磁兼容分析。':'选择一套或多套方案后生成；未勾选的方案不会进入方案对比、威胁验证和 PDF 导出。';
  resetCustomEditing();customDefaultSingles=new Map();
  stopBuildingSelection();buildingError='';buildingSelector.refresh();constraintsInvalid=false;selectedDevices.clear();
  activePipelineRequest=null;lastRequestSnapshot=null;worker?.terminate();worker=null;
  mobileReportRequestId=null;mobileRequestId++;
  report=null;run=null;originalRun=null;plan=null;deviceDisplay=createDeviceDisplayMap();mobileSnapshots=new Map();mobilePending=false;busy=false;pendingThreatKey=null;threatFrameIndex=0;threatFrameTime=0;scheduler.cancel();
  setThreatTracking(false);stopThreatPlayback();destroyLayer();rebuildThreatGround();
  $('task3-mobile-repair').checked=false;setMobileStatus('完成推演后可启用移动补盲。');
  for(const id of ['task3-plans-table','task3-plan','task3-plan-detail','task3-device-list','task3-emc','task3-condition','task3-blind-compare','task3-blind-list'])$(id).replaceChildren();
  for(const count of panel.querySelectorAll('#task3-blind-legend [data-count]'))count.textContent='';
  const scopeStatus=$('task3-scope-status');
  scopeStatus.textContent='生成方案后显示当前场景范围。';scopeStatus.dataset.tone='';
  $('task3-progress-side').value=0;setStatus(coreChanged?'核心建筑已更新，请重新推演。':site?'场景已切换，请重新推演。':'待命');applyTab();controlsEnabled();updateDiagnostics();
 }
 rebuildThreatGround();applyTab();renderThreatConfig();renderEquipmentSelection();controlsEnabled();updateDiagnostics();
 function setMapSwitching(value){
  if(mapSwitching===value)return;
  mapSwitching=value;
  if(value){resetCustomEditing();stopBuildingSelection();setThreatTracking(false);stopThreatPlayback();pendingThreatKey=null;}
  controlsEnabled();updateLayerVisibility();updateDiagnostics();
 }
 return {panel,layer,setStatus,setScene,setMapSwitching,getPlanChatContext,showTab(id){if(!TABS[id])return;activeTab=id;activeSub=TABS[id].subs[0]?.[0]??null;applyTab();},setMapActive(value){mapActive=!!value;if(!mapActive){resetCustomEditing();stopBuildingSelection();}updateLayerVisibility();updateDiagnostics();},selectThreatScenario,startThreatSimulation,pauseThreatSimulation,getThreatPlayback,getThreatResult,setThreatSpeed,setThreatProgress,update(stamp){
  if(!layer.visible){if(buildingSelector.diagnostics().active)updateDiagnostics();return;}
  const pulse=.5+.5*Math.sin((Number(stamp)||0)*.006);
  for(const mesh of deviceMeshes){
   const halo=mesh.userData.halo,on=detectedDeviceIds.has(mesh.userData.deviceId);mesh.material.color.set(mesh.userData.isMobile?0xff9f5a:COLORS[mesh.userData.deviceType]);halo.quaternion.copy(camera.quaternion);halo.visible=on;
   if(on){halo.material.opacity=.35+.5*pulse;halo.scale.setScalar(1+.25*pulse);}else{halo.material.opacity=0;halo.scale.setScalar(1);}
  }
  if(threatTracking&&targetMeshes[0]){const target=targetMeshes[0];controls.target.lerp(target.position,0.12);camera.position.lerp(target.position.clone().add(new THREE.Vector3(900,1100,900)),0.06);controls.update();}
  updateDiagnostics();
 }};
}
