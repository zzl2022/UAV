import {PHYSICS_FIELDS} from './physics.js';
import * as THREE from 'three';
import {PRESETS,TYPES,fieldsFor,ENV_FIELDS,TARGET_FIELDS,createDevice,EQUIPMENT_SOURCE} from './presets.js';
import {MODEL_VERSION,evaluate,validateScenario,validateDevice,validateTarget,validateEnvironment,opticalFov} from './engine.js';
import {createSceneQuery} from './scene.js';
import './ui.css';
import {nominalCoverage} from './coverage.js';
import {defaultScenario} from './scenario.js';
import {mountHeatmap} from './heatmap-ui.js';
import {mountCapabilityAssessment} from './capability-ui.js';
import {createEquipmentDemo} from './equipment-demo.js';
import {assessmentSummary} from './capability-data.js';
import {mountEquipmentManager} from './equipment-manager.js';
import {mountCityConditions} from './city-conditions.js';

const COLORS={radar:0x70d6ff,optical:0xffd783,radio:0xb89aff,acoustic:0x69e2bd};
const format=x=>typeof x==='number'?(Math.abs(x)>=10000?x.toFixed(0):x.toFixed(2)):'—';
const TYPE_METRICS={rangeMeters:'距离误差 / m',azimuthDegrees:'方位误差 / °',elevationDegrees:'俯仰误差 / °',multipathBiasDegrees:'多径角偏差指标 / °',networkLocalizationMeters:'三维站网定位误差估计 / m',angularPixelDegrees:'单像素角度 / °'};
const LOSS_NAMES={facadeReflection:'Facade reflection',rain:'雨衰',cloudFog:'云雾衰减',multipath:'地面双径（负值为增强）',clutter:'城市杂波',noise:'底噪抬升',cochannel:'同频干扰',crosstalk:'设备串扰',visibility:'能见度消光',penetration:'建筑穿透',diffraction:'遮挡绕射',spreading:'几何扩散',air:'空气吸收',refraction:'折射附加损耗'};

export function mountSensorUI({app,scene,camera,controls,renderer,model,city,workspace,tweenCamera}){
 const panel=document.createElement('div');panel.id='equipment-panel';panel.hidden=true;
 panel.innerHTML=`
 <section><h2>当前装备</h2><select id="equipment-device" aria-label="当前装备"></select><div class="sensor-add"><select id="equipment-preset" aria-label="添加型号"></select><button id="equipment-add">＋ 添加</button></div><div class="buttons"><button id="equipment-remove">删除当前</button><button id="equipment-focus">聚焦点位</button></div><button id="equipment-reset" class="clear-devices">清空设备</button></section>
 <label class="probe-setting">鼠标查询：表面上方 / m<input id="equipment-probe-height" type="number" min="0" max="2000" step="1" value="50"></label>
 <section><h2>单目标能力比较</h2><div id="equipment-results"></div></section>
 <section><h2>位置与姿态</h2><div id="equipment-position" class="sensor-fields"></div><div class="buttons"><button id="equipment-pick-device">在地图选装备点</button><button id="equipment-pick-target">在地图选目标点</button></div><p class="hint">拖动设备或目标调整位置。</p></section>
 <details><summary>设备参数与来源</summary><div id="equipment-parameters" class="sensor-fields"></div><p id="equipment-parameter-note" class="hint" hidden></p></details>
 <details><summary>目标与工作模式</summary><div id="equipment-target-position" class="sensor-fields"></div><label>目标发射无线电 <input id="equipment-emitting" type="checkbox" checked></label><label>光电工作模式<select id="equipment-optical-mode"><option value="wide">可见光 · 宽视场</option><option value="narrow">可见光 · 窄视场</option><option value="thermal">热成像</option></select></label><div id="equipment-target" class="sensor-fields"></div></details>
 <details><summary>环境与站网参数</summary><div id="equipment-environment" class="sensor-fields"></div></details>
 <section><h2>评估结果</h2><div id="equipment-breakdown"></div></section>
 <div id="equipment-message" role="status" class="sensor-message"></div>
 <section class="sensor-io"><button id="equipment-export" class="primary">导出参数与评估报告 · JSON ↓</button><label class="sensor-import">导入参数方案<input id="equipment-import" type="file" accept=".json,application/json"></label><details><summary>示例方案</summary><button id="equipment-defaults">载入四类示例设备</button></details></section>`;
 const sceneControls=document.createElement('div');sceneControls.id='equipment-scene-controls';sceneControls.hidden=true;sceneControls.append(...panel.childNodes);panel.append(sceneControls);
 const scenePanelVisible=()=>!sceneControls.hidden;
 workspace.mountWindow('equipment','反无设备',panel,{closeId:'equipment-back',onClose:()=>{
  panel.hidden=true;layer.visible=false;pickMode=null;endDrag();hideProbe();heat.hide();capabilities?.invalidate();
  app.classList.remove('equipment-window-open');
 }});
 const physicalSection=document.createElement('details');physicalSection.id='equipment-physics-section';physicalSection.innerHTML='<summary>雷达 / 无线电物理链路参数</summary><div id="equipment-physics" class="sensor-fields"></div>';
 panel.querySelector('.sensor-io').before(physicalSection);
 const hopping=document.createElement('label');hopping.innerHTML='跳频目标 <input id="equipment-fhss" type="checkbox">';panel.querySelector('#equipment-emitting').parentElement.after(hopping);
 const toggle=app.querySelector('#toggle-sensors');
 const $=id=>panel.querySelector('#'+id);
 const layer=new THREE.Group();layer.name='Sensor_Modeling';layer.visible=false;scene.add(layer);
 let query,state,selectedId,pickMode=null,results=[],serial=4,lastContexts=new Map(),capabilities;
 let markerMeshes=[],drag=null,dragTimer,probeHeight=50,valid=true,heatQuery,demo=null,demoQueries={};
 const defaultState=()=>defaultScenario(city);
 state=defaultState();selectedId=state.devices[0].id;
 const homeModel=model,homeOrigin=[...state.origin],homeAnchor=[...state.devices[0].position];
 let activeMode='recon',activeModel=homeModel,activeOrigin=[...homeOrigin],activeAnchor=[...homeAnchor],activeMeta=null;
 function sceneDefaultState(){
  const next=defaultState();
  if(activeMode==='recon')return next;
  const shift=activeAnchor.map((value,index)=>value-homeAnchor[index]);
  for(const device of next.devices)device.position=device.position.map((value,index)=>value+shift[index]);
  next.target.position=next.target.position.map((value,index)=>value+shift[index]);
  next.origin=[...activeOrigin];
  return next;
 }
 const selected=()=>state.devices.find(d=>d.id===selectedId);
 for(const p of PRESETS){const option=new Option(`${TYPES[p.type]} · ${p.name}`,p.id);$('equipment-preset').add(option);}
 function message(text){$('equipment-message').textContent=text;}
 function numericFields(container,values,fields,scope,provenance={}){
  container.replaceChildren();
  for(const [key,field] of Object.entries(fields)){
   const label=document.createElement('label');label.className='sensor-field';
   const title=document.createElement('span');title.textContent=field.label;
   const input=document.createElement('input');input.type='number';input.min=field.min;input.max=field.max;input.step=field.step;input.value=values[key];input.dataset.scope=scope;input.dataset.field=key;input.setAttribute('aria-label',field.label);
    const unit=document.createElement('small');unit.textContent=scope.endsWith('position')?field.unit:`${field.unit} · ${provenance[key]??field.source??'场景假设'}`;
    if(scope.endsWith('position')&&key==='up')label.title='局部 ENU 上坐标，单位米；与离地高度及海拔不同';
   label.append(title,input,unit);container.append(label);
  }
 }
 const positionFields={east:{label:'东坐标',unit:'m',min:-30000,max:30000,step:1},north:{label:'北坐标',unit:'m',min:-30000,max:30000,step:1},up:{label:'上坐标',unit:'m',min:-20000,max:20000,step:1}};
 const positionValues=p=>({east:p[0],north:-p[2],up:p[1]});
 function renderForm(){
  const device=selected(),preset=device?PRESETS.find(p=>p.id===device.presetId):null;
  $('equipment-device').replaceChildren(...state.devices.map(d=>new Option(`${TYPES[d.type]} · ${d.name} (${d.id})`,d.id,false,d.id===selectedId)));
  $('equipment-device').disabled=!device;
  if(!device)$('equipment-device').add(new Option('暂无设备，请选择型号并添加',''));
  const dataset=capabilities?.isDataset(device);
  $('equipment-parameter-note').textContent=dataset?'':preset?.notes??'';
  $('equipment-parameter-note').hidden=!$('equipment-parameter-note').textContent;
  $('equipment-physics-section').hidden=!device?.physics;
  if(device?.physics)numericFields($('equipment-physics'),device.physics,PHYSICS_FIELDS[device.type],'physics');
  $('equipment-fhss').checked=state.target.fhss===true;
  const provenance={...preset?.provenance};
  for(const key of Object.keys(device?.parameters??{}))if(device.parameters[key]!==preset.parameters[key])provenance[key]='用户调整';
  for(const key of ['maxRange','capacity'])if(device?.type==='radio'&&provenance[key]!=='用户调整')provenance[key]='文档派生';
  if(device){numericFields($('equipment-position'),positionValues(device.position),positionFields,'device-position');numericFields($('equipment-parameters'),device.parameters,Object.fromEntries(Object.entries(fieldsFor(device.type)).filter(([k])=>!device.physics||!['referenceSnrDb','thresholdDb','referenceRcs','pathExponent','referenceEirpDbm'].includes(k))),'parameters',provenance);}
  else{$('equipment-position').replaceChildren();$('equipment-parameters').replaceChildren();}
  $('equipment-pick-device').disabled=!device;$('equipment-focus').disabled=!device;
  numericFields($('equipment-target-position'),positionValues(state.target.position),positionFields,'target-position');
  numericFields($('equipment-target'),state.target,{...TARGET_FIELDS,acousticFrequencyHz:{label:'目标主声频',unit:'Hz',min:20,max:20000,step:10}},'target');
  numericFields($('equipment-environment'),state.environment,ENV_FIELDS,'environment');
  $('equipment-emitting').checked=state.target.emitting;$('equipment-optical-mode').value=state.target.opticalMode;
  $('equipment-remove').disabled=!device;
  if(dataset)capabilities.renderParameters($('equipment-parameters'));
  // Dataset optical/acoustic settings live here; the original form remains available in simulation mode.
  for(const node of [$('equipment-environment').parentElement,$('equipment-target').parentElement])node.hidden=dataset;
  $('equipment-probe-height').parentElement.hidden=dataset;
  $('detection-controls').hidden=!!device&&['optical','acoustic'].includes(device.type);
  capabilities?.form();
 }
 function disposeLayer(){markerMeshes=[];for(const child of [...layer.children]){child.geometry?.dispose();child.material?.dispose();layer.remove(child);}}
 function line(points,color,dashed=false){const geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));const material=dashed?new THREE.LineDashedMaterial({color,dashSize:35,gapSize:25,transparent:true,opacity:0.5}):new THREE.LineBasicMaterial({color});const object=new THREE.Line(geometry,material);if(dashed)object.computeLineDistances();layer.add(object);}
 function mark(position,color,size,identity){const mesh=new THREE.Mesh(new THREE.SphereGeometry(size,12,8),new THREE.MeshBasicMaterial({color,depthTest:false}));mesh.position.fromArray(position);mesh.renderOrder=10;mesh.userData=identity;layer.add(mesh);markerMeshes.push(mesh);}
 function draw(){
  disposeLayer();
  for(const device of state.devices){
   if(!capabilities?.isDataset(device)&&(state.devices.length<=12||device.id===selectedId)){const shade=new THREE.Mesh(nominalCoverage(device,state.target),new THREE.MeshBasicMaterial({color:COLORS[device.type],transparent:true,opacity:device.id===selectedId?0.13:0.035,side:THREE.DoubleSide,depthWrite:false}));
   shade.position.fromArray(device.position);shade.visible=heat.nominalVisible();shade.userData={deviceId:device.id,kind:'nominal-range-shade'};layer.add(shade);}
   mark(device.position,COLORS[device.type],device.id===selectedId?10:6,{deviceId:device.id,kind:'device'});
  }
  mark(state.target.position,0xff7e85,10,{kind:'target'});
  const device=selected();if(device){const result=results.find(r=>r.id===device.id),context=lastContexts.get(device.id);
   const color=capabilities?.isDataset(device)?context?.blocked?0xff7e85:context?.known?0x89bce5:0x8796aa:result?.eligible?0x69e2bd:0xff7e85;
   line([device.position,state.target.position],color);if(!capabilities?.isDataset(device))for(const path of context?.facadePaths??[])line([device.position,path.point,state.target.position],0xffd783,true);}
  layer.updateMatrixWorld(true);
 }
 function metric(parent,label,value){if(value==null||value==='—')return;const row=document.createElement('div');row.className='sensor-metric';const title=document.createElement('span'),number=document.createElement('strong');title.textContent=label;number.textContent=value;row.append(title,number);parent.append(row);}
 function renderResults(){
  $('equipment-results').replaceChildren();
  if(!results.length)$('equipment-results').textContent='暂无设备，添加后显示信号与判定。';
  for(const result of results){const device=state.devices.find(d=>d.id===result.id),dataset=capabilities?.isDataset(device),assessment=dataset?capabilities.result(device.id):null;
   const row=document.createElement('button');row.className=`sensor-result ${result.id===selectedId?'is-selected':''}`;row.dataset.select=result.id;const title=document.createElement('span');title.textContent=TYPES[result.type];const value=document.createElement('span');value.textContent=dataset?`${format(result.geometry.distance)} m`:`${format(result.marginDb)} dB`;const badge=document.createElement('span');badge.className=dataset?'neutral':result.status==='within-model'?'pass':'fail';badge.textContent=dataset?assessmentSummary(assessment):result.status==='within-model'?'模型内可感知':result.status==='uncertain'?'场景范围外':'模型内不可感知';row.append(title,value,badge);$('equipment-results').append(row);}
  const r=results.find(r=>r.id===selectedId),parent=$('equipment-breakdown');parent.replaceChildren();if(!r)return;
  if(capabilities?.isDataset(selected())){capabilities.renderMetrics(parent,capabilities.result(selectedId));capabilities.renderParameters($('equipment-parameters'));return;}
  metric(parent,'空间距离 / m',format(r.geometry.distance));metric(parent,'方位 / 俯仰 / °',`${format(r.geometry.azimuth)} / ${format(r.geometry.elevation)}`);
  metric(parent,'遮挡建筑数',r.geometry.buildingCount);if(r.geometry.blocked||r.geometry.known)metric(parent,'几何直达路径',r.geometry.blocked?'已遮挡':'当前网格未检出遮挡');
  metric(parent,'模型裕量 / dB',format(r.marginDb));metric(parent,'估计信噪比 / dB',format(r.snrDb));metric(parent,'当前路径等效距离上限 / m',format(r.equivalentRangeMeters));
  if(r.reasons.length){const text=document.createElement('p');text.className='sensor-reasons';text.textContent=r.reasons.join('；');parent.append(text);}
  for(const [key,value] of Object.entries(r.losses))metric(parent,`${LOSS_NAMES[key]??key} / dB`,format(value));
  for(const [key,value] of Object.entries(r.errors))if(value!==null&&Number.isFinite(value))metric(parent,TYPE_METRICS[key]??key,format(value));
  if(r.extras.backend)metric(parent,'计算模型',r.type==='radar'?'雷达能量方程模型':'无线电链路预算模型');
  const extraLabels={modelPd:'Model Pd (uncalibrated)',requiredSnrDb:'Required SNR / dB',pulseBlindRangeMeters:'Pulse blind range / m',receivedPowerDbm:'Received power / dBm',noiseDbm:'Thermal noise / dBm',processingGainDb:'Processing gain / dB',captureProbability:'FHSS capture probability',tdoaBiasMeters:'NLOS bias / m',tdoaBiasSeconds:'NLOS bias / s',recognitionRangeMeters:'Recognition range / m',reflectionDelaySeconds:'Echo delay / s',rangeBiasMeters:'Echo range bias / m',facadePathCount:'Facade paths',ghostRiskIndex:'虚警风险指标（非概率）',angularPixels:'目标原始像素',effectivePixels:'目标有效像素',horizontalFov:'瞬时水平视场 / °',verticalFov:'瞬时垂直视场 / °',contrastFactor:'对比度系数',multipathDopplerSpreadHz:'多径频率展宽指标 / Hz',receivedSoundDb:'接收声压 / dB SPL',noiseDb:'合成背景声压 / dB SPL',soundSpeed:'沿路径声速 / m/s',propagationSeconds:'声传播时延 / s',temporalDriftMeters:'时延导致的位置滞后 / m',mixingRiskIndex:'声波混叠风险指标'};
  Object.assign(extraLabels,{modelPd:'统计模型 Pd（非实测）',requiredSnrDb:'统计检出门限 / dB',pulseBlindRangeMeters:'脉冲近距盲区 / m',receivedPowerDbm:'链路接收功率估计 / dBm',noiseDbm:'接收机热噪声 / dBm',processingGainDb:'反推处理增益 / dB',captureProbability:'跳频捕获概率近似',tdoaBiasMeters:'NLOS 时差距离偏差 / m',tdoaBiasSeconds:'NLOS 时差偏差 / s',recognitionRangeMeters:'消光门限识别距离 / m',reflectionDelaySeconds:'立面回声超额时延 / s',rangeBiasMeters:'回声距离偏差 / m',facadePathCount:'有效一次立面反射路径数'});
  for(const [key,label] of Object.entries(extraLabels))if(key in r.extras)metric(parent,label,format(r.extras[key]));
  if(r.extras.ghostCandidate){metric(parent,'双径虚拟回波距离 / m',format(r.extras.ghostCandidate.apparentRangeMeters));metric(parent,'虚拟回波可分辨',r.extras.ghostCandidate.resolvable?'仅在近似模型中可分辨':'低于参考距离分辨能力');}
  for(const warning of r.warnings.filter(w=>!/缺少|缺失|未知|未提供/.test(w))){const text=document.createElement('p');text.className='hint';text.textContent=warning;parent.append(text);}
 }
 function compute(){
  capabilities?.invalidate();
  try{
   for(const d of state.devices)validateDevice(d);validateTarget(state.target);validateEnvironment(state.environment);
   const contexts=new Map();lastContexts=new Map();
   results=state.devices.map(device=>{const key=JSON.stringify([device.position,state.target.position]);let context=contexts.get(key);if(!context){context=query.trace(device.position,state.target.position);contexts.set(key,context);}lastContexts.set(device.id,context);return evaluate(device,state.target,state.environment,context);});
   valid=true;renderResults();draw();message(state.devices.length>12?'仅显示当前设备的标称范围。':'');$('equipment-export').disabled=false;
   window.sensorDiagnostics={modelVersion:MODEL_VERSION,deviceCount:state.devices.length,types:state.devices.map(d=>d.type),results:structuredClone(results),selectedId,devicePositions:state.devices.map(d=>({id:d.id,position:[...d.position]})),targetPosition:[...state.target.position],coverage:layer.children.filter(o=>o.userData.kind==='nominal-range-shade').map(o=>({deviceId:o.userData.deviceId,...o.geometry.userData}))};
   updateMarkerScreens();
   if(scenePanelVisible()){heat.schedule();capabilities?.refresh();}else heat.hide();
  }catch(error){capabilities?.invalidate();valid=false;hideProbe();heat.hide();message(`无法计算：${error.message}`);$('equipment-results').replaceChildren();$('equipment-breakdown').replaceChildren();$('equipment-export').disabled=true;window.sensorDiagnostics={error:error.message};}
 }
 function focus(){if(!selected())return;const p=new THREE.Vector3(...selected().position),t=new THREE.Vector3(...state.target.position),center=p.clone().add(t).multiplyScalar(0.5),span=Math.max(200,p.distanceTo(t)*1.5);controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(span*.65,span*.65,span*.85));controls.update();updateMarkerScreens();}
 function setActiveScene(next,context){
  const nextModel=next==='recon'?homeModel:context?.model;
  if(!nextModel||(next===activeMode&&nextModel===activeModel))return;
  const nextOrigin=next==='recon'?homeOrigin:context.origin;
  const nextAnchor=next==='recon'?homeAnchor:context.anchor;
  const delta=nextAnchor.map((value,index)=>value-activeAnchor[index]);
  for(const device of state.devices)device.position=device.position.map((value,index)=>value+delta[index]);
  state.target.position=state.target.position.map((value,index)=>value+delta[index]);
  state.origin=[...nextOrigin];
  activeMode=next;activeModel=nextModel;activeOrigin=[...nextOrigin];activeAnchor=[...nextAnchor];activeMeta=next==='recon'?null:context?.meta??null;
  demo?.stop();demoQueries={};query=null;heatQuery=null;lastContexts.clear();
  heat.setModel(activeModel);capabilities?.invalidate();renderForm();
  if(!panel.hidden){if(!query)query=createSceneQuery(activeModel,{reflections:true});compute();}
 }
 function show(){
  panel.hidden=false;
  app.classList.add('equipment-window-open');
  workspace.showWindow('equipment');manager.refresh();
  if(!query){message(`正在建立${activeMode==='recon'?'建筑/地形':'当前站点'}空间索引…`);query=createSceneQuery(activeModel,{reflections:true});}
  layer.visible=true;renderForm();compute();focus();
 }
 // HUD-menu entry: show the scene equipment markers without opening the old
 // floating window and without moving the camera (the map stays in 全域视角).
 function activate(){
  panel.hidden=false;
  app.classList.add('equipment-window-open');
  manager.refresh();
  if(!query){message(`正在建立${activeMode==='recon'?'建筑/地形':'当前站点'}空间索引…`);query=createSceneQuery(activeModel,{reflections:true});}
  layer.visible=true;renderForm();compute();
 }
 function deactivate(){
  endDrag();hideProbe();pickMode=null;layer.visible=false;capabilities?.invalidate();
  app.classList.remove('equipment-window-open');
 }
 // Keep the scenario selection aligned with the catalog type: if the current
 // device already has this type, keep it (so model changes stay on the same
 // physical device); otherwise pick the first device of that type.
 function ensureDevice(type){
  let device=selected();
  if(!device||device.type!==type){
   device=state.devices.find(item=>item.type===type)??null;
   if(device){selectedId=device.id;renderForm();}
  }
  return device;
 }
 function centerPoint(){
  const ground=activeModel.ground;ground.geometry.computeBoundingBox?.();
  const bounds=ground.geometry.boundingBox??{min:{x:-5000,z:-5000},max:{x:5000,z:5000}};
  const x=(bounds.min.x+bounds.max.x)/2,z=(bounds.min.z+bounds.max.z)/2;
  const y=(query?.groundAt(x,z)??0)+50;
  return [x,y,z];
 }
 // Frame the model center with the demo's working radius so the volume and the
 // surrounding city stay legible; the HUD panel offset keeps the focus clear.
 function focusCenter(point,type){
  const radius={radar:1500,radio:1000,optical:400,acoustic:500,fivega:1500,electrostatic:100}[type]??600;
  const span=Math.max(700,radius*2);
  const center=new THREE.Vector3(...(point??centerPoint()));
  const position=center.clone().add(new THREE.Vector3(span*.7,span*.62,span*.95));
  if(tweenCamera)tweenCamera(position,center,1100);
  else{camera.position.copy(position);controls.target.copy(center);controls.update();}
  updateMarkerScreens();
 }
 function focusType(type){focusCenter(centerPoint(),type);}
 function startDemo(type){
  if(new URLSearchParams(location.search).get('demo')==='0')return null;
  const entry=panel.querySelector('.equipment-demo-entry');
  if(entry&&!panel.querySelector('.equipment-demo-settings'))entry.click();
  const center=demo?.setCenter?.()??centerPoint();
  demo?.start?.({hud:false});
  // Keep the catalog parameters in view; the demo runs independently of this panel.
  const firstGroup=[...panel.querySelectorAll('.equipment-group-nav button')].find(button=>!button.classList.contains('equipment-demo-entry'));
  firstGroup?.click();
  return center;
 }
 function followDevice(type){
  ensureDevice(type);
  const center=startDemo(type)??centerPoint();
  focusCenter(center,type);
 }
 // Selecting a device (dropdown, result row or map marker) syncs the catalog
 // type and lets the manager selection callback restart the demo and refocus.
 function followSelected(){
  const device=selected();
  if(!device)return;
  const tab=panel.querySelector(`#equipment-tab-${device.type}`);
  tab?.click();
 }
 function showDemoHud(){return demo?.showHud?.()??false;}
 function hideDemoHud(){demo?.hideHud?.();}
 function stopDemo(){demo?.stop?.();}
 toggle.onclick=show;
 $('equipment-device').onchange=()=>{selectedId=$('equipment-device').value;renderForm();compute();followSelected();};
 $('equipment-results').onclick=e=>{const id=e.target.closest('[data-select]')?.dataset.select;if(id){selectedId=id;renderForm();compute();followSelected();}};
 $('equipment-add').onclick=()=>{if(state.devices.length>=64){message('最多添加 64 个设备。');return;}const device=createDevice($('equipment-preset').value,`sensor-${++serial}`,selected()?.position??activeAnchor);state.devices.push(device);selectedId=device.id;renderForm();compute();followSelected();};
 $('equipment-remove').onclick=()=>{if(!selected())return;endDrag();state.devices=state.devices.filter(d=>d.id!==selectedId);selectedId=state.devices[0]?.id??null;renderForm();compute();};
 $('equipment-focus').onclick=()=>{focus();workspace.minimizeWindow('equipment');};
 let editTimer;
 panel.addEventListener('input',event=>{if(event.target.dataset.scope){capabilities.invalidate();renderResults();$('equipment-export').disabled=true;clearTimeout(editTimer);editTimer=setTimeout(()=>event.target.dispatchEvent(new Event('change',{bubbles:true})),80);}});
 panel.addEventListener('change',event=>{clearTimeout(editTimer);
  const input=event.target,scope=input.dataset.scope,key=input.dataset.field;if(!scope)return;
  if(!input.value.trim()){capabilities.invalidate();valid=false;hideProbe();heat.hide();message('请输入有效参数');$('equipment-export').disabled=true;return;}
  const value=Number(input.value);
  if(scope==='device-position'||scope==='target-position'){const p=scope==='device-position'?selected().position:state.target.position;const index={east:0,up:1,north:2}[key];p[index]=key==='north'?-value:value;}
  else if(scope==='parameters'){selected().parameters[key]=value;input.closest('label').querySelector('small').textContent=`${fieldsFor(selected().type)[key].unit} · 用户调整`;}
  else if(scope==='physics')selected().physics[key]=value;
  else state[scope][key]=value;
  compute();
 });
 $('equipment-fhss').onchange=()=>{state.target.fhss=$('equipment-fhss').checked;compute();};
 $('equipment-emitting').onchange=()=>{state.target.emitting=$('equipment-emitting').checked;compute();};
 $('equipment-optical-mode').onchange=()=>{state.target.opticalMode=$('equipment-optical-mode').value;compute();};
 $('equipment-pick-device').onclick=()=>{pickMode='device';message('请点击城市地面或建筑表面设置当前装备位置。');workspace.minimizeWindow('equipment');};
 $('equipment-pick-target').onclick=()=>{pickMode='target';message('请点击城市地面或建筑表面设置目标位置。');workspace.minimizeWindow('equipment');};
 const heat=mountHeatmap({panel,scene,model:activeModel,getState:()=>state,getSelected:()=>selectedId,isActive:()=>scenePanelVisible()&&!panel.hidden&&valid&&!['optical','acoustic'].includes(selected()?.type),
  getQuery:reflections=>reflections?query:(heatQuery??=createSceneQuery(activeModel)),
  onNominalChange:visible=>{for(const child of layer.children)if(child.userData.kind==='nominal-range-shade')child.visible=visible;},onProbeChange:()=>{}});
 heat.setOverview((region,heights,oblique)=>{
  const x=(region.west+region.east)/2,z=(region.south+region.north)/2,y=(query.groundAt(x,z)??0)+Math.max(...heights)*.5,span=Math.max(region.east-region.west,region.north-region.south);
  controls.target.set(x,y,z);camera.position.set(x+(oblique?span*.65:0),y+span*(oblique?.85:1.7),z+span*(oblique?.9:.02));controls.update();updateMarkerScreens();
 });
 function hideProbe(){renderer.domElement.style.cursor='';if(window.sensorDiagnostics)delete window.sensorDiagnostics.probe;}
 function screenRay(clientX,clientY){const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),camera);ray.firstHitOnly=true;return ray;}
 function surfaceAt(clientX,clientY){return screenRay(clientX,clientY).intersectObjects([activeModel.buildings,activeModel.ground])[0];}
 function markerAt(clientX,clientY){return screenRay(clientX,clientY).intersectObjects(markerMeshes)[0]?.object;}
 function supportAt(position){const ray=new THREE.Raycaster(new THREE.Vector3(position[0],20000,position[2]),new THREE.Vector3(0,-1,0),0,40000);ray.firstHitOnly=true;return ray.intersectObjects([activeModel.buildings,activeModel.ground])[0]?.point.y;}
 function updateMarkerScreens(){
  if(!window.sensorDiagnostics)return;window.sensorDiagnostics.cameraControlsEnabled=controls.enabled;window.sensorDiagnostics.cameraPosition=camera.position.toArray();camera.updateMatrixWorld();const rect=renderer.domElement.getBoundingClientRect();
  window.sensorDiagnostics.markerScreens=markerMeshes.map(mesh=>{const p=mesh.position.clone().project(camera);return {...mesh.userData,x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2,visible:p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1};});
 }
 controls.addEventListener('change',updateMarkerScreens);
 // Signal estimate at the demo probe point, rendered inside the demo readout.
 function signalProbeRows(position){
  const device=selected(),demoType=window.equipmentDemoDiagnostics?.type;
  if(!device)return {rows:[['场景设备','暂无设备，请先添加']]};
  if(demoType&&device.type!==demoType)return {rows:[['场景设备',`${TYPES[device.type]} · ${device.name}`],['信号估计','当前仿真类型暂无场景信号模型']]};
  if(!query)return {rows:[['信号估计','空间索引尚未就绪']]};
  try{
   const context=query.trace(device.position,position);
   if(capabilities.isDataset(device))return {rows:[['场景设备',`${TYPES[device.type]} · ${device.name}`],['空间距离',`${format(Math.hypot(...position.map((v,i)=>v-device.position[i])))} m`],['直达路径',context.blocked?'受阻':context.known?'畅通':'—']]};
   const result=evaluate(device,{...state.target,position},state.environment,context);
   const hardBlocked=result.geometry.blocked&&['radar','optical'].includes(device.type);
   const value=hardBlocked?'直达信号被实体遮挡':device.type==='optical'?`有效像素 ${format(result.extras.effectivePixels)} px`:device.type==='acoustic'?`声压 ${format(result.extras.receivedSoundDb)} dB SPL · 信噪比 ${format(result.snrDb)} dB`:`估计信噪比 ${format(result.snrDb)} dB`;
   const status=`${hardBlocked?'未截断参考裕量':'裕量'} ${format(result.marginDb)} dB · ${result.status==='within-model'?'模型内可感知':result.status==='uncertain'?'地形覆盖不足':result.reasons.join('；')}`;
   return {rows:[['场景设备',`${TYPES[device.type]} · ${device.name}`],['信号估计',value],['裕量 / 状态',status]]};
  }catch(error){return {rows:[['信号估计',`无法查询：${error.message}`]]};}
 }
 $('equipment-probe-height').oninput=()=>{const input=$('equipment-probe-height'),value=Number(input.value);if(input.value.trim()&&Number.isFinite(value)&&value>=0&&value<=2000)probeHeight=value;};
 function endDrag(){
  if(!drag)return;const pointerId=drag.pointerId,wasDamping=drag.damping;drag=null;clearTimeout(dragTimer);controls.enabled=true;controls.enableDamping=wasDamping;renderer.domElement.style.cursor='';
  if(renderer.domElement.hasPointerCapture(pointerId))renderer.domElement.releasePointerCapture(pointerId);
 }
 let down;
 renderer.domElement.addEventListener('pointerdown',event=>{
  down=[event.clientX,event.clientY];if(panel.hidden||event.button!==0||pickMode)return;
  const marker=markerAt(event.clientX,event.clientY);if(!marker)return;
  event.stopImmediatePropagation();event.preventDefault();
  const position=marker.userData.kind==='device'?state.devices.find(d=>d.id===marker.userData.deviceId)?.position:state.target.position;if(!position)return;
  if(marker.userData.deviceId)selectedId=marker.userData.deviceId;
  const support=supportAt(position);drag={...marker.userData,pointerId:event.pointerId,offset:Number.isFinite(support)?Math.max(0.5,position[1]-support):2,damping:controls.enableDamping};
  controls.enabled=false;controls.enableDamping=false;hideProbe();renderer.domElement.setPointerCapture(event.pointerId);renderer.domElement.style.cursor='grabbing';renderForm();compute();
 },true);
 renderer.domElement.addEventListener('pointermove',event=>{
  if(panel.hidden)return;
  if(drag){
   event.stopImmediatePropagation();const hit=surfaceAt(event.clientX,event.clientY);if(!hit)return;
   const position=hit.point.toArray();position[1]+=drag.offset;
   if(drag.kind==='device'){const device=state.devices.find(d=>d.id===drag.deviceId);if(device)device.position=position;}else state.target.position=position;
   if(!dragTimer)dragTimer=setTimeout(()=>{dragTimer=null;compute();},60);return;
  }
  renderer.domElement.style.cursor=markerAt(event.clientX,event.clientY)?'grab':'';
 },true);
 renderer.domElement.addEventListener('pointerup',event=>{
  if(drag){event.stopImmediatePropagation();endDrag();renderForm();compute();workspace.restoreWindow('equipment');followSelected();return;}
  if(!pickMode||panel.hidden||!down||Math.hypot(event.clientX-down[0],event.clientY-down[1])>5)return;
  const hit=surfaceAt(event.clientX,event.clientY);if(!hit){message('未选中模型表面，请点击建筑或地形。');return;}
  const p=hit.point.toArray();p[1]+=pickMode==='device'?2:50;
  if(pickMode==='device'&&selected())selected().position=p;else if(pickMode==='target')state.target.position=p;pickMode=null;renderForm();compute();workspace.restoreWindow('equipment');
 },true);
 renderer.domElement.addEventListener('pointercancel',()=>{if(drag){endDrag();renderForm();compute();}});
 renderer.domElement.addEventListener('lostpointercapture',()=>{if(drag){endDrag();renderForm();compute();}});
 renderer.domElement.addEventListener('pointerleave',()=>{if(!drag){hideProbe();renderer.domElement.style.cursor='';}});
 $('equipment-export').onclick=()=>{
  if(state.devices.some(d=>capabilities.isDataset(d))&&!capabilities.exportData()){message('请完成本次评估后再导出。');return;}
  const payload={...state,equipmentSource:EQUIPMENT_SOURCE,parameterProvenance:Object.fromEntries(state.devices.map(device=>[device.id,Object.fromEntries(Object.entries(PRESETS.find(p=>p.id===device.presetId).provenance).map(([key,source])=>[key,device.parameters[key]===PRESETS.find(p=>p.id===device.presetId).parameters[key]?source:'用户调整']))])),sourceHashes:activeMode==='recon'?city.metadata.sources:activeMeta?.source??null,ecefTransform:activeMode==='recon'?city.metadata.ecefTransform:null,results,contexts:Object.fromEntries(lastContexts),physicsSources:['radar/core/radar_snr.m','radar/config/radar_02C.m','radar/config/radar_03D.m','rf/core/sensitivity_solve.m','rf/core/rx_power_dbm.m','rf/core/rx_noise_dbm.m'],modelNotes:'Approximate uncalibrated sensor models; scores are not detection probabilities.'};
  payload.results=results.filter(r=>!capabilities.isDataset(state.devices.find(d=>d.id===r.id)));
  payload.capabilityAssessment=capabilities.exportData();payload.assessmentMode=capabilities.exportMode();
  payload.modelNotes='基础评估使用比赛设备配置与场景几何；假设仿真采用可调整系数，评分用于趋势比较。';
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='zhengzhou-sensor-scenario.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 $('equipment-import').onchange=async()=>{
  const file=$('equipment-import').files[0];if(!file)return;
  try{if(file.size>1024*1024)throw Error('参数文件不能大于 1 MB');const next=validateScenario(JSON.parse(await file.text()),activeOrigin);endDrag();hideProbe();state=next;selectedId=state.devices[0]?.id??null;serial=Math.max(serial,...state.devices.map(d=>Number(d.id.replace('sensor-',''))||0));renderForm();compute();focus();message('方案导入成功，已根据当前城市网格重新计算。');}catch(error){message(`导入失败：${error.message}`);}finally{$('equipment-import').value='';}
 };
 $('equipment-reset').onclick=()=>{endDrag();hideProbe();state.devices=[];selectedId=null;pickMode=null;renderForm();compute();message('已删除所有设备与范围阴影。选择型号后可重新添加。');};
 $('equipment-defaults').onclick=()=>{endDrag();hideProbe();state=sceneDefaultState();selectedId=state.devices[0].id;serial=4;renderForm();compute();focus();};
 capabilities=mountCapabilityAssessment({panel,city,getState:()=>state,getSelected:()=>selectedId,getQuery:()=>query,isVisible:()=>!panel.hidden,sceneMatches:()=>activeMode==='recon',onChange:(reform=false)=>{if(reform)renderForm();compute();},onUpdate:()=>{renderResults();$('equipment-export').disabled=!valid||(state.devices.some(d=>capabilities.isDataset(d))&&!capabilities.exportData());}});
 renderForm();toggle.disabled=false;
 const demoModel={get buildings(){return activeModel.buildings;},get ground(){return activeModel.ground;}};
 demo=createEquipmentDemo({app,scene,camera,controls,renderer,model:demoModel,workspace,getScenario:()=>state,
  getQuery:reflections=>demoQueries[reflections?'reflections':'direct']??=(createSceneQuery(activeModel,{reflections})),
  getSignalProbe:position=>signalProbeRows(position),
  onStart:()=>{heat.hide();layer.visible=false;hideProbe();},
 });
 const manager=mountEquipmentManager(panel,{demo,onSelectionChange:({type})=>followDevice(type)});
 const scenarioListeners=new Set(),getScenarioSnapshot=()=>structuredClone(state);
 const publishConfiguration=()=>{window.sceneConfigurationDiagnostics={environment:structuredClone(state.environment),target:structuredClone(state.target)};};
 const publishScenario=()=>{publishConfiguration();const snapshot=getScenarioSnapshot();for(const listener of [...scenarioListeners])listener(structuredClone(snapshot));};
 let cityTargetPick=false;
 const cityConditions=mountCityConditions({panel:app.querySelector('#city-panel'),getState:()=>state,
  onEnvironment:value=>{state.environment=structuredClone(value);capabilities.invalidate();publishScenario();},
  onTarget:value=>{state.target=structuredClone(value);capabilities.invalidate();publishScenario();},
  onPickTarget:()=>{cityTargetPick=true;workspace.minimizeWindow('city');window.__ac8SceneMenu?.minimize();},
 });
 publishConfiguration();
 app.querySelector('#open-city-model').addEventListener('click',()=>cityConditions.refresh());
 renderer.domElement.addEventListener('pointerup',event=>{
  if(!cityTargetPick)return;
  const cityWindowNode=app.querySelector('#city-window');
  if(!cityWindowNode?.open&&!window.__ac8SceneMenu?.isOpen()){cityTargetPick=false;return;}
  if(!down||Math.hypot(event.clientX-down[0],event.clientY-down[1])>5)return;
  const hit=surfaceAt(event.clientX,event.clientY);if(!hit)return;
  event.stopImmediatePropagation();cityTargetPick=false;const position=hit.point.toArray();position[1]+=50;cityConditions.setTargetPosition(position);workspace.restoreWindow('city');window.__ac8SceneMenu?.restore();
 },true);
 app.addEventListener('view-change',event=>{if(event.detail!=='sensors'){capabilities.invalidate();workspace.closeWindow('equipment');layer.visible=false;pickMode=null;endDrag();hideProbe();heat.hide();}});
 return {panel,activate,deactivate,focusType,startDemo,showDemoHud,hideDemoHud,stopDemo,render:()=>demo.render()||heat.render(renderer,scene,camera),getScenario:getScenarioSnapshot,getScenarioSnapshot,getEquipmentSnapshot:manager.getSnapshot,subscribeEquipmentChanges:manager.subscribe,subscribeScenarioChanges(listener){scenarioListeners.add(listener);return()=>scenarioListeners.delete(listener);},setActiveScene,applyScenario(value){demo.stop();state=validateScenario(value,activeOrigin);selectedId=state.devices[0]?.id??null;serial=Math.max(4,...state.devices.map(d=>Number(d.id.replace('sensor-',''))||0));renderForm();cityConditions.refresh();publishConfiguration();app.dataset.activeView='sensors';if(window.__ac8EquipmentMenu?.openDetail)window.__ac8EquipmentMenu.openDetail('radar');else show();}};
}
