import * as THREE from 'three';
import {DEFAULT_SETTINGS,scenarios,validateSettings} from './optimizer.js';
import {AlarmTracker,interpolateRoute} from './flight.js';
import {validateReport,enrichReport} from './report.js';
import {MODEL_VERSION} from '../sensors/engine.js';
import {TYPES} from '../sensors/presets.js';
import {terrainSampler} from '../sensors/terrain-query.js';
import {flightTelemetry} from './telemetry.js';
import {createDroneMesh} from './drone-mesh.js';
import {createVoiceAlarm} from './voice.js';
import './ui.css';
const COLORS={radar:0x70d6ff,radio:0xb89aff,optical:0xffd783,acoustic:0x69e2bd};
const clock=t=>`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const percent=x=>`${(x*100).toFixed(1)}%`;
export function mountPlanningUI({app,city,scene,camera,controls,renderer,sensors,model,workspace,getSite,embedded=false,onActivate=null}){
 const panel=document.createElement('div');panel.id='planning-panel';panel.hidden=true;let active=false;
 panel.innerHTML=`
 <section><h2>方案优化</h2><label>优化范围<select id="planning-scope"><option value="city">全场景</option><option value="core">核心区周边 2.4 × 2.4 km</option></select></label>
 <div class="planning-inputs"><label>网格间距 / m<input id="planning-spacing" type="number" min="150" max="1000" step="50" value="500"></label><label>设备上限<input id="planning-max-devices" type="number" min="1" max="64" value="64"></label><label>预算 / 相对单位<input id="planning-budget" type="number" min="1" max="1000" value="600"></label><label>预留裕量 / dB<input id="planning-reserve" type="number" min="0" max="20" value="3"></label></div>
 <details><summary>相对设备成本</summary><div class="planning-inputs"><label>雷达<input id="planning-cost-radar" type="number" min="0.1" max="100" value="12"></label><label>无线电<input id="planning-cost-radio" type="number" min="0.1" max="100" value="5"></label><label>光电<input id="planning-cost-optical" type="number" min="0.1" max="100" value="4"></label><label>声学<input id="planning-cost-acoustic" type="number" min="0.1" max="100" value="2"></label></div></details>
 <div class="buttons"><button id="planning-optimize" class="primary">重新优化</button><button id="planning-cancel" disabled>取消计算</button></div><progress id="planning-progress" max="1" value="0"></progress><div id="planning-status" role="status">正在读取已计算示例…</div></section>
 <section><h2>方案比较</h2><select id="planning-plan" aria-label="部署方案"></select><div id="planning-comparison"></div><div id="planning-summary"></div><details><summary>计算详情</summary><div id="planning-calculation"></div></details>
 <label>覆盖工况<select id="planning-condition"><option value="nominal">基线 · 发射</option><option value="silent">无线电静默</option><option value="weather">雨雾及街道噪声</option><option value="interference">电磁干扰</option></select></label>
 <label>显示离地高度<select id="planning-height"><option value="30">30 m</option><option value="60" selected>60 m</option><option value="100">100 m</option></select></label><div class="planning-legend"><span>● 已覆盖采样</span><span>● 盲点</span><span>◎ 核心区</span></div>
 <div class="buttons"><button id="planning-overview">全域与轨迹</button><button id="planning-apply">到装备面板调整</button></div></section>
 <section><h2>示例航迹 · D-01</h2><div id="flight-alarm" class="alarm-clear">尚未播放</div><div id="flight-summary"></div>
 <div class="buttons"><button id="planning-play" class="primary">▶ 播放飞行</button><button id="planning-reset">↺ 回到起点</button></div>
 <label>播放速度<select id="planning-speed"><option value="1">1× 实时</option><option value="10" selected>10×</option><option value="30">30×</option><option value="60">60×</option></select></label>
 <input id="planning-seek" type="range" min="0" max="1000" value="0" aria-label="飞行进度">
 <div id="flight-clock">00:00 / 00:00</div><div id="flight-detections"></div></section>
 <section><h2>报警记录</h2><ol id="flight-events"></ol></section>
 <details><summary>设备清单与部署依据</summary><div id="planning-devices"></div><p class="hint" title="点位按采样覆盖、相对成本与安装指标筛选；安装姿态与频道分组为模型假设。">安装条件待现场核验。</p></details>
 <section class="planning-io"><button id="planning-export">导出方案、覆盖与报警报告 ↓</button></section>`;
 if(!embedded)workspace.mountSidebarPanel(panel,'planning');const $=id=>panel.querySelector('#'+id);
 const button=app.querySelector('#toggle-planning');
 const layer=new THREE.Group();layer.name='Deployment_and_Flight';layer.visible=false;scene.add(layer);
 const label=document.createElement('div');label.id='flight-label';label.hidden=true;renderer.domElement.parentElement.append(label);
 const view=renderer.domElement.parentElement,voice=createVoiceAlarm();let groundAt=terrainSampler(model.ground.geometry);
 const tooltip=document.createElement('div');tooltip.id='planning-device-tooltip';tooltip.hidden=true;tooltip.setAttribute('role','tooltip');view.append(tooltip);
 const hud=document.createElement('section');hud.id='flight-hud';
 hud.innerHTML=`<div class="ac8-flight-block"><span class="ac8-flight-label">[目标]</span><div class="ac8-flight-target"><span id="flight-name">无人机 D-01</span><strong id="flight-live-state">待命</strong></div></div><div class="ac8-flight-block"><span class="ac8-flight-label">[高度]</span><div class="ac8-flight-value"><span id="flight-agl">—</span><small>m</small></div></div><div class="ac8-flight-block"><span class="ac8-flight-label">[坐标]</span><div id="flight-coordinates">—</div></div><div class="ac8-flight-actions"><button id="flight-track" type="button" aria-pressed="false">跟踪无人机</button><button id="flight-voice" type="button" aria-pressed="false">开启语音报警</button></div><div id="flight-voice-status" role="status">语音关闭</div>`;
 view.append(hud);
 const h=id=>hud.querySelector('#'+id);let deviceMeshes=[],detectedIds=new Set(),pointer=null,telemetry=null;
 h('flight-voice').disabled=!voice.supported;h('flight-voice-status').textContent=voice.supported?'语音关闭':'当前浏览器不支持语音合成';
 window.addEventListener('flight-voice-error',()=>{h('flight-voice-status').textContent='语音播放失败，请检查系统中文语音与浏览器声音设置';});
 function speakCurrent(force=false){if(!telemetry)return;const state=tracker.status==='alarm'?'发现无人机':tracker.status==='coasting'?'无人机信号暂失，正在确认':'无人机当前未检出';voice.announce(tracker.status,`${state}，目标 D 零一。${telemetry.agl===null?'':`离地高度 ${Math.round(telemetry.agl)} 米。`}东经 ${telemetry.longitude.toFixed(4)}，北纬 ${telemetry.latitude.toFixed(4)}。`,{force});}
 h('flight-voice').onclick=()=>{const enabled=voice.setEnabled(!voice.enabled);h('flight-voice').setAttribute('aria-pressed',String(enabled));h('flight-voice').textContent=enabled?'关闭语音报警':'开启语音报警';h('flight-voice-status').textContent=enabled?'语音已启用':'语音关闭';if(enabled&&flight&&!busy)speakCurrent(true);};
 view.addEventListener('pointermove',event=>{const rect=view.getBoundingClientRect();pointer={x:event.clientX-rect.left,y:event.clientY-rect.top};});view.addEventListener('pointerleave',()=>{pointer=null;tooltip.hidden=true;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)voice.stop();});
 let report=null,plan=null,flight=null,worker=null,busy=false,playing=false,time=0,lastStamp=0,frameIndex=-1,tracker=new AlarmTracker(),drone=null,coverageMesh=null,alarmLines=null,loadPromise=null,lastCompleted=null,speed=10;
 let hudRetracted=false,hudRetractTimer=null;
 let tracking=false,cameraTween=null,lastFollowStamp=0,trailMesh=null,trailPositions=null,trailUvs=null,trailTexture=null;
 const TRAIL_MAX=110,TRAIL_DISTANCE=1000;
 const setStatus=text=>{$('planning-status').textContent=text;};
 function destroyLayer(){stopTracking();cancelCameraTween();for(const child of [...layer.children]){child.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});layer.remove(child);}drone=null;trailMesh=null;trailPositions=null;trailUvs=null;coverageMesh=null;alarmLines=null;deviceMeshes=[];tooltip.hidden=true;}
 function line(points,color,opacity=1){const mesh=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity}));layer.add(mesh);return mesh;}
 function trailGradient(){
  if(trailTexture)return trailTexture;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=2;const ctx=canvas.getContext('2d');
  const gradient=ctx.createLinearGradient(0,0,256,0);
  gradient.addColorStop(0,'rgba(255,52,32,1)');
  gradient.addColorStop(.3,'rgba(255,245,240,.92)');
  gradient.addColorStop(.58,'rgba(255,255,255,.5)');
  gradient.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,256,2);
  trailTexture=new THREE.CanvasTexture(canvas);
  trailTexture.colorSpace=THREE.SRGBColorSpace;
  trailTexture.minFilter=THREE.LinearFilter;trailTexture.magFilter=THREE.LinearFilter;
  return trailTexture;
 }
 function createTrail(){
  trailPositions=new Float32Array(TRAIL_MAX*2*3);trailUvs=new Float32Array(TRAIL_MAX*2*2);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(trailPositions,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(trailUvs,2));
  const indices=[];for(let i=0;i<TRAIL_MAX-1;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  geometry.setIndex(indices);geometry.setDrawRange(0,0);
  trailMesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:trailGradient(),transparent:true,depthWrite:false,depthTest:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false}));
  trailMesh.frustumCulled=false;trailMesh.renderOrder=58;layer.add(trailMesh);
 }
 function refreshTrail(){
  if(!trailMesh||!report?.route||!drone||time<=0){trailMesh?.geometry.setDrawRange(0,0);return;}
  const route=report.route,current=new THREE.Vector3().fromArray(interpolateRoute(route,time));
  const samples=[current.clone()];
  const step=Math.max(.4,route.duration/180);
  for(let t=time-step;t>0&&samples.length<TRAIL_MAX;t-=step){
   const point=new THREE.Vector3().fromArray(interpolateRoute(route,t));
   if(point.distanceTo(current)>TRAIL_DISTANCE)break;
   samples.push(point);
  }
  if(samples.length<2){trailMesh.geometry.setDrawRange(0,0);return;}
  const up=new THREE.Vector3(0,1,0),width=14,count=samples.length;
  for(let i=0;i<count;i++){
   const direction=(i===0?samples[0].clone().sub(samples[1]):samples[i-1].clone().sub(samples[i]));
   if(direction.lengthSq()<1e-8)direction.set(1,0,0);
   direction.normalize();
   const side=new THREE.Vector3().crossVectors(direction,up);
   if(side.lengthSq()<1e-8)side.set(1,0,0);
   side.normalize().multiplyScalar(width/2);
   const left=samples[i].clone().add(side),right=samples[i].clone().sub(side),offset=i*6,uvOffset=i*4;
   trailPositions[offset]=left.x;trailPositions[offset+1]=left.y;trailPositions[offset+2]=left.z;
   trailPositions[offset+3]=right.x;trailPositions[offset+4]=right.y;trailPositions[offset+5]=right.z;
   const u=i/(count-1);trailUvs[uvOffset]=u;trailUvs[uvOffset+1]=0;trailUvs[uvOffset+2]=u;trailUvs[uvOffset+3]=1;
  }
  trailMesh.geometry.attributes.position.needsUpdate=true;
  trailMesh.geometry.attributes.uv.needsUpdate=true;
  trailMesh.geometry.setDrawRange(0,(count-1)*6);
 }
 function stopTracking(){
  if(!tracking)return;
  tracking=false;controls.enabled=true;
  const button=h('flight-track');if(button){button.textContent='跟踪无人机';button.setAttribute('aria-pressed','false');}
 }
 function cancelCameraTween(){
  if(cameraTween){cancelAnimationFrame(cameraTween);cameraTween=null;}
 }
 function animateCamera(position,target,duration=850){
  cancelCameraTween();stopTracking();
  const fromPosition=camera.position.clone(),fromTarget=controls.target.clone();
  const start=performance.now();
  controls.enabled=false;
  const step=now=>{
   const t=Math.min(1,(now-start)/duration),e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
   camera.position.lerpVectors(fromPosition,position,e);
   controls.target.lerpVectors(fromTarget,target,e);
   controls.update();
   if(t<1)cameraTween=requestAnimationFrame(step);
   else{cameraTween=null;controls.enabled=!tracking;}
  };
  cameraTween=requestAnimationFrame(step);
 }
 function startTracking(){
  if(!drone||!report)return;
  stopTracking();cancelCameraTween();
  tracking=true;controls.enabled=false;lastFollowStamp=0;
  const button=h('flight-track');if(button){button.textContent='停止跟踪';button.setAttribute('aria-pressed','true');}
 }
 function toggleTracking(){if(tracking)stopTracking();else startTracking();}
 function followCamera(stamp){
  if(!tracking||!drone||!report)return;
  const delta=lastFollowStamp?Math.min(.12,(stamp-lastFollowStamp)/1000):.016;lastFollowStamp=stamp;
  const current=drone.position.clone();
  const ahead=interpolateRoute(report.route,Math.min(report.route.duration,time+Math.max(.4,report.route.duration/400)));
  const forward=new THREE.Vector3(...ahead).sub(current);
  if(forward.lengthSq()<1e-8)forward.set(1,0,0);
  forward.normalize();
  const up=new THREE.Vector3(0,1,0);
  const side=new THREE.Vector3().crossVectors(forward,up).normalize();
  const desired=current.clone().add(forward.clone().multiplyScalar(-750)).add(up.clone().multiplyScalar(480)).add(side.multiplyScalar(510));
  camera.position.lerp(desired,Math.min(1,delta*3.2));
  controls.target.lerp(current,Math.min(1,delta*5));
  camera.lookAt(controls.target);
 }
 h('flight-track').onclick=toggleTracking;
 function draw(){
  destroyLayer();if(!report||!plan)return;
  line(report.route.points.map(p=>p.position),0xc6dbe3,0.65);
  const bounds=report.sampling.bounds,corePoints=[];for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;corePoints.push([bounds.core[0]+Math.cos(a)*report.settings.coreRadius,bounds.core[1]+8,bounds.core[2]+Math.sin(a)*report.settings.coreRadius]);}line(corePoints,0xffd783,0.7);
  for(const d of plan.devices){const mesh=new THREE.Mesh(new THREE.SphereGeometry(25,10,7),new THREE.MeshBasicMaterial({color:COLORS[d.type],depthTest:false}));mesh.position.fromArray(d.position);mesh.userData.device=d;const halo=new THREE.Mesh(new THREE.RingGeometry(35,44,24),new THREE.MeshBasicMaterial({color:0xffc36b,transparent:true,opacity:0.8,depthTest:false,side:THREE.DoubleSide}));halo.visible=false;mesh.add(halo);mesh.userData.halo=halo;layer.add(mesh);deviceMeshes.push(mesh);}
  const h=Number($('planning-height').value),c=report.conditions.findIndex(x=>x.id===$('planning-condition').value);
  const samples=report.sampling.samples.map((p,j)=>({p,j})).filter(({p})=>p.agl===h);
  coverageMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(16,6,4),new THREE.MeshBasicMaterial({depthTest:false,transparent:true,opacity:0.75}),samples.length);
  const matrix=new THREE.Matrix4(),color=new THREE.Color();samples.forEach(({p,j},i)=>{matrix.makeTranslation(...p.position);coverageMesh.setMatrixAt(i,matrix);coverageMesh.setColorAt(i,color.set(plan.coverage[c][j]>0?0x69e2bd:0xff776d));});layer.add(coverageMesh);
  drone=createDroneMesh();drone.scale.setScalar(4.5);
  layer.add(drone);createTrail();updatePosition();updateDiagnostics();
 }
 function metric(parent,title,value){const row=document.createElement('div');row.className='sensor-metric';const span=document.createElement('span'),strong=document.createElement('strong');span.textContent=title;strong.textContent=value;row.append(span,strong);parent.append(row);}
 function renderReport(){
  $('planning-plan').replaceChildren(...report.plans.map(p=>new Option(`${p.name} · ${p.devices.length} 台`,p.id,false,p.id===plan.id)));
  $('planning-comparison').replaceChildren();for(const p of report.plans)metric($('planning-comparison'),`${p.name} / ${p.devices.length} 台`,`${percent(p.metrics[0].coverageRate)} · 成本 ${p.cost.toFixed(1)}`);
  $('planning-summary').replaceChildren();$('planning-calculation').replaceChildren();const c=report.conditions.findIndex(x=>x.id===$('planning-condition').value),m=plan.metrics[c];
  metric($('planning-summary'),'当前工况采样覆盖',`${m.covered} / ${m.total} · ${percent(m.coverageRate)}`);metric($('planning-summary'),'采样盲区占比',percent(m.blindRate));metric($('planning-summary'),'核心区采样覆盖',percent(m.coreCoverageRate));const area=plan.areaEstimates?.[$('planning-condition').value]?.find(a=>a.height===Number($('planning-height').value));if(area)metric($('planning-summary'),'当前高度层网格盲区近似面积',`${(area.approximateBlindAreaMeters2/1e6).toFixed(2)} km²`);metric($('planning-calculation'),'已检查候选 / 有效采样',`${report.candidateCount} / ${report.sampling.samples.length}`);
  metric($('planning-calculation'),'DEM 空缺 / 建筑内部排除',`${report.sampling.excluded.outsideDem} / ${report.sampling.excluded.insideBuildings}`);
  metric($('planning-summary'),'EMC 代理冲突',`${plan.emc.conflicts.length} 对`);
  $('planning-devices').replaceChildren();for(const device of plan.devices){const b=document.createElement('button');b.className='planning-device';b.textContent=`${TYPES[device.type]} · ${device.id} / 东 ${device.position[0].toFixed(0)} 北 ${(-device.position[2]).toFixed(0)}`;b.onclick=()=>focus(device.position,700);$('planning-devices').append(b);}
  draw();controlsEnabled();
 }
 function focus(position,span){
  const target=new THREE.Vector3(...position);
  const cameraPosition=target.clone().add(new THREE.Vector3(span*.55,span*.9,span*.75));
  animateCamera(cameraPosition,target,850);
 }
 function overview(){if(!report)return;const b=report.sampling.bounds,span=Math.max(b.east-b.west,b.north-b.south);focus([(b.east+b.west)/2,150,(b.south+b.north)/2],span);}
 function controlsEnabled(){for(const id of ['planning-optimize','planning-plan','planning-condition','planning-apply','planning-export'])$(id).disabled=busy||(!report&&id!=='planning-optimize');$('planning-cancel').disabled=!busy;$('planning-play').disabled=busy;$('planning-reset').disabled=busy||!flight;$('planning-seek').disabled=busy||!flight;}
 function updateDiagnostics(){const play=$('planning-play');if(play)play.textContent=playing?'Ⅱ 暂停飞行':report?.route?.duration&&time>=report.route.duration?'↺ 再次播放':time>0?'▶ 继续飞行':'▶ 播放飞行';const seek=$('planning-seek');if(seek&&document.activeElement!==seek)seek.value=String(report?.route?.duration?time/report.route.duration*1000:0);const speedSelect=$('planning-speed');if(speedSelect&&Number(speedSelect.value)!==speed)speedSelect.value=String(speed);window.planningDiagnostics={ready:!!report,busy,planId:plan?.id,condition:$('planning-condition').value,deviceCount:plan?.devices.length??0,sampleCount:report?.sampling.samples.length??0,coverageRate:plan?.metrics[report?.conditions.findIndex(c=>c.id===$('planning-condition').value)]?.coverageRate,playing,time,speed,duration:report?.route.duration??0,tracking,cameraPosition:camera.position.toArray(),targetPosition:controls.target.toArray(),telemetry,voiceEnabled:voice.enabled,markers:deviceMeshes.map(mesh=>{const p=mesh.position.clone().project(camera);return {id:mesh.userData.device.id,type:mesh.userData.device.type,name:mesh.userData.device.name,x:(p.x+1)/2*view.clientWidth,y:(1-p.y)/2*view.clientHeight,visible:p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1,alarming:detectedIds.has(mesh.userData.device.id),scale:mesh.scale.x};}),alarm:tracker.status,frameIndex,eventCount:tracker.events.length,detectedIds:frameIndex>=0?flight?.frames[frameIndex]?.detections.map(d=>d.id)??[]:[]};}
 function acceptFrame(index){
  if(!flight)return;if(index<frameIndex){tracker=new AlarmTracker();frameIndex=-1;}
  while(frameIndex<index){frameIndex++;tracker.accept(flight.frames[frameIndex]);}
  const frame=flight.frames[frameIndex];detectedIds=new Set(frame.detections.map(d=>d.id));$('flight-alarm').className=`alarm-${tracker.status}`;$('flight-alarm').textContent=tracker.status==='alarm'?'● 报警 · 已检出无人机':tracker.status==='coasting'?'◌ 丢失确认中 · 当前帧未检出':'○ 未检出 · 当前模型帧';
  $('flight-detections').replaceChildren();for(const d of frame.detections)metric($('flight-detections'),`${TYPES[d.type]} ${d.id}`,`裕量 ${d.marginDb.toFixed(1)} dB`);
  if(!frame.detections.length)$('flight-detections').textContent='无设备在当前帧满足感知条件。';
  $('flight-events').replaceChildren(...tracker.events.slice(-30).reverse().map(event=>{const li=document.createElement('li');li.textContent=`${clock(event.time)} ${event.message}${event.deviceIds?` · ${event.deviceIds.length} 台设备`:''}`;return li;}));
  if(alarmLines){alarmLines.geometry.dispose();alarmLines.material.dispose();layer.remove(alarmLines);alarmLines=null;}
  if(frame.detections.length){const points=[];for(const d of frame.detections){const device=plan.devices.find(x=>x.id===d.id);points.push(device.position,frame.position);}alarmLines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:0x5cff9d,transparent:true,opacity:.95,depthTest:false,blending:THREE.AdditiveBlending,toneMapped:false}));alarmLines.renderOrder=56;layer.add(alarmLines);}
  updateDiagnostics();
 }
 function restoreHud(){hudRetracted=false;if(hudRetractTimer){clearTimeout(hudRetractTimer);hudRetractTimer=null;}}
 function scheduleHudRetract(){if(hudRetractTimer)clearTimeout(hudRetractTimer);hudRetractTimer=setTimeout(()=>{hudRetractTimer=null;hudRetracted=true;updatePosition();},1500);}
 function updatePosition(){
  if(!report||!drone)return;
  const position=interpolateRoute(report.route,time);
  drone.position.fromArray(position);
  const ahead=interpolateRoute(report.route,Math.min(report.route.duration,time+Math.max(.3,report.route.duration/500)));
  const direction=new THREE.Vector3(...ahead).sub(drone.position);
  if(direction.lengthSq()>1e-8)drone.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction.normalize());
  refreshTrail();
  const p=drone.position.clone();p.y+=85;camera.updateMatrixWorld();p.project(camera);label.hidden=!active||hudRetracted||p.z<-1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;
  const view=renderer.domElement.parentElement;label.style.left=`${(p.x+1)/2*view.clientWidth}px`;label.style.top=`${(1-p.y)/2*view.clientHeight}px`;telemetry=flightTelemetry(drone.position.toArray(),city.metadata.ecefTransform,groundAt);const agl=telemetry.agl===null?'未知':telemetry.agl.toFixed(1);label.textContent=`◎ D-01 · ${tracker.status==='alarm'?'报警':tracker.status==='coasting'?'确认中':'未检出'} · 离地 ${agl} m`;h('flight-agl').textContent=agl;h('flight-coordinates').textContent=`东经 ${telemetry.longitude.toFixed(6)}° · 北纬 ${telemetry.latitude.toFixed(6)}°`;h('flight-live-state').textContent=busy?'正在重算':tracker.status==='alarm'?'已检出 · 报警':tracker.status==='coasting'?'信号确认中':'未检出';h('flight-track').disabled=!drone;hud.dataset.alarm=busy?'clear':tracker.status;hud.classList.toggle('is-visible',!!active&&!hudRetracted);label.dataset.alarm=tracker.status;
  $('flight-clock').textContent=`${clock(time)} / ${clock(report.route.duration)}`;
 }
 function installFlight(value){voice.stop();$('planning-progress').value=1;flight=value;time=0;playing=false;tracker=new AlarmTracker();frameIndex=-1;$('flight-summary').replaceChildren();metric($('flight-summary'),'轨迹采样检出比例',percent(flight.summary.detectedFraction));metric($('flight-summary'),'首报 / 失联事件',`${flight.summary.firstDetectionTime===null?'未检出':clock(flight.summary.firstDetectionTime)} / ${flight.summary.lossEvents} 次`);metric($('flight-summary'),'仿真速度 / 计算步长',`${report.route.speed} m/s / ${flight.interval} s`);acceptFrame(0);updatePosition();controlsEnabled();lastCompleted={report,plan,flight};}
 function setReport(value){report=enrichReport(validateReport(value,city),city);plan=report.plans.find(p=>p.id===report.selectedId);busy=false;renderReport();installFlight(report.flight);if(active)overview();setStatus(`已载入方案 · ${plan.devices.length} 台设备`);}
 function getWorker(){if(worker)return worker;worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{if(data.type==='progress'){$('planning-progress').value=data.value.total?data.value.completed/data.value.total:0;setStatus(`${data.value.stage==='matrix'?'评估候选覆盖':data.value.stage==='repair'?'为盲点补充候选':'计算飞行报警'} ${data.value.completed}/${data.value.total}`);}else if(data.type==='report'){try{setReport(data.report);}catch(error){fail(error.message);}}else if(data.type==='flight'){busy=false;installFlight(data.flight);setStatus('所选方案与工况的飞行报警已重算。');}else if(data.type==='error')fail(data.message);};
  worker.onerror=event=>fail(event.message||'后台计算失败');return worker;
 }
 function fail(text){voice.stop();worker?.terminate();worker=null;busy=false;playing=false;if(lastCompleted){({report,plan}=lastCompleted);renderReport();installFlight(lastCompleted.flight);}setStatus(`计算失败：${text}。保留上次已完成方案。`);controlsEnabled();updateDiagnostics();}
 function simulate(){if(!report)return;voice.stop();detectedIds.clear();playing=false;busy=true;flight=null;controlsEnabled();updateDiagnostics();const condition=scenarios(report.environment).find(c=>c.id===$('planning-condition').value);setStatus('正在重算当前方案的轨迹报警…');getWorker().postMessage({type:'simulate',site:getSite?.()??null,baseURL:new URL('./',location.href).href,devices:plan.devices,route:report.route,target:{...report.target,...condition.target},environment:condition.environment,core:report.sampling.bounds.core,coreRadius:report.settings.coreRadius});}
 async function loadExample(){
  try{const response=await fetch('./deployment-example.json');if(!response.ok)throw Error('示例文件不可用，可点击重新优化');const value=await response.json();if(!busy&&!report)setReport(value);}
  catch(error){setStatus(error.message);controlsEnabled();updateDiagnostics();}
 }
 function loadInitial(){
  if(getSite?.()){if(report){updatePosition();overview();}else setStatus('当前场景请点击“重新优化”生成部署方案。');}
  else if(!loadPromise)loadPromise=loadExample();
  else if(report){updatePosition();overview();}
 }
 function setActive(value){
  const next=!!value;
  if(next&&!active){active=true;panel.hidden=false;layer.visible=true;restoreHud();loadInitial();}
  else if(!next&&active){active=false;panel.hidden=true;layer.visible=false;label.hidden=true;hud.classList.remove('is-visible');tooltip.hidden=true;pointer=null;voice.stop();playing=false;lastStamp=0;stopTracking();cancelCameraTween();}
  updateDiagnostics();
 }
 function activate(){
  if(!active){
   if(onActivate)onActivate();else if(!embedded)workspace.activateView('planning');
   active=true;layer.visible=true;panel.hidden=false;
  }
  loadInitial();
 }
 button?.addEventListener('click',activate);
 if(!embedded)app.addEventListener('view-change',event=>{if(event.detail!=='planning')setActive(false);});
 for(const type of ['pointerdown','focusin'])panel.addEventListener(type,()=>{if(!active)activate();},true);
 $('planning-optimize').onclick=()=>{if(busy)return;voice.stop();playing=false;const current=sensors.getScenario();const settings={...structuredClone(DEFAULT_SETTINGS),scope:$('planning-scope').value,spacing:Number($('planning-spacing').value),maxDevices:Number($('planning-max-devices').value),budget:Number($('planning-budget').value),marginReserveDb:Number($('planning-reserve').value),costs:Object.fromEntries(['radar','radio','optical','acoustic'].map(type=>[type,Number($('planning-cost-'+type).value)]))};try{validateSettings(settings);}catch(error){setStatus(error.message);return;}busy=true;controlsEnabled();updateDiagnostics();setStatus('后台计算中，地图仍可操作。');getWorker().postMessage({type:'optimize',site:getSite?.()??null,baseURL:new URL('./',location.href).href,settings,environment:current.environment,target:current.target});};
 $('planning-cancel').onclick=()=>{if(worker)worker.onmessage=null;worker?.terminate();worker=null;busy=false;if(lastCompleted){({report,plan}=lastCompleted);renderReport();installFlight(lastCompleted.flight);}setStatus('已取消，保留上次完成的方案。');controlsEnabled();updateDiagnostics();};
 $('planning-plan').onchange=()=>{plan=report.plans.find(p=>p.id===$('planning-plan').value);renderReport();simulate();};
 $('planning-condition').onchange=()=>{renderReport();simulate();};$('planning-height').onchange=()=>{renderReport();if(flight&&frameIndex>=0)acceptFrame(frameIndex);};$('planning-overview').onclick=overview;
 $('planning-apply').onclick=()=>{if(!report)return;const condition=scenarios(report.environment).find(c=>c.id===$('planning-condition').value);sensors.applyScenario({modelVersion:MODEL_VERSION,origin:report.origin,devices:plan.devices,target:{...report.target,...condition.target,position:interpolateRoute(report.route,time)},environment:condition.environment});};
 function setSpeed(value){speed=Math.max(1,Number(value)||10);updateDiagnostics();}
 function setProgress(value){
  if(!flight||!report)return;
  voice.stop();restoreHud();
  time=Math.max(0,Math.min(1,Number(value)/1000))*report.route.duration;
  const index=time>=report.route.duration?flight.frames.length-1:Math.min(flight.frames.length-1,Math.floor(time/flight.interval));
  acceptFrame(index);updatePosition();updateDiagnostics();
 }
 $('planning-play').onclick=()=>{if(playing)pauseSimulation();else startSimulation();};
 $('planning-reset').onclick=()=>{if(!flight)return;voice.stop();playing=false;lastStamp=0;time=0;tracker=new AlarmTracker();frameIndex=-1;restoreHud();acceptFrame(0);updatePosition();updateDiagnostics();};
 $('planning-speed').onchange=()=>setSpeed(Number($('planning-speed').value));
 $('planning-seek').oninput=()=>setProgress(Number($('planning-seek').value));
 async function startSimulation(){
  if(busy)return false;
  if(!active){activate();if(report)overview();}
  if(!report){
   if(getSite?.()){setStatus('当前场景请先打开推演部署并点击“重新优化”。');return false;}
   if(!loadPromise)loadPromise=loadExample();
   await loadPromise;
  }
  if(!flight)return false;
  if(time>=report.route.duration){time=0;tracker=new AlarmTracker();frameIndex=-1;acceptFrame(0);}
  playing=true;lastStamp=0;speakCurrent(true);updateDiagnostics();
  return true;
 }
 function pauseSimulation(){playing=false;lastStamp=0;voice.stop();updateDiagnostics();}
 function toggleSimulation(){if(playing)pauseSimulation();else startSimulation();}
 function getPlayback(){return {enabled:!!flight,playing,time,duration:report?.route.duration??0,speed,busy};}
 function getSimulationResult(){
  if(!report||!plan||!flight)return null;
  const conditionId=$('planning-condition').value,index=report.conditions.findIndex(c=>c.id===conditionId);
  const metrics=plan.metrics[index]??plan.metrics[0],condition=report.conditions[index]??report.conditions[0],summary=flight.summary;
  return {
   planId:plan.id,planName:plan.name,conditionId:condition?.id??conditionId,conditionName:condition?.name??conditionId,
   deviceCount:plan.devices.length,cost:plan.cost,
   coverageRate:metrics?.coverageRate,blindRate:metrics?.blindRate,coreCoverageRate:metrics?.coreCoverageRate,sampleCount:metrics?.total,
   detectedFraction:summary.detectedFraction,firstDetectionTime:summary.firstDetectionTime,lossEvents:summary.lossEvents,
   routeDuration:report.route?.duration??0,speed,createdAt:Date.now(),
  };
 }
 $('planning-export').onclick=()=>{const blob=new Blob([JSON.stringify({...report,activePlanId:plan.id,activeConditionId:$('planning-condition').value,activeFlight:flight,playback:{time,status:tracker.status,events:tracker.events}},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='zhengzhou-deployment-flight.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 function updateMarkers(stamp){
  const pulse=(Math.sin(stamp/1000*Math.PI*3)+1)/2;
  for(const mesh of deviceMeshes){const active=!busy&&detectedIds.has(mesh.userData.device.id);mesh.material.color.set(active?0xff675b:COLORS[mesh.userData.device.type]);mesh.scale.setScalar(active?1.15+pulse*.65:1);mesh.userData.halo.visible=active;mesh.userData.halo.material.opacity=.25+pulse*.7;mesh.userData.halo.quaternion.copy(camera.quaternion);}
  if(!pointer||!active){tooltip.hidden=true;return;}let picked=null,best=19;
  for(const mesh of deviceMeshes){const p=mesh.position.clone().project(camera);if(p.z<-1||p.z>1)continue;const x=(p.x+1)/2*view.clientWidth,y=(1-p.y)/2*view.clientHeight,d=Math.hypot(pointer.x-x,pointer.y-y);if(d<best){best=d;picked=mesh;}}
  tooltip.hidden=!picked;if(!picked)return;const d=picked.userData.device;tooltip.textContent=`${TYPES[d.type]} · ${d.name}\n${d.id}${detectedIds.has(d.id)&&!busy?'\n● 当前检出无人机 · 闪烁报警':''}`;tooltip.style.left=`${Math.max(8,Math.min(view.clientWidth-260,pointer.x+14))}px`;tooltip.style.top=`${Math.max(8,Math.min(view.clientHeight-90,pointer.y+14))}px`;
 }
 function update(stamp){if(!active)return;for(const rotor of drone?.userData.rotors??[])rotor.rotation.y+=0.42;if(playing&&flight){if(lastStamp)time=Math.min(report.route.duration,time+Math.min(0.2,(stamp-lastStamp)/1000)*speed);lastStamp=stamp;let index=Math.min(flight.frames.length-1,Math.floor(time/flight.interval));if(time>=report.route.duration)index=flight.frames.length-1;if(index!==frameIndex)acceptFrame(index);if(time>=report.route.duration&&playing){playing=false;setStatus('飞行结束，可回放或导出全部报警记录。');scheduleHudRetract();}updateDiagnostics();}else lastStamp=0;updatePosition();followCamera(stamp);updateMarkers(stamp);if(playing&&!document.hidden&&!busy)speakCurrent();updateDiagnostics();}
 function setScene(site){report=null;plan=null;flight=null;lastCompleted=null;loadPromise=null;busy=false;playing=false;stopTracking();cancelCameraTween();hud.classList.remove('is-visible');destroyLayer();groundAt=site?()=>0:terrainSampler(model.ground.geometry);setStatus(site?'当前场景请点击“重新优化”生成部署方案。':'正在读取已计算示例…');updateDiagnostics();}
 controlsEnabled();return {update,panel,setActive,setScene,startSimulation,pauseSimulation,toggleSimulation,setSpeed,setProgress,getPlayback,getSimulationResult};
}
