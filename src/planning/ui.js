import * as THREE from 'three';
import {AlarmTracker,interpolateRoute} from './flight.js';
import {scenarios} from './optimizer.js';
import {MODEL_VERSION} from '../sensors/engine.js';
import {TYPES} from '../sensors/presets.js';
import {terrainSampler} from '../sensors/terrain-query.js';
import {flightTelemetry} from './telemetry.js';
import {createVoiceAlarm} from './voice.js';
import {createDroneMesh} from './drone-mesh.js';
import {threatSummaryText} from '../task3/threats.js';
import './ui.css';

const COLORS={radar:0x70d6ff,radio:0xb89aff,optical:0xffd783,acoustic:0x69e2bd};
const clock=t=>`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const percent=x=>`${(x*100).toFixed(1)}%`;

// 仅供任务三调用：方案、工况和装备参数全部来自当前任务三报告。
export function mountPlanningUI({city,scene,camera,controls,renderer,sensors,model}){
 const panel=document.createElement('div');panel.id='planning-panel';panel.hidden=true;
 panel.innerHTML=`
 <section id="flight-section"><h2>单机飞行警报</h2><p class="planning-note">直接使用优化推演当前方案、工况和装备参数，不单独生成部署。</p>
 <div id="flight-alarm" class="alarm-clear">等待任务三推演结果</div><div id="flight-summary"></div>
 <progress id="planning-progress" max="1" value="0"></progress><div id="planning-status" role="status">等待任务三推演结果</div>
 <div class="buttons"><button id="flight-play" class="primary" disabled>▶ 播放飞行</button><button id="flight-reset" disabled>↺ 回到起点</button></div>
 <label>播放速度<select id="flight-speed"><option value="1">1× 实时</option><option value="10" selected>10×</option><option value="30">30×</option><option value="60">60×</option></select></label>
 <input id="flight-seek" type="range" min="0" max="1000" value="0" aria-label="飞行进度" disabled><div id="flight-clock">00:00 / 00:00</div><div id="flight-detections"></div>
 <div class="buttons"><button id="planning-overview" disabled>全域与轨迹</button><button id="planning-apply" disabled>到装备面板调整</button></div></section>
 <section id="threat-section" hidden><h2>威胁推演回放</h2>
  <label>威胁场景<select id="threat-key">
   <option value="single">威胁 · 单目标</option>
   <option value="multi">威胁 · 多目标</option>
   <option value="swarm">威胁 · 蜂群</option>
  </select></label>
  <div id="threat-alarm" class="alarm-clear">等待推演结果</div>
  <div id="threat-summary"></div>
  <div class="buttons"><button id="threat-play" class="primary" disabled>▶ 播放推演</button><button id="threat-reset" disabled>↺</button></div>
  <label>播放速度<select id="threat-rate"><option value="1">1× 实时</option><option value="10" selected>10×</option><option value="30">30×</option><option value="60">60×</option></select></label>
  <input id="threat-seek" type="range" min="0" max="1000" value="0" aria-label="推演进度"><div id="threat-clock">00:00 / 00:00</div>
  <div id="threat-detections"></div>
  <div class="buttons"><button id="threat-overview" disabled>全域</button><button id="threat-apply" disabled>到装备面板调整</button></div>
  <div class="threat-events-block"><h3>警报记录</h3><ol id="threat-events"></ol></div>
  <div id="threat-list"></div></section>
 <section id="flight-events-section"><h2>警报记录</h2><ol id="flight-events"></ol></section>
 <details><summary>当前方案设备与部署依据</summary><div id="planning-devices"></div><p class="hint" title="点位按采样覆盖、相对成本与安装指标筛选；安装姿态与频道分组为模型假设。">安装条件待现场核验。</p></details>
 <section class="planning-io"><button id="planning-export" disabled>导出当前航迹与警报报告 ↓</button></section>`;
 const $=id=>panel.querySelector('#'+id);
 const layer=new THREE.Group();layer.name='Deployment_and_Flight';layer.visible=false;scene.add(layer);
 const view=renderer.domElement.parentElement,label=document.createElement('div');label.id='flight-label';label.hidden=true;view.append(label);
 const voice=createVoiceAlarm(),groundAt=terrainSampler(model.ground.geometry);
 const tooltip=document.createElement('div');tooltip.id='planning-device-tooltip';tooltip.hidden=true;tooltip.setAttribute('role','tooltip');view.append(tooltip);
 const hud=document.createElement('section');hud.id='flight-hud';hud.hidden=true;hud.classList.add('is-embedded');hud.innerHTML=`<div class="flight-hud-title">◎ 目标无人机 D-01 <strong id="flight-live-state">待命</strong></div><div class="flight-altitude"><span id="flight-agl">—</span><small>米 · 离地高度</small></div><div id="flight-coordinates"></div><div id="flight-elevation" title="模型高程采用源 DEM，垂直基准未注明。"></div><div class="buttons"><button id="flight-locate">⌖ 定位无人机</button><button id="flight-voice" aria-pressed="false">开启语音警报</button></div><div id="flight-voice-status" role="status">语音关闭</div>`;view.append(hud);
 const h=id=>hud.querySelector('#'+id);
 let active=false,source=null,report=null,plan=null,conditionId='nominal',route=null,flight=null;
 let worker=null,requestId=0,busy=false,playing=false,time=0,lastStamp=0,frameIndex=-1,tracker=new AlarmTracker();
 let drone=null,alarmLines=null,deviceMeshes=[],detectedIds=new Set(),pointer=null,telemetry=null;
 let mode='flight',threatKey='single',threatTargets=[],threatDetectLines=null,threatFocus=null,threatPlaying=false,threatFrameIndex=0,threatFrameTime=0,threatLastStamp=0,threatAnnouncedIds=new Set(),threatOverviewDone=false;
 const setStatus=text=>{$('planning-status').textContent=text;};
 h('flight-voice').disabled=!voice.supported;h('flight-voice-status').textContent=voice.supported?'语音关闭':'当前浏览器不支持语音合成';
 window.addEventListener('flight-voice-error',()=>{h('flight-voice-status').textContent='语音播放失败，请检查系统中文语音与浏览器声音设置';});
 function speakCurrent(force=false){
  if(!telemetry)return;
  const state=tracker.status==='alarm'?'发现无人机':tracker.status==='coasting'?'无人机信号暂失，正在确认':'无人机当前未检出';
  voice.announce(tracker.status,`${state}，目标 D 零一。${telemetry.agl===null?'':`离地高度 ${Math.round(telemetry.agl)} 米。`}东经 ${telemetry.longitude.toFixed(4)}，北纬 ${telemetry.latitude.toFixed(4)}。`,{force});
 }
 h('flight-voice').onclick=()=>{const enabled=voice.setEnabled(!voice.enabled);h('flight-voice').setAttribute('aria-pressed',String(enabled));h('flight-voice').textContent=enabled?'关闭语音警报':'开启语音警报';h('flight-voice-status').textContent=enabled?'语音已启用':'语音关闭';if(enabled&&flight&&!busy)speakCurrent(true);};
 h('flight-locate').onclick=()=>{if(mode==='flight'){if(drone)focus(drone.position.toArray(),650);}else if(threatFocus){focus(threatFocus.position,650);}};
 view.addEventListener('pointermove',event=>{const rect=view.getBoundingClientRect();pointer={x:event.clientX-rect.left,y:event.clientY-rect.top};});
 view.addEventListener('pointerleave',()=>{pointer=null;tooltip.hidden=true;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)voice.stop();});
 function disposeObject(object){object.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});}
 function destroyLayer(){for(const child of [...layer.children]){disposeObject(child);layer.remove(child);}drone=null;alarmLines=null;deviceMeshes=[];threatTargets=[];threatDetectLines=null;tooltip.hidden=true;}
 function line(points,color,opacity=1){const mesh=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity}));layer.add(mesh);return mesh;}
 function draw(){
  destroyLayer();if(!report||!plan)return;
  const bounds=report.sampling.bounds,corePoints=[];
  for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;corePoints.push([bounds.core[0]+Math.cos(a)*report.settings.coreRadius,bounds.core[1]+8,bounds.core[2]+Math.sin(a)*report.settings.coreRadius]);}
  line(corePoints,0xffd783,.7);
  for(const d of plan.devices){
   const mesh=new THREE.Mesh(new THREE.SphereGeometry(25,10,7),new THREE.MeshBasicMaterial({color:COLORS[d.type],depthTest:false}));mesh.position.fromArray(d.position);mesh.userData.device=d;
   const halo=new THREE.Mesh(new THREE.RingGeometry(35,44,24),new THREE.MeshBasicMaterial({color:0xff675b,transparent:true,opacity:.8,depthTest:false,side:THREE.DoubleSide}));halo.visible=false;mesh.add(halo);mesh.userData.halo=halo;layer.add(mesh);deviceMeshes.push(mesh);
  }
  if(mode==='flight'){
   if(route)line(route.points.map(p=>p.position),0xc6dbe3,.65);
   if(route){drone=createDroneMesh();layer.add(drone);updatePosition();}
  }else{
   installThreatFrame();
  }
  updateDiagnostics();
 }
 const threatResult=()=>report?.threats?.[threatKey];
 function renderThreatSummary(){
  const th=threatResult(),box=$('threat-summary');box.replaceChildren();
  if(!th){box.innerHTML='<p class="hint">暂无威胁推演结果，请先完成推演。</p>';$('threat-list').replaceChildren();return;}
  const s=th.summary;
  for(const [k,v] of [['推演目标',`${s.targetCount} 架`],['被真实检出',`${th.perTarget.filter(p=>p.firstDetectionTime!==null).length} 架`],['平均首报',s.meanFirstDetectionTime===null?'—':`${s.meanFirstDetectionTime.toFixed(1)} s`],['平均检出占比',percent(s.meanDetectedFraction)],['容量溢出架次',`${s.overflowEvents}`]]){const d=document.createElement('div');d.className='sensor-metric';d.innerHTML=`<span>${k}</span><strong>${v}</strong>`;box.append(d);}
  box.insertAdjacentHTML('beforeend',`<p class="hint">${th.text}</p>`);
  $('threat-list').replaceChildren(...th.perTarget.map(p=>{const b=document.createElement('button');b.className='planning-device';b.textContent=`${p.id} · 首报 ${p.firstDetectionTime===null?'未检出':clock(p.firstDetectionTime)} · 检出 ${percent(p.detectedFraction)}`;return b;}));
 }
 function installThreatFrame(){
  const th=threatResult();if(!th?.frames?.length)return;
  const frames=th.frames,index=Math.min(frames.length-1,threatFrameIndex),frame=frames[index];
  for(const mesh of threatTargets){layer.remove(mesh);disposeObject(mesh);}
  threatTargets=[];
  threatFocus=frame.targets.find(t=>t.detectedBy.length>0)||frame.targets[0]||null;
  for(const t of frame.targets){
   const mesh=createDroneMesh();mesh.position.fromArray(t.position);mesh.userData.targetId=t.id;mesh.userData.detected=t.detectedBy.length>0;layer.add(mesh);threatTargets.push(mesh);
  }
  if(threatDetectLines){layer.remove(threatDetectLines);threatDetectLines.geometry.dispose();threatDetectLines.material.dispose();threatDetectLines=null;}
  const pts=[];for(const t of frame.targets)for(const d of t.detectedBy){const device=plan.devices.find(x=>x.id===d.id);if(device)pts.push(device.position,t.position);}
  if(pts.length){threatDetectLines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:0xff776d,transparent:true,opacity:.55}));layer.add(threatDetectLines);}
  detectedIds=new Set(frame.targets.flatMap(t=>t.detectedBy.map(d=>d.id)));
  const dur=frames.at(-1).time;$('threat-clock').textContent=`${clock(frame.time)} / ${clock(dur)}`;$('threat-seek').value=dur?frame.time/dur*1000:0;
  const detected=frame.targets.filter(t=>t.detectedBy.length>0).length;
  $('threat-alarm').className=detected?'alarm-alarm':'alarm-clear';
  $('threat-alarm').textContent=detected?`● 警报 · 当前帧检出 ${detected} / ${frame.targets.length} 架`:'○ 未检出 · 当前模型帧';
  renderThreatDetections(frame);renderThreatEvents(frame.time);updateThreatHud();
  speakThreatProgress(frame.time);
  updateDiagnostics();
 }
 function renderThreatDetections(frame){
  const box=$('threat-detections');box.replaceChildren();
  const counts=new Map();for(const t of frame.targets)for(const d of t.detectedBy)counts.set(d.id,(counts.get(d.id)??0)+1);
  if(!counts.size){box.textContent='无设备在当前帧满足感知条件。';return;}
  for(const [id,count] of counts){const device=plan.devices.find(x=>x.id===id);if(device)metric(box,`${TYPES[device.type]} ${device.id}`,`检出 ${count} 架`);}
 }
 function renderThreatEvents(time){
  const th=threatResult();if(!th)return;
  const detected=th.perTarget.filter(p=>p.firstDetectionTime!==null&&p.firstDetectionTime<=time).sort((a,b)=>a.firstDetectionTime-b.firstDetectionTime);
  $('threat-events').replaceChildren(...detected.map(p=>{const li=document.createElement('li');li.textContent=`${clock(p.firstDetectionTime)} ${p.id} 首次被检出`;return li;}));
 }
 function updateThreatHud(){
  if(!threatFocus){label.hidden=true;hud.hidden=true;return;}
  const p=new THREE.Vector3(...threatFocus.position);p.y+=35;camera.updateMatrixWorld();p.project(camera);
  label.hidden=!active||p.z<-1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;label.style.left=`${(p.x+1)/2*view.clientWidth}px`;label.style.top=`${(1-p.y)/2*view.clientHeight}px`;
  const detected=threatFocus.detectedBy.length>0;
  label.textContent=`◎ ${threatFocus.id} · ${detected?'已检出':'未检出'}`;label.dataset.alarm=detected?'alarm':'';
  const tel=flightTelemetry(threatFocus.position,city.metadata.ecefTransform,groundAt);
  hud.querySelector('.flight-hud-title').childNodes[0].nodeValue=`◎ 威胁目标 ${threatFocus.id} `;
  h('flight-live-state').textContent=detected?'已检出 · 警报':'未检出';
  h('flight-agl').textContent=tel.agl===null?'未知':tel.agl.toFixed(1);
  h('flight-coordinates').textContent=`东经 ${tel.longitude.toFixed(6)}° · 北纬 ${tel.latitude.toFixed(6)}°`;
  h('flight-elevation').textContent=`模型高程 ${tel.elevation.toFixed(1)} m`;
  hud.dataset.alarm=detected?'alarm':'clear';hud.hidden=!active;
 }
 function prepareThreatVoice(){threatOverviewDone=false;threatAnnouncedIds=new Set();}
 function speakThreatProgress(time){
  const th=threatResult();if(!th||!voice.enabled)return;
  if(!threatOverviewDone){voice.announce('threat-overview',threatSummaryText(th),{force:true});threatOverviewDone=true;}
  const due=th.perTarget.filter(p=>p.firstDetectionTime!==null&&p.firstDetectionTime<=time&&!threatAnnouncedIds.has(p.id)).sort((a,b)=>a.firstDetectionTime-b.firstDetectionTime);
  for(const p of due){const seq=threatAnnouncedIds.size+1;voice.announce(`threat-${p.id}`,`第 ${seq} 架目标已被发现`,{force:true});threatAnnouncedIds.add(p.id);}
 }
 function stopThreatPlayback(){threatPlaying=false;threatLastStamp=0;const tp=$('threat-play');if(tp)tp.textContent='▶ 播放推演';}
 function threatTick(stamp){
  const th=threatResult();if(!th?.frames?.length){threatPlaying=false;return;}
  if(threatLastStamp)threatFrameTime=Math.min(th.frames.at(-1).time,threatFrameTime+Math.min(.2,(stamp-threatLastStamp)/1000)*Number($('threat-rate').value));threatLastStamp=stamp;
  const dur=th.frames.at(-1).time;
  if(threatFrameTime>=dur){threatFrameTime=dur;threatPlaying=false;$('threat-play').textContent='↺ 再次播放';}
  const idx=Math.min(th.frames.length-1,th.frames.findIndex(f=>f.time>=threatFrameTime));
  if(idx!==threatFrameIndex&&idx>=0){threatFrameIndex=idx;installThreatFrame();}
 }
 function setMode(value){
  const isThreat=value==='threat';
  mode=value;
  $('flight-section').hidden=isThreat;$('flight-events-section').hidden=isThreat;$('threat-section').hidden=!isThreat;
  if(isThreat){voice.stop();playing=false;if($('flight-play'))$('flight-play').textContent='▶ 播放飞行';threatFrameIndex=0;threatFrameTime=0;stopThreatPlayback();}
  else stopThreatPlayback();
  draw();
  if(isThreat){renderThreatSummary();prepareThreatVoice();installThreatFrame();}
  updateDiagnostics();
 }
 function metric(parent,title,value){const row=document.createElement('div');row.className='sensor-metric';const span=document.createElement('span'),strong=document.createElement('strong');span.textContent=title;strong.textContent=value;row.append(span,strong);parent.append(row);}
 function renderDevices(){
  $('planning-devices').replaceChildren();
  for(const device of plan?.devices??[]){const b=document.createElement('button');b.className='planning-device';b.textContent=`${TYPES[device.type]} · ${device.id} / 东 ${device.position[0].toFixed(0)} 北 ${(-device.position[2]).toFixed(0)}`;b.onclick=()=>focus(device.position,700);$('planning-devices').append(b);}
 }
 function focus(position,span){controls.target.fromArray(position);camera.position.fromArray(position).add(new THREE.Vector3(span*.55,span*.9,span*.75));controls.update();}
 function overview(){if(!report)return;const b=report.sampling.bounds,span=Math.max(b.east-b.west,b.north-b.south);focus([(b.east+b.west)/2,150,(b.south+b.north)/2],span);}
 function controlsEnabled(){
  for(const id of ['flight-play','flight-reset','flight-seek','planning-export'])$(id).disabled=busy||!flight;
  for(const id of ['planning-overview'])$(id).disabled=!report;
  $('planning-apply').disabled=busy||!route;
  const th=threatResult(),thReady=!!th?.frames?.length;$('threat-play').disabled=busy||!thReady;$('threat-reset').disabled=busy||!thReady;$('threat-seek').disabled=!thReady;
  $('threat-overview').disabled=!report;$('threat-apply').disabled=busy||!threatFocus;
 }
 function updateDiagnostics(){
  window.planningDiagnostics={ready:!!source,busy,requestId,planId:plan?.id,conditionId,deviceCount:plan?.devices.length??0,playing,time,telemetry,voiceEnabled:voice.enabled,markers:deviceMeshes.map(mesh=>{const p=mesh.position.clone().project(camera);return{id:mesh.userData.device.id,type:mesh.userData.device.type,name:mesh.userData.device.name,x:(p.x+1)/2*view.clientWidth,y:(1-p.y)/2*view.clientHeight,visible:p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1,alarming:detectedIds.has(mesh.userData.device.id),scale:mesh.scale.x};}),alarm:tracker.status,frameIndex,eventCount:tracker.events.length,detectedIds:frameIndex>=0?flight?.frames[frameIndex]?.detections.map(d=>d.id)??[]:[],droneShape:drone?.name??null};
 }
 function acceptFrame(index){
  if(!flight)return;if(index<frameIndex){tracker=new AlarmTracker();frameIndex=-1;}
  while(frameIndex<index){frameIndex++;tracker.accept(flight.frames[frameIndex]);}
  const frame=flight.frames[frameIndex];detectedIds=new Set(frame.detections.map(d=>d.id));
  $('flight-alarm').className=`alarm-${tracker.status}`;$('flight-alarm').textContent=tracker.status==='alarm'?'● 警报 · 已检出无人机':tracker.status==='coasting'?'◌ 丢失确认中 · 当前帧未检出':'○ 未检出 · 当前模型帧';
  $('flight-detections').replaceChildren();for(const d of frame.detections)metric($('flight-detections'),`${TYPES[d.type]} ${d.id}`,`裕量 ${d.marginDb.toFixed(1)} dB`);
  if(!frame.detections.length)$('flight-detections').textContent='无设备在当前帧满足感知条件。';
  $('flight-events').replaceChildren(...tracker.events.slice(-30).reverse().map(event=>{const li=document.createElement('li');li.textContent=`${clock(event.time)} ${event.message}${event.deviceIds?` · ${event.deviceIds.length} 台设备`:''}`;return li;}));
  if(alarmLines){alarmLines.geometry.dispose();alarmLines.material.dispose();layer.remove(alarmLines);alarmLines=null;}
  if(frame.detections.length){const points=[];for(const d of frame.detections){const device=plan.devices.find(x=>x.id===d.id);if(device)points.push(device.position,frame.position);}alarmLines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:0xff776d,transparent:true,opacity:.6}));layer.add(alarmLines);}
  updateDiagnostics();
 }
 function updatePosition(){
  if(!route||!drone){label.hidden=true;hud.hidden=true;return;}
  drone.position.fromArray(interpolateRoute(route,time));const p=drone.position.clone();p.y+=35;camera.updateMatrixWorld();p.project(camera);
  label.hidden=!active||p.z<-1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;label.style.left=`${(p.x+1)/2*view.clientWidth}px`;label.style.top=`${(1-p.y)/2*view.clientHeight}px`;
  telemetry=flightTelemetry(drone.position.toArray(),city.metadata.ecefTransform,groundAt);const agl=telemetry.agl===null?'未知':telemetry.agl.toFixed(1);
  label.textContent=`◎ D-01 · ${tracker.status==='alarm'?'警报':tracker.status==='coasting'?'确认中':'未检出'} · 离地 ${agl} m`;label.dataset.alarm=tracker.status;
  hud.querySelector('.flight-hud-title').childNodes[0].nodeValue='◎ 目标无人机 D-01 ';h('flight-agl').textContent=agl;h('flight-coordinates').textContent=`东经 ${telemetry.longitude.toFixed(6)}° · 北纬 ${telemetry.latitude.toFixed(6)}°`;h('flight-elevation').textContent=`模型高程 ${telemetry.elevation.toFixed(1)} m`;h('flight-live-state').textContent=busy?'正在重算':tracker.status==='alarm'?'已检出 · 警报':tracker.status==='coasting'?'信号确认中':'未检出';hud.dataset.alarm=busy?'clear':tracker.status;hud.hidden=!active;
  $('flight-clock').textContent=`${clock(time)} / ${clock(route.duration)}`;$('flight-seek').value=route.duration?time/route.duration*1000:0;
 }
 function installFlight(value){
  voice.stop();route=value.route;flight=value.flight;time=0;playing=false;tracker=new AlarmTracker();frameIndex=-1;$('planning-progress').value=1;$('flight-play').textContent='▶ 播放飞行';
  $('flight-summary').replaceChildren();metric($('flight-summary'),'轨迹采样检出比例',percent(flight.summary.detectedFraction));metric($('flight-summary'),'首报 / 失联事件',`${flight.summary.firstDetectionTime===null?'未检出':clock(flight.summary.firstDetectionTime)} / ${flight.summary.lossEvents} 次`);metric($('flight-summary'),'仿真速度 / 计算步长',`${route.speed} m/s / ${flight.interval} s`);
  draw();acceptFrame(0);updatePosition();controlsEnabled();
 }
 function cancelWork(){
  requestId++;if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();worker=null;}
  busy=false;playing=false;lastStamp=0;voice.stop();
 }
 function invalidate(){
  cancelWork();route=null;flight=null;time=0;frameIndex=-1;tracker=new AlarmTracker();detectedIds.clear();telemetry=null;
  $('flight-summary').replaceChildren();$('flight-events').replaceChildren();$('flight-detections').replaceChildren();$('flight-alarm').className='alarm-clear';$('flight-alarm').textContent='任务三数据已更新，等待重新计算';$('flight-clock').textContent='00:00 / 00:00';$('flight-seek').value=0;$('planning-progress').value=0;
  draw();controlsEnabled();updateDiagnostics();
 }
 function fail(text,id){if(id!==requestId)return;cancelWork();busy=false;route=null;flight=null;setStatus(`航迹计算失败：${text}`);draw();controlsEnabled();updateDiagnostics();}
 function getWorker(){
  if(worker)return worker;const instance=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});worker=instance;
  instance.onmessage=({data})=>{
   if(instance!==worker||data.requestId!==requestId)return;
   if(data.type==='progress'){const value=data.value;$('planning-progress').value=value.total?value.completed/value.total:0;setStatus(`计算当前方案飞行警报 ${value.completed}/${value.total}`);}
   else if(data.type==='flight'){busy=false;installFlight(data);setStatus(`已按任务三 ${plan.name} · ${conditionId} 工况完成计算。`);controlsEnabled();updateDiagnostics();}
   else if(data.type==='error')fail(data.message,data.requestId);
  };
  instance.onerror=event=>fail(event.message||'后台计算失败',requestId);return instance;
 }
 function simulate(){
  if(!source||!report||!plan||busy||flight)return;
  const id=++requestId,condition=scenarios(report.environment).find(c=>c.id===conditionId)??scenarios(report.environment)[0];
  busy=true;playing=false;detectedIds.clear();controlsEnabled();updateDiagnostics();setStatus('正在按任务三当前方案生成轨迹并计算警报…');
  getWorker().postMessage({type:'simulate',requestId:id,baseURL:new URL('./',location.href).href,bounds:report.sampling.bounds,devices:plan.devices,target:{...report.target,...condition.target},environment:condition.environment,core:report.sampling.bounds.core,coreRadius:report.settings.coreRadius});
 }
 function setDeployment(value){
  if(source&&value?.report===report&&value?.plan===plan&&value?.conditionId===conditionId)return;
  invalidate();source=value?.report&&value?.plan?value:null;report=source?.report??null;plan=source?.plan??null;conditionId=source?.conditionId??'nominal';
  renderDevices();controlsEnabled();
  if(mode!=='flight'){renderThreatSummary();prepareThreatVoice();}
  draw();
  setStatus(source?`已接入任务三 ${plan.name} · ${conditionId} 工况。`:'等待任务三推演结果');
  if(active&&source&&mode==='flight')simulate();updateDiagnostics();
 }
 function setActive(value){
  active=!!value;panel.hidden=!active;layer.visible=active;
  if(active){
   if(mode!=='flight'){renderThreatSummary();prepareThreatVoice();draw();}
   else if(source&&!flight&&!busy)simulate();else updatePosition();
  }else{label.hidden=true;hud.hidden=true;tooltip.hidden=true;pointer=null;voice.stop();playing=false;lastStamp=0;stopThreatPlayback();if(flight)$('flight-play').textContent=time>0?'▶ 继续飞行':'▶ 播放飞行';}
  updateDiagnostics();
 }
 function openSection(section){const target=$(section==='alarms'?'flight-events-section':section==='threat'?'threat-section':'flight-section');target?.scrollIntoView({block:'start'});}
 $('planning-overview').onclick=overview;
 $('planning-apply').onclick=()=>{if(!route)return;const condition=scenarios(report.environment).find(c=>c.id===conditionId)??scenarios(report.environment)[0];sensors.applyScenario({modelVersion:MODEL_VERSION,origin:report.origin,devices:plan.devices,target:{...report.target,...condition.target,position:interpolateRoute(route,time)},environment:condition.environment});};
 $('flight-play').onclick=()=>{if(!flight)return;if(time>=route.duration){time=0;tracker=new AlarmTracker();frameIndex=-1;acceptFrame(0);}playing=!playing;lastStamp=0;if(playing)speakCurrent(true);else voice.stop();$('flight-play').textContent=playing?'Ⅱ 暂停飞行':'▶ 继续飞行';updateDiagnostics();};
 $('flight-reset').onclick=()=>{if(!flight)return;voice.stop();playing=false;time=0;tracker=new AlarmTracker();frameIndex=-1;acceptFrame(0);updatePosition();$('flight-play').textContent='▶ 播放飞行';};
 $('flight-seek').oninput=()=>{if(!flight)return;voice.stop();time=Number($('flight-seek').value)/1000*route.duration;const index=time>=route.duration?flight.frames.length-1:Math.min(flight.frames.length-1,Math.floor(time/flight.interval));acceptFrame(index);updatePosition();};
 $('planning-export').onclick=()=>{if(!flight)return;const blob=new Blob([JSON.stringify({schema:'task3-flight/1.0',task3RequestId:report.requestId,activePlanId:plan.id,activeConditionId:conditionId,plan,route,flight,playback:{time,status:tracker.status,events:tracker.events}},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='task3-flight-alarm-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('threat-key').onchange=()=>{threatKey=$('threat-key').value;stopThreatPlayback();threatFrameIndex=0;threatFrameTime=0;renderThreatSummary();prepareThreatVoice();installThreatFrame();controlsEnabled();};
 $('threat-play').onclick=()=>{const th=threatResult();if(!th?.frames?.length)return;if(threatPlaying){stopThreatPlayback();return;}if(threatFrameTime>=th.frames.at(-1).time){threatFrameTime=0;threatFrameIndex=0;}threatPlaying=true;threatLastStamp=0;prepareThreatVoice();$('threat-play').textContent='Ⅱ 暂停';updateDiagnostics();};
 $('threat-reset').onclick=()=>{stopThreatPlayback();threatFrameIndex=0;threatFrameTime=0;prepareThreatVoice();installThreatFrame();};
 $('threat-seek').oninput=()=>{const th=threatResult();if(!th?.frames?.length)return;stopThreatPlayback();threatFrameTime=Number($('threat-seek').value)/1000*th.frames.at(-1).time;const idx=th.frames.findIndex(f=>f.time>=threatFrameTime);threatFrameIndex=Math.max(0,Math.min(th.frames.length-1,idx));installThreatFrame();};
 $('threat-overview').onclick=overview;
 $('threat-apply').onclick=()=>{if(!threatFocus||!report)return;const condition=scenarios(report.environment).find(c=>c.id===conditionId)??scenarios(report.environment)[0];sensors.applyScenario({modelVersion:MODEL_VERSION,origin:report.origin,devices:plan.devices,target:{...report.target,...condition.target,position:[...threatFocus.position]},environment:condition.environment});};
 function updateMarkers(stamp){
  const pulse=(Math.sin(stamp/1000*Math.PI*3)+1)/2;
  for(const mesh of deviceMeshes){const alarming=!busy&&detectedIds.has(mesh.userData.device.id);mesh.material.color.set(alarming?0xff675b:COLORS[mesh.userData.device.type]);mesh.scale.setScalar(alarming?1.15+pulse*.65:1);mesh.userData.halo.visible=alarming;mesh.userData.halo.material.opacity=.25+pulse*.7;mesh.userData.halo.quaternion.copy(camera.quaternion);}
  if(!pointer||!active){tooltip.hidden=true;return;}let picked=null,best=19;
  for(const mesh of deviceMeshes){const p=mesh.position.clone().project(camera);if(p.z<-1||p.z>1)continue;const x=(p.x+1)/2*view.clientWidth,y=(1-p.y)/2*view.clientHeight,d=Math.hypot(pointer.x-x,pointer.y-y);if(d<best){best=d;picked=mesh;}}
  tooltip.hidden=!picked;if(!picked)return;const d=picked.userData.device;tooltip.textContent=`${TYPES[d.type]} · ${d.name}\n${d.id}${detectedIds.has(d.id)&&!busy?'\n● 当前检出无人机 · 闪烁警报':''}`;tooltip.style.left=`${Math.max(8,Math.min(view.clientWidth-260,pointer.x+14))}px`;tooltip.style.top=`${Math.max(8,Math.min(view.clientHeight-90,pointer.y+14))}px`;
 }
 function update(stamp){
  if(!active)return;
  if(mode==='flight'){
   if(playing&&flight){if(lastStamp)time=Math.min(route.duration,time+Math.min(.2,(stamp-lastStamp)/1000)*Number($('flight-speed').value));lastStamp=stamp;let index=Math.min(flight.frames.length-1,Math.floor(time/flight.interval));if(time>=route.duration)index=flight.frames.length-1;if(index!==frameIndex)acceptFrame(index);if(time>=route.duration){playing=false;$('flight-play').textContent='↺ 再次播放';setStatus('飞行结束，可回放或导出全部警报记录。');}updateDiagnostics();}else lastStamp=0;
   updatePosition();
  }else{
   if(threatPlaying)threatTick(stamp);else threatLastStamp=0;
  }
  updateMarkers(stamp);if(playing&&!document.hidden&&!busy)speakCurrent();updateDiagnostics();
 }
 controlsEnabled();updateDiagnostics();return{update,panel,setActive,setDeployment,invalidate,openSection,setMode};
}
