import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {buildCityGeometry,buildTerrainGeometry,createModel} from './model.js';
import {siteImageBounds,siteGroundGeometry,roofHighlightGeometry} from './site-display.js';
import './style.css';
import {mountLandmarks} from './landmarks.js';
import {mountSensorUI} from './sensors/ui.js';
import {createWorkspace} from './workspace.js';
import {coreFootprintBounds,loadSiteCity,siteAnalysisMetadata,siteCoreBuildings} from './site-analysis.js';
import './workspace.css';
import './ac8-theme.css';
import {mountIntro} from './intro.js';
import {createAc8Hud} from './ac8-hud.js';
import {mountSceneMenu} from './scene-menu.js';
import {mountCustomSites} from './custom-sites.js';
import {mountCustomSiteCore} from './custom-site-core.js';
import {mountHudMenu} from './hud-menu.js';
import {mountProjectChat} from './project-chat.js';
import {flightTelemetry} from './planning/telemetry.js';
import {terrainSampler} from './sensors/terrain-query.js';
import {CATALOG_TYPES} from './sensors/equipment-models.js';
import logoFullUrl from './assets/logo-full.png';
const app=document.querySelector('#app');
app.innerHTML=`<header id="platform-topbar">
  <div class="topbar-flow" aria-hidden="true"></div>
  <div class="topbar-brand">
    <img class="topbar-logo-full" src="${logoFullUrl}" alt="中国人民公安大学">
  </div>
  <div class="topbar-center">
  <h1>反无装备优化部署与仿真推演平台</h1>
  </div>
  <div class="topbar-drone" aria-hidden="true">
    <svg viewBox="0 0 140 92" role="img">
      <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <path d="M51 35 31 21M89 35l20-14M51 57 31 71M89 57l20 14" stroke-width="3.4"/>
        <ellipse cx="27" cy="19" rx="17" ry="5.6" stroke-width="2.8"/>
        <ellipse cx="113" cy="19" rx="17" ry="5.6" stroke-width="2.8"/>
        <ellipse cx="27" cy="73" rx="17" ry="5.6" stroke-width="2.8"/>
        <ellipse cx="113" cy="73" rx="17" ry="5.6" stroke-width="2.8"/>
        <rect x="50" y="30" width="40" height="32" rx="10" stroke-width="3"/>
        <circle cx="70" cy="46" r="8" stroke-width="2.6"/>
        <path d="M62 62h16l-3.5 8h-9z" stroke-width="2.4"/>
        <path d="M70 70v6" stroke-width="2.4"/>
        <path d="M58 80h24" stroke-width="2.8" opacity=".85"/>
      </g>
      <g fill="currentColor">
        <circle cx="27" cy="19" r="3.1"/><circle cx="113" cy="19" r="3.1"/>
        <circle cx="27" cy="73" r="3.1"/><circle cx="113" cy="73" r="3.1"/>
        <circle cx="70" cy="46" r="3.6"/>
      </g>
      <g fill="none" stroke="currentColor" stroke-width="1.8" opacity=".55">
        <path d="M119 39a23 23 0 0 1 0 14"/><path d="M125 33a33 33 0 0 1 0 26"/>
      </g>
    </svg>
  </div>
</header>
<div id="platform-body">
<aside id="workspace-sidebar">
  <div class="sidebar-top"><button id="sidebar-collapse" type="button" aria-label="折叠场景侧栏" title="折叠侧栏">«</button></div>
  <nav class="workspace-launchers" id="ac8-main-menu" aria-label="功能">
    <button id="open-city-model" aria-controls="city-window" aria-pressed="false"><span aria-hidden="true">▦</span>三维环境建模<i class="ac8-launcher-bracket ac8-launcher-bracket-top" aria-hidden="true"></i><i class="ac8-launcher-bracket ac8-launcher-bracket-bottom" aria-hidden="true"></i></button>
    <button id="toggle-sensors" aria-controls="equipment-window" aria-pressed="false" disabled><span aria-hidden="true">◎</span>感知装备建模<i class="ac8-launcher-bracket ac8-launcher-bracket-top" aria-hidden="true"></i><i class="ac8-launcher-bracket ac8-launcher-bracket-bottom" aria-hidden="true"></i></button>
    <button id="toggle-deployment" aria-controls="deployment-window" aria-pressed="false" disabled><span aria-hidden="true">⌘</span>部署仿真推演<i class="ac8-launcher-bracket ac8-launcher-bracket-top" aria-hidden="true"></i><i class="ac8-launcher-bracket ac8-launcher-bracket-bottom" aria-hidden="true"></i></button>
  </nav>
</aside>
<main id="scene-main">
<div id="viewport" aria-label="可旋转的三维城市场景"></div><div class="north">N<br>↑</div><div id="status" role="status">正在加载场景…</div><div class="navigation">左键旋转 · 右键平移 · 滚轮缩放</div></main>
<button id="sidebar-expand" type="button" aria-label="展开场景侧栏" title="展开侧栏">»</button>
</div>
<div id="deployment-panel">
  <div class="deployment-tabs" role="tablist" aria-label="优化推演" hidden>
    <button id="toggle-task3" role="tab" aria-controls="task3-panel" aria-selected="true" disabled>优化推演</button>
  </div>
  <div id="deployment-panels"><p id="deployment-loading" class="hint">正在加载优化推演模块…</p></div>
</div>
<div id="city-panel">
  <section id="model-section"><h2>场景模型</h2>
  <label for="model-select">模型</label><div class="model-select-row"><select id="model-select" aria-label="选择地图模型">
    <option value="recon" selected>复杂城市——河南博物院</option>
    <option value="shenzhen">复杂城市——深圳国际交流中心(APEC举办地)</option>
    <option value="wuxi">复杂城市——无锡市市民中心</option>
    <option value="hangzhou">机场区域——杭州萧山机场</option>
  </select><button id="delete-custom-site" type="button" aria-label="删除当前自定义模型" hidden>×</button></div>
  <button id="select-core-buildings" type="button" disabled>选择核心建筑</button></section>
  <section id="layers-section"><h2>场景图层</h2>
  <label><input type="checkbox" id="buildings" checked>建筑</label>
  <label><input type="checkbox" id="terrain" checked>地形</label>
  <label><input type="checkbox" id="imagery" checked>影像地图</label></section>
  <section><h2>场景视角</h2><div class="buttons" id="city-views"><button id="reset">↗ 全域视角</button><button id="top">⌖ 俯视平面</button><button id="core-focus" hidden>⌖ 核心建筑</button></div></section>
  <div class="stats"><div><strong id="count">—</strong><span>建筑要素</span></div><div><strong id="height">—</strong><span>最高建筑 / m</span></div></div>
</div>
<div id="ac8-simulation-bar" aria-label="推演模拟控制">
  <label class="ac8-sim-scenario"><span aria-hidden="true">场景</span><select id="ac8-sim-scenario" aria-label="模拟场景">
    <option value="single" selected>单机单点入侵</option>
    <option value="multi">多方向同步入侵</option>
    <option value="swarm">蜂群饱和攻击</option>
  </select></label>
  <label class="ac8-sim-speed"><span aria-hidden="true">速度</span><select id="ac8-sim-speed" aria-label="模拟速度">
    <option value="1">x1</option><option value="2">x2</option><option value="3">x3</option><option value="5">x5</option>
    <option value="10" selected>x10</option><option value="30">x30</option><option value="60">x60</option><option value="100">x100</option>
  </select></label>
  <button id="ac8-sim-start" type="button" disabled>仿真模拟</button>
  <input id="ac8-sim-progress" type="range" min="0" max="1000" value="0" aria-label="模拟进度" disabled>
  <button id="ac8-sim-history" type="button" aria-controls="ac8-sim-history-panel" aria-expanded="false">模拟历史</button>
</div>
<section id="ac8-sim-history-panel" hidden aria-label="模拟历史">
  <header class="ac8-history-head">
    <div><strong>模拟历史</strong><span>最近 20 次</span></div>
    <button id="ac8-history-close" type="button" aria-label="关闭模拟历史">×</button>
  </header>
  <div id="ac8-history-compare" class="ac8-history-compare"></div>
  <div id="ac8-history-list" class="ac8-history-list"></div>
  <footer class="ac8-history-foot">
    <span id="ac8-history-hint">点击两条记录进行对比</span>
    <button id="ac8-history-clear" type="button">清空历史</button>
  </footer>
</section>`;
mountIntro();
const workspace=createWorkspace(app);
const launchers=app.querySelector('.workspace-launchers');
const revealLaunchers=()=>{document.body.classList.add('app-revealed');launchers?.classList.add('is-visible');};
if(document.getElementById('ac8-intro'))window.addEventListener('ac8-intro-complete',revealLaunchers,{once:true});
else revealLaunchers();
workspace.mountWindow('city','场景设定',app.querySelector('#city-panel'));
workspace.mountWindow('deployment','优化推演',app.querySelector('#deployment-panel'),{onClose:()=>app.dispatchEvent(new CustomEvent('view-change',{detail:'scene'}))});
const el=id=>document.getElementById(id);
const sidebarCollapse=el('sidebar-collapse'),sidebarExpand=el('sidebar-expand');
function setSidebarCollapsed(value){
  app.classList.toggle('sidebar-collapsed',value);
  sidebarCollapse.setAttribute('aria-expanded',String(!value));
  sidebarExpand.setAttribute('aria-expanded',String(!value));
}
sidebarCollapse.onclick=()=>setSidebarCollapsed(true);
sidebarExpand.onclick=()=>setSidebarCollapsed(false);
const deploymentButton=el('toggle-deployment');
let renderer,model,city,terrain,controls,task3;
let scene,camera,imageryTexture,imageryMaterial,grid;
let mode='recon',siteGroups={},siteMeta={},siteParts={},coreHighlight,neighborHighlight,coreLabel;
let currentCoreBounds=null,coreEditor=null;
mountProjectChat(app,()=>({scene:mode,...task3?.getPlanChatContext()}));
const BUILTIN_SITES={
  shenzhen:{
    label:'复杂城市——深圳国际交流中心(APEC举办地)',short:'深圳国际交流中心',
    base:'./data/sites/shenzhen/shenzhen-gba',
    imagery:'./data/sites/shenzhen/shenzhen-imagery.jpg',
  },
  wuxi:{
    label:'复杂城市——无锡市市民中心',short:'无锡市市民中心',
    base:'./data/sites/wuxi/wuxi-gba',
    imagery:'./data/sites/wuxi/wuxi-imagery.jpg',
    // The 3 km Wuxi model needs a wider square than 0.54×span.
    frameHalf:4400,
  },
  hangzhou:{
    label:'机场区域——杭州萧山机场',short:'杭州萧山机场',
    base:'./data/sites/hangzhou/hangzhou-gba',
    imagery:'./data/sites/hangzhou/hangzhou-imagery.jpg',
  },
};
const SITES={...BUILTIN_SITES};
const viewport=el('viewport');
const status=text=>{const node=el('status');node.textContent=text;node.hidden=!text;};
const disableControls=value=>{for (const id of ['buildings','terrain','imagery','reset','top','core-focus','model-select']) el(id).disabled=value;};
disableControls(true);
async function fetchJSON(path){const response=await fetch(path);if(!response.ok)throw Error(`${path}: HTTP ${response.status}`);return response.json();}
try {
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);renderer.localClippingEnabled=true;
  viewport.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=null;
  coreHighlight=new THREE.Group();coreHighlight.name='Core_Building_Highlight';scene.add(coreHighlight);
  const draftCoreHighlight=new THREE.Group();draftCoreHighlight.name='Draft_Core_Highlight';scene.add(draftCoreHighlight);
  neighborHighlight=new THREE.Group();neighborHighlight.name='Core_Neighbor_Highlight';scene.add(neighborHighlight);
  coreLabel=document.createElement('button');coreLabel.id='core-label';coreLabel.className='map-landmark';coreLabel.hidden=true;viewport.append(coreLabel);coreLabel.onclick=()=>focusCore();
  camera=new THREE.PerspectiveCamera(42,1,1,100000);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*0.49;controls.maxDistance=90000;controls.minDistance=20;
  scene.add(new THREE.HemisphereLight(0xd9efff,0x63757b,2.3));
  const sun=new THREE.DirectionalLight(0xffeed5,3);sun.position.set(-4000,8000,3000);scene.add(sun);
  [city,terrain]=await Promise.all([fetchJSON('./data/city.json'),fetchJSON('./data/terrain.json')]);
  const reconCityMetadata=city.metadata;
  status('正在生成建筑与地形网格…');
  await new Promise(resolve=>requestAnimationFrame(resolve));
  model=createModel(city,terrain);scene.add(model.group);
  const reconPlainMaterial=new THREE.MeshStandardMaterial({color:0x243d46,roughness:1,side:THREE.DoubleSide});
  let imageryError;
  if(terrain.imagery){
    try {
      imageryTexture=await new THREE.TextureLoader().loadAsync(`./data/${terrain.imagery.texture}`);
      imageryTexture.colorSpace=THREE.SRGBColorSpace;
      imageryTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      imageryMaterial=new THREE.MeshBasicMaterial({map:imageryTexture,side:THREE.DoubleSide});
      model.ground.material=imageryMaterial;
    }catch(error){imageryError=error;console.warn('影像加载失败',error);}
  }
  const reconBox=new THREE.Box3().setFromObject(model.group);
  const reconSize=reconBox.getSize(new THREE.Vector3());
  const span=Math.max(reconSize.x,reconSize.z);
  const activeGroup=()=>mode==='recon'?model.group:siteGroups[mode];
  const easeInOutCubic=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  const FRAME_DISTANCE=1.3;
  let cameraAnimation=null,mapPicking=false;
  function tweenCamera(position,target,duration=900){
    if(cameraAnimation){cameraAnimation.cancel();cameraAnimation=null;}
    return new Promise(resolve=>{
      const fromPos=camera.position.clone(),fromTarget=controls.target.clone();
      const start=performance.now();
      const anim={cancelled:false,raf:0,cancel(){
        if(anim.cancelled)return;
        anim.cancelled=true;cancelAnimationFrame(anim.raf);controls.enabled=true;
        if(cameraAnimation===anim)cameraAnimation=null;
        resolve();
      }};
      cameraAnimation=anim;controls.enabled=false;
      const step=now=>{
        if(anim.cancelled)return;
        const k=Math.min(1,(now-start)/duration),e=easeInOutCubic(k);
        camera.position.lerpVectors(fromPos,position,e);
        controls.target.lerpVectors(fromTarget,target,e);
        controls.update();
        if(k<1)anim.raf=requestAnimationFrame(step);
        else{cameraAnimation=null;controls.enabled=true;controls.update();resolve();}
      };
      anim.raf=requestAnimationFrame(step);
    });
  }
  function frameTarget(object,top=false,scale=1){
    const box=new THREE.Box3().setFromObject(object);
    if(box.isEmpty())return null;
    const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const objectSpan=Math.max(size.x,size.z,size.y)||1000;
    camera.up.set(0,1,0);
    const portraitFit=window.innerWidth/window.innerHeight<1?1.35:1;
    const position=center.clone().add(new THREE.Vector3(top?0:objectSpan*scale*.66*FRAME_DISTANCE,top?objectSpan*1.55*FRAME_DISTANCE*portraitFit:objectSpan*scale*1.0*FRAME_DISTANCE*portraitFit,top?.001*FRAME_DISTANCE:objectSpan*scale*.92*FRAME_DISTANCE*portraitFit));
    return {center,position};
  }
  function frameObject(object,top=false,scale=1,{animate=true}={}){
    const next=frameTarget(object,top,scale);
    if(!next)return Promise.resolve();
    if(!animate){
      if(cameraAnimation){cameraAnimation.cancel();cameraAnimation=null;}
      camera.position.copy(next.position);controls.target.copy(next.center);controls.update();
      return Promise.resolve();
    }
    return tweenCamera(next.position,next.center,900);
  }
  frameObject(model.group,false,1,{animate:false});
  // After the boot animation, settle closer to the city with a smooth tween.
  function zoomAfterIntro(){
    const run=()=>{
      if(document.documentElement.dataset.ready!=='true'){window.setTimeout(run,200);return;}
      if(mapPicking||el('model-select').disabled)return;
      try{
        const next=frameTarget(activeGroup(),false,.55);
        if(next)tweenCamera(next.position,next.center,1200);
      }catch{}
    };
    window.setTimeout(run,450);
  }
  window.addEventListener('ac8-intro-complete',zoomAfterIntro,{once:true});
  if(window.__ac8IntroDone)zoomAfterIntro();
  const ac8Hud=createAc8Hud({scene,camera,viewport,getActiveGroup:activeGroup});
  window.__ac8Hud=ac8Hud;
  el('reset').onclick=()=>frameObject(activeGroup());
  el('top').onclick=()=>frameObject(activeGroup(),true);
  grid=new THREE.GridHelper(Math.ceil(span/1000)*1000,Math.ceil(span/1000)*2,0x33515b,0x20333b);grid.position.y=reconBox.min.y-1;scene.add(grid);
  el('count').textContent=city.metadata.sourceFeatures.toLocaleString('zh-CN');el('height').textContent=city.metadata.maxHeight;
  function updateStatus(){
    const imageError=mode==='recon'?imageryError:siteParts[mode]?.imageryError;
    const missingImagery=SITES[mode]?.custom&&!SITES[mode].imagery;
    status(missingImagery?'该模型未提供影像底图。':imageError?'影像底图未能加载，当前显示素色地面。':'');
  }
  function updateDiagnostics(){
    if(!city||!terrain||!model)return;
    const sites=Object.fromEntries(Object.entries(SITES).map(([id,site])=>[id,{loaded:!!siteGroups[id]?.children.length,buildingCount:siteMeta[id]?.buildingCount??site.buildingCount??null,maxHeight:siteMeta[id]?.maxHeight??site.maxHeight??null}]));
    window.cityDiagnostics={features:city.metadata.sourceFeatures,parts:city.buildings.length,terrainVertices:terrain.positions.length/3,buildingTriangles:model.buildings.geometry.attributes.position.count/3,imagery:!!imageryTexture,modelMode:mode,coreCount:coreHighlight.userData.buildingCount??0,coreNeighbors:neighborHighlight.userData.buildingCount??0,models:{recon:{loaded:true,featureCount:reconCityMetadata.sourceFeatures},...sites}};
  }
  function addGround(group,meta,texture,bounds,terrainData){
    const geometry=terrainData?buildTerrainGeometry(terrainData):siteGroundGeometry(bounds,meta.baseElevation??0);
    // The map meets the walls at grade. Depth bias separates coincident bottom faces.
    const surface={side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1};
    const textureMaterial=texture?new THREE.MeshBasicMaterial({...surface,map:texture}):null;
    const plainMaterial=new THREE.MeshStandardMaterial({...surface,color:0x243d46,roughness:1});
    const plane=new THREE.Mesh(geometry,textureMaterial??plainMaterial);
    plane.name='TianDiTu_Imagery';
    plane.userData.textureMaterial=textureMaterial;
    plane.userData.plainMaterial=plainMaterial;
    group.add(plane);
    return plane;
  }
  async function ensureCustomSite(id,site){
    const {city:siteCity,terrain:terrainData,meta}=await loadSiteCity(site,document.baseURI);
    if(!meta.custom||meta.meshType!=='json')throw Error('自定义模型的元数据无效');
    const {geometry,ranges}=buildCityGeometry(siteCity.buildings);
    const buildings=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xc6ccd4,roughness:0.95,side:THREE.DoubleSide}));
    const group=new THREE.Group();
    group.name=`${id}_Buildings_DEM`;group.visible=false;group.userData={...siteCity.metadata};group.add(buildings);
    let texture=null,imageryError=null;
    if(site.imagery){
      try{
        texture=await new THREE.TextureLoader().loadAsync(site.imagery);
        texture.colorSpace=THREE.SRGBColorSpace;
        texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      }catch(error){imageryError=error;}
    }
    const ground=addGround(group,meta,texture,meta.localBounds,terrainData);
    siteMeta[id]=meta;
    siteParts[id]={group,buildings,ground,ranges,buildingsData:siteCity,imageryError};
    scene.add(group);siteGroups[id]=group;
  }
  async function ensureSite(id){
    const site=SITES[id];
    if(!site)return;
    if(siteGroups[id]?.children.length)return;
    status(`正在加载${site.label}…`);
    if(site.custom)return ensureCustomSite(id,site);
    const buildingData=site.buildings
      ?fetchJSON(site.buildings).catch(error=>{console.warn(`${site.short}建筑明细加载失败`,error);return null;})
      :Promise.resolve(null);
    const meshData=fetchJSON(`${site.base}-meta.json`).then(async meta=>{
      const version=meta.glb?.sha256?`?v=${meta.glb.sha256}`:'';
      const gltf=await new GLTFLoader().loadAsync(`${site.base}.glb${version}`);
      return {meta,gltf};
    });
    const [{meta,gltf},buildingsData,imageryMeta]=await Promise.all([
      meshData,
      buildingData,
      fetchJSON(site.imagery.replace(/\.jpe?g$/i,'.json')).catch(()=>null),
    ]);
    siteMeta[id]=meta;
    let buildingMesh=null;
    gltf.scene.traverse(child=>{if(child.isMesh&&child.material){child.material.side=THREE.DoubleSide;buildingMesh??=child;}});
    const group=new THREE.Group();group.name=`${id}_GBA_LoD1`;group.visible=false;group.add(gltf.scene);
    if(site.frameHalf)group.userData.frameHalf=site.frameHalf;
    const origin=[meta.center?.[0]??0,meta.center?.[1]??0,0];
    group.userData={...group.userData,name:meta.name,origin,ecefTransform:null};
    siteParts[id]={group,buildings:buildingMesh??gltf.scene,ground:null,buildingsData};
    let bounds=meta.localBounds,texture=null;
    try{
      bounds=siteImageBounds(meta,imageryMeta);
      texture=await new THREE.TextureLoader().loadAsync(site.imagery);
      texture.colorSpace=THREE.SRGBColorSpace;
      texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    }catch(error){
      siteParts[id].imageryError=error;
      console.warn(`${site.short}影像底图加载失败`,error);
    }
    siteParts[id].ground=addGround(group,meta,texture,bounds);
    if(meta.route?.points?.length){
      const route=meta.route.points.map(point=>new THREE.Vector3(point[0],2,point[1]));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(route),new THREE.LineBasicMaterial({color:0x6ce5c3,depthTest:false,transparent:true,opacity:0.95})));
      const curve=new THREE.CatmullRomCurve3(meta.route.points.map(point=>new THREE.Vector3(point[0],3,point[1])));
      const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(48,meta.route.points.length*24),32,6,false),new THREE.MeshBasicMaterial({color:0x6ce5c3,transparent:true,opacity:0.28,depthTest:false,side:THREE.DoubleSide}));
      tube.renderOrder=9;group.add(tube);
    }
    scene.add(group);siteGroups[id]=group;
  }
  function siteSensorContext(id){
    const meta=siteMeta[id],parts=siteParts[id];
    if(!meta||!parts?.buildings||!parts.ground)return null;
    parts.ground.geometry.computeBoundingBox();
    const core=meta.coreBuilding,[x,z]=core?.center??[0,0];
    const baseY=core?.rings?.[0]?.[0]?.[1]??0;
    return {
      model:{group:parts.group,buildings:parts.buildings,ground:parts.ground,ranges:parts.ranges??[]},
      origin:meta.origin??[meta.center?.[0]??0,meta.center?.[1]??0,0],
      anchor:meta.analysisAnchor??[x,baseY+(Number(core?.height)||0)+2,z],
      meta,
    };
  }
  function clearBuildingHighlights(group){
    const materials=new Set();
    for(const child of [...group.children]){child.geometry?.dispose();if(child.material)materials.add(child.material);group.remove(child);}
    for(const material of materials)material.dispose();
    group.visible=false;group.userData.buildingCount=0;
  }
  function setNeighborHighlight(buildings,cores){
    clearBuildingHighlights(neighborHighlight);
    if(!cores.length||!buildings?.length)return;
    const references=cores.map(core=>coreFootprintBounds([core])).filter(Boolean);
    const coreIds=new Set(cores.map(core=>core.id)),candidates=new Map();
    for(const building of buildings){
      if(coreIds.has(building.id))continue;
      const center=coreFootprintBounds([building]);
      if(!center)continue;
      const distance=Math.min(...references.map(core=>Math.hypot(center.x-core.x,center.z-core.z)));
      if(distance<=250&&distance<(candidates.get(building.id)?.distance??Infinity))candidates.set(building.id,{building,distance});
    }
    const neighbors=[...candidates.values()].sort((a,b)=>a.distance-b.distance).slice(0,60);
    if(!neighbors.length)return;
    const roofMaterial=new THREE.LineBasicMaterial({color:0xffd166,depthTest:false,transparent:true,opacity:0.9});
    const baseMaterial=new THREE.LineBasicMaterial({color:0xffb347,depthTest:false,transparent:true,opacity:0.3});
    for(const {building} of neighbors){
      const baseY=building.rings[0][0][1];
      const height=Math.max(0.5,Number(building.height)||0);
      for(const ring of building.rings){
        const closed=ring.length>1&&ring[0][0]===ring[ring.length-1][0]&&ring[0][2]===ring[ring.length-1][2];
        const points=closed?ring.slice(0,-1):ring;
        const roof=points.map(point=>new THREE.Vector3(point[0],baseY+height+0.35,point[2]));
        const base=points.map(point=>new THREE.Vector3(point[0],baseY+0.3,point[2]));
        neighborHighlight.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(roof),roofMaterial));
        neighborHighlight.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(base),baseMaterial));
      }
      const cap=roofCap(building.rings,baseY+height+0.2,0xffc857,0.24);if(cap)neighborHighlight.add(cap);
    }
    neighborHighlight.userData.buildingCount=neighbors.length;
    neighborHighlight.visible=true;
  }
  function coreCenter(cores){
    const bounds=coreFootprintBounds(cores);
    if(bounds&&cores.length===1)bounds.top=bounds.bottom+coreDisplayHeight(cores[0]);
    return bounds;
  }
  function roofCap(rings,y,color,opacity){
    if(!rings?.[0]?.length)return null;
    const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    const mesh=new THREE.Mesh(roofHighlightGeometry(rings,y),material);
    mesh.renderOrder=7;
    return mesh;
  }
  function coreDisplayHeight(core){
    return core.id==='synthetic-venue-footprint'?0:Math.max(0,Number(core.height)||0);
  }
  function drawCoreHighlights(group,cores,color,glowColor){
    clearBuildingHighlights(group);
    if(!cores.length)return;
    const roofMaterial=new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:0.95});
    const glowMaterial=glowColor&&cores.some(core=>coreDisplayHeight(core)>0)
      ?new THREE.LineBasicMaterial({color:glowColor,depthTest:false,transparent:true,opacity:0.35}):null;
    for(const core of cores){
      const baseY=core.rings[0][0][1],height=coreDisplayHeight(core);
      for(const ring of core.rings){
        const roof=ring.map(([x,,z])=>new THREE.Vector3(x,baseY+height,z));
        group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(roof),roofMaterial));
        if(glowMaterial&&height){
          const base=ring.map(([x,,z])=>new THREE.Vector3(x,baseY,z));
          group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(base),glowMaterial));
        }
      }
      const cap=roofCap(core.rings,baseY+height,color,0.32);if(cap)group.add(cap);
    }
    group.userData.buildingCount=cores.length;
    group.visible=true;
  }
  function setCoreHighlight(core,name){
    const cores=(Array.isArray(core)?core:core?[core]:[]).filter(building=>building.rings?.[0]?.length);
    currentCoreBounds=coreCenter(cores);
    drawCoreHighlights(coreHighlight,cores,0xffd166,0xfff3b0);
    if(!currentCoreBounds){coreLabel.hidden=true;return;}
    coreLabel.textContent=`⌖ ${name}${cores.length===1&&!coreDisplayHeight(cores[0])?'（示意范围）':''}`;
    coreLabel.title=`定位${name}`;
    coreLabel.hidden=false;
  }
  function setCoreForMode(next){
    const meta=siteMeta[next],custom=SITES[next]?.custom,cores=siteCoreBuildings(meta),first=cores[0];
    const name=meta?.coreName??first?.name??'核心建筑';
    setCoreHighlight(custom?cores:first,name);
    // 内置站点沿用原有邻域层，自定义模型只渲染选中的建筑。
    setNeighborHighlight([],custom?[]:cores);
    const button=el('core-focus');
    if(currentCoreBounds){button.hidden=false;button.disabled=false;button.textContent=`⌖ ${custom?name:first?.shortName||name}`;button.title=`定位${name}`;}
    else{button.hidden=true;button.disabled=true;}
  }
  function focusCore(){
    const center=currentCoreBounds;
    if(!center)return;
    const target=new THREE.Vector3(center.x,(center.bottom+center.top)/2,center.z);
    if(SITES[mode]?.custom){
      const radius=Math.hypot(center.east-center.west,center.top-center.bottom,center.north-center.south)*0.5;
      const halfAngle=Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*Math.min(1,camera.aspect));
      const distance=Math.max(120,1.35*radius/Math.sin(halfAngle));
      tweenCamera(target.clone().add(new THREE.Vector3(.7,.85,.9).normalize().multiplyScalar(distance)),target,850);
      return;
    }
    const span=Math.max(center.size*1.8,120);
    tweenCamera(target.clone().add(new THREE.Vector3(span*.7,span*.85,span*.9)),target,850);
  }
  function updateCoreLabel(){
    const center=currentCoreBounds;
    if(!center||!coreHighlight.visible){coreLabel.hidden=true;return;}
    const point=new THREE.Vector3(center.x,center.top+18,center.z);
    camera.updateMatrixWorld();point.project(camera);
    const visible=point.z>=-1&&point.z<=1&&Math.abs(point.x)<0.95&&Math.abs(point.y)<0.92;
    coreLabel.hidden=!visible;
    if(visible){coreLabel.style.left=`${(point.x+1)/2*viewport.clientWidth}px`;coreLabel.style.top=`${(1-point.y)/2*viewport.clientHeight}px`;}
  }
  function applyModeLayers(){
    const showBuildings=el('buildings').checked;
    const showTerrain=el('terrain').checked;
    const showImagery=el('imagery').checked;
    if(mode==='recon'){
      model.buildings.visible=showBuildings;
      model.ground.visible=showTerrain;
      if(imageryMaterial){
        const old=model.ground.material;
        model.ground.material=showImagery?imageryMaterial:reconPlainMaterial;
        if(old!==model.ground.material&&old!==imageryMaterial&&old!==reconPlainMaterial)old.dispose();
      }
    }else{
      coreHighlight.visible=showBuildings&&!!currentCoreBounds;
      neighborHighlight.visible=showBuildings&&neighborHighlight.userData.buildingCount>0;
      const parts=siteParts[mode];
      if(parts){
        parts.buildings.visible=showBuildings;
        if(parts.ground){
          parts.ground.visible=showTerrain;
          const {textureMaterial,plainMaterial}=parts.ground.userData;
          parts.ground.material=showImagery&&textureMaterial?textureMaterial:plainMaterial;
        }
      }
    }
    el('imagery').disabled=mode==='recon'?!imageryMaterial:!siteParts[mode]?.ground?.userData.textureMaterial;
  }
  function applyModeUI(next){
    // Restore the metadata before rendering the panel: switching back to recon
    // used to read the previous site metadata because this assignment came later.
    if(next==='recon')city.metadata=reconCityMetadata;
    else if(siteMeta[next])city.metadata=siteAnalysisMetadata(siteMeta[next],SITES[next]);
    if(next==='recon'){el('count').textContent=reconCityMetadata.sourceFeatures.toLocaleString('zh-CN');el('height').textContent=reconCityMetadata.maxHeight;}
    else{const meta=siteMeta[next];el('count').textContent=(meta?.buildingCount??0).toLocaleString('zh-CN');el('height').textContent=meta?.maxHeight??'—';}
    const museum=el('museum-focus');if(museum)museum.hidden=next!=='recon';
    landmarks?.setActive?.(next==='recon');
    setCoreForMode(next);
    coreEditor?.refresh();
    applyModeLayers();
    task3?.setScene?.(activeSiteDescriptor());
  }
  function activeSiteDescriptor(){
    if(mode==='recon')return null;
    const site=SITES[mode],meta=siteMeta[mode];
    const coreName=meta?.coreName??siteCoreBuildings(meta)[0]?.name??(site.custom?null:site.short);
    return {base:site.base,label:site.label,custom:!!site.custom,coreName};
  }
  async function getTask3BuildingContext(signal){
    const sceneId=mode;
    if(sceneId==='recon')return {sceneKey:'recon',city,model};
    const site=SITES[sceneId],parts=siteParts[sceneId];
    if(!parts?.buildings)throw Error('当前地图的建筑模型尚未加载');
    let data=parts.buildingsData;
    if(!data){
      const response=await fetch(site.buildings??`${site.base}.json`,{signal});
      if(!response.ok)throw Error(`建筑明细 HTTP ${response.status}`);
      data=await response.json();
    }
    signal.throwIfAborted();
    if(sceneId!==mode)throw Error('地图已切换，请重新选点');
    if(!data?.buildings?.length)throw Error('当前地图没有可选建筑明细');
    if(data.buildings.length!==siteMeta[sceneId].buildingCount)throw Error('建筑明细数量与当前模型不一致');
    parts.buildingsData=data;
    return {sceneKey:site.base,city:data,model:parts};
  }
  async function setMode(next){
    if(!(next==='recon'||SITES[next]))return false;
    if(coreEditor?.busy)return false;
    if(next===mode){frameObject(activeGroup());return true;}
    const select=el('model-select');
    if(select.disabled)return false;
    coreEditor?.close();
    select.value=next;select.disabled=true;
    const hud=window.__ac8Hud;
    const cityWindow=document.querySelector('#city-window');
    const cityOpen=!!cityWindow?.open&&!cityWindow.classList.contains('is-minimized');
    if(cityOpen)workspace.minimizeWindow('city');
    status('正在切换模型…');
    try{
      task3?.setMapSwitching(true);
      // 1) hide the old map at the current square size (south -> north)
      if(hud?.playScanHide)await hud.playScanHide();
      // 2) load the new map while it is hidden
      if(SITES[next])await ensureSite(next);
      const nextGroup=next==='recon'?model.group:siteGroups[next];
      // 3) then animate the square to the new model size and pull the camera
      //    back/forward so the map keeps the same apparent size in the lens
      await Promise.all([
        hud?.animateToGroup?.(nextGroup,{duration:700}),
        frameObject(nextGroup,false,1),
      ]);
      // 4) switch visibility, then reveal the new map north -> south
      mode=next;
      model.group.visible=next==='recon';
      for(const [id,group] of Object.entries(siteGroups))group.visible=id===next;
      grid.visible=next==='recon';
      applyModeUI(next);
      sensors?.setActiveScene?.(next,next==='recon'?null:siteSensorContext(next));
      hud?.syncToGroup?.(nextGroup);
      hud?.prepareScanClip?.();
      if(hud?.playScanReveal)await hud.playScanReveal();
      updateStatus();updateDiagnostics();
      return true;
    }catch(error){select.value=mode;status(`模型加载失败：${error.message}`);hud?.endSwitchScan?.();return false;}
    finally{select.disabled=false;task3?.setMapSwitching(false);if(cityOpen)workspace.restoreWindow('city');}
  }
  el('model-select').onchange=()=>setMode(el('model-select').value);
  el('core-focus').onclick=focusCore;
  for(const id of ['buildings','terrain','imagery'])el(id).onchange=applyModeLayers;
  const resize=()=>{camera.aspect=viewport.clientWidth/viewport.clientHeight;camera.updateProjectionMatrix();renderer.setSize(viewport.clientWidth,viewport.clientHeight);window.__ac8Hud?.resize?.();};
  new ResizeObserver(resize).observe(viewport);resize();
  let sensors;
  const landmarks=mountLandmarks({city,scene,camera,controls,viewport,tweenCamera});
  const museumFocus=el('museum-focus');if(museumFocus)el('city-views').append(museumFocus);
  let lastHudStamp=0;
  renderer.setAnimationLoop(stamp=>{
    const dt=lastHudStamp?Math.min(.1,(stamp-lastHudStamp)/1000):0;lastHudStamp=stamp;
    controls.update();landmarks.update();updateCoreLabel();task3?.update?.(stamp);
    window.__ac8Hud?.update?.(dt);
    if(!sensors?.render())renderer.render(scene,camera);
    window.__ac8Hud?.render?.();
  });
  disableControls(false);el('imagery').checked=!!imageryMaterial;applyModeUI(mode);updateStatus();
  sensors=mountSensorUI({app,scene,camera,controls,renderer,model,city,workspace,tweenCamera,onPickView:()=>{cancelAnimationFrame(equipmentShiftFrame);equipmentShift=0;applyEquipmentShift(0);return frameObject(activeGroup(),true,1,{animate:false});}});
  function coreCoordinateText(){
    const transform=city?.metadata?.ecefTransform;
    let position=null;
    if(mode==='recon'){
      position=landmarks?.landmark?.position??null;
    }else if(SITES[mode]?.custom&&currentCoreBounds){
      const {x,z,top}=currentCoreBounds;
      position=[x,top,z];
    }else{
      const core=siteMeta[mode]?.coreBuilding;
      if(core?.center)position=[core.center[0],Number(core.height)||0,core.center[1]];
    }
    if(!position||!transform)return '—';
    try{
      const {longitude,latitude}=flightTelemetry(position,transform,()=>0);
      return `东经 ${longitude.toFixed(6)}° · 北纬 ${latitude.toFixed(6)}°`;
    }catch{return '—';}
  }
  const shortPlanName=name=>String(name??'').split(' · ')[0]||'—';
  const pct=value=>Number.isFinite(value)?`${(value*100).toFixed(1)}%`:'—';
  function currentPlan(){
    const diag=window.task3Diagnostics,report=window.__task3Report;
    return report?.plans?.find(plan=>plan.id===diag?.planId)??report?.plans?.find(plan=>plan.id===diag?.recommendedId)??report?.plans?.[0]??null;
  }
  function currentMetric(plan=currentPlan()){
    const diag=window.task3Diagnostics;
    return plan?.metrics?.find(row=>row.condition===diag?.condition)??plan?.metrics?.[0]??null;
  }
  function sceneLine(){
    const area=mode==='recon'?'河南博物院':(SITES[mode]?.short??SITES[mode]?.label??'—');
    return `${area} · ${coreCoordinateText()}`;
  }
  function equipmentConfigText(){
    const snapshot=sensors?.getEquipmentSnapshot?.()??window.task3Diagnostics?.lastEquipmentSnapshot??window.__task3Report?.equipmentSnapshot??null;
    const ids=snapshot?.selectedPresetIds??[];
    const profiles=snapshot?.profiles??[],byType=new Map(),order=['雷达','无线电','光电','声学','5G-A','静电'],rank=name=>{const index=order.indexOf(name);return index<0?order.length:index;};
    for(const id of ids){
      const profile=profiles.find(item=>item.presetId===id),type=CATALOG_TYPES[profile?.type]??'未知',names=byType.get(type)??[];
      names.push(profile?.name??id);byType.set(type,names);
    }
    const selection=[...byType.entries()].sort(([a],[b])=>rank(a)-rank(b)).map(([type,names])=>`${type} ${[...new Set(names)].join('、')}`).join('｜');
    const library=sensors?.getEquipmentLibrary()??[];
    const inventory=library.length?`装备库 ${library.length} 项（${library.map(({type,name})=>`${CATALOG_TYPES[type]} ${name}`).join('、')}）`:'装备库为空';
    return `${selection?`已选 ${selection}`:'未配置装备'} · ${inventory}`;
  }
  function deploymentInputText(){
    if(!el('task3-scope-width'))return '等待推演输入';
    const value=id=>el(`task3-${id}`)?.value||'—';
    const threat=el('task3-threat')?.selectedOptions[0]?.textContent??'—';
    const diag=window.task3Diagnostics;
    const state=diag?.busy?' · 方案计算中':diag?.staleResult?' · 结果已过期，待重新生成':'';
    return `范围 ${value('scope-width')} × ${value('scope-depth')} m · 网格 ${value('spacing')} m · 预算 ${value('budget')} · 设备上限 ${value('max-devices')} · 威胁 ${threat}（${value('threat-count')} 架，高度 ${value('threat-agl')} m，速度 ${value('threat-speed')} m/s）${state}`;
  }
  function noResultText(){return window.task3Diagnostics?.busy?'方案计算中，尚未生成':'尚未生成';}
  function resultStateText(){
    const diag=window.task3Diagnostics;
    if(diag?.mobilePending)return '移动补盲计算中，显示原方案结果 · ';
    if(diag?.busy)return '方案计算中，显示上一轮结果 · ';
    return diag?.staleResult?'结果已过期，显示上一轮结果 · ':'';
  }
  function planComparisonText(){
    const report=window.__task3Report,plan=currentPlan();
    if(!plan)return noResultText();
    const recommended=shortPlanName(report.plans.find(row=>row.id===report.recommendedId)?.name);
    const score=report.scoring?.plans?.find(row=>row.id===plan.id)?.score;
    const cost=Number.isFinite(plan.cost)?plan.cost.toFixed(1):'—';
    const scoreText=Number.isFinite(score)?score.toFixed(3):'—';
    const scoreLabel=plan.derivation?'原方案综合分':'综合分';
    return `${resultStateText()}${report.plans.length} 套 · 推荐 ${recommended} · 当前 ${shortPlanName(plan.name)} · 设备 ${plan.devices.length} 台 · 相对成本 ${cost} · ${scoreLabel} ${scoreText}`;
  }
  function blindAnalysisText(){
    const diag=window.task3Diagnostics,report=window.__task3Report,plan=currentPlan();
    if(!plan?.metrics?.length)return noResultText();
    const current=currentMetric(plan),weakest=Math.min(...plan.metrics.map(row=>row.coverageRate));
    const average=plan.metrics.reduce((sum,row)=>sum+row.blindRate,0)/plan.metrics.length;
    const index=Math.max(0,report?.conditions?.findIndex(row=>row.id===diag?.condition)??0);
    const points=diag?.blindStats?.total??report.blindspots?.[plan.id]?.[index]?.stats?.total;
    return `${resultStateText()}当前工况覆盖 ${pct(current?.coverageRate)} · 最弱工况覆盖 ${pct(weakest)} · 盲区采样点 ${points??'—'} · 平均盲区占比 ${pct(average)} · 核心区覆盖 ${pct(current?.coreCoverageRate)} / 二重覆盖 ${pct(current?.coreRedundantRate)}`;
  }
  function emcText(){
    const plan=currentPlan(),emc=window.__task3Report?.emc?.[plan?.id];
    if(!emc)return noResultText();
    const verdict={pass:'通过',degraded:'降额',fail:'不通过'}[emc.verdict]??'—';
    const status=typeof plan.deployable==='boolean'?` · 部署状态 ${plan.deployable?'可部署':'不可部署'}`:'';
    return `${resultStateText()}${verdict} · 严重 ${emc.counts?.fail??'—'} / 提示 ${emc.counts?.warning??'—'}${status}`;
  }
  const sceneSummary=()=>({
    scene:sceneLine(),
    equipmentConfig:equipmentConfigText(),
    deploymentInput:deploymentInputText(),
    planComparison:planComparisonText(),
    blindAnalysis:blindAnalysisText(),
    emc:emcText(),
  });
  const sceneMenu=mountSceneMenu({app,launchers,panel:app.querySelector('#city-panel'),workspace,camera,renderer,getInfo:sceneSummary});
  mountCustomSites({menu:el('ac8-scene-menu'),select:el('model-select'),switchTo:setMode,currentSite:()=>mode,announce:status,register(site){
    const base=`./data/custom-sites/${site.slug}/${site.slug}`;
    SITES[site.slug]={custom:true,label:site.name,short:site.name,base:`${base}-gba`,
      buildings:`${base}-gba.json`,imagery:site.imagery?`${base}-imagery.jpg`:null,
      buildingCount:site.buildingCount,maxHeight:site.maxHeight};
    updateDiagnostics();
  },unregister(slug){
    const parts=siteParts[slug];
    if(parts){
      scene.remove(parts.group);
      parts.buildings.geometry.dispose();
      parts.buildings.material.dispose();
      parts.ground.geometry.dispose();
      const {plainMaterial,textureMaterial}=parts.ground.userData;
      plainMaterial.dispose();
      textureMaterial?.map?.dispose();
      textureMaterial?.dispose();
    }
    delete SITES[slug];delete siteGroups[slug];delete siteMeta[slug];delete siteParts[slug];
    updateDiagnostics();
  }});
  function restoreOverview(){
    if(['ready','computing'].includes(window.equipmentDemoDiagnostics?.status))return;
    frameObject(activeGroup());
  }
  let equipmentShift=0,equipmentShiftFrame=0;
  function applyEquipmentShift(value){
    const width=viewport.clientWidth||window.innerWidth,height=viewport.clientHeight||window.innerHeight;
    if(value<=.0005)camera.clearViewOffset();
    else camera.setViewOffset(width,height,-width*value,0,width,height);
    camera.updateProjectionMatrix();
  }
  function animateEquipmentShift(target,duration=1000){
    cancelAnimationFrame(equipmentShiftFrame);
    const from=equipmentShift,start=performance.now();
    const step=now=>{
      const t=Math.min(1,(now-start)/duration),eased=1-Math.pow(1-t,3);
      equipmentShift=from+(target-from)*eased;
      applyEquipmentShift(equipmentShift);
      if(t<1)equipmentShiftFrame=requestAnimationFrame(step);
    };
    equipmentShiftFrame=requestAnimationFrame(step);
  }
  function equipmentFocusShift(){
    const content=app.querySelector('#ac8-equipment-menu .ac8-hud-content');
    const rect=content?.getBoundingClientRect();
    if(!rect)return .18;
    return Math.max(.1,Math.min(.34,(rect.right+56-window.innerWidth/2)/window.innerWidth));
  }
  const equipmentMenu=mountHudMenu({
    app,launchers,kind:'equipment',launcher:app.querySelector('#toggle-sensors'),
    panel:app.querySelector('#equipment-panel'),contentClass:'is-equipment',
    entries:[
      {id:'radar',label:'雷达'},
      {id:'optical',label:'光电'},
      {id:'radio',label:'无线电'},
      {id:'acoustic',label:'声学'},
      {id:'fivega',label:'5G-A'},
      {id:'electrostatic',label:'静电'},
      {id:'inventory',label:'装备清单'},
    ],
    onOpen:()=>{
      // Hide the task3 layer before showing the equipment markers.
      app.dispatchEvent(new CustomEvent('view-change',{detail:'scene'}));
      sensors.activate();
    },
    onSelect:(type,{content})=>{
      const inventory=type==='inventory';
      content.parentElement.classList.toggle('is-inventory',inventory);
      if(inventory)sensors.showEquipmentInventory();
      else document.querySelector(`#equipment-tab-${type}`)?.click();
      animateEquipmentShift(equipmentFocusShift(),1100);
    },
    onDetailExit:()=>{
      app.querySelector('#ac8-equipment-menu')?.classList.remove('is-inventory');
      animateEquipmentShift(0,850);restoreOverview();
    },
    onClose:()=>{
      app.querySelector('#ac8-equipment-menu')?.classList.remove('is-demo-details','is-inventory');
      sensors.hideDemoHud();sensors.stopDemo();
      animateEquipmentShift(0,850);sensors.deactivate();restoreOverview();
    },
  });
  window.addEventListener('resize',()=>{
    if(equipmentMenu?.active()==='inventory')animateEquipmentShift(equipmentFocusShift(),260);
    else if(equipmentShift>0)applyEquipmentShift(equipmentShift);
  });
  app.addEventListener('equipment-demo-details',()=>{
    if(!sensors.showDemoHud())return;
    app.querySelector('#ac8-equipment-menu')?.classList.add('is-demo-details');
    animateEquipmentShift(0,850);restoreOverview();
  });
  app.addEventListener('equipment-demo-back',()=>{
    app.querySelector('#ac8-equipment-menu')?.classList.remove('is-demo-details');
  });
  window.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    const root=app.querySelector('#ac8-equipment-menu');
    if(!root?.classList.contains('is-demo-details'))return;
    event.preventDefault();event.stopImmediatePropagation();
    app.dispatchEvent(new CustomEvent('equipment-demo-back'));
  },true);
  const simStart=app.querySelector('#ac8-sim-start'),simSpeed=app.querySelector('#ac8-sim-speed'),simProgress=app.querySelector('#ac8-sim-progress'),simScenario=app.querySelector('#ac8-sim-scenario');
  let simSeeking=false;
  const simMode=()=>['single','multi','swarm'].includes(simScenario?.value)?simScenario.value:'single';
  const currentPlayback=()=>task3?.getThreatPlayback?.()??{};
  function updateSimulationBar(){
    if(!task3)return;
    const state=currentPlayback();
    simStart.disabled=!!state.busy||!!state.blocked;
    simStart.textContent=state.playing?'暂停仿真':state.enabled&&state.duration&&state.time>=state.duration?'再次仿真':state.enabled&&state.time>0?'继续仿真':'仿真模拟';
    simStart.dataset.playing=String(!!state.playing);
    if(simScenario&&state.key&&simScenario.value!==state.key)simScenario.value=state.key;
    if(Number(simSpeed.value)!==state.speed&&state.speed)simSpeed.value=String(state.speed);
    const progress=state.duration?Math.max(0,Math.min(100,state.time/state.duration*100)):0;
    if(!simSeeking)simProgress.value=String(progress*10);
    simProgress.style.setProperty('--ac8-progress',`${progress}%`);
    simProgress.disabled=!state.enabled;
  }
  if(simStart&&simSpeed&&simProgress){
    simStart.onclick=()=>{
      const state=task3?.getThreatPlayback?.()??{};
      if(state.playing){task3.pauseThreatSimulation?.();return;}
      const fresh=!state.enabled||!state.duration||state.time===0||state.time>=state.duration;
      const started=task3?.startThreatSimulation?.(simMode());
      if(started!==false&&fresh){const result=task3?.getThreatResult?.();if(result)recordSimulation(result);}
    };
    simScenario?.addEventListener('change',()=>{task3?.selectThreatScenario?.(simMode());updateSimulationBar();});
    simSpeed.onchange=()=>task3?.setThreatSpeed?.(Number(simSpeed.value));
    simProgress.oninput=()=>task3?.setThreatProgress?.(Number(simProgress.value));
    simProgress.onpointerdown=()=>{simSeeking=true;};
    simProgress.onpointercancel=()=>{simSeeking=false;};
    window.addEventListener('pointerup',()=>{simSeeking=false;});
    updateSimulationBar();
    window.setInterval(updateSimulationBar,160);
  }
  const historyPanel=app.querySelector('#ac8-sim-history-panel'),historyList=app.querySelector('#ac8-history-list'),historyCompare=app.querySelector('#ac8-history-compare');
  const historyButton=app.querySelector('#ac8-sim-history'),historyClose=app.querySelector('#ac8-history-close'),historyClear=app.querySelector('#ac8-history-clear'),historyHint=app.querySelector('#ac8-history-hint');
  const HISTORY_KEY='uav-simulation-history-v1';
  let simulationHistory=[];
  try{const stored=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');if(Array.isArray(stored))simulationHistory=stored.filter(item=>item&&typeof item==='object').slice(0,20);}catch{}
  let compareSelection=[];
  const secs=value=>Number.isFinite(value)?`${value.toFixed(1)} s`:'—';
  const historyTime=value=>{const date=new Date(value);return Number.isFinite(value)&&!Number.isNaN(date.getTime())?date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'—';};
  const persistHistory=()=>{try{localStorage.setItem(HISTORY_KEY,JSON.stringify(simulationHistory.slice(0,20)));}catch{}};
  const historyCell=text=>{const span=document.createElement('span');span.textContent=text;return span;};
  function renderHistoryCompare(){
    historyCompare.replaceChildren();
    const indices=compareSelection.length===2?[...compareSelection]:[0,1].filter(index=>index<simulationHistory.length);
    if(indices.length<2){const empty=document.createElement('p');empty.className='ac8-history-empty';empty.textContent='至少需要两次模拟记录才能对比';historyCompare.append(empty);return;}
    const [a,b]=indices.map(index=>simulationHistory[index]);
    const head=document.createElement('div');head.className='ac8-history-compare-head';
    head.append(historyCell('指标'),historyCell(`记录 A · ${historyTime(a.createdAt)}`),historyCell(`记录 B · ${historyTime(b.createdAt)}`),historyCell('差值'));
    head.firstElementChild.className='ac8-history-compare-label';head.lastElementChild.className='ac8-history-compare-delta';
    historyCompare.append(head);
    const rows=[['方案',entry=>entry.planName,null,null],['工况',entry=>entry.conditionName,null,null],['设备 / 台',entry=>entry.deviceCount,entry=>entry.deviceCount,'int'],['覆盖率',entry=>pct(entry.coverageRate),entry=>entry.coverageRate,'pp'],['盲区率',entry=>pct(entry.blindRate),entry=>entry.blindRate,'pp'],['核心区覆盖',entry=>pct(entry.coreCoverageRate),entry=>entry.coreCoverageRate,'pp'],['航迹检出',entry=>pct(entry.detectedFraction),entry=>entry.detectedFraction,'pp'],['首报时间',entry=>entry.firstDetectionTime===null?'未检出':secs(entry.firstDetectionTime),entry=>entry.firstDetectionTime,'sec'],['失联次数',entry=>entry.lossEvents,entry=>entry.lossEvents,'int'],['模拟速度',entry=>`x${entry.speed}`,entry=>entry.speed,'speed']];
    for(const [label,format,numeric,kind] of rows){
      const row=document.createElement('div');row.className='ac8-history-compare-row';
      const labelCell=historyCell(label);labelCell.className='ac8-history-compare-label';
      row.append(labelCell,historyCell(format(a)??'—'),historyCell(format(b)??'—'));
      let delta='—';
      if(numeric&&kind){const left=numeric(a),right=numeric(b);if(Number.isFinite(left)&&Number.isFinite(right)){const diff=right-left;if(kind==='pp')delta=`${diff>=0?'+':''}${(diff*100).toFixed(1)} pp`;else if(kind==='sec')delta=`${diff>=0?'+':''}${diff.toFixed(1)} s`;else if(kind==='speed')delta=`${diff>=0?'+':''}x${Math.abs(diff)}`;else delta=`${diff>=0?'+':''}${diff}`;}}
      const deltaCell=historyCell(delta);deltaCell.className='ac8-history-compare-delta';row.append(deltaCell);
      historyCompare.append(row);
    }
  }
  function renderHistory(){
    historyList.replaceChildren();
    const head=document.createElement('div');head.className='ac8-history-row ac8-history-row-head';
    for(const label of ['时间','方案','工况','覆盖率','盲区','航迹检出','首报','失联'])head.append(historyCell(label));
    historyList.append(head);
    if(!simulationHistory.length){const empty=document.createElement('p');empty.className='ac8-history-empty';empty.textContent='暂无模拟记录';historyList.append(empty);}
    simulationHistory.forEach((entry,index)=>{
      const row=document.createElement('button');row.type='button';row.className='ac8-history-row';row.dataset.index=String(index);
      if(compareSelection.includes(index))row.classList.add('is-selected');
      const time=historyCell(historyTime(entry.createdAt));time.className='ac8-history-time';
      row.append(time,historyCell(entry.planName??'—'),historyCell(entry.conditionName??'—'),historyCell(pct(entry.coverageRate)),historyCell(pct(entry.blindRate)),historyCell(pct(entry.detectedFraction)),historyCell(entry.firstDetectionTime===null?'未检出':secs(entry.firstDetectionTime)),historyCell(String(entry.lossEvents??'—')));
      row.onclick=()=>{const position=compareSelection.indexOf(index);if(position>=0)compareSelection.splice(position,1);else{compareSelection.push(index);if(compareSelection.length>2)compareSelection.shift();}renderHistory();};
      historyList.append(row);
    });
    historyHint.textContent=compareSelection.length===2?'已选择两条记录，右侧为对比结果':compareSelection.length===1?'再选择一条记录进行对比':'点击两条记录进行对比';
    renderHistoryCompare();
  }
  function hideHistory(){historyPanel.hidden=true;historyButton.setAttribute('aria-expanded','false');}
  function recordSimulation(entry){
    if(!entry)return;
    simulationHistory.unshift({...entry,id:Date.now()});
    simulationHistory=simulationHistory.slice(0,20);
    compareSelection=[];
    persistHistory();
    if(!historyPanel.hidden)renderHistory();
  }
  if(historyButton&&historyPanel){
    historyButton.onclick=()=>{
      if(historyPanel.hidden){renderHistory();historyPanel.hidden=false;historyButton.setAttribute('aria-expanded','true');}
      else hideHistory();
    };
    historyClose.onclick=hideHistory;
    historyClear.onclick=()=>{if(!simulationHistory.length)return;if(!window.confirm('清空全部模拟历史？'))return;simulationHistory=[];compareSelection=[];persistHistory();renderHistory();};
    document.addEventListener('pointerdown',event=>{if(historyPanel.hidden)return;if(historyPanel.contains(event.target)||historyButton.contains(event.target))return;hideHistory();});
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!historyPanel.hidden){event.preventDefault();event.stopImmediatePropagation();hideHistory();}},true);
  }
  function activateDeploymentModule(id){
    if(!task3)return;
    workspace.activateView('task3');
    task3.showTab(id);
  }
  const deploymentMenu=mountHudMenu({
    app,launchers,kind:'deployment',launcher:deploymentButton,
    panel:app.querySelector('#deployment-panel'),contentClass:'is-deployment',
    entries:[
      {id:'input',label:'推演输入'},
      {id:'plans',label:'方案对比'},
      {id:'blindspots',label:'盲区分析'},
      {id:'emc',label:'电磁兼容'},
    ],
    onSelect:id=>activateDeploymentModule(id),
    onDetailExit:()=>app.dispatchEvent(new CustomEvent('view-change',{detail:'scene'})),
    onClose:()=>app.dispatchEvent(new CustomEvent('view-change',{detail:'scene'})),
  });
  let corePickingMenus=[];
  coreEditor=mountCustomSiteCore({
    app,canvas:renderer.domElement,camera,announce:status,
    getActiveSite:()=>SITES[mode]?.custom&&siteParts[mode]?{slug:mode,meta:siteMeta[mode],parts:siteParts[mode]}:null,
    setPicking(active){
      if(active&&mapPicking)return false;
      mapPicking=active;
      if(active){
        cameraAnimation?.cancel();
        corePickingMenus=[sceneMenu,equipmentMenu,deploymentMenu].filter(menu=>menu?.isOpen()&&!menu.isMinimized?.());
        for(const menu of corePickingMenus)menu.minimize();
      }else{
        for(const menu of corePickingMenus)menu.restore();
        corePickingMenus=[];
      }
      return true;
    },
    renderDraft:cores=>drawCoreHighlights(draftCoreHighlight,cores,0x69eaff),
    onSaved(slug,metadata){
      siteMeta[slug]=metadata;
      const analysis=siteAnalysisMetadata(metadata,SITES[slug]);
      siteParts[slug].buildingsData.metadata=analysis;
      Object.assign(siteParts[slug].group.userData,analysis);
      if(slug===mode){
        city.metadata=analysis;
        setCoreForMode(slug);
        applyModeLayers();
        task3?.setScene(activeSiteDescriptor(),{coreChanged:true});
      }
      updateDiagnostics();
    },
  });
  import('./task3/ui.js').then(({mountTask3UI})=>{
    task3=mountTask3UI({
      app,city,model,scene,camera,controls,renderer,sensors,workspace,getSite:activeSiteDescriptor,
      getActiveModel:()=>mode==='recon'?model:siteParts[mode],
      getGroundAt:()=>{
        const ground=mode==='recon'?model.ground:siteParts[mode]?.ground;
        return ground?terrainSampler(ground.geometry):null;
      },
      getBuildingContext:getTask3BuildingContext,
      onMapPickMode:active=>{
        mapPicking=active;
        if(active){cameraAnimation?.cancel();deploymentMenu.minimize();}
        else deploymentMenu.restore();
      },
    });
    task3.setScene(activeSiteDescriptor());
    task3.setMapSwitching(el('model-select').disabled);
    deploymentButton.disabled=false;
    updateSimulationBar();
  }).catch(error=>{
    console.warn('任务三面板挂载失败',error);
    task3=null;
    el('toggle-task3').disabled=true;
    deploymentButton.disabled=true;
    status('任务三加载失败，请刷新后重试。');
  });
  document.documentElement.dataset.ready='true';
  // Expose diagnostic counts only, for reproducible headless browser verification.
  updateDiagnostics();
}catch(error){status(`无法建立场景：${error.message}。请先执行数据准备，并使用支持 WebGL 的浏览器。`);document.documentElement.dataset.ready='error';console.error(error);}
