import * as THREE from 'three';
import {catalogFields,defaultProfile} from '../sensors/equipment-catalog.js';
import {catalogModel} from '../sensors/equipment-models.js';
import {validateEnvironment,validateTarget} from '../sensors/engine.js';
import {demoDefaults} from '../sensors/equipment-demo-model.js';
import {createSceneQuery} from '../sensors/scene.js';
import {DEMO_MAX_ACTIVE,DEMO_MIN_SEPARATION_M,DEMO_START_COOLDOWN_MS,DEMO_MAX_SAMPLES,deviceDemoStartDecision} from '../sensors/equipment-demo-limits.js';
import {createEquipmentDemoSession,prepareEquipmentDemoRun,DEMO_GRADIENT,DEMO_PROBE_INSTRUCTION,
 demoMetricLabel,renderDemoLegend,renderDemoRows,demoSampleMessage} from '../sensors/equipment-demo-session.js';

export function prepareDeploymentDemoInputs(device,report){
 if(!device||!report)throw Error('当前方案未提供该设备');
 if(catalogModel(device.presetId).catalogOnly)throw Error('此型号没有可复用的感知仿真模型');
 if(!report.environment||!report.target)throw Error('本轮方案缺少环境或目标参数');
 validateEnvironment(report.environment);validateTarget(report.target);
 const profile=defaultProfile(device.presetId);
 if(profile.type!==device.type)throw Error('当前设备型号与类型不一致');
 const fields=catalogFields(device.presetId),saved=report.equipmentSnapshot?.profiles?.find(item=>item.presetId===device.presetId);
 for(const scope of ['parameters','physics'])for(const key of Object.keys(profile[scope])){
  const value=Object.hasOwn(device[scope]??{},key)?device[scope][key]:saved?.[scope]?.[key];
  const field=fields[`${scope}.${key}`];
  if(value==null&&!field.nullable)throw Error(`该设备缺少${field.label}`);
  profile[scope][key]=value??null;
 }
 if(saved?.working)profile.working=structuredClone(saved.working);
 const settings=demoDefaults(profile),{heading,pitch}=device.parameters??{};
 if(Number.isFinite(heading))settings.heading=(heading%360+360)%360;
 if(Number.isFinite(pitch))settings.pitch=pitch;
 return {profile,settings,position:device.position,scenario:{environment:report.environment,target:report.target}};
}

export function createTask3DeviceDemo({host,scene,camera,controls,renderer,getActiveModel,getInputs,focus,holdLayers,toast,onChange}){
 const group=new THREE.Group();group.name='Task3_Device_Demonstration';group.visible=false;scene.add(group);
 const canvas=renderer.domElement,session=createEquipmentDemoSession({group,renderer,scene,camera});
 const hud=document.createElement('section');hud.id='task3-device-demo';hud.hidden=true;hud.setAttribute('aria-label','方案设备仿真');
 hud.innerHTML=`
  <div class="demo-hud-heading"><strong></strong><span class="demo-kind"></span></div>
  <div class="demo-hud-metric"></div><div class="demo-colorbar"></div><div class="demo-scale"></div>
  <p class="task3-demo-status" role="status"></p>
  <div class="demo-hover"><div class="demo-hover-title">探针读数</div><div class="task3-demo-hint"></div><dl class="task3-demo-values"></dl></div>
  <div class="demo-hud-actions"><button type="button" data-stop>停止仿真</button><button type="button" data-close>关闭</button></div>`;
 host.append(hud);hud.querySelector('.demo-colorbar').style.background=DEMO_GRADIENT;
 const status=hud.querySelector('.task3-demo-status'),hint=hud.querySelector('.task3-demo-hint'),rows=hud.querySelector('dl');
 let active=null,savedView=null,restoreLayers=null,lastStart=-Infinity,starts=0,disposals=0,statusKey='stopped';
 let listenerScope=null,pointer=null,probeDirty=false,lastProbe=0,modelCache=null,queries=new Map();

 function resetProbe(text=DEMO_PROBE_INSTRUCTION){
  hint.textContent=text;rows.replaceChildren();
  if(active)active.probe=null;
 }
 const pointerAt=event=>{pointer={x:event.clientX,y:event.clientY};probeDirty=true;};
 const pointerGone=()=>{pointer=null;probeDirty=false;resetProbe();onChange?.();};
 const trackCamera=()=>{if(pointer)probeDirty=true;};
 function listen(){
  listenerScope=new AbortController();
  const options={signal:listenerScope.signal,passive:true};
  canvas.addEventListener('pointermove',pointerAt,options);
  canvas.addEventListener('pointerup',pointerAt,options);
  canvas.addEventListener('pointerleave',pointerGone,options);
  controls.addEventListener('change',trackCamera);
 }
 function release(){
  if(!active)return;
  session.stop();active=null;group.visible=false;disposals++;
  listenerScope?.abort();listenerScope=null;controls.removeEventListener('change',trackCamera);
  pointer=null;probeDirty=false;resetProbe();
 }
 function stop(){
  if(!active)return;
  release();hud.hidden=true;statusKey='stopped';restoreLayers?.();restoreLayers=null;
  if(savedView){
   const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
   camera.position.copy(savedView.position);controls.target.copy(savedView.target);controls.update();
   controls.enableDamping=damping;savedView=null;
  }
  onChange?.();
 }
 hud.querySelector('[data-stop]').onclick=stop;
 hud.querySelector('[data-close]').onclick=stop;

 function getQuery(model,reflections){
  if(modelCache!==model){modelCache=model;queries.clear();}
  if(!queries.has(reflections))queries.set(reflections,createSceneQuery(model,{reflections}));
  return queries.get(reflections);
 }
 const notify=(text,tone='info')=>toast?.(text,{tone});
 async function start(id){
  const inputs=getInputs(id),position=inputs?.device?.position;
  if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)){
   notify('当前方案缺少有效的设备部署点位','error');return false;
  }
  const decision=deviceDemoStartDecision(active,{id,position},lastStart,performance.now());
  if(decision==='focus'){focus(active.position,active.run.spec.settings.radius*1.2);return true;}
  if(decision==='nearby'){notify(`设备间距小于 ${DEMO_MIN_SEPARATION_M} m，已有临近设备仿真，请先停止`);return false;}
  if(decision==='cooldown'){notify('设备仿真启动间隔为 1.5 秒，请稍候');return false;}
  let run;
  try{
   const model=getActiveModel();
   run=prepareEquipmentDemoRun({...prepareDeploymentDemoInputs(inputs.device,inputs.report),model,
    getQuery:reflections=>getQuery(model,reflections)});
  }catch(error){notify(`设备仿真不可用：${error.message}`,'error');return false;}
  if(!active){
   savedView={position:camera.position.clone(),target:controls.target.clone()};
   restoreLayers=holdLayers();
  }
  release();
  const current={id,position:[...position],run,samples:run.grid.total,probe:null};
  active=current;starts++;lastStart=performance.now();statusKey='computing';group.visible=true;
  hud.querySelector('strong').textContent=`${inputs.name} · ${run.spec.profile.name}`;
  hud.querySelector('.demo-kind').textContent=run.spec.kind;
  hud.querySelector('.demo-hud-metric').textContent=demoMetricLabel(run.spec.metric);
  hud.querySelector('.demo-scale').replaceChildren();status.textContent='正在计算当前点位的感知采样…';
  resetProbe();hud.hidden=false;focus(position,run.spec.settings.radius*1.2);listen();onChange?.();
  try{
   const field=await session.start(run,{onProgress:(done,total)=>{
    if(active===current)status.textContent=`感知采样 ${Math.round(done/total*100)}%`;
   }});
   if(active!==current||!field)return false;
   renderDemoLegend(hud,session.configure());
   status.textContent=demoSampleMessage(field);statusKey=field.counts.signal?'ready':'empty';onChange?.();return true;
  }catch(error){
   if(active===current){stop();notify(`设备仿真失败：${error.message}`,'error');}
   return false;
  }
 }
 function render(){
  const stamp=performance.now();
  if(probeDirty&&pointer&&statusKey!=='computing'&&stamp-lastProbe>=80){
   probeDirty=false;lastProbe=stamp;
   const result=session.probe(pointer.x,pointer.y);
   if(result){
    hint.textContent=result.hint;renderDemoRows(rows,result.rows);active.probe={source:result.data.source,mask:result.data.mask};
   }else resetProbe('此处没有模型表面或可见仿真体场');
   onChange?.();
  }
  return session.render();
 }
 function diagnostics(){
  return {status:statusKey,deviceId:active?.id??null,position:active?.position??null,activeCount:active?1:0,starts,disposals,
   samples:active?.samples??0,volume:session.hasVolume,probe:active?.probe??null,listening:!!listenerScope,
   limits:{maxActive:DEMO_MAX_ACTIVE,minSeparationM:DEMO_MIN_SEPARATION_M,startCooldownMs:DEMO_START_COOLDOWN_MS,maxSamples:DEMO_MAX_SAMPLES}};
 }
 return {start,stop,render,diagnostics,get obstacle(){return hud.hidden?null:hud.getBoundingClientRect();},
  get active(){return active!==null;},clearScene(){stop();queries.clear();modelCache=null;}};
}
