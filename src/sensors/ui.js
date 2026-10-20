import * as THREE from 'three';
import {PRESETS,TYPES,fieldsFor,ENV_FIELDS,TARGET_FIELDS,createDevice,EQUIPMENT_SOURCE} from './presets.js';
import {MODEL_VERSION,evaluate,validateScenario,validateDevice,validateTarget,validateEnvironment,opticalFov} from './engine.js';
import {createSceneQuery} from './scene.js';
import './ui.css';
import {nominalCoverage} from './coverage.js';
import {defaultScenario} from './scenario.js';

const COLORS={radar:0x70d6ff,optical:0xffd783,radio:0xb89aff,acoustic:0x69e2bd};
const format=x=>typeof x==='number'?(Math.abs(x)>=10000?x.toFixed(0):x.toFixed(2)):'—';
const TYPE_METRICS={rangeMeters:'距离误差 / m',azimuthDegrees:'方位误差 / °',elevationDegrees:'俯仰误差 / °',multipathBiasDegrees:'多径角偏差指标 / °',networkLocalizationMeters:'三维站网定位误差估计 / m',angularPixelDegrees:'单像素角度 / °'};
const LOSS_NAMES={rain:'雨衰',cloudFog:'云雾衰减',multipath:'地面双径（负值为增强）',clutter:'城市杂波',noise:'底噪抬升',cochannel:'同频干扰',crosstalk:'设备串扰',visibility:'能见度消光',penetration:'建筑穿透',diffraction:'遮挡绕射',spreading:'几何扩散',air:'空气吸收',refraction:'折射附加损耗'};

export function mountSensorUI({app,scene,camera,controls,renderer,model,city}){
 const panel=document.createElement('aside');panel.id='equipment-panel';panel.hidden=true;
 panel.innerHTML=`<div class="brand"><span class="mark">◉</span> 感知装备 <small>SUBTASK 02</small></div>
 <button id="equipment-back" class="back-button">← 返回城市建模</button>
 <p class="sensor-disclaimer">工程近似模型 · 参数可调<br>文档参数与假设分列，结果需实测标定。评分不是探测概率。</p>
 <section><h2>当前装备 <span>DEVICES</span></h2><select id="equipment-device" aria-label="当前装备"></select><div class="sensor-add"><select id="equipment-preset" aria-label="添加型号"></select><button id="equipment-add">＋ 添加</button></div><div class="buttons"><button id="equipment-remove">删除当前</button><button id="equipment-focus">聚焦点位</button></div><button id="equipment-reset" class="clear-devices">一键还原 · 清空所有设备</button><p id="equipment-note" class="hint"></p></section>
 <label class="probe-setting">鼠标查询：表面上方 / m<input id="equipment-probe-height" type="number" min="0" max="2000" step="1" value="50"></label>
 <section><h2>单目标能力比较 <span>LIVE</span></h2><div id="equipment-results"></div></section>
 <section><h2>位置与姿态 <span>METERS / ENU</span></h2><div id="equipment-position" class="sensor-fields"></div><div class="buttons"><button id="equipment-pick-device">在地图选装备点</button><button id="equipment-pick-target">在地图选目标点</button></div><p class="hint">拖动彩色装备球或红色目标球可移动点位并保留相对表面高度；拖动空白处仍旋转地图。点选新增位置后装备在表面上方 2 m，目标在表面上方 50 m。上坐标为局部 ENU 高度，不是离地高度。</p></section>
 <details><summary>当前型号参数 <small>文档 / 假设 / 派生</small></summary><div id="equipment-parameters" class="sensor-fields"></div></details>
 <details><summary>目标与工作模式</summary><div id="equipment-target-position" class="sensor-fields"></div><label>目标发射无线电 <input id="equipment-emitting" type="checkbox" checked></label><label>光电工作模式<select id="equipment-optical-mode"><option value="wide">可见光 · 宽视场</option><option value="narrow">可见光 · 窄视场</option><option value="thermal">热成像</option></select></label><div id="equipment-target" class="sensor-fields"></div></details>
 <details><summary>环境与站网参数</summary><div id="equipment-environment" class="sensor-fields"></div></details>
 <section><h2>当前设备计算明细 <span>BREAKDOWN</span></h2><div id="equipment-breakdown"></div></section>
 <div id="equipment-message" role="status" class="sensor-message"></div>
 <section class="sensor-io"><button id="equipment-export" class="primary">导出参数与计算报告 · JSON ↓</button><label class="sensor-import">导入参数方案<input id="equipment-import" type="file" accept=".json,application/json"></label><button id="equipment-defaults">载入四类示例设备</button></section>
 <footer>半透明阴影是标称范围/视场示意，随范围、盲区、方向与视场实时更新，未裁切遮挡，不能当作有效覆盖。实线显示当前设备至目标的路径。<br><a href="./sensors-modeling.md" target="_blank" rel="noopener">模型公式与参数来源 ↗</a></footer>`;
 app.insertBefore(panel,app.querySelector('main'));
 const cityPanel=app.querySelector('aside');
 const toggle=document.createElement('button');toggle.id='toggle-sensors';toggle.textContent='装备建模 →';toggle.disabled=true;app.querySelector('header').appendChild(toggle);
 const $=id=>panel.querySelector('#'+id);
 const layer=new THREE.Group();layer.name='Sensor_Modeling';layer.visible=false;scene.add(layer);
 let query,state,selectedId,pickMode=null,results=[],serial=4,lastContexts=new Map();
 let markerMeshes=[],drag=null,dragTimer,hoverTimer,lastPointer=null,probeHeight=50,valid=true;
 const defaultState=()=>defaultScenario(city);
 state=defaultState();selectedId=state.devices[0].id;
 const spawnPosition=[...state.devices[0].position];
 const selected=()=>state.devices.find(d=>d.id===selectedId);
 for(const p of PRESETS){const option=new Option(`${TYPES[p.type]} · ${p.name}`,p.id);$('equipment-preset').add(option);}
 function message(text){$('equipment-message').textContent=text;}
 function numericFields(container,values,fields,scope,provenance={}){
  container.replaceChildren();
  for(const [key,field] of Object.entries(fields)){
   const label=document.createElement('label');label.className='sensor-field';
   const title=document.createElement('span');title.textContent=field.label;
   const input=document.createElement('input');input.type='number';input.min=field.min;input.max=field.max;input.step=field.step;input.value=values[key];input.dataset.scope=scope;input.dataset.field=key;input.setAttribute('aria-label',field.label);
   const unit=document.createElement('small');unit.textContent=`${field.unit} · ${provenance[key]??'假设'}`;
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
  $('equipment-note').textContent=preset?.notes??'设备已清空。选择型号后点击“添加”即可重新放置。';
  const provenance={...preset?.provenance};
  for(const key of Object.keys(device?.parameters??{}))if(device.parameters[key]!==preset.parameters[key])provenance[key]='用户调整';
  for(const key of ['maxRange','capacity'])if(device?.type==='radio'&&provenance[key]!=='用户调整')provenance[key]='文档派生';
  if(device){numericFields($('equipment-position'),positionValues(device.position),positionFields,'device-position');numericFields($('equipment-parameters'),device.parameters,fieldsFor(device.type),'parameters',provenance);}
  else{$('equipment-position').replaceChildren();$('equipment-parameters').replaceChildren();}
  $('equipment-pick-device').disabled=!device;$('equipment-focus').disabled=!device;
  numericFields($('equipment-target-position'),positionValues(state.target.position),positionFields,'target-position');
  numericFields($('equipment-target'),state.target,{...TARGET_FIELDS,acousticFrequencyHz:{label:'目标主声频',unit:'Hz',min:20,max:20000,step:10}},'target');
  numericFields($('equipment-environment'),state.environment,ENV_FIELDS,'environment');
  $('equipment-emitting').checked=state.target.emitting;$('equipment-optical-mode').value=state.target.opticalMode;
  $('equipment-remove').disabled=!device;
 }
 function disposeLayer(){markerMeshes=[];for(const child of [...layer.children]){child.geometry?.dispose();child.material?.dispose();layer.remove(child);}}
 function line(points,color,dashed=false){const geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));const material=dashed?new THREE.LineDashedMaterial({color,dashSize:35,gapSize:25,transparent:true,opacity:0.5}):new THREE.LineBasicMaterial({color});const object=new THREE.Line(geometry,material);if(dashed)object.computeLineDistances();layer.add(object);}
 function mark(position,color,size,identity){const mesh=new THREE.Mesh(new THREE.SphereGeometry(size,12,8),new THREE.MeshBasicMaterial({color,depthTest:false}));mesh.position.fromArray(position);mesh.renderOrder=10;mesh.userData=identity;layer.add(mesh);markerMeshes.push(mesh);}
 function draw(){
  disposeLayer();
  for(const device of state.devices){
   if(state.devices.length<=12||device.id===selectedId){const shade=new THREE.Mesh(nominalCoverage(device,state.target),new THREE.MeshBasicMaterial({color:COLORS[device.type],transparent:true,opacity:device.id===selectedId?0.13:0.035,side:THREE.DoubleSide,depthWrite:false}));
   shade.position.fromArray(device.position);shade.userData={deviceId:device.id,kind:'nominal-range-shade'};layer.add(shade);}
   mark(device.position,COLORS[device.type],device.id===selectedId?10:6,{deviceId:device.id,kind:'device'});
  }
  mark(state.target.position,0xff7e85,10,{kind:'target'});
  const device=selected();if(device){const result=results.find(r=>r.id===device.id);line([device.position,state.target.position],result?.eligible?0x69e2bd:0xff7e85);}
  layer.updateMatrixWorld(true);
 }
 function metric(parent,label,value){const row=document.createElement('div');row.className='sensor-metric';const title=document.createElement('span'),number=document.createElement('strong');title.textContent=label;number.textContent=value;row.append(title,number);parent.append(row);}
 function renderResults(){
  $('equipment-results').replaceChildren();
  if(!results.length)$('equipment-results').textContent='暂无设备，添加后显示信号与判定。';
  for(const result of results){const row=document.createElement('button');row.className=`sensor-result ${result.id===selectedId?'is-selected':''}`;row.dataset.select=result.id;const title=document.createElement('span');title.textContent=TYPES[result.type];const value=document.createElement('span');value.textContent=`${format(result.marginDb)} dB`;const badge=document.createElement('span');badge.className=result.status==='within-model'?'pass':'fail';badge.textContent=result.status==='within-model'?'模型内可感知':result.status==='uncertain'?'覆盖数据不足':'模型内不可感知';row.append(title,value,badge);$('equipment-results').append(row);}
  const r=results.find(r=>r.id===selectedId),parent=$('equipment-breakdown');parent.replaceChildren();if(!r)return;
  metric(parent,'空间距离 / m',format(r.geometry.distance));metric(parent,'方位 / 俯仰 / °',`${format(r.geometry.azimuth)} / ${format(r.geometry.elevation)}`);
  metric(parent,'遮挡建筑数',r.geometry.buildingCount);metric(parent,'几何直达路径',r.geometry.blocked?'已遮挡':'当前网格未检出遮挡');
  metric(parent,'模型裕量 / dB',format(r.marginDb));metric(parent,'估计信噪比 / dB',format(r.snrDb));metric(parent,'当前路径等效距离上限 / m',format(r.equivalentRangeMeters));
  if(r.reasons.length){const text=document.createElement('p');text.className='sensor-reasons';text.textContent=r.reasons.join('；');parent.append(text);}
  for(const [key,value] of Object.entries(r.losses))metric(parent,`${LOSS_NAMES[key]??key} / dB`,format(value));
  for(const [key,value] of Object.entries(r.errors))metric(parent,TYPE_METRICS[key]??key,format(value));
  const extraLabels={ghostRiskIndex:'虚警风险指标（非概率）',angularPixels:'目标原始像素',effectivePixels:'目标有效像素',horizontalFov:'瞬时水平视场 / °',verticalFov:'瞬时垂直视场 / °',contrastFactor:'对比度系数',multipathDopplerSpreadHz:'多径频率展宽指标 / Hz',receivedSoundDb:'接收声压 / dB SPL',noiseDb:'合成背景声压 / dB SPL',soundSpeed:'沿路径声速 / m/s',propagationSeconds:'声传播时延 / s',temporalDriftMeters:'时延导致的位置滞后 / m',mixingRiskIndex:'声波混叠风险指标'};
  for(const [key,label] of Object.entries(extraLabels))if(key in r.extras)metric(parent,label,format(r.extras[key]));
  if(r.extras.ghostCandidate){metric(parent,'双径虚拟回波距离 / m',format(r.extras.ghostCandidate.apparentRangeMeters));metric(parent,'虚拟回波可分辨',r.extras.ghostCandidate.resolvable?'仅在近似模型中可分辨':'低于参考距离分辨能力');}
  for(const warning of r.warnings){const text=document.createElement('p');text.className='hint';text.textContent=warning;parent.append(text);}
 }
 function compute(){
  try{
   for(const d of state.devices)validateDevice(d);validateTarget(state.target);validateEnvironment(state.environment);
   const contexts=new Map();lastContexts=new Map();
   results=state.devices.map(device=>{const key=JSON.stringify([device.position,state.target.position]);let context=contexts.get(key);if(!context){context=query.trace(device.position,state.target.position);contexts.set(key,context);}lastContexts.set(device.id,context);return evaluate(device,state.target,state.environment,context);});
   valid=true;renderResults();draw();message('拖动彩色点位可移动；将鼠标移到地图上查询信号。阴影仅表示标称范围。'+(state.devices.length>12?'大型方案只显示当前设备范围，所有点位保留。':''));$('equipment-export').disabled=false;
   window.sensorDiagnostics={modelVersion:MODEL_VERSION,deviceCount:state.devices.length,types:state.devices.map(d=>d.type),results:structuredClone(results),selectedId,devicePositions:state.devices.map(d=>({id:d.id,position:[...d.position]})),targetPosition:[...state.target.position],coverage:layer.children.filter(o=>o.userData.kind==='nominal-range-shade').map(o=>({deviceId:o.userData.deviceId,...o.geometry.userData}))};
   updateMarkerScreens();refreshProbe();
  }catch(error){valid=false;hideProbe();message(`无法计算：${error.message}`);$('equipment-results').replaceChildren();$('equipment-breakdown').replaceChildren();$('equipment-export').disabled=true;window.sensorDiagnostics={error:error.message};}
 }
 function focus(){if(!selected())return;const p=new THREE.Vector3(...selected().position),t=new THREE.Vector3(...state.target.position),center=p.clone().add(t).multiplyScalar(0.5),span=Math.max(200,p.distanceTo(t)*1.5);controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(span*.65,span*.65,span*.85));controls.update();updateMarkerScreens();}
 function show(){
  app.dispatchEvent(new CustomEvent('view-change',{detail:'sensors'}));
  if(!query){message('正在建立建筑/地形空间索引…');query=createSceneQuery(model);}
  cityPanel.hidden=true;panel.hidden=false;app.classList.add('equipment-mode');layer.visible=true;compute();focus();
 }
 toggle.onclick=show;
 $('equipment-back').onclick=()=>{panel.hidden=true;cityPanel.hidden=false;app.classList.remove('equipment-mode');layer.visible=false;pickMode=null;endDrag();hideProbe();};
 $('equipment-device').onchange=()=>{selectedId=$('equipment-device').value;renderForm();compute();};
 $('equipment-results').onclick=e=>{const id=e.target.closest('[data-select]')?.dataset.select;if(id){selectedId=id;renderForm();compute();}};
 $('equipment-add').onclick=()=>{if(state.devices.length>=64){message('最多添加 64 个设备。');return;}const device=createDevice($('equipment-preset').value,`sensor-${++serial}`,selected()?.position??spawnPosition);state.devices.push(device);selectedId=device.id;renderForm();compute();};
 $('equipment-remove').onclick=()=>{if(!selected())return;endDrag();state.devices=state.devices.filter(d=>d.id!==selectedId);selectedId=state.devices[0]?.id??null;renderForm();compute();};
 $('equipment-focus').onclick=focus;
 let editTimer;
 panel.addEventListener('input',event=>{if(event.target.dataset.scope){clearTimeout(editTimer);editTimer=setTimeout(()=>event.target.dispatchEvent(new Event('change',{bubbles:true})),80);}});
 panel.addEventListener('change',event=>{clearTimeout(editTimer);
  const input=event.target,scope=input.dataset.scope,key=input.dataset.field;if(!scope)return;
  if(!input.value.trim()){message('参数不能为空');$('equipment-export').disabled=true;return;}
  const value=Number(input.value);
  if(scope==='device-position'||scope==='target-position'){const p=scope==='device-position'?selected().position:state.target.position;const index={east:0,up:1,north:2}[key];p[index]=key==='north'?-value:value;}
  else if(scope==='parameters'){selected().parameters[key]=value;input.closest('label').querySelector('small').textContent=`${fieldsFor(selected().type)[key].unit} · 用户调整`;}
  else state[scope][key]=value;
  compute();
 });
 $('equipment-emitting').onchange=()=>{state.target.emitting=$('equipment-emitting').checked;compute();};
 $('equipment-optical-mode').onchange=()=>{state.target.opticalMode=$('equipment-optical-mode').value;compute();};
 $('equipment-pick-device').onclick=()=>{pickMode='device';message('请点击城市地面或建筑表面设置当前装备位置。');};
 $('equipment-pick-target').onclick=()=>{pickMode='target';message('请点击城市地面或建筑表面设置目标位置。');};
 const viewport=renderer.domElement.parentElement;
 const hud=document.createElement('div');hud.id='signal-probe';hud.hidden=true;hud.setAttribute('role','status');
 hud.innerHTML='<strong>鼠标位置 · 信号估计</strong><div id="signal-caption"></div><div id="signal-value"></div><div id="signal-state"></div><small id="signal-position"></small>';
 viewport.parentElement.append(hud);
 const probeMarker=new THREE.Mesh(new THREE.SphereGeometry(5,8,6),new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false}));probeMarker.visible=false;probeMarker.renderOrder=11;scene.add(probeMarker);
 function hideProbe(){renderer.domElement.style.cursor='';clearTimeout(hoverTimer);hud.hidden=true;probeMarker.visible=false;lastPointer=null;if(window.sensorDiagnostics)delete window.sensorDiagnostics.probe;}
 function screenRay(clientX,clientY){const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),camera);ray.firstHitOnly=true;return ray;}
 function surfaceAt(clientX,clientY){return screenRay(clientX,clientY).intersectObjects([model.buildings,model.ground])[0];}
 function markerAt(clientX,clientY){return screenRay(clientX,clientY).intersectObjects(markerMeshes)[0]?.object;}
 function supportAt(position){const ray=new THREE.Raycaster(new THREE.Vector3(position[0],20000,position[2]),new THREE.Vector3(0,-1,0),0,40000);ray.firstHitOnly=true;return ray.intersectObjects([model.buildings,model.ground])[0]?.point.y;}
 function updateMarkerScreens(){
  if(!window.sensorDiagnostics)return;window.sensorDiagnostics.cameraControlsEnabled=controls.enabled;window.sensorDiagnostics.cameraPosition=camera.position.toArray();camera.updateMatrixWorld();const rect=renderer.domElement.getBoundingClientRect();
  window.sensorDiagnostics.markerScreens=markerMeshes.map(mesh=>{const p=mesh.position.clone().project(camera);return {...mesh.userData,x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2,visible:p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1};});
 }
 controls.addEventListener('change',updateMarkerScreens);
 function refreshProbe(){
  if(!lastPointer||panel.hidden||drag||!valid)return;
  const hit=surfaceAt(lastPointer.x,lastPointer.y),device=selected();hud.hidden=false;
  if(!hit||!device){hud.querySelector('#signal-caption').textContent=!device?'暂无设备，请先添加':'此处没有模型表面';for(const id of ['signal-value','signal-state','signal-position'])hud.querySelector('#'+id).textContent='';probeMarker.visible=false;if(window.sensorDiagnostics)delete window.sensorDiagnostics.probe;return;}
  try{
   const position=hit.point.toArray();position[1]+=probeHeight;
   const result=evaluate(device,{...state.target,position},state.environment,query.trace(device.position,position));
   hud.querySelector('#signal-caption').textContent=`${TYPES[device.type]} · ${device.name} · 表面上方 ${probeHeight} m`;
   const hardBlocked=result.geometry.blocked&&['radar','optical'].includes(device.type);
   hud.querySelector('#signal-value').textContent=hardBlocked?'直达信号被实体遮挡':device.type==='optical'?`有效像素 ${format(result.extras.effectivePixels)} px`:device.type==='acoustic'?`声压 ${format(result.extras.receivedSoundDb)} dB SPL · 信噪比 ${format(result.snrDb)} dB`:`估计信噪比 ${format(result.snrDb)} dB`;
   hud.querySelector('#signal-state').textContent=`${hardBlocked?'未截断参考裕量':'裕量'} ${format(result.marginDb)} dB · ${result.status==='within-model'?'模型内可感知':result.status==='uncertain'?'地形覆盖不足':result.reasons.join('；')}`;
   hud.querySelector('#signal-position').textContent=`东 ${position[0].toFixed(1)} / 北 ${(-position[2]).toFixed(1)} / 上 ${position[1].toFixed(1)} m`;
   probeMarker.position.fromArray(position);probeMarker.visible=true;
   window.sensorDiagnostics.probe={position,heightAboveSurface:probeHeight,deviceId:device.id,result};
  }catch(error){hud.querySelector('#signal-value').textContent=`无法查询：${error.message}`;probeMarker.visible=false;}
 }
 $('equipment-probe-height').oninput=()=>{const input=$('equipment-probe-height'),value=Number(input.value);if(input.value.trim()&&Number.isFinite(value)&&value>=0&&value<=2000){probeHeight=value;refreshProbe();}else hideProbe();};
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
  lastPointer={x:event.clientX,y:event.clientY};renderer.domElement.style.cursor=markerAt(event.clientX,event.clientY)?'grab':'';
  clearTimeout(hoverTimer);hoverTimer=setTimeout(refreshProbe,80);
 },true);
 renderer.domElement.addEventListener('pointerup',event=>{
  if(drag){event.stopImmediatePropagation();endDrag();renderForm();compute();return;}
  if(!pickMode||panel.hidden||!down||Math.hypot(event.clientX-down[0],event.clientY-down[1])>5)return;
  const hit=surfaceAt(event.clientX,event.clientY);if(!hit){message('未选中模型表面，请点击建筑或地形。');return;}
  const p=hit.point.toArray();p[1]+=pickMode==='device'?2:50;
  if(pickMode==='device'&&selected())selected().position=p;else if(pickMode==='target')state.target.position=p;pickMode=null;renderForm();compute();
 },true);
 renderer.domElement.addEventListener('pointercancel',()=>{if(drag){endDrag();renderForm();compute();}});
 renderer.domElement.addEventListener('lostpointercapture',()=>{if(drag){endDrag();renderForm();compute();}});
 renderer.domElement.addEventListener('pointerleave',()=>{if(!drag){hideProbe();renderer.domElement.style.cursor='';}});
 $('equipment-export').onclick=()=>{
  const payload={...state,equipmentSource:EQUIPMENT_SOURCE,parameterProvenance:Object.fromEntries(state.devices.map(device=>[device.id,Object.fromEntries(Object.entries(PRESETS.find(p=>p.id===device.presetId).provenance).map(([key,source])=>[key,device.parameters[key]===PRESETS.find(p=>p.id===device.presetId).parameters[key]?source:'用户调整']))])),sourceHashes:city.metadata.sources,ecefTransform:city.metadata.ecefTransform,results,contexts:Object.fromEntries(lastContexts),modelNotes:'Approximate uncalibrated sensor models; scores are not detection probabilities.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='zhengzhou-sensor-scenario.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 $('equipment-import').onchange=async()=>{
  const file=$('equipment-import').files[0];if(!file)return;
  try{if(file.size>1024*1024)throw Error('参数文件不能大于 1 MB');const next=validateScenario(JSON.parse(await file.text()),city.metadata.origin);endDrag();hideProbe();state=next;selectedId=state.devices[0]?.id??null;serial=Math.max(serial,...state.devices.map(d=>Number(d.id.replace('sensor-',''))||0));renderForm();compute();focus();message('方案导入成功，已根据当前城市网格重新计算。');}catch(error){message(`导入失败：${error.message}`);}finally{$('equipment-import').value='';}
 };
 $('equipment-reset').onclick=()=>{endDrag();hideProbe();state.devices=[];selectedId=null;pickMode=null;renderForm();compute();message('已删除所有设备与范围阴影。选择型号后可重新添加。');};
 $('equipment-defaults').onclick=()=>{endDrag();hideProbe();state=defaultState();selectedId=state.devices[0].id;serial=4;renderForm();compute();focus();};
 renderForm();toggle.disabled=false;
 app.addEventListener('view-change',event=>{if(event.detail!=='sensors'){panel.hidden=true;layer.visible=false;pickMode=null;endDrag();hideProbe();}});
 return {panel,getScenario:()=>structuredClone(state),applyScenario(value){state=validateScenario(value,city.metadata.origin);selectedId=state.devices[0]?.id??null;serial=Math.max(4,...state.devices.map(d=>Number(d.id.replace('sensor-',''))||0));renderForm();show();}};
}
