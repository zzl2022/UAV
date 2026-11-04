import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createModel} from './model.js';
import './style.css';
import {mountLandmarks} from './landmarks.js';
import {mountPlanningUI} from './planning/ui.js';
import {mountSensorUI} from './sensors/ui.js';
import {createWorkspace} from './workspace.js';
import './workspace.css';

const app=document.querySelector('#app');
app.innerHTML=`<div class="platform-brand" role="banner"><h1>反无人机<strong>部署仿真平台</strong></h1></div>
<aside id="workspace-sidebar">
  <nav class="workspace-launchers" aria-label="功能窗口">
    <button id="open-city-model" aria-controls="city-window" aria-pressed="false"><span aria-hidden="true">▦</span>城市建模</button>
    <button id="toggle-sensors" aria-controls="equipment-window" aria-pressed="false" disabled><span aria-hidden="true">◎</span>装备参数</button>
  </nav>
  <div class="deployment-heading"><h2>推演与部署</h2><span class="live" aria-hidden="true"></span></div>
  <div class="deployment-tabs" role="tablist" aria-label="推演与部署">
    <button id="toggle-task3" role="tab" aria-controls="task3-panel" aria-selected="true" disabled>综合推演</button>
    <button id="toggle-planning" role="tab" aria-controls="planning-panel" aria-selected="false" disabled>部署与飞行</button>
  </div>
  <div id="deployment-panels"><p id="deployment-loading" class="hint">正在加载推演模块…</p></div>
</aside><main id="scene-main">
<div id="viewport" aria-label="可旋转的三维城市场景"></div><div class="north">N<br>↑</div><div id="status" role="status">正在加载场景…</div><div class="navigation">左键旋转 · 右键平移 · 滚轮缩放</div></main>
<div id="city-panel">
  <p class="intro" id="intro">郑州 · 河南博物院片区</p>
  <div class="stats"><div><strong id="count">—</strong><span>建筑要素</span></div><div><strong id="height">—</strong><span>最高建筑 / m</span></div></div>
  <section id="model-section"><h2>场景模型</h2>
  <label>模型<select id="model-select" aria-label="选择地图模型">
    <option value="recon" selected>郑州重建模型</option>
    <option value="beijing">北京故宫模型</option>
    <option value="daxing">大兴机场模型（10 km）</option>
    <option value="nuclear">北京核电站（房山）模型</option>
    <option value="railway">北京—通州铁路模型（5 km）</option>
  </select></label>
  <p class="hint" id="model-note">郑州 SHP 轮廓 + DEM + 正射影像。图层开关与建筑属性仅作用于本模型。</p></section>
  <section id="layers-section"><h2>场景图层</h2>
  <label><input type="checkbox" id="buildings" checked>建筑</label>
  <label><input type="checkbox" id="terrain" checked>地形</label>
  <label><input type="checkbox" id="imagery" checked>影像底图</label>
  <details class="scene-details"><summary>高级图层</summary>
  <label><input type="checkbox" id="wire">建筑线框</label>
  <label title="与重建建筑互斥显示；原始白模高程基准未注明"><input type="checkbox" id="original">原始白模对比</label>
  </details></section>
  <section><h2>场景视角</h2><div class="buttons" id="city-views"><button id="reset">↗ 全域视角</button><button id="top">⌖ 俯视平面</button><button id="core-focus" hidden>⌖ 核心建筑</button></div></section>
  <details class="scene-details"><summary>场景数据与导出</summary>
  <button id="export" class="primary" disabled>导出三维模型 · GLB ↓</button>
  <a class="download" href="./data/buildings.geojson" download>下载建筑 GeoJSON ↗</a>
  <a class="download" href="./data/report.json" target="_blank" rel="noopener">场景数据报告 ↗</a>
  <p class="hint">平面坐标：局部 ENU / m；地理坐标：WGS84。模型高程采用源 DEM，垂直基准未注明。</p>
  <p id="location">局部 ENU / m</p>
  </details>
  <section id="selection"><h2>建筑属性</h2><button id="city-inspect">在地图中选取建筑</button><p class="hint" id="details">点击建筑查看属性</p></section>
</div>`;
const workspace=createWorkspace(app);
workspace.mountWindow('city','城市建模',app.querySelector('#city-panel'));
document.getElementById('city-inspect').onclick=()=>workspace.minimizeWindow('city');
const el=id=>document.getElementById(id);
let renderer,model,city,terrain,controls,original;
let scene,camera,imageryTexture,grid;
let mode='recon',siteGroups={},siteMeta={},coreHighlight,currentCore=null,coreLabel;
const SITES={
  beijing:{
    label:'北京故宫模型',short:'故宫',
    note:'GBA LoD1 逐栋模型 + 天地图影像底图 · CC BY-NC 4.0（非商业）。',
    intro:'北京 · 故宫周边 5 km',
    location:'BEIJING · LOCAL ENU · METERS',
    base:'./data/beijing/beijing-gba',
    imagery:'./data/beijing/beijing-imagery.jpg',
  },
  daxing:{
    label:'大兴机场模型（10 km）',short:'大兴机场',
    note:'GBA LoD1 逐栋模型 + 天地图影像底图 · 10 km 半径 · CC BY-NC 4.0（非商业）。',
    intro:'北京 · 大兴国际机场 10 km',
    location:'BEIJING · DAXING · LOCAL ENU · METERS',
    base:'./data/sites/daxing/daxing-gba',
    imagery:'./data/sites/daxing/daxing-imagery.jpg',
  },
  nuclear:{
    label:'北京核电站（房山）模型',short:'北京核电站（房山）',
    note:'房山核设施（中国原子能科学研究院）周边 5 km · GBA LoD1 + 天地图影像 · CC BY-NC 4.0。',
    intro:'北京 · 房山核设施 5 km',
    location:'BEIJING · FANGSHAN · LOCAL ENU · METERS',
    base:'./data/sites/nuclear/nuclear-gba',
    imagery:'./data/sites/nuclear/nuclear-imagery.jpg',
  },
  railway:{
    label:'北京—通州铁路模型（5 km）',short:'铁路走廊',
    note:'GBA 沿线建筑 + 天地图影像底图 · 铁路两侧各约 5 km · CC BY-NC 4.0（非商业）。',
    intro:'北京 · 北京站—通州铁路走廊',
    location:'BEIJING · RAIL CORRIDOR · LOCAL ENU · METERS',
    base:'./data/sites/railway/railway-gba',
    imagery:'./data/sites/railway/railway-imagery.jpg',
  },
};
const viewport=el('viewport');
const status=text=>{el('status').textContent=text;};
const disableControls=value=>{for (const id of ['buildings','terrain','imagery','wire','original','reset','top','core-focus','model-select']) el(id).disabled=value;};
disableControls(true);
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function fetchJSON(path){const response=await fetch(path);if(!response.ok)throw Error(`${path}: HTTP ${response.status}`);return response.json();}
try {
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x0c171f);
  viewport.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color(0x0c171f);
  coreHighlight=new THREE.Group();coreHighlight.name='Core_Building_Highlight';scene.add(coreHighlight);
  coreLabel=document.createElement('button');coreLabel.id='core-label';coreLabel.className='map-landmark';coreLabel.hidden=true;viewport.append(coreLabel);coreLabel.onclick=()=>focusCore();
  camera=new THREE.PerspectiveCamera(42,1,1,100000);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*0.49;controls.maxDistance=35000;controls.minDistance=20;
  scene.add(new THREE.HemisphereLight(0xd9efff,0x63757b,2.3));
  const sun=new THREE.DirectionalLight(0xffeed5,3);sun.position.set(-4000,8000,3000);scene.add(sun);
  [city,terrain]=await Promise.all([fetchJSON('./data/city.json'),fetchJSON('./data/terrain.json')]);
  status('正在生成建筑与地形网格…');
  await new Promise(resolve=>requestAnimationFrame(resolve));
  model=createModel(city,terrain);scene.add(model.group);
  let imageryError;
  if(terrain.imagery){
    try {
      imageryTexture=await new THREE.TextureLoader().loadAsync(`./data/${terrain.imagery.texture}`);
      imageryTexture.colorSpace=THREE.SRGBColorSpace;
      imageryTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      model.ground.material=new THREE.MeshBasicMaterial({map:imageryTexture,side:THREE.DoubleSide});
    }catch(error){imageryError=error;console.warn('影像加载失败',error);}
  }
  const reconBox=new THREE.Box3().setFromObject(model.group);
  const reconSize=reconBox.getSize(new THREE.Vector3());
  const span=Math.max(reconSize.x,reconSize.z);
  const activeGroup=()=>mode==='recon'?model.group:siteGroups[mode];
  function frameObject(object,top=false,scale=1){
    const box=new THREE.Box3().setFromObject(object);
    if(box.isEmpty())return;
    const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const objectSpan=Math.max(size.x,size.z,size.y)||1000;
    controls.target.copy(center);camera.up.set(0,1,0);
    camera.position.copy(center).add(new THREE.Vector3(top?0:objectSpan*scale*.7,top?objectSpan*1.55:objectSpan*scale*.9,top?.001:objectSpan*scale*.95));
    controls.update();
  }
  frameObject(model.group);
  el('reset').onclick=()=>frameObject(activeGroup());
  el('top').onclick=()=>frameObject(activeGroup(),true);
  grid=new THREE.GridHelper(Math.ceil(span/1000)*1000,Math.ceil(span/1000)*2,0x33515b,0x20333b);grid.position.y=reconBox.min.y-1;scene.add(grid);
  el('count').textContent=city.metadata.sourceFeatures.toLocaleString('zh-CN');el('height').textContent=city.metadata.maxHeight;
  el('location').textContent=`${city.metadata.origin[0].toFixed(5)}° E / ${city.metadata.origin[1].toFixed(5)}° N · ENU`;
  function modeInfo(next){
    if(SITES[next]){const site=SITES[next];return {label:site.short,note:site.note,intro:site.intro,location:site.location};}
    return {label:'郑州重建模型',note:'郑州 SHP 轮廓 + DEM + 正射影像。图层开关与建筑属性仅作用于本模型。',intro:'郑州 · 河南博物院片区',location:`${city.metadata.origin[0].toFixed(5)}° E / ${city.metadata.origin[1].toFixed(5)}° N · ENU`};
  }
  function updateStatus(){
    if(SITES[mode]){const site=SITES[mode],meta=siteMeta[mode];status(`已加载${site.short} GBA ${(meta?.buildingCount??0).toLocaleString('zh-CN')} 栋 · 高度 ${meta?.minHeight??'—'}–${meta?.maxHeight??'—'} m · 天地图影像底图`);return;}
    status(imageryError?'场景已加载 · 影像加载失败':'场景已加载');
  }
  function updateDiagnostics(){
    if(!city||!terrain||!model)return;
    const sites=Object.fromEntries(Object.keys(SITES).map(id=>[id,{loaded:!!siteGroups[id]?.children.length,buildingCount:siteMeta[id]?.buildingCount??null,maxHeight:siteMeta[id]?.maxHeight??null}]));
    window.cityDiagnostics={features:city.metadata.sourceFeatures,parts:city.buildings.length,terrainVertices:terrain.positions.length/3,buildingTriangles:model.buildings.geometry.attributes.position.count/3,imagery:!!imageryTexture,modelMode:mode,models:{recon:{loaded:true,featureCount:city.metadata.sourceFeatures},...sites}};
  }
  function addGround(group,meta,texture){
    const [x0,x1,z0,z1]=meta?.localBounds??[-5042,4974,-5054,4984];
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([x0,-0.5,z0,x1,-0.5,z0,x1,-0.5,z1,x0,-0.5,z1],3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));
    geometry.setIndex([0,2,1,0,3,2]);
    const plane=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
    plane.name='TianDiTu_Imagery';
    group.add(plane);
  }
  async function ensureSite(id){
    const site=SITES[id];
    if(!site)return;
    if(siteGroups[id]?.children.length)return;
    status(`正在加载${site.label}…`);
    const [meta,gltf]=await Promise.all([
      fetchJSON(`${site.base}-meta.json`),
      new GLTFLoader().loadAsync(`${site.base}.glb`),
    ]);
    siteMeta[id]=meta;
    gltf.scene.traverse(child=>{if(child.isMesh&&child.material)child.material.side=THREE.DoubleSide;});
    const group=new THREE.Group();group.name=`${id}_GBA_LoD1`;group.visible=false;group.add(gltf.scene);
    try{
      const texture=await new THREE.TextureLoader().loadAsync(site.imagery);
      texture.colorSpace=THREE.SRGBColorSpace;
      texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      addGround(group,meta,texture);
    }catch(error){console.warn(`${site.short}影像底图加载失败`,error);}
    if(meta.route?.points?.length){
      const route=meta.route.points.map(point=>new THREE.Vector3(point[0],2,point[1]));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(route),new THREE.LineBasicMaterial({color:0x6ce5c3,depthTest:false,transparent:true,opacity:0.95})));
      const curve=new THREE.CatmullRomCurve3(meta.route.points.map(point=>new THREE.Vector3(point[0],3,point[1])));
      const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(48,meta.route.points.length*24),32,6,false),new THREE.MeshBasicMaterial({color:0x6ce5c3,transparent:true,opacity:0.28,depthTest:false,side:THREE.DoubleSide}));
      tube.renderOrder=9;group.add(tube);
    }
    scene.add(group);siteGroups[id]=group;
  }
  function disposeCoreHighlight(){
    for(const child of [...coreHighlight.children]){child.geometry?.dispose();child.material?.dispose();coreHighlight.remove(child);}
  }
  function coreCenter(core){
    const ring=core?.rings?.[0]||[];
    if(!ring.length)return null;
    const xs=ring.map(point=>point[0]),zs=ring.map(point=>point[2]);
    return {x:(Math.min(...xs)+Math.max(...xs))/2,z:(Math.min(...zs)+Math.max(...zs))/2,size:Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs),30)};
  }
  function setCoreHighlight(core){
    currentCore=core||null;
    disposeCoreHighlight();
    if(!core||!core.rings?.length){coreHighlight.visible=false;coreLabel.hidden=true;return;}
    const height=Math.max(0,Number(core.height)||0);
    const roofMaterial=new THREE.LineBasicMaterial({color:0xffd166,depthTest:false,transparent:true,opacity:0.95});
    const glowMaterial=new THREE.LineBasicMaterial({color:0xfff3b0,depthTest:false,transparent:true,opacity:0.35});
    for(const ring of core.rings){
      const roof=ring.map(point=>new THREE.Vector3(point[0],height+0.6,point[2]));
      const base=ring.map(point=>new THREE.Vector3(point[0],0.4,point[2]));
      coreHighlight.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(roof),roofMaterial));
      coreHighlight.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(base),glowMaterial));
    }
    const outer=core.rings[0]||[];
    const xs=outer.map(point=>point[0]),zs=outer.map(point=>point[2]);
    for(const [x,z] of [[Math.min(...xs),Math.min(...zs)],[Math.min(...xs),Math.max(...zs)],[Math.max(...xs),Math.min(...zs)],[Math.max(...xs),Math.max(...zs)]]){
      coreHighlight.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x,0.4,z),new THREE.Vector3(x,height+0.6,z)]),glowMaterial));
    }
    coreHighlight.visible=true;
    coreLabel.textContent=`⌖ ${core.name||'核心建筑'}`;
    coreLabel.title=`定位${core.name||'核心建筑'}`;
    coreLabel.hidden=false;
  }
  function setCoreForMode(next){
    const core=SITES[next]?siteMeta[next]?.coreBuilding:null;
    setCoreHighlight(core);
    const button=el('core-focus');
    if(core){button.hidden=false;button.disabled=false;button.textContent=`⌖ ${core.shortName||core.name||'核心建筑'}`;button.title=`定位${core.name||'核心建筑'}`;}
    else{button.hidden=true;button.disabled=true;}
  }
  function focusCore(){
    if(!currentCore)return;
    const center=coreCenter(currentCore);
    if(!center)return;
    const target=new THREE.Vector3(center.x,(Number(currentCore.height)||0)/2,center.z);
    const span=Math.max(center.size*1.8,120);
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(span*.7,span*.85,span*.9));
    controls.update();
  }
  function updateCoreLabel(){
    if(!currentCore||mode==='recon'){coreLabel.hidden=true;return;}
    const center=coreCenter(currentCore);
    if(!center){coreLabel.hidden=true;return;}
    const point=new THREE.Vector3(center.x,(Number(currentCore.height)||0)+18,center.z);
    camera.updateMatrixWorld();point.project(camera);
    const visible=point.z>=-1&&point.z<=1&&Math.abs(point.x)<0.95&&Math.abs(point.y)<0.92;
    coreLabel.hidden=!visible;
    if(visible){coreLabel.style.left=`${(point.x+1)/2*viewport.clientWidth}px`;coreLabel.style.top=`${(1-point.y)/2*viewport.clientHeight}px`;}
  }
  function applyModeUI(next){
    const info=modeInfo(next);
    el('intro').textContent=info.intro;
    el('model-note').textContent=info.note;
    el('location').textContent=info.location;
    el('layers-section').hidden=next!=='recon';
    el('selection').hidden=next!=='recon';
    if(next==='recon'){el('count').textContent=city.metadata.sourceFeatures.toLocaleString('zh-CN');el('height').textContent=city.metadata.maxHeight;}
    else{const meta=siteMeta[next];el('count').textContent=(meta?.buildingCount??0).toLocaleString('zh-CN');el('height').textContent=meta?.maxHeight??'—';}
    for(const id of ['toggle-sensors','toggle-task3','toggle-planning']){const button=el(id);if(button)button.disabled=next!=='recon';}
    const museum=el('museum-focus');if(museum)museum.hidden=next!=='recon';
    landmarks?.setActive?.(next==='recon');
    setCoreForMode(next);
  }
  async function setMode(next){
    if(!(next==='recon'||SITES[next]))return;
    if(next===mode){frameObject(activeGroup());return;}
    const select=el('model-select');select.value=next;select.disabled=true;el('export').disabled=true;
    try{
      if(SITES[next])await ensureSite(next);
      mode=next;
      model.group.visible=next==='recon';
      for(const [id,group] of Object.entries(siteGroups))group.visible=id===next;
      if(original)original.visible=next==='recon'&&el('original').checked;
      if(next==='recon'){model.buildings.visible=el('buildings').checked&&!el('original').checked;model.ground.visible=el('terrain').checked;}
      grid.visible=next==='recon';
      applyModeUI(next);
      frameObject(activeGroup(),false,next==='recon'?1:0.35);
      updateStatus();updateDiagnostics();
    }catch(error){select.value=mode;status(`模型加载失败：${error.message}`);}
    finally{select.disabled=false;el('export').disabled=false;}
  }
  el('model-select').onchange=()=>setMode(el('model-select').value);
  el('core-focus').onclick=focusCore;
  el('buildings').onchange=()=>{model.buildings.visible=el('buildings').checked&&!el('original').checked;};
  el('terrain').onchange=()=>{model.ground.visible=el('terrain').checked;};
  el('imagery').onchange=()=>{
    const old=model.ground.material;
    model.ground.material=el('imagery').checked
      ?new THREE.MeshBasicMaterial({map:imageryTexture,side:THREE.DoubleSide})
      :new THREE.MeshStandardMaterial({color:0x243d46,roughness:1,side:THREE.DoubleSide});
    old.dispose();
  };
  el('wire').onchange=()=>{model.buildings.material.wireframe=el('wire').checked;};
  el('original').onchange=async()=>{
    const checked=el('original').checked;model.buildings.visible=!checked&&el('buildings').checked;
    if(original){original.visible=checked;return;}
    if(!checked)return;
    el('original').disabled=true;status('正在加载原始白模…');
    const loaded=[];
    try {
      const loader=new GLTFLoader();
      for(const file of ['NoLod_0.glb','NoLod_1.glb']) loaded.push((await loader.loadAsync(`./data/${file}`)).scene);
      original=new THREE.Group();original.name='Source_White_Model';original.add(...loaded);scene.add(original);original.visible=el('original').checked;
      updateStatus();
    }catch(error){for(const item of loaded)item.traverse(o=>{o.geometry?.dispose();});el('original').checked=false;model.buildings.visible=el('buildings').checked;status(`白模加载失败：${error.message}`);}
    finally{el('original').disabled=false;}
  };
  el('export').onclick=async()=>{
    const names={recon:'zhengzhou-city-enu.glb',beijing:'beijing-forbidden-city-gba.glb',daxing:'daxing-airport-gba.glb',nuclear:'fangshan-nuclear-gba.glb',railway:'beijing-tongzhou-railway-gba.glb'};
    const target=activeGroup();
    el('export').disabled=true;status(`正在导出${modeInfo(mode).label}…`);
    let wire;
    if(mode==='recon'){wire=model.buildings.material.wireframe;model.buildings.material.wireframe=false;}
    try {const buffer=await new GLTFExporter().parseAsync(target,{binary:true,onlyVisible:false});download(buffer,names[mode],'model/gltf-binary');updateStatus();}
    catch(error){status(`导出失败：${error.message}`);}finally{if(mode==='recon')model.buildings.material.wireframe=wire;el('export').disabled=false;}
  };
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down;
  renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(mode!=='recon'||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5||!model.buildings.visible)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(model.buildings)[0];if(!hit)return;
    const b=model.ranges.find(r=>hit.faceIndex>=r.start&&hit.faceIndex<r.end)?.building;if(!b)return;
    el('details').textContent=`${b.name} | 建筑高度 ${b.height} m | 地面模型高程 ${b.ground.toFixed(1)} m | ID ${b.id}`;
    workspace.restoreWindow('city');
  });
  const resize=()=>{camera.aspect=viewport.clientWidth/viewport.clientHeight;camera.updateProjectionMatrix();renderer.setSize(viewport.clientWidth,viewport.clientHeight);};
  new ResizeObserver(resize).observe(viewport);resize();
  let planning,sensors;
  const landmarks=mountLandmarks({city,scene,camera,controls,viewport});
  const museumFocus=el('museum-focus');if(museumFocus)el('city-views').append(museumFocus);
  renderer.setAnimationLoop(stamp=>{controls.update();landmarks.update();updateCoreLabel();planning?.update(stamp);if(!sensors?.render())renderer.render(scene,camera);});
  disableControls(false);el('imagery').disabled=!imageryTexture;el('imagery').checked=!!imageryTexture;el('export').disabled=false;updateStatus();
  sensors=mountSensorUI({app,scene,camera,controls,renderer,model,city,workspace});
  planning=mountPlanningUI({app,city,scene,camera,controls,renderer,sensors,model,workspace});
  import('./task3/ui.js').then(({mountTask3UI})=>{
    mountTask3UI({app,city,terrain,scene,camera,controls,renderer,sensors,model,workspace});
    applyModeUI(mode);
    if(!app.dataset.activeView&&!app.querySelector('.workspace-window[open]'))el('toggle-task3').click();
  }).catch(error=>{console.warn('任务三面板挂载失败',error);el('toggle-task3').disabled=true;el('toggle-planning').click();});
  document.documentElement.dataset.ready='true';
  // Expose diagnostic counts only, for reproducible headless browser verification.
  updateDiagnostics();
}catch(error){status(`无法建立场景：${error.message}。请先执行数据准备，并使用支持 WebGL 的浏览器。`);document.documentElement.dataset.ready='error';console.error(error);}
