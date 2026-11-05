import * as THREE from 'three';
import {DEMO_METRICS,demoDefaults,prepareDemo,demoShape,probeDemo} from './equipment-demo-model.js';
import {volumeGrid,rampColor} from './volume.js';
import {createVolumeRenderer} from './volume-renderer.js';
import {nominalCoverage} from './coverage.js';
import './equipment-demo.css';

export function createEquipmentDemo({app,scene,camera,controls,renderer,model,workspace,getScenario,getQuery,onStart}){
 const group=new THREE.Group();group.name='Equipment_Demonstration';group.visible=false;scene.add(group);
 const positions=new Map(),settings=new Map();let root=null,getProfile=null,current=null,active=null,field=null,volume=null,worker=null,generation=0,picking=false,down=null,range=null,openSettings=null;
 let activeScenario=null,lastPointer=null,probeDirty=false,lastProbeTime=0,probeMarker=null;
 const settingsKey='uav.equipment-demo-settings.v1';let storage,storedSettings={};
 try{storage=localStorage;const parsed=JSON.parse(storage.getItem(settingsKey)??'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))storedSettings=parsed;}catch{}
 const persistSettings=()=>{
  try{
   if(!storage)throw Error('浏览器存储不可用');
   const next={...storedSettings,...Object.fromEntries(settings)};storage.setItem(settingsKey,JSON.stringify(next));storedSettings=next;
  }catch{message('演示设置无法保存，请检查浏览器存储空间');}
 };
 const hud=document.createElement('section');hud.id='equipment-demo-hud';hud.hidden=true;
 hud.innerHTML='<div class="demo-hud-heading"><strong></strong><span class="demo-kind"></span></div><div class="demo-hud-metric"></div><div class="demo-colorbar"></div><div class="demo-scale"></div><p role="status"></p><div class="demo-hud-actions"><button type="button" data-demo-action="settings">演示设置</button><button type="button" data-demo-action="stop">停止演示</button></div>';
 app.querySelector('main').append(hud);
 const probeBox=document.createElement('div');probeBox.className='demo-hover';probeBox.id='demo-hover';
 const probeTitle=document.createElement('div');probeTitle.className='demo-hover-title';probeTitle.textContent='鼠标位置参数';
 const probeHint=document.createElement('div');probeHint.id='demo-hover-hint';probeHint.textContent='移动鼠标到地图或演示体场查看参数';
 const probeRows=document.createElement('dl');probeRows.id='demo-hover-values';probeBox.append(probeTitle,probeHint,probeRows);hud.querySelector('.demo-hud-actions').before(probeBox);
 const gradient=`linear-gradient(to right,${Array.from({length:32},(_,i)=>`rgb(${rampColor(i/31).map(v=>Math.round(v*255)).join(',')})`).join(',')})`;hud.querySelector('.demo-colorbar').style.background=gradient;
 hud.querySelector('[data-demo-action=settings]').onclick=()=>{openSettings?.();workspace.restoreWindow('equipment');};hud.querySelector('[data-demo-action=stop]').onclick=()=>stop();
 const $=id=>root?.querySelector('#demo-'+id);
 const opts=()=>settings.get(current);
 const publish=(status,extra={})=>{window.equipmentDemoDiagnostics={status,presetId:active?.profile.presetId??current,type:active?.type,metric:active?.metric.id,kind:active?.kind,position:active?.position??(current?positions.get(current):null),...extra};};
 const message=text=>{if($('status'))$('status').textContent=text;hud.querySelector('[role=status]').textContent=text;};
 function clearProbe(hint='移动鼠标到地图或演示体场查看参数'){
  probeHint.textContent=hint;probeRows.replaceChildren();if(probeMarker)probeMarker.visible=false;
  if(window.equipmentDemoDiagnostics)delete window.equipmentDemoDiagnostics.probe;
 }
 function clear(){volume?.dispose();volume=null;field=null;probeMarker=null;activeScenario=null;lastPointer=null;probeDirty=false;clearProbe();for(const child of [...group.children]){group.remove(child);child.geometry?.dispose();child.material?.dispose();}}
 function refreshProbe(){
  probeDirty=false;if(!active||!field||!lastPointer||!activeScenario)return;
  const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.firstHitOnly=true;
  ray.setFromCamera(new THREE.Vector2((lastPointer.x-rect.left)/rect.width*2-1,-(lastPointer.y-rect.top)/rect.height*2+1),camera);
  const surface=ray.intersectObjects([model.buildings,model.ground])[0],hit=volume?.probe(ray);
  const useVolume=hit&&(!surface||hit.distance<=surface.distance+.1);
  if(!useVolume&&!surface){clearProbe('此处没有模型表面或可见演示体场');return;}
  const point=useVolume?hit.point.toArray():surface.point.toArray();
  if(!useVolume)point[1]+=active.settings.mountHeight;
  const value=probeDemo(active,point,activeScenario,getQuery(active.settings.reflections));
  const state={0:'地形数据不足',1:'有效模型采样',2:'超出范围、视场或信号条件不满足',3:'位于建筑或地形内部',4:'超出离地高度上限'}[value.mask]??'暂无数据';
  probeHint.textContent=`${useVolume?'可见体场位置':`表面上方 ${active.settings.mountHeight} m`} · ${state}`;
  const format=(v,unit='',digits=1)=>Number.isFinite(v)?`${v.toFixed(digits)}${unit?' '+unit:''}`:'—';
  const rows=[['东 / 北 / 上坐标',[point[0],-point[2],point[1]].map(n=>format(n)).join(' / ')+' m'],['离地高度',format(value.heightAboveGround,'m')],['距装备距离',format(value.distance,'m')],['方位角 / 仰角',`${format(value.azimuth,'°')} / ${format(value.elevation,'°')}`],...DEMO_METRICS[active.type].map(metric=>[metric.label,format(value.metrics.find(item=>item.id===metric.id)?.value,metric.unit,metric.max<=1?3:1)])];
  probeRows.replaceChildren();for(const [label,text] of rows){const term=document.createElement('dt'),data=document.createElement('dd');term.textContent=label;data.textContent=text;probeRows.append(term,data);}
  if(probeMarker){probeMarker.visible=true;probeMarker.position.fromArray(point);}
  window.equipmentDemoDiagnostics.probe={...value,source:useVolume?'volume':'surface'};
 }
 function buttons(){if($('stop'))$('stop').disabled=!active&&!picking;if($('start'))$('start').textContent=active?'更新演示':'开始演示';}
 function stop(){generation++;worker?.terminate();worker=null;active=null;picking=false;clear();group.visible=false;hud.hidden=true;renderer.domElement.style.cursor='';buttons();publish('stopped');message('演示已停止');}
 function pointLabel(){const p=positions.get(current);if($('position'))$('position').textContent=p?`东 ${p[0].toFixed(0)} m · 北 ${(-p[2]).toFixed(0)} m · 高 ${p[1].toFixed(0)} m`:'未选择点位';}
 function anchor(){
  if(positions.has(current))return;
  const bounds=model.ground.geometry.boundingBox,x=(bounds.min.x+bounds.max.x)/2,z=(bounds.min.z+bounds.max.z)/2;
  const query=getQuery(false),surface=query.surfaceAt(x,z)??query.groundAt(x,z)??bounds.min.y;
  positions.set(current,[x,surface+opts().mountHeight,z]);
 }
 function fit(top=false){
  if(!active)return;const p=active.position,span=active.settings.radius*2,centerY=(getQuery(false).groundAt(p[0],p[2])??p[1])+Math.min(active.settings.ceiling,active.settings.radius)*.4;
  controls.target.set(p[0],centerY,p[2]);camera.position.set(p[0]+(top?0:span*.65),centerY+span*(top?1.25:.75),p[2]+(top?.01:span*.8));controls.update();
 }
 function configure(){
  if(!active||!field)return;const s=settings.get(active.profile.presetId),m=active.metric,displayRange=s.autoscale?range:[m.min,m.max],floor=s.floor??m.floor;
  volume?.configure({metric:'margin',range:displayRange,floor,density:s.density,opacityDistance:active.settings.radius*.25,clip:s.clip,style:s.style});
  for(const object of group.children)if(object.userData.demoNominal)object.visible=s.nominal;
  hud.querySelector('.demo-hud-metric').textContent=`${m.label}${m.unit?' / '+m.unit:''} · 显示 ≥ ${Number(floor).toFixed(m.max<=1?2:1)}`;
  hud.querySelector('.demo-scale').replaceChildren(...[0,.5,1].map(t=>{const label=document.createElement('span');label.textContent=(displayRange[0]+t*(displayRange[1]-displayRange[0])).toFixed(m.max<=1?2:1);return label;}));
  publish('ready',{count:field.grid.total,counts:field.counts,range:displayRange,style:s.style,clip:s.clip,floor,settings:structuredClone(s)});
  probeDirty=true;
 }
 function install(result,id){
  if(id!==generation||!active)return;
  field=result;const visibleValues=[],floor=active.settings.floor??active.metric.floor;
  for(let i=0;i<field.grid.total;i++)if(field.values[i*4+3]===1&&field.values[i*4]>=floor)visibleValues.push(field.values[i*4]);
  visibleValues.sort((a,b)=>a-b);
  // Keep a few near-device extrema from flattening the visible field's color scale.
  const min=visibleValues[0]??Infinity,max=visibleValues[Math.floor((visibleValues.length-1)*.98)]??-Infinity;
  range=active.metric.max<=1?[0,1]:Number.isFinite(min)?[min,Math.max(min+1,max)]:[active.metric.min,active.metric.max];
  if(field.counts.signal)volume=createVolumeRenderer(group,field);
  const shape=demoShape(active),p={maxRange:active.settings.radius,minRange:0,heading:active.settings.heading,pitch:active.settings.pitch,azimuthFov:shape.horizontal,elevationMin:shape.low,elevationMax:shape.high};
  const geometry=nominalCoverage({type:'radar',parameters:p},{}),wire=new THREE.LineSegments(new THREE.WireframeGeometry(geometry),new THREE.LineBasicMaterial({color:0x83cfca,transparent:true,opacity:.2}));geometry.dispose();wire.position.fromArray(active.position);wire.userData.demoNominal=true;group.add(wire);
  const marker=new THREE.Mesh(new THREE.SphereGeometry(Math.max(2,active.settings.radius/130),12,8),new THREE.MeshBasicMaterial({color:0xb6fff0,depthTest:false}));marker.position.fromArray(active.position);marker.renderOrder=60;group.add(marker);
  probeMarker=new THREE.Mesh(new THREE.SphereGeometry(Math.max(2,active.settings.radius/180),10,8),new THREE.MeshBasicMaterial({color:0xffe29b,depthTest:false}));probeMarker.visible=false;probeMarker.renderOrder=61;group.add(probeMarker);
  message(field.counts.signal?`${field.counts.signal.toLocaleString()} 个有效采样 · 实际步长 ${field.grid.step.map(v=>v.toFixed(0)).join(' / ')} m`:'当前条件下没有可显示的采样');configure();buttons();
 }
 function start(){
  try{
   const invalid=root?.querySelector(':invalid');if(invalid){invalid.reportValidity();throw Error('请检查演示设置');}
   anchor();const next=prepareDemo(getProfile(),opts(),positions.get(current)),scenario=structuredClone(getScenario());
   stop();active=next;activeScenario=scenario;onStart();group.visible=true;hud.hidden=false;
   hud.querySelector('strong').textContent=next.profile.name;hud.querySelector('.demo-kind').textContent=next.kind;
   hud.querySelector('.demo-hud-metric').textContent=next.metric.label+(next.metric.unit?' / '+next.metric.unit:'');hud.querySelector('.demo-scale').replaceChildren();
   const b=model.ground.geometry.boundingBox,r=next.settings.radius,p=next.position,region={west:Math.max(b.min.x,p[0]-r),east:Math.min(b.max.x,p[0]+r),south:Math.max(b.min.z,p[2]-r),north:Math.min(b.max.z,p[2]+r)};
   const grid=volumeGrid(region,{spacing:next.settings.spacing,verticalSpacing:Math.max(10,next.settings.spacing/2),minY:b.min.y+1,maxY:Math.max(p[1]+10,b.max.y+next.settings.ceiling),maxSamples:24000});
   const id=++generation;worker=new Worker(new URL('./equipment-demo-worker.js',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{if(data.id!==generation)return;if(data.type==='progress'){message(`计算中 ${Math.round(data.done/data.total*100)}%`);publish('computing',{done:data.done,total:data.total});}else if(data.type==='error'){stop();message(data.message);publish('error',{error:data.message});workspace.restoreWindow('equipment');}else{try{install(data.result,id);}catch(error){stop();message(error.message);publish('error',{error:error.message});workspace.restoreWindow('equipment');}worker?.terminate();worker=null;}};
   worker.onerror=event=>{stop();message('演示计算失败，请重试');publish('error',{error:event.message});workspace.restoreWindow('equipment');};
   worker.postMessage({id,baseURL:new URL(import.meta.env.BASE_URL,location.href).href,spec:next,grid,scenario});
   message('正在计算城市演示图层');publish('computing',{total:grid.total});buttons();fit();workspace.minimizeWindow('equipment');
  }catch(error){message(error.message);publish('error',{error:error.message});}
 }
 function mount(container,{getProfile:readProfile}){
  getProfile=readProfile;const profile=getProfile();current=profile.presetId;if(!settings.has(current)){
   let next=demoDefaults(profile);
   try{if(storedSettings[current]){
    const saved={...storedSettings[current]},oldDefault=profile.type==='electrostatic'?150:profile.type==='fivega'?600:400;
    if(!saved.heightDefaultVersion&&saved.ceiling===oldDefault)saved.ceiling=800;
    saved.heightDefaultVersion=1;next=prepareDemo(profile,saved,[0,0,0]).settings;
   }}catch{}
   settings.set(current,next);
  }
  root=document.createElement('div');root.className='equipment-demo-settings';container.append(root);
  root.innerHTML='<h3>演示</h3><div class="demo-position"><div><span>演示点位</span><output id="demo-position">使用地图选点</output></div><button type="button" id="demo-pick">地图选点</button></div><div class="demo-setting-tabs" role="tablist" aria-label="演示设置"><button type="button" role="tab" aria-selected="true" data-page="field">范围与朝向</button><button type="button" role="tab" aria-selected="false" data-page="render">可视化</button></div><div id="demo-fields" class="profile-field-grid"></div><div id="demo-render" class="profile-field-grid" hidden></div><div class="demo-actions"><button type="button" id="demo-start" class="primary">开始演示</button><button type="button" id="demo-stop">停止演示</button><button type="button" id="demo-top">俯视</button><button type="button" id="demo-oblique">三维观察</button></div><p id="demo-status" role="status"></p>';
  const s=opts(),m=DEMO_METRICS[profile.type].find(item=>item.id===s.metric);if(s.floor==null)s.floor=m.floor;
  const add=(host,key,label,unit,{min,max,step='any',options,boolean=false,visual=false}={})=>{
   const wrap=document.createElement('label');wrap.className='profile-field';const title=document.createElement('span');title.className='profile-field-label';title.textContent=label;
   const box=document.createElement('div');box.className='profile-field-control';let input;
   if(options){input=document.createElement('select');for(const [value,text] of options)input.add(new Option(text,String(value)));input.value=String(s[key]);}
   else{input=document.createElement('input');input.type=boolean?'checkbox':'number';if(boolean)input.checked=s[key];else{input.required=true;input.min=min;input.max=max;input.step=step;input.value=s[key];}}
   input.id='demo-'+key;input.setAttribute('aria-label',label);box.append(input);if(boolean){wrap.classList.add('demo-switch');}else if(unit){const el=document.createElement('span');el.className='profile-unit';el.textContent=unit;box.append(el);}wrap.append(title,box);host.append(wrap);
   input.addEventListener(options||boolean?'change':'input',()=>{
    if(!boolean&&!options&&!input.checkValidity()){message('请检查'+label);return;}
    s[key]=boolean?input.checked:options&&['metric','style'].includes(key)?input.value:Number(input.value);
    if(key==='metric'){const metric=DEMO_METRICS[profile.type].find(item=>item.id===s.metric);s.floor=metric.floor;$('floor').value=s.floor;$('floor').min=metric.min;$('floor').max=metric.id==='distance'?s.radius:metric.max;$('floor').step=metric.max<=1?.01:.5;const box=$('floor').closest('.profile-field-control');let unit=box.querySelector('.profile-unit');if(!unit){unit=document.createElement('span');unit.className='profile-unit';box.append(unit);}unit.textContent=metric.unit;unit.hidden=!metric.unit;if(active)start();}
    else if(visual){if(active)configure();}
    else{if(key==='mountHeight'&&positions.has(current)){const pos=positions.get(current),surface=getQuery(false).surfaceAt(pos[0],pos[2]);if(surface!=null)pos[1]=surface+s.mountHeight;pointLabel();}if(active)message('设置已修改，请更新演示');}
    persistSettings();
   });
  };
  add($('fields'),'radius','演示半径','m',{min:25,max:5000});add($('fields'),'ceiling','离地高度上限','m',{min:25,max:3000});
  add($('fields'),'mountHeight','选点表面上方','m',{min:1,max:500});add($('fields'),'spacing','采样间距','',{options:[[100,'快速 · 100 m'],[50,'标准 · 50 m'],[25,'精细 · 25 m']]});
  if(['radar','radio','optical','fivega'].includes(profile.type)){
   add($('fields'),'heading','方位指向','°',{min:0,max:360});add($('fields'),'pitch','俯仰指向','°',{min:-90,max:90});
  }
  if(['optical','fivega'].includes(profile.type))add($('fields'),'horizontal','演示水平视场','°',{min:.1,max:profile.type==='optical'?170:360});
  if(profile.type==='fivega')add($('fields'),'vertical','演示垂直张角','°',{min:.1,max:179});
  add($('render'),'metric','显示物理量','',{options:DEMO_METRICS[profile.type].map(item=>[item.id,item.label+(item.unit?' / '+item.unit:'')])});
  add($('render'),'style','渲染方式','',{visual:true,options:[['volume','连续体渲染'],['surface','门限等值面']]});
  add($('render'),'floor','显示下限',m.unit,{min:m.min,max:m.id==='distance'?s.radius:m.max,step:m.max<=1?.01:.5,visual:true});
  add($('render'),'density','体密度','',{min:.1,max:5,step:.1,visual:true});add($('render'),'clip','东西剖切比例','',{min:.05,max:1,step:.05,visual:true});
  add($('render'),'autoscale','自动色带','',{boolean:true,visual:true});add($('render'),'nominal','范围线框','',{boolean:true,visual:true});
  if(['radar','radio','acoustic'].includes(profile.type))add($('fields'),'reflections','计入反射路径','',{boolean:true});
  const pageButtons=[...root.querySelectorAll('.demo-setting-tabs button')];
  const selectPage=name=>{for(const button of pageButtons){const selected=button.dataset.page===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}$('fields').hidden=name!=='field';$('render').hidden=name!=='render';};
  for(const button of pageButtons)button.onclick=()=>selectPage(button.dataset.page);
  root.querySelector('.demo-setting-tabs').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const next=event.key==='Home'?0:event.key==='End'?1:pageButtons.findIndex(b=>b.getAttribute('aria-selected')==='true')===0?1:0;selectPage(pageButtons[next].dataset.page);pageButtons[next].focus();};
  $('start').onclick=start;$('stop').onclick=()=>stop();$('top').onclick=()=>fit(true);$('oblique').onclick=()=>fit();
  $('pick').onclick=()=>{stop();picking=true;buttons();message('请在城市地图中选择点位');renderer.domElement.style.cursor='crosshair';workspace.minimizeWindow('equipment');publish('picking');};
  anchor();pointLabel();buttons();selectPage('field');if(active)$('status').textContent=hud.querySelector('[role=status]').textContent;
 }
 renderer.domElement.addEventListener('pointerdown',event=>{down=[event.clientX,event.clientY];});
 renderer.domElement.addEventListener('pointermove',event=>{if(!active)return;lastPointer={x:event.clientX,y:event.clientY};probeDirty=true;});
 renderer.domElement.addEventListener('pointerleave',()=>{lastPointer=null;probeDirty=false;clearProbe();});
 controls.addEventListener('change',()=>{if(lastPointer)probeDirty=true;});
 renderer.domElement.addEventListener('pointerup',event=>{
  if(!picking||!down||Math.hypot(event.clientX-down[0],event.clientY-down[1])>5)return;
  const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.firstHitOnly=true;ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
  const hit=ray.intersectObjects([model.buildings,model.ground])[0];if(!hit)return;
  event.stopImmediatePropagation();positions.set(current,[hit.point.x,hit.point.y+opts().mountHeight,hit.point.z]);picking=false;renderer.domElement.style.cursor='';pointLabel();buttons();message('已选择演示点位');workspace.restoreWindow('equipment');publish('located');
 },true);
 app.querySelector('#equipment-window').addEventListener('close',()=>stop());
 app.addEventListener('view-change',()=>stop());app.querySelector('#model-select')?.addEventListener('change',()=>stop());
 publish('stopped');
 return {mount,start,stop,setOpenSettings:callback=>{openSettings=callback;},render:()=>{if(probeDirty&&performance.now()-lastProbeTime>80){lastProbeTime=performance.now();refreshProbe();}return volume?.render(renderer,scene,camera)??false;},profileChanged:()=>{if(active)stop();}};
}
