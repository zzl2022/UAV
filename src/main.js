import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createModel} from './model.js';
import './style.css';
import {mountLandmarks} from './landmarks.js';
import {mountPlanningUI} from './planning/ui.js';
import {mountSensorUI} from './sensors/ui.js';
import {createWorkspace} from './workspace.js';
import {siteAnalysisMetadata} from './site-analysis.js';
import './workspace.css';
import './ac8-theme.css';
import {mountIntro} from './intro.js';
import {createAc8Hud} from './ac8-hud.js';
import {mountSceneMenu} from './scene-menu.js';
import {mountHudMenu} from './hud-menu.js';
import {flightTelemetry} from './planning/telemetry.js';
import logoFullUrl from './assets/logo-full.png';

const app=document.querySelector('#app');
app.innerHTML=`<header id="platform-topbar">
  <div class="topbar-brand">
    <img class="topbar-logo-full" src="${logoFullUrl}" alt="中国人民公安大学">
  </div>
  <h1>反无装备优化部署与仿真推演平台</h1>
  <div class="topbar-drone" aria-hidden="true">
    <svg viewBox="0 0 128 84" role="img">
      <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <path d="M28 26h20l14 16 14-16h20" stroke-width="3.2"/>
        <path d="M34 60h18l10-12 10 12h18" stroke-width="2.4" opacity=".75"/>
        <ellipse cx="25" cy="24" rx="16" ry="5" stroke-width="2.2"/>
        <ellipse cx="101" cy="24" rx="16" ry="5" stroke-width="2.2"/>
        <ellipse cx="38" cy="61" rx="13" ry="4" stroke-width="1.8" opacity=".85"/>
        <ellipse cx="88" cy="61" rx="13" ry="4" stroke-width="1.8" opacity=".85"/>
        <rect x="52" y="30" width="24" height="14" rx="6" stroke-width="2.4"/>
        <path d="M58 47h12l-3 7h-6z" stroke-width="1.8"/>
        <path d="M64 58v7" stroke-width="2"/>
        <path d="M55 70h18" stroke-width="2" opacity=".7"/>
      </g>
      <g fill="currentColor" opacity=".85">
        <circle cx="25" cy="24" r="2.4"/><circle cx="101" cy="24" r="2.4"/>
        <circle cx="38" cy="61" r="2"/><circle cx="88" cy="61" r="2"/>
        <circle cx="64" cy="37" r="2.6"/>
      </g>
      <g fill="none" stroke="currentColor" stroke-width="1.6" opacity=".5">
        <path d="M112 16a22 22 0 0 1 0 16"/><path d="M118 11a31 31 0 0 1 0 26"/>
      </g>
    </svg>
  </div>
</header>
<div id="platform-body">
<aside id="workspace-sidebar">
  <div class="sidebar-top"><button id="sidebar-collapse" type="button" aria-label="折叠场景侧栏" title="折叠侧栏">«</button></div>
  <button id="ac8-main-menu-toggle" class="ac8-main-menu-toggle" type="button" aria-controls="ac8-main-menu" aria-expanded="true" title="收起主菜单" aria-label="收起主菜单"><span aria-hidden="true">«</span><em>MENU</em></button>
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
  <label>模型<select id="model-select" aria-label="选择地图模型">
    <option value="recon" selected>复杂城市——河南博物院</option>
    <option value="shenzhen">复杂城市——深圳国际交流中心(APEC举办地)</option>
    <option value="beijing">核心区域——北京故宫</option>
    <option value="daxing">机场区域——大兴机场</option>
    <option value="hangzhou">机场区域——杭州萧山机场</option>
    <option value="nuclear">核电设施——房山核设施</option>
    <option value="changjiang">核电设施——海南昌江核电厂</option>
    <option value="railway">铁路沿线——北京站到通州站</option>
  </select></label></section>
  <section id="layers-section"><h2>场景图层</h2>
  <label><input type="checkbox" id="buildings" checked>建筑</label>
  <label><input type="checkbox" id="terrain" checked>地形</label>
  <label><input type="checkbox" id="imagery" checked>影像地图</label></section>
  <section><h2>场景视角</h2><div class="buttons" id="city-views"><button id="reset">↗ 全域视角</button><button id="top">⌖ 俯视平面</button><button id="core-focus" hidden>⌖ 核心建筑</button></div></section>
  <div class="stats"><div><strong id="count">—</strong><span>建筑要素</span></div><div><strong id="height">—</strong><span>最高建筑 / m</span></div></div>
</div>
<div id="ac8-simulation-bar" aria-label="推演模拟控制">
  <button id="ac8-sim-start" type="button" disabled>开始模拟</button>
  <label class="ac8-sim-scenario"><span aria-hidden="true">场景</span><select id="ac8-sim-scenario" aria-label="模拟场景">
    <option value="flight" selected>单机飞行警报</option>
    <option value="single">威胁推演 · 单目标</option>
    <option value="multi">威胁推演 · 多目标</option>
    <option value="swarm">威胁推演 · 蜂群</option>
  </select></label>
  <label class="ac8-sim-speed"><span aria-hidden="true">速度</span><select id="ac8-sim-speed" aria-label="模拟速度">
    <option value="1">x1</option><option value="2">x2</option><option value="3">x3</option><option value="5">x5</option>
    <option value="10" selected>x10</option><option value="30">x30</option><option value="60">x60</option><option value="100">x100</option>
  </select></label>
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
deploymentButton.onclick=()=>{
  const tab=el('toggle-task3');
  if(tab&&!tab.disabled)tab.click();
};
let renderer,model,city,terrain,controls;
let scene,camera,imageryTexture,imageryMaterial,grid;
let mode='recon',siteGroups={},siteMeta={},siteParts={},coreHighlight,neighborHighlight,currentCore=null,coreLabel;
const SITES={
  beijing:{
    label:'核心区域——北京故宫',short:'北京故宫',
    base:'./data/beijing/beijing-gba',
    imagery:'./data/beijing/beijing-imagery.jpg',
  },
  shenzhen:{
    label:'复杂城市——深圳国际交流中心(APEC举办地)',short:'深圳国际交流中心',
    base:'./data/sites/shenzhen/shenzhen-gba',
    imagery:'./data/sites/shenzhen/shenzhen-imagery.jpg',
  },
  daxing:{
    label:'机场区域——大兴机场',short:'大兴机场',
    base:'./data/sites/daxing/daxing-gba',
    imagery:'./data/sites/daxing/daxing-imagery.jpg',
  },
  hangzhou:{
    label:'机场区域——杭州萧山机场',short:'杭州萧山机场',
    base:'./data/sites/hangzhou/hangzhou-gba',
    imagery:'./data/sites/hangzhou/hangzhou-imagery.jpg',
  },
  nuclear:{
    label:'核电设施——房山核设施',short:'房山核设施',
    base:'./data/sites/nuclear/nuclear-gba',
    imagery:'./data/sites/nuclear/nuclear-imagery.jpg',
    buildings:'./data/sites/nuclear/nuclear-gba.json',
  },
  changjiang:{
    label:'核电设施——海南昌江核电厂',short:'海南昌江核电厂',
    base:'./data/sites/changjiang/changjiang-gba',
    imagery:'./data/sites/changjiang/changjiang-imagery.jpg',
    buildings:'./data/sites/changjiang/changjiang-gba.json',
  },
  railway:{
    label:'铁路沿线——北京站到通州站',short:'铁路走廊',
    base:'./data/sites/railway/railway-gba',
    imagery:'./data/sites/railway/railway-imagery.jpg',
  },
};
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
  let cameraAnimation=null;
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
  const ac8Hud=createAc8Hud({scene,camera,viewport,getActiveGroup:activeGroup});
  window.__ac8Hud=ac8Hud;
  el('reset').onclick=()=>frameObject(activeGroup());
  el('top').onclick=()=>frameObject(activeGroup(),true);
  grid=new THREE.GridHelper(Math.ceil(span/1000)*1000,Math.ceil(span/1000)*2,0x33515b,0x20333b);grid.position.y=reconBox.min.y-1;scene.add(grid);
  el('count').textContent=city.metadata.sourceFeatures.toLocaleString('zh-CN');el('height').textContent=city.metadata.maxHeight;
  function updateStatus(){
    // Model loading is indicated by the scene itself; no completion toast.
    status('');
  }
  function updateDiagnostics(){
    if(!city||!terrain||!model)return;
    const sites=Object.fromEntries(Object.keys(SITES).map(id=>[id,{loaded:!!siteGroups[id]?.children.length,buildingCount:siteMeta[id]?.buildingCount??null,maxHeight:siteMeta[id]?.maxHeight??null}]));
    window.cityDiagnostics={features:city.metadata.sourceFeatures,parts:city.buildings.length,terrainVertices:terrain.positions.length/3,buildingTriangles:model.buildings.geometry.attributes.position.count/3,imagery:!!imageryTexture,modelMode:mode,coreNeighbors:neighborHighlight.userData.buildingCount??0,models:{recon:{loaded:true,featureCount:city.metadata.sourceFeatures},...sites}};
  }
  function addGround(group,meta,texture){
    const [x0,x1,z0,z1]=meta?.localBounds??[-5042,4974,-5054,4984];
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([x0,-0.5,z0,x1,-0.5,z0,x1,-0.5,z1,x0,-0.5,z1],3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));
    geometry.setIndex([0,2,1,0,3,2]);
    const textureMaterial=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});
    const plainMaterial=new THREE.MeshStandardMaterial({color:0x243d46,roughness:1,side:THREE.DoubleSide});
    const plane=new THREE.Mesh(geometry,textureMaterial);
    plane.name='TianDiTu_Imagery';
    plane.userData.textureMaterial=textureMaterial;
    plane.userData.plainMaterial=plainMaterial;
    group.add(plane);
    return plane;
  }
  async function ensureSite(id){
    const site=SITES[id];
    if(!site)return;
    if(siteGroups[id]?.children.length)return;
    status(`正在加载${site.label}…`);
    const buildingData=site.buildings
      ?fetchJSON(site.buildings).catch(error=>{console.warn(`${site.short}建筑明细加载失败`,error);return null;})
      :Promise.resolve(null);
    const [meta,gltf,buildingsData]=await Promise.all([
      fetchJSON(`${site.base}-meta.json`),
      new GLTFLoader().loadAsync(`${site.base}.glb`),
      buildingData,
    ]);
    siteMeta[id]=meta;
    let buildingMesh=null;
    gltf.scene.traverse(child=>{if(child.isMesh&&child.material){child.material.side=THREE.DoubleSide;buildingMesh??=child;}});
    const group=new THREE.Group();group.name=`${id}_GBA_LoD1`;group.visible=false;group.add(gltf.scene);
    const origin=[meta.center?.[0]??0,meta.center?.[1]??0,0];
    group.userData={...group.userData,name:meta.name,origin,ecefTransform:null};
    siteParts[id]={group,buildings:buildingMesh??gltf.scene,ground:null,buildingsData};
    try{
      const texture=await new THREE.TextureLoader().loadAsync(site.imagery);
      texture.colorSpace=THREE.SRGBColorSpace;
      texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      siteParts[id].ground=addGround(group,meta,texture);
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
  function siteSensorContext(id){
    const meta=siteMeta[id],parts=siteParts[id];
    if(!meta||!parts?.buildings||!parts.ground)return null;
    parts.ground.geometry.computeBoundingBox();
    const core=meta.coreBuilding,[x,z]=core?.center??[0,0];
    const baseY=core?.rings?.[0]?.[0]?.[1]??0;
    return {
      model:{group:parts.group,buildings:parts.buildings,ground:parts.ground,ranges:[]},
      origin:[meta.center?.[0]??0,meta.center?.[1]??0,0],
      anchor:[x,baseY+(Number(core?.height)||0)+2,z],
      meta,
    };
  }
  function disposeCoreHighlight(){
    for(const child of [...coreHighlight.children]){child.geometry?.dispose();child.material?.dispose();coreHighlight.remove(child);}
  }
  function disposeNeighborHighlight(){
    const materials=new Set();
    for(const child of [...neighborHighlight.children]){child.geometry?.dispose();if(child.material)materials.add(child.material);neighborHighlight.remove(child);}
    for(const material of materials)material.dispose();
    neighborHighlight.visible=false;neighborHighlight.userData.buildingCount=0;
  }
  function setNeighborHighlight(buildings,core){
    disposeNeighborHighlight();
    if(!core?.center||!Array.isArray(buildings)||!buildings.length)return;
    const [cx,cz]=core.center,candidates=[];
    for(const building of buildings){
      if(building.id===core.id)continue;
      const ring=building.rings?.[0];
      if(!ring?.length)continue;
      const xs=ring.map(point=>point[0]),zs=ring.map(point=>point[2]);
      const bx=(Math.min(...xs)+Math.max(...xs))/2,bz=(Math.min(...zs)+Math.max(...zs))/2;
      const distance=Math.hypot(bx-cx,bz-cz);
      if(distance<=250)candidates.push({building,distance});
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    if(!candidates.length)return;
    const roofMaterial=new THREE.LineBasicMaterial({color:0xffd166,depthTest:false,transparent:true,opacity:0.9});
    const baseMaterial=new THREE.LineBasicMaterial({color:0xffb347,depthTest:false,transparent:true,opacity:0.3});
    for(const {building} of candidates.slice(0,60)){
      const height=Math.max(0.5,Number(building.height)||0);
      for(const ring of building.rings){
        const closed=ring.length>1&&ring[0][0]===ring[ring.length-1][0]&&ring[0][2]===ring[ring.length-1][2];
        const points=closed?ring.slice(0,-1):ring;
        const roof=points.map(point=>new THREE.Vector3(point[0],height+0.35,point[2]));
        const base=points.map(point=>new THREE.Vector3(point[0],0.3,point[2]));
        neighborHighlight.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(roof),roofMaterial));
        neighborHighlight.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(base),baseMaterial));
      }
      const cap=roofCap(building.rings[0],height+0.2,0xffc857,0.24);if(cap)neighborHighlight.add(cap);
    }
    neighborHighlight.userData.buildingCount=Math.min(candidates.length,60);
    neighborHighlight.visible=true;
  }
  function coreCenter(core){
    const ring=core?.rings?.[0]||[];
    if(!ring.length)return null;
    const xs=ring.map(point=>point[0]),zs=ring.map(point=>point[2]);
    return {x:(Math.min(...xs)+Math.max(...xs))/2,z:(Math.min(...zs)+Math.max(...zs))/2,size:Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs),30)};
  }
  function roofCap(ring,y,color,opacity){
    if(!ring?.length)return null;
    const closed=ring.length>1&&ring[0][0]===ring[ring.length-1][0]&&ring[0][2]===ring[ring.length-1][2];
    const points=(closed?ring.slice(0,-1):ring).map(point=>new THREE.Vector2(point[0],-point[2]));
    if(points.length<3)return null;
    const mesh=new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(points)),new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false}));
    mesh.rotation.x=-Math.PI/2;mesh.position.y=y;mesh.renderOrder=7;
    return mesh;
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
    const cap=roofCap(core.rings[0],height+0.2,0xffd166,0.32);if(cap)coreHighlight.add(cap);
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
    setNeighborHighlight(next==='nuclear'||next==='changjiang'?siteParts[next]?.buildingsData?.buildings??[]:[],core);
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
    tweenCamera(target.clone().add(new THREE.Vector3(span*.7,span*.85,span*.9)),target,850);
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
    if(next==='recon'){el('count').textContent=city.metadata.sourceFeatures.toLocaleString('zh-CN');el('height').textContent=city.metadata.maxHeight;}
    else{const meta=siteMeta[next];el('count').textContent=(meta?.buildingCount??0).toLocaleString('zh-CN');el('height').textContent=meta?.maxHeight??'—';}
    for(const id of ['toggle-sensors','toggle-task3','toggle-deployment']){const button=el(id);if(button)button.disabled=false;}
    const museum=el('museum-focus');if(museum)museum.hidden=next!=='recon';
    landmarks?.setActive?.(next==='recon');
    setCoreForMode(next);
    applyModeLayers();
    if(next==='recon'){city.metadata=reconCityMetadata;}
    else if(siteMeta[next]){city.metadata=siteAnalysisMetadata(siteMeta[next],SITES[next]);}
    planning?.setScene?.(activeSiteDescriptor());
    task3?.setScene?.(activeSiteDescriptor());
  }
  function activeSiteDescriptor(){if(mode==='recon')return null;return {base:SITES[mode].base,label:SITES[mode].label,coreName:siteMeta[mode]?.coreBuilding?.name??SITES[mode].short};}
  async function setMode(next){
    if(!(next==='recon'||SITES[next]))return;
    if(next===mode){frameObject(activeGroup());return;}
    const select=el('model-select');select.value=next;select.disabled=true;
    const hud=window.__ac8Hud;
    const cityWindow=document.querySelector('#city-window');
    const cityOpen=!!cityWindow?.open&&!cityWindow.classList.contains('is-minimized');
    if(cityOpen)workspace.minimizeWindow('city');
    status('正在切换模型…');
    try{
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
    }catch(error){select.value=mode;status(`模型加载失败：${error.message}`);hud?.endSwitchScan?.();}
    finally{select.disabled=false;if(cityOpen)workspace.restoreWindow('city');}
  }
  el('model-select').onchange=()=>setMode(el('model-select').value);
  el('core-focus').onclick=focusCore;
  for(const id of ['buildings','terrain','imagery'])el(id).onchange=applyModeLayers;
  const resize=()=>{camera.aspect=viewport.clientWidth/viewport.clientHeight;camera.updateProjectionMatrix();renderer.setSize(viewport.clientWidth,viewport.clientHeight);window.__ac8Hud?.resize?.();};
  new ResizeObserver(resize).observe(viewport);resize();
  let planning,sensors,task3;
  const landmarks=mountLandmarks({city,scene,camera,controls,viewport,tweenCamera});
  const museumFocus=el('museum-focus');if(museumFocus)el('city-views').append(museumFocus);
  let lastHudStamp=0;
  renderer.setAnimationLoop(stamp=>{
    const dt=lastHudStamp?Math.min(.1,(stamp-lastHudStamp)/1000):0;lastHudStamp=stamp;
    controls.update();landmarks.update();updateCoreLabel();planning?.update(stamp);
    window.__ac8Hud?.update?.(dt);
    if(!sensors?.render())renderer.render(scene,camera);
    window.__ac8Hud?.render?.();
  });
  disableControls(false);el('imagery').checked=!!imageryMaterial;applyModeLayers();updateStatus();
  sensors=mountSensorUI({app,scene,camera,controls,renderer,model,city,workspace,tweenCamera});
  function coreCoordinateText(){
    const transform=city?.metadata?.ecefTransform;
    let position=null;
    if(mode==='recon'){
      position=landmarks?.landmark?.position??null;
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
  function equipmentText(){
    const devices=sensors?.getScenarioSnapshot?.().devices??[];
    if(!devices.length)return '未配置';
    const counts=new Map();
    for(const device of devices){
      const name=device.name||device.presetId||'未知装备';
      counts.set(name,(counts.get(name)||0)+1);
    }
    return [...counts].map(([name,count])=>count>1?`${name} ×${count}`:name).join(' · ');
  }
  function planText(){
    const selected=select=>select?.options?.length?select.selectedOptions?.[0]?.textContent?.trim():'';
    const task3Ready=!!window.task3Diagnostics?.ready;
    const planningReady=!!window.planningDiagnostics?.ready;
    const task3Plan=task3Ready?selected(document.querySelector('#task3-plan')):'';
    const planningPlan=planningReady?selected(document.querySelector('#planning-plan')):'';
    if(app.dataset.activeView==='planning'&&planningPlan)return planningPlan;
    return task3Plan||planningPlan||'均衡方案';
  }
  const sceneSummary=()=>({
    area:mode==='recon'?'河南博物院':(SITES[mode]?.short??SITES[mode]?.label??'—'),
    coordinates:coreCoordinateText(),
    equipment:equipmentText(),
    plan:planText(),
  });
  mountSceneMenu({app,launchers,panel:app.querySelector('#city-panel'),workspace,camera,renderer,getInfo:sceneSummary});
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
  window.addEventListener('resize',()=>{if(equipmentShift>0)applyEquipmentShift(equipmentShift);});
  mountHudMenu({
    app,launchers,kind:'equipment',launcher:app.querySelector('#toggle-sensors'),
    panel:app.querySelector('#equipment-panel'),contentClass:'is-equipment',
    entries:[
      {id:'radar',label:'雷达'},
      {id:'optical',label:'光电'},
      {id:'radio',label:'无线电'},
      {id:'acoustic',label:'声学'},
      {id:'fivega',label:'5G-A'},
      {id:'electrostatic',label:'静电'},
    ],
    onOpen:()=>{
      // Hide planning / task3 layers before showing the equipment markers.
      app.dispatchEvent(new CustomEvent('view-change',{detail:'scene'}));
      sensors.activate();
    },
    onSelect:type=>{
      document.querySelector(`#equipment-tab-${type}`)?.click();
      animateEquipmentShift(equipmentFocusShift(),1100);
    },
    onDetailExit:()=>{animateEquipmentShift(0,850);restoreOverview();},
    onClose:()=>{
      app.querySelector('#ac8-equipment-menu')?.classList.remove('is-demo-details');
      sensors.hideDemoHud();sensors.stopDemo();
      animateEquipmentShift(0,850);sensors.deactivate();restoreOverview();
    },
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
  planning=mountPlanningUI({app,city,scene,camera,controls,renderer,sensors,model,workspace,getSite:activeSiteDescriptor,embedded:true,onActivate:()=>{task3?.showFlight?.();workspace.activateView('task3');}});
  const simStart=app.querySelector('#ac8-sim-start'),simSpeed=app.querySelector('#ac8-sim-speed'),simProgress=app.querySelector('#ac8-sim-progress'),simScenario=app.querySelector('#ac8-sim-scenario');
  let simSeeking=false;
  const simMode=()=>simScenario?.value==='single'||simScenario?.value==='multi'||simScenario?.value==='swarm'?simScenario.value:'flight';
  const currentPlayback=()=>simMode()==='flight'?(planning?.getPlayback?.()??{}):(task3?.getThreatPlayback?.()??{});
  function updateSimulationBar(){
    if(!planning)return;
    const mode=simMode(),state=currentPlayback();
    simStart.disabled=mode==='flight'?!!state.busy:!task3;
    simStart.textContent=state.playing?'暂停模拟':state.enabled&&state.duration&&state.time>=state.duration?'再次模拟':state.enabled&&state.time>0?'继续模拟':'开始模拟';
    simStart.dataset.playing=String(!!state.playing);
    if(Number(simSpeed.value)!==state.speed&&state.speed)simSpeed.value=String(state.speed);
    const progress=state.duration?Math.max(0,Math.min(100,state.time/state.duration*100)):0;
    if(!simSeeking)simProgress.value=String(progress*10);
    simProgress.style.setProperty('--ac8-progress',`${progress}%`);
    simProgress.disabled=!state.enabled;
  }
  if(simStart&&simSpeed&&simProgress){
    simStart.onclick=()=>{
      if(simMode()==='flight'){
        const state=planning.getPlayback?.()??{};
        if(state.playing){planning.pauseSimulation?.();return;}
        const fresh=!state.enabled||!state.duration||state.time===0||state.time>=state.duration;
        Promise.resolve(planning.startSimulation?.()).then(started=>{
          if(started&&fresh)recordSimulation(planning.getSimulationResult?.());
        });
        return;
      }
      const state=task3?.getThreatPlayback?.()??{};
      if(state.playing){task3.pauseThreatSimulation?.();return;}
      task3?.startThreatSimulation?.(simMode());
    };
    simScenario?.addEventListener('change',()=>{planning.pauseSimulation?.();task3?.pauseThreatSimulation?.();updateSimulationBar();});
    simSpeed.onchange=()=>{if(simMode()==='flight')planning.setSpeed?.(Number(simSpeed.value));else task3?.setThreatSpeed?.(Number(simSpeed.value));};
    simProgress.oninput=()=>{if(simMode()==='flight')planning.setProgress?.(Number(simProgress.value));else task3?.setThreatProgress?.(Number(simProgress.value));};
    simProgress.onpointerdown=()=>{simSeeking=true;};
    simProgress.onpointercancel=()=>{simSeeking=false;};
    window.addEventListener('pointerup',()=>{simSeeking=false;});
    simStart.disabled=false;
    updateSimulationBar();
    window.setInterval(updateSimulationBar,160);
  }
  const historyPanel=app.querySelector('#ac8-sim-history-panel'),historyList=app.querySelector('#ac8-history-list'),historyCompare=app.querySelector('#ac8-history-compare');
  const historyButton=app.querySelector('#ac8-sim-history'),historyClose=app.querySelector('#ac8-history-close'),historyClear=app.querySelector('#ac8-history-clear'),historyHint=app.querySelector('#ac8-history-hint');
  const HISTORY_KEY='uav-simulation-history-v1';
  let simulationHistory=[];
  try{const stored=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');if(Array.isArray(stored))simulationHistory=stored.filter(item=>item&&typeof item==='object').slice(0,20);}catch{}
  let compareSelection=[];
  const pct=value=>Number.isFinite(value)?`${(value*100).toFixed(1)}%`:'—';
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
    const run=()=>{
      if(!task3?.showTab)return false;
      const tab=document.querySelector('#toggle-task3');
      if(!tab||tab.disabled)return false;
      tab.click();
      task3.showTab(id);
      return true;
    };
    if(run())return;
    const timer=window.setInterval(()=>{if(run())window.clearInterval(timer);},200);
    window.setTimeout(()=>window.clearInterval(timer),15000);
  }
  mountHudMenu({
    app,launchers,kind:'deployment',launcher:app.querySelector('#toggle-deployment'),
    panel:app.querySelector('#deployment-panel'),contentClass:'is-deployment',
    entries:[
      {id:'input',label:'推演输入'},
      {id:'plans',label:'方案对比'},
      {id:'blindspots',label:'盲区分布'},
      {id:'emc',label:'电磁兼容'},
      {id:'flight',label:'飞行演示'},
    ],
    onSelect:id=>activateDeploymentModule(id),
    onClose:()=>app.dispatchEvent(new CustomEvent('view-change',{detail:'scene'})),
  });
  import('./task3/ui.js').then(({mountTask3UI})=>{
    task3=mountTask3UI({app,city,terrain,scene,camera,controls,renderer,sensors,model,workspace,getSite:activeSiteDescriptor,simulation:planning});
    applyModeUI(mode);
  }).catch(error=>{console.warn('任务三面板挂载失败',error);el('toggle-task3').disabled=true;workspace.showWindow('deployment');el('toggle-task3').click();});
  document.documentElement.dataset.ready='true';
  // Expose diagnostic counts only, for reproducible headless browser verification.
  updateDiagnostics();
}catch(error){status(`无法建立场景：${error.message}。请先执行数据准备，并使用支持 WebGL 的浏览器。`);document.documentElement.dataset.ready='error';console.error(error);}
