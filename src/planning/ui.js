import * as THREE from 'three';
import {DEFAULT_SETTINGS,scenarios,validateSettings} from './optimizer.js';
import {AlarmTracker,interpolateRoute} from './flight.js';
import {validateReport,enrichReport} from './report.js';
import {MODEL_VERSION} from '../sensors/engine.js';
import {TYPES} from '../sensors/presets.js';
import {terrainSampler} from '../sensors/terrain-query.js';
import {flightTelemetry} from './telemetry.js';
import {createVoiceAlarm} from './voice.js';
import './ui.css';
const COLORS={radar:0x70d6ff,radio:0xb89aff,optical:0xffd783,acoustic:0x69e2bd};
const clock=t=>`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const percent=x=>`${(x*100).toFixed(1)}%`;
export function mountPlanningUI({app,city,scene,camera,controls,renderer,sensors,model}){
 const panel=document.createElement('aside');panel.id='planning-panel';panel.hidden=true;
 panel.innerHTML=`<div class="brand"><span class="mark">◎</span> 部署推演 <small>SUBTASK 03</small></div><button id="planning-back" class="back-button">← 返回城市建模</button>
 <p class="planning-note">候选集内择优 · 全域离散采样<br>绿色为采样点覆盖，红色为盲点；不代表连续空间无盲区。</p>
 <section><h2>方案优化 <span>OPTIMIZATION</span></h2><label>优化范围<select id="planning-scope"><option value="city">全部仓库城区</option><option value="core">博物院周边 2.4 × 2.4 km</option></select></label>
 <div class="planning-inputs"><label>网格间距 / m<input id="planning-spacing" type="number" min="150" max="1000" step="50" value="500"></label><label>设备上限<input id="planning-max-devices" type="number" min="1" max="64" value="64"></label><label>预算 / 相对单位<input id="planning-budget" type="number" min="1" max="1000" value="600"></label><label>预留裕量 / dB<input id="planning-reserve" type="number" min="0" max="20" value="3"></label></div>
 <details><summary>相对设备成本</summary><div class="planning-inputs"><label>雷达<input id="planning-cost-radar" type="number" min="0.1" max="100" value="12"></label><label>无线电<input id="planning-cost-radio" type="number" min="0.1" max="100" value="5"></label><label>光电<input id="planning-cost-optical" type="number" min="0.1" max="100" value="4"></label><label>声学<input id="planning-cost-acoustic" type="number" min="0.1" max="100" value="2"></label></div></details>
 <div class="buttons"><button id="planning-optimize" class="primary">重新优化</button><button id="planning-cancel" disabled>取消计算</button></div><progress id="planning-progress" max="1" value="0"></progress><div id="planning-status" role="status">正在读取已计算示例…</div></section>
 <section><h2>方案比较 <span>CANDIDATES</span></h2><select id="planning-plan" aria-label="部署方案"></select><div id="planning-comparison"></div><div id="planning-summary"></div>
 <label>覆盖工况<select id="planning-condition"><option value="nominal">基线 · 发射</option><option value="silent">无线电静默</option><option value="weather">雨雾及街道噪声</option><option value="interference">电磁干扰</option></select></label>
 <label>显示离地高度<select id="planning-height"><option value="30">30 m</option><option value="60" selected>60 m</option><option value="100">100 m</option></select></label><div class="planning-legend"><span>● 已覆盖采样</span><span>● 盲点</span><span>◎ 核心区</span></div>
 <div class="buttons"><button id="planning-overview">全域与轨迹</button><button id="planning-apply">到装备面板调整</button></div></section>
 <section><h2>无人机 D-01 <span>LIVE FLIGHT</span></h2><div id="flight-alarm" class="alarm-clear">尚未播放</div><div id="flight-summary"></div><div class="buttons"><button id="flight-play" class="primary">▶ 播放飞行</button><button id="flight-reset">↺ 回到起点</button></div>
 <label>演示倍速<select id="flight-speed"><option value="1">1× 实时</option><option value="10" selected>10×</option><option value="30">30×</option><option value="60">60×</option></select></label><input id="flight-seek" type="range" min="0" max="1000" value="0" aria-label="飞行进度"><div id="flight-clock">00:00 / 00:00</div><div id="flight-detections"></div></section>
 <section><h2>报警记录 <span>EVENTS</span></h2><ol id="flight-events"></ol></section>
 <details><summary>设备清单与部署依据</summary><div id="planning-devices"></div><p class="hint">按采样盲区权重、相对成本、安装代理指标比较。安装点为几何候选，施工条件未实测。雷达安装姿态与频道分组为模型假设。</p></details>
 <section class="planning-io"><button id="planning-export">导出方案、覆盖与报警报告 ↓</button><a href="./deployment-modeling.md" target="_blank" rel="noopener">优化方法与适用边界 ↗</a></section>`;
 app.insertBefore(panel,app.querySelector('main'));const cityPanel=app.querySelector('aside');const $=id=>panel.querySelector('#'+id);
 const button=document.createElement('button');button.id='toggle-planning';button.textContent='部署与飞行 →';app.querySelector('header').append(button);
 const layer=new THREE.Group();layer.name='Deployment_and_Flight';layer.visible=false;scene.add(layer);
 const label=document.createElement('div');label.id='flight-label';label.hidden=true;renderer.domElement.parentElement.append(label);
 const view=renderer.domElement.parentElement,voice=createVoiceAlarm(),groundAt=terrainSampler(model.ground.geometry);
 const tooltip=document.createElement('div');tooltip.id='planning-device-tooltip';tooltip.hidden=true;tooltip.setAttribute('role','tooltip');view.append(tooltip);
 const hud=document.createElement('section');hud.id='flight-hud';hud.hidden=true;hud.innerHTML=`<div class="flight-hud-title">◎ 目标无人机 D-01 <strong id="flight-live-state">待命</strong></div><div class="flight-altitude"><span id="flight-agl">—</span><small>米 · 离地高度</small></div><div id="flight-coordinates"></div><div id="flight-elevation"></div><div class="buttons"><button id="flight-locate">⌖ 定位无人机</button><button id="flight-voice" aria-pressed="false">开启语音报警</button></div><div id="flight-voice-status" role="status">语音关闭</div>`;view.append(hud);
 const h=id=>hud.querySelector('#'+id);let deviceMeshes=[],detectedIds=new Set(),pointer=null,telemetry=null;
 h('flight-voice').disabled=!voice.supported;h('flight-voice-status').textContent=voice.supported?'语音关闭 · 点击启用中文播报':'当前浏览器不支持语音合成';
 window.addEventListener('flight-voice-error',()=>{h('flight-voice-status').textContent='语音播放失败，请检查系统中文语音与浏览器声音设置';});
 function speakCurrent(force=false){if(!telemetry)return;const state=tracker.status==='alarm'?'发现无人机':tracker.status==='coasting'?'无人机信号暂失，正在确认':'无人机当前未检出';voice.announce(tracker.status,`${state}，目标 D 零一。${telemetry.agl===null?'':`离地高度 ${Math.round(telemetry.agl)} 米。`}东经 ${telemetry.longitude.toFixed(4)}，北纬 ${telemetry.latitude.toFixed(4)}。`,{force});}
 h('flight-voice').onclick=()=>{const enabled=voice.setEnabled(!voice.enabled);h('flight-voice').setAttribute('aria-pressed',String(enabled));h('flight-voice').textContent=enabled?'关闭语音报警':'开启语音报警';h('flight-voice-status').textContent=enabled?'语音已启用 · 状态变化播报，持续状态每 30 秒提醒':'语音关闭';if(enabled&&flight&&!busy)speakCurrent(true);};
 h('flight-locate').onclick=()=>{if(drone)focus(drone.position.toArray(),650);};
 view.addEventListener('pointermove',event=>{const rect=view.getBoundingClientRect();pointer={x:event.clientX-rect.left,y:event.clientY-rect.top};});view.addEventListener('pointerleave',()=>{pointer=null;tooltip.hidden=true;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)voice.stop();});
 let report=null,plan=null,flight=null,worker=null,busy=false,playing=false,time=0,lastStamp=0,frameIndex=-1,tracker=new AlarmTracker(),drone=null,coverageMesh=null,alarmLines=null,loadPromise=null,lastCompleted=null;
 const setStatus=text=>{$('planning-status').textContent=text;};
 function destroyLayer(){for(const child of [...layer.children]){child.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});layer.remove(child);}drone=null;coverageMesh=null;alarmLines=null;deviceMeshes=[];tooltip.hidden=true;}
 function line(points,color,opacity=1){const mesh=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity}));layer.add(mesh);return mesh;}
 function draw(){
  destroyLayer();if(!report||!plan)return;
  line(report.route.points.map(p=>p.position),0xc6dbe3,0.65);
  const bounds=report.sampling.bounds,corePoints=[];for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;corePoints.push([bounds.core[0]+Math.cos(a)*report.settings.coreRadius,bounds.core[1]+8,bounds.core[2]+Math.sin(a)*report.settings.coreRadius]);}line(corePoints,0xffd783,0.7);
  for(const d of plan.devices){const mesh=new THREE.Mesh(new THREE.SphereGeometry(25,10,7),new THREE.MeshBasicMaterial({color:COLORS[d.type],depthTest:false}));mesh.position.fromArray(d.position);mesh.userData.device=d;const halo=new THREE.Mesh(new THREE.RingGeometry(35,44,24),new THREE.MeshBasicMaterial({color:0xffc36b,transparent:true,opacity:0.8,depthTest:false,side:THREE.DoubleSide}));halo.visible=false;mesh.add(halo);mesh.userData.halo=halo;layer.add(mesh);deviceMeshes.push(mesh);}
  const h=Number($('planning-height').value),c=report.conditions.findIndex(x=>x.id===$('planning-condition').value);
  const samples=report.sampling.samples.map((p,j)=>({p,j})).filter(({p})=>p.agl===h);
  coverageMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(16,6,4),new THREE.MeshBasicMaterial({depthTest:false,transparent:true,opacity:0.75}),samples.length);
  const matrix=new THREE.Matrix4(),color=new THREE.Color();samples.forEach(({p,j},i)=>{matrix.makeTranslation(...p.position);coverageMesh.setMatrixAt(i,matrix);coverageMesh.setColorAt(i,color.set(plan.coverage[c][j]>0?0x69e2bd:0xff776d));});layer.add(coverageMesh);
  drone=new THREE.Group();const body=new THREE.Mesh(new THREE.SphereGeometry(12,12,8),new THREE.MeshBasicMaterial({color:0xff776d,depthTest:false}));drone.add(body);
  for(const x of [-1,1])for(const z of [-1,1]){const rotor=new THREE.Mesh(new THREE.TorusGeometry(9,1.8,5,15),new THREE.MeshBasicMaterial({color:0xffd783,depthTest:false}));rotor.rotation.x=Math.PI/2;rotor.position.set(x*18,0,z*18);drone.add(rotor);}
  layer.add(drone);updatePosition();updateDiagnostics();
 }
 function metric(parent,title,value){const row=document.createElement('div');row.className='sensor-metric';const span=document.createElement('span'),strong=document.createElement('strong');span.textContent=title;strong.textContent=value;row.append(span,strong);parent.append(row);}
 function renderReport(){
  $('planning-plan').replaceChildren(...report.plans.map(p=>new Option(`${p.name} · ${p.devices.length} 台`,p.id,false,p.id===plan.id)));
  $('planning-comparison').replaceChildren();for(const p of report.plans)metric($('planning-comparison'),`${p.name} / ${p.devices.length} 台`,`${percent(p.metrics[0].coverageRate)} · 成本 ${p.cost.toFixed(1)}`);
  $('planning-summary').replaceChildren();const c=report.conditions.findIndex(x=>x.id===$('planning-condition').value),m=plan.metrics[c];
  metric($('planning-summary'),'当前工况采样覆盖',`${m.covered} / ${m.total} · ${percent(m.coverageRate)}`);metric($('planning-summary'),'采样盲区占比',percent(m.blindRate));metric($('planning-summary'),'核心区采样覆盖',percent(m.coreCoverageRate));const area=plan.areaEstimates?.[$('planning-condition').value]?.find(a=>a.height===Number($('planning-height').value));if(area)metric($('planning-summary'),'当前高度层网格盲区近似面积',`${(area.approximateBlindAreaMeters2/1e6).toFixed(2)} km²`);metric($('planning-summary'),'已检查候选 / 有效采样',`${report.candidateCount} / ${report.sampling.samples.length}`);
  metric($('planning-summary'),'DEM 空缺 / 建筑内部排除',`${report.sampling.excluded.outsideDem} / ${report.sampling.excluded.insideBuildings}`);
  metric($('planning-summary'),'EMC 代理冲突',`${plan.emc.conflicts.length} 对`);
  $('planning-devices').replaceChildren();for(const device of plan.devices){const b=document.createElement('button');b.className='planning-device';b.textContent=`${TYPES[device.type]} · ${device.id} / 东 ${device.position[0].toFixed(0)} 北 ${(-device.position[2]).toFixed(0)}`;b.onclick=()=>focus(device.position,700);$('planning-devices').append(b);}
  draw();controlsEnabled();
 }
 function focus(position,span){controls.target.fromArray(position);camera.position.fromArray(position).add(new THREE.Vector3(span*.55,span*.9,span*.75));controls.update();}
 function overview(){if(!report)return;const b=report.sampling.bounds,span=Math.max(b.east-b.west,b.north-b.south);focus([(b.east+b.west)/2,150,(b.south+b.north)/2],span);}
 function controlsEnabled(){for(const id of ['planning-optimize','planning-plan','planning-condition','planning-apply','planning-export'])$(id).disabled=busy||(!report&&id!=='planning-optimize');$('planning-cancel').disabled=!busy;for(const id of ['flight-play','flight-reset','flight-seek'])$(id).disabled=busy||!flight;}
 function updateDiagnostics(){window.planningDiagnostics={ready:!!report,busy,planId:plan?.id,condition:$('planning-condition').value,deviceCount:plan?.devices.length??0,sampleCount:report?.sampling.samples.length??0,coverageRate:plan?.metrics[report?.conditions.findIndex(c=>c.id===$('planning-condition').value)]?.coverageRate,playing,time,telemetry,voiceEnabled:voice.enabled,markers:deviceMeshes.map(mesh=>{const p=mesh.position.clone().project(camera);return {id:mesh.userData.device.id,type:mesh.userData.device.type,name:mesh.userData.device.name,x:(p.x+1)/2*view.clientWidth,y:(1-p.y)/2*view.clientHeight,visible:p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1,alarming:detectedIds.has(mesh.userData.device.id),scale:mesh.scale.x};}),alarm:tracker.status,frameIndex,eventCount:tracker.events.length,detectedIds:frameIndex>=0?flight?.frames[frameIndex]?.detections.map(d=>d.id)??[]:[]};}
 function acceptFrame(index){
  if(!flight)return;if(index<frameIndex){tracker=new AlarmTracker();frameIndex=-1;}
  while(frameIndex<index){frameIndex++;tracker.accept(flight.frames[frameIndex]);}
  const frame=flight.frames[frameIndex];detectedIds=new Set(frame.detections.map(d=>d.id));$('flight-alarm').className=`alarm-${tracker.status}`;$('flight-alarm').textContent=tracker.status==='alarm'?'● 报警 · 已检出无人机':tracker.status==='coasting'?'◌ 丢失确认中 · 当前帧未检出':'○ 未检出 · 当前模型帧';
  $('flight-detections').replaceChildren();for(const d of frame.detections)metric($('flight-detections'),`${TYPES[d.type]} ${d.id}`,`裕量 ${d.marginDb.toFixed(1)} dB`);
  if(!frame.detections.length)$('flight-detections').textContent='无设备在当前帧满足感知条件。';
  $('flight-events').replaceChildren(...tracker.events.slice(-30).reverse().map(event=>{const li=document.createElement('li');li.textContent=`${clock(event.time)} ${event.message}${event.deviceIds?` · ${event.deviceIds.length} 台设备`:''}`;return li;}));
  if(alarmLines){alarmLines.geometry.dispose();alarmLines.material.dispose();layer.remove(alarmLines);alarmLines=null;}
  if(frame.detections.length){const points=[];for(const d of frame.detections){const device=plan.devices.find(x=>x.id===d.id);points.push(device.position,frame.position);}alarmLines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:0xff776d,transparent:true,opacity:0.6}));layer.add(alarmLines);}
  updateDiagnostics();
 }
 function updatePosition(){
  if(!report||!drone)return;drone.position.fromArray(interpolateRoute(report.route,time));const p=drone.position.clone();p.y+=35;camera.updateMatrixWorld();p.project(camera);label.hidden=panel.hidden||p.z<-1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;
  const view=renderer.domElement.parentElement;label.style.left=`${(p.x+1)/2*view.clientWidth}px`;label.style.top=`${(1-p.y)/2*view.clientHeight}px`;telemetry=flightTelemetry(drone.position.toArray(),city.metadata.ecefTransform,groundAt);const agl=telemetry.agl===null?'未知':telemetry.agl.toFixed(1);label.textContent=`◎ D-01 · ${tracker.status==='alarm'?'报警':tracker.status==='coasting'?'确认中':'未检出'} · 离地 ${agl} m`;h('flight-agl').textContent=agl;h('flight-coordinates').textContent=`东经 ${telemetry.longitude.toFixed(6)}° · 北纬 ${telemetry.latitude.toFixed(6)}°`;h('flight-elevation').textContent=`模型高程 ${telemetry.elevation.toFixed(1)} m · 源 DEM 垂直基准未注明`;h('flight-live-state').textContent=busy?'正在重算':tracker.status==='alarm'?'已检出 · 报警':tracker.status==='coasting'?'信号确认中':'未检出';hud.dataset.alarm=busy?'clear':tracker.status;hud.hidden=panel.hidden;label.dataset.alarm=tracker.status;
  $('flight-clock').textContent=`${clock(time)} / ${clock(report.route.duration)}`;$('flight-seek').value=report.route.duration?time/report.route.duration*1000:0;
 }
 function installFlight(value){voice.stop();$('planning-progress').value=1;flight=value;time=0;playing=false;tracker=new AlarmTracker();frameIndex=-1;$('flight-play').textContent='▶ 播放飞行';$('flight-summary').replaceChildren();metric($('flight-summary'),'轨迹采样检出比例',percent(flight.summary.detectedFraction));metric($('flight-summary'),'首报 / 失联事件',`${flight.summary.firstDetectionTime===null?'未检出':clock(flight.summary.firstDetectionTime)} / ${flight.summary.lossEvents} 次`);metric($('flight-summary'),'真实速度 / 模型更新',`${report.route.speed} m/s / ${flight.interval} s`);acceptFrame(0);updatePosition();controlsEnabled();lastCompleted={report,plan,flight};}
 function setReport(value){report=enrichReport(validateReport(value,city),city);plan=report.plans.find(p=>p.id===report.selectedId);busy=false;renderReport();installFlight(report.flight);if(!panel.hidden)overview();setStatus(`示例已验证 · ${plan.devices.length} 台设备。覆盖仅限所列采样点；可重新优化。`);}
 function getWorker(){if(worker)return worker;worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{if(data.type==='progress'){$('planning-progress').value=data.value.total?data.value.completed/data.value.total:0;setStatus(`${data.value.stage==='matrix'?'评估候选覆盖':data.value.stage==='repair'?'为盲点补充候选':'计算飞行报警'} ${data.value.completed}/${data.value.total}`);}else if(data.type==='report'){try{setReport(data.report);}catch(error){fail(error.message);}}else if(data.type==='flight'){busy=false;installFlight(data.flight);setStatus('所选方案与工况的飞行报警已重算。');}else if(data.type==='error')fail(data.message);};
  worker.onerror=event=>fail(event.message||'后台计算失败');return worker;
 }
 function fail(text){voice.stop();worker?.terminate();worker=null;busy=false;playing=false;if(lastCompleted){({report,plan}=lastCompleted);renderReport();installFlight(lastCompleted.flight);}setStatus(`计算失败：${text}。保留上次已完成方案。`);controlsEnabled();updateDiagnostics();}
 function simulate(){if(!report)return;voice.stop();detectedIds.clear();playing=false;busy=true;flight=null;controlsEnabled();updateDiagnostics();const condition=scenarios(report.environment).find(c=>c.id===$('planning-condition').value);setStatus('正在重算当前方案的轨迹报警…');getWorker().postMessage({type:'simulate',baseURL:new URL('./',location.href).href,devices:plan.devices,route:report.route,target:{...report.target,...condition.target},environment:condition.environment,core:report.sampling.bounds.core,coreRadius:report.settings.coreRadius});}
 async function loadExample(){
  try{const response=await fetch('./deployment-example.json');if(!response.ok)throw Error('示例文件不可用，可点击重新优化');const value=await response.json();if(!busy&&!report)setReport(value);}
  catch(error){setStatus(error.message);controlsEnabled();updateDiagnostics();}
 }
 button.onclick=()=>{app.dispatchEvent(new CustomEvent('view-change',{detail:'planning'}));cityPanel.hidden=true;panel.hidden=false;app.classList.add('equipment-mode');layer.visible=true;if(!loadPromise)loadPromise=loadExample();else if(report){updatePosition();overview();}};
 app.addEventListener('view-change',event=>{if(event.detail!=='planning'){panel.hidden=true;layer.visible=false;label.hidden=true;hud.hidden=true;tooltip.hidden=true;pointer=null;voice.stop();playing=false;}});
 $('planning-back').onclick=()=>{app.dispatchEvent(new CustomEvent('view-change',{detail:'city'}));panel.hidden=true;cityPanel.hidden=false;app.classList.remove('equipment-mode');};
 $('planning-optimize').onclick=()=>{if(busy)return;voice.stop();playing=false;const current=sensors.getScenario();const settings={...structuredClone(DEFAULT_SETTINGS),scope:$('planning-scope').value,spacing:Number($('planning-spacing').value),maxDevices:Number($('planning-max-devices').value),budget:Number($('planning-budget').value),marginReserveDb:Number($('planning-reserve').value),costs:Object.fromEntries(['radar','radio','optical','acoustic'].map(type=>[type,Number($('planning-cost-'+type).value)]))};try{validateSettings(settings);}catch(error){setStatus(error.message);return;}busy=true;controlsEnabled();updateDiagnostics();setStatus('后台计算中，地图仍可操作。');getWorker().postMessage({type:'optimize',baseURL:new URL('./',location.href).href,settings,environment:current.environment,target:current.target});};
 $('planning-cancel').onclick=()=>{if(worker)worker.onmessage=null;worker?.terminate();worker=null;busy=false;if(lastCompleted){({report,plan}=lastCompleted);renderReport();installFlight(lastCompleted.flight);}setStatus('已取消，保留上次完成的方案。');controlsEnabled();updateDiagnostics();};
 $('planning-plan').onchange=()=>{plan=report.plans.find(p=>p.id===$('planning-plan').value);renderReport();simulate();};
 $('planning-condition').onchange=()=>{renderReport();simulate();};$('planning-height').onchange=()=>{renderReport();if(flight&&frameIndex>=0)acceptFrame(frameIndex);};$('planning-overview').onclick=overview;
 $('planning-apply').onclick=()=>{if(!report)return;const condition=scenarios(report.environment).find(c=>c.id===$('planning-condition').value);sensors.applyScenario({modelVersion:MODEL_VERSION,origin:report.origin,devices:plan.devices,target:{...report.target,...condition.target,position:interpolateRoute(report.route,time)},environment:condition.environment});};
 $('flight-play').onclick=()=>{if(!flight)return;if(time>=report.route.duration){time=0;tracker=new AlarmTracker();frameIndex=-1;acceptFrame(0);}playing=!playing;lastStamp=0;if(playing)speakCurrent(true);else voice.stop();$('flight-play').textContent=playing?'Ⅱ 暂停飞行':'▶ 继续飞行';updateDiagnostics();};
 $('flight-reset').onclick=()=>{if(!flight)return;voice.stop();playing=false;time=0;tracker=new AlarmTracker();frameIndex=-1;acceptFrame(0);updatePosition();$('flight-play').textContent='▶ 播放飞行';};
 $('flight-seek').oninput=()=>{if(!flight)return;voice.stop();time=Number($('flight-seek').value)/1000*report.route.duration;const index=time>=report.route.duration?flight.frames.length-1:Math.min(flight.frames.length-1,Math.floor(time/flight.interval));acceptFrame(index);updatePosition();};
 $('planning-export').onclick=()=>{const blob=new Blob([JSON.stringify({...report,activePlanId:plan.id,activeConditionId:$('planning-condition').value,activeFlight:flight,playback:{time,status:tracker.status,events:tracker.events}},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='zhengzhou-deployment-flight.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 function updateMarkers(stamp){
  const pulse=(Math.sin(stamp/1000*Math.PI*3)+1)/2;
  for(const mesh of deviceMeshes){const active=!busy&&detectedIds.has(mesh.userData.device.id);mesh.material.color.set(active?0xff675b:COLORS[mesh.userData.device.type]);mesh.scale.setScalar(active?1.15+pulse*.65:1);mesh.userData.halo.visible=active;mesh.userData.halo.material.opacity=.25+pulse*.7;mesh.userData.halo.quaternion.copy(camera.quaternion);}
  if(!pointer||panel.hidden){tooltip.hidden=true;return;}let picked=null,best=19;
  for(const mesh of deviceMeshes){const p=mesh.position.clone().project(camera);if(p.z<-1||p.z>1)continue;const x=(p.x+1)/2*view.clientWidth,y=(1-p.y)/2*view.clientHeight,d=Math.hypot(pointer.x-x,pointer.y-y);if(d<best){best=d;picked=mesh;}}
  tooltip.hidden=!picked;if(!picked)return;const d=picked.userData.device;tooltip.textContent=`${TYPES[d.type]} · ${d.name}\n${d.id}${detectedIds.has(d.id)&&!busy?'\n● 当前检出无人机 · 闪烁报警':''}`;tooltip.style.left=`${Math.max(8,Math.min(view.clientWidth-260,pointer.x+14))}px`;tooltip.style.top=`${Math.max(8,Math.min(view.clientHeight-90,pointer.y+14))}px`;
 }
 function update(stamp){if(panel.hidden)return;if(playing&&flight){if(lastStamp)time=Math.min(report.route.duration,time+Math.min(0.2,(stamp-lastStamp)/1000)*Number($('flight-speed').value));lastStamp=stamp;let index=Math.min(flight.frames.length-1,Math.floor(time/flight.interval));if(time>=report.route.duration)index=flight.frames.length-1;if(index!==frameIndex)acceptFrame(index);if(time>=report.route.duration){playing=false;$('flight-play').textContent='↺ 再次播放';setStatus('飞行结束，可回放或导出全部报警记录。');}updateDiagnostics();}else lastStamp=0;updatePosition();updateMarkers(stamp);if(playing&&!document.hidden&&!busy)speakCurrent();updateDiagnostics();}
 controlsEnabled();return {update};
}
