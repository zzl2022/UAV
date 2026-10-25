import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createModel} from './model.js';
import './style.css';
import {mountLandmarks} from './landmarks.js';
import {mountPlanningUI} from './planning/ui.js';
import {mountSensorUI} from './sensors/ui.js';
import {mountStudentCapabilities} from './student-capabilities/ui.js';

const app=document.querySelector('#app');
app.innerHTML=`<aside id="city-panel">
  <div class="brand"><span class="mark">◈</span> UAV <small>地理空间实验室</small></div>
  <div class="eyebrow">CITY RECONSTRUCTION / 01</div>
  <h1>城市三维<br>地理建模<span>。</span></h1>
  <p class="intro" id="intro">郑州 · 河南博物院片区<br>基于仓库建筑轮廓与 DEM 的真实数据重建</p>
  <div class="stats"><div><strong id="count">—</strong><span>建筑要素</span></div><div><strong id="height">—</strong><span>最高建筑 / m</span></div></div>
  <section><h2>场景模型 <span>MODEL</span></h2>
  <label>模型<select id="model-select" aria-label="选择场景模型">
    <option value="white">原白模</option>
    <option value="recon" selected>重建模型</option>
    <option value="beijing">故宫模型</option>
  </select></label>
  <p class="hint" id="model-note">郑州 SHP 轮廓 + DEM + 正射影像。图层开关仅作用于本模型。</p></section>
  <section id="layers-section"><h2>场景图层 <span>LAYERS</span></h2>
  <label><input type="checkbox" id="buildings" checked>建筑重建 <small>SHP / high</small></label>
  <label><input type="checkbox" id="terrain" checked>真实地形 <small>DEM / 30 m 级</small></label>
  <label><input type="checkbox" id="imagery" checked>影像底图 <small>GeoTIFF / RGB</small></label>
  <label><input type="checkbox" id="wire">建筑线框 <small>WIREFRAME</small></label>
  <p class="hint">图层开关仅作用于重建模型。</p></section>
  <section><h2>模型工具 <span>TOOLS</span></h2><div class="buttons"><button id="reset">↗ 全域视角</button><button id="top">⌖ 俯视平面</button></div>
  <button id="export" class="primary" disabled>导出当前模型 · GLB ↓</button></section>
  <section id="selection"><h2>建筑属性 <span>INSPECT</span></h2><p class="hint" id="details">点击建筑查看名称、真实高度与地面海拔。</p></section>
  <footer>坐标：WGS84 → 局部 ENU / 米<br>高程按源 DEM 使用，垂直基准未标注。<br>影像按坐标贴合地形，不改变建筑高度。<br>原白模：源 NoLod_*.glb；开源对照：<a href="./open-model.md" target="_blank" rel="noopener" style="color:#93b6c0">GlobalBuildingAtlas LoD1</a> · CC BY-NC 4.0</footer>
</aside><main><button id="sidebar-toggle" type="button" aria-controls="city-panel" aria-expanded="true" aria-label="隐藏侧栏" title="隐藏侧栏">‹<span>隐藏侧栏</span></button><header><div><span class="live"></span> <span id="scene-title">郑州城市数字底座</span> <span class="tag" id="scene-tag">REPOSITORY DATA</span></div><a href="./data/report.json" target="_blank" rel="noopener">数据报告 ↗</a></header>
<div id="viewport" aria-label="可旋转的三维城市场景"></div><div class="north">N<br>↑</div><div id="status" role="status">正在读取仓库数据…</div><div class="navigation">左键旋转 · 右键平移 · 滚轮缩放</div><div id="location">LOCAL ENU · METERS</div></main>`;
const el=id=>document.getElementById(id);
let renderer,model,city,terrain,controls,landmarks;
let scene,camera,imageryTexture,grid;
let mode='recon',whiteGroup,beijingGroup,beijingMeta;
const viewport=el('viewport');
const status=text=>{el('status').textContent=text;};
const disableControls=value=>{for (const id of ['buildings','terrain','imagery','wire','reset','top','export','model-select']) el(id).disabled=value;};
disableControls(true);
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function fetchJSON(path){const response=await fetch(path);if(!response.ok)throw Error(`${path}: HTTP ${response.status}`);return response.json();}
function glbFeatureCount(gltf){
  let count=0;
  for(const mesh of gltf.parser?.json?.meshes??[])
    for(const primitive of mesh.primitives??[])
      count+=primitive.extensions?.EXT_mesh_features?.featureIds?.[0]?.featureCount??0;
  return count;
}
try {
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x0c171f);
  viewport.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color(0x0c171f);
  camera=new THREE.PerspectiveCamera(42,1,1,100000);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*0.49;controls.maxDistance=35000;controls.minDistance=20;
  scene.add(new THREE.HemisphereLight(0xd9efff,0x63757b,2.3));
  const sun=new THREE.DirectionalLight(0xffeed5,3);sun.position.set(-4000,8000,3000);scene.add(sun);
  [city,terrain]=await Promise.all([fetchJSON('./data/city.json'),fetchJSON('./data/terrain.json')]);
  status('正在生成建筑与地形网格…');
  await new Promise(resolve=>requestAnimationFrame(resolve));
  model=createModel(city,terrain);scene.add(model.group);
  whiteGroup=new THREE.Group();whiteGroup.name='Zhengzhou_NoLod_Source';whiteGroup.visible=false;scene.add(whiteGroup);
  beijingGroup=new THREE.Group();beijingGroup.name='Beijing_GBA_LoD1';beijingGroup.visible=false;scene.add(beijingGroup);
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
  const activeGroup=()=>mode==='recon'?model.group:mode==='white'?whiteGroup:beijingGroup;
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
    if(next==='white')return {label:'原白模',title:'郑州原始白模',tag:'ORIGINAL MODEL',note:'源 NoLod_*.glb 白模，仅用于几何对照；不含重建属性与正射影像。',intro:'郑州 · 河南博物院片区<br>原始 NoLod 三维白模 · 源数据保留',location:'ZHENGZHOU · LOCAL ENU · METERS'};
    if(next==='beijing')return {label:'故宫模型',title:'北京故宫 GBA LoD1',tag:'BEIJING / GBA',note:'GBA LoD1 逐栋模型 + 天地图影像底图 · CC BY-NC 4.0（非商业）。',intro:'北京 · 故宫周边 5 km<br>GBA LoD1 逐栋模型 + 天地图影像底图',location:'BEIJING · LOCAL ENU · METERS'};
    return {label:'重建模型',title:'郑州城市数字底座',tag:'REPOSITORY DATA',note:'郑州 SHP 轮廓 + DEM + 正射影像。图层开关仅作用于本模型。',intro:'郑州 · 河南博物院片区<br>基于仓库建筑轮廓与 DEM 的真实数据重建',location:`${city.metadata.origin[0].toFixed(5)}° E / ${city.metadata.origin[1].toFixed(5)}° N · ENU`};
  }
  function updateStatus(){
    if(mode==='white'){status(`已加载原始白模 ${(whiteGroup.userData.featureCount??0).toLocaleString('zh-CN')} 个要素 · 仅几何对照`);return;}
    if(mode==='beijing'){status(`已加载北京故宫 GBA ${(beijingMeta?.buildingCount??0).toLocaleString('zh-CN')} 栋 · 高度 ${beijingMeta?.minHeight??'—'}–${beijingMeta?.maxHeight??'—'} m · 天地图影像底图`);return;}
    status(`已建模 ${city.metadata.sourceFeatures.toLocaleString('zh-CN')} 栋建筑 · 地形 ${terrain.cols} × ${terrain.rows} · ${imageryTexture?'影像已对齐':'米制坐标'}${imageryError?'（影像加载失败，可重新准备数据后刷新）':''}`);
  }
  function updateDiagnostics(){
    if(!city||!terrain||!model)return;
    window.cityDiagnostics={features:city.metadata.sourceFeatures,parts:city.buildings.length,terrainVertices:terrain.positions.length/3,buildingTriangles:model.buildings.geometry.attributes.position.count/3,imagery:!!imageryTexture,modelMode:mode,sidebarCollapsed:app.classList.contains('sidebar-collapsed'),models:{recon:{loaded:true,featureCount:city.metadata.sourceFeatures},white:{loaded:whiteGroup.children.length>0,featureCount:whiteGroup.userData.featureCount??null},beijing:{loaded:beijingGroup.children.length>0,buildingCount:beijingMeta?.buildingCount??null,maxHeight:beijingMeta?.maxHeight??null}}};
  }
  function addBeijingGround(meta,texture){
    const [x0,x1,z0,z1]=meta?.localBounds??[-5042,4974,-5054,4984];
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([x0,-0.5,z0,x1,-0.5,z0,x1,-0.5,z1,x0,-0.5,z1],3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));
    geometry.setIndex([0,2,1,0,3,2]);
    const plane=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
    plane.name='Beijing_TianDiTu_Imagery';
    beijingGroup.add(plane);
  }
  async function ensureWhite(){
    if(whiteGroup.children.length)return;
    status('正在加载郑州原始白模…');
    const loader=new GLTFLoader();
    const [a,b]=await Promise.all([loader.loadAsync('./data/NoLod_0.glb'),loader.loadAsync('./data/NoLod_1.glb')]);
    for(const gltf of [a,b])gltf.scene.traverse(child=>{if(child.isMesh&&child.material)child.material.side=THREE.DoubleSide;});
    whiteGroup.add(a.scene,b.scene);
    whiteGroup.userData.featureCount=glbFeatureCount(a)+glbFeatureCount(b);
    whiteGroup.userData.loaded=true;
  }
  async function ensureBeijing(){
    if(beijingGroup.children.length)return;
    status('正在加载北京故宫 GBA 模型（约 82 MB）…');
    const [meta,gltf]=await Promise.all([fetchJSON('./data/beijing/beijing-gba-meta.json'),new GLTFLoader().loadAsync('./data/beijing/beijing-gba.glb')]);
    beijingMeta=meta;
    gltf.scene.traverse(child=>{if(child.isMesh&&child.material)child.material.side=THREE.DoubleSide;});
    beijingGroup.add(gltf.scene);
    try{
      const texture=await new THREE.TextureLoader().loadAsync('./data/beijing/beijing-imagery.jpg');
      texture.colorSpace=THREE.SRGBColorSpace;
      texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      addBeijingGround(meta,texture);
    }catch(error){console.warn('故宫影像底图加载失败',error);}
    beijingGroup.userData.loaded=true;
  }
  function applyModeUI(next){
    const info=modeInfo(next);
    el('scene-title').textContent=info.title;
    el('scene-tag').textContent=info.tag;
    el('intro').innerHTML=info.intro;
    el('model-note').textContent=info.note;
    el('location').textContent=info.location;
    el('layers-section').hidden=next!=='recon';
    el('selection').hidden=next!=='recon';
    if(next==='recon'){el('count').textContent=city.metadata.sourceFeatures.toLocaleString('zh-CN');el('height').textContent=city.metadata.maxHeight;}
    else if(next==='white'){el('count').textContent=(whiteGroup.userData.featureCount??0).toLocaleString('zh-CN');el('height').textContent='—';}
    else{el('count').textContent=(beijingMeta?.buildingCount??0).toLocaleString('zh-CN');el('height').textContent=beijingMeta?.maxHeight??'—';}
    const sensorsToggle=document.querySelector('#toggle-sensors'),planningToggle=document.querySelector('#toggle-planning'),studentToggle=document.querySelector('#toggle-student');
    if(sensorsToggle)sensorsToggle.disabled=next!=='recon';
    if(planningToggle)planningToggle.disabled=next!=='recon';
    if(studentToggle)studentToggle.disabled=next!=='recon';
    landmarks?.setActive?.(next==='recon');
  }
  async function setMode(next){
    if(!['recon','white','beijing'].includes(next))return;
    if(next===mode){frameObject(activeGroup());return;}
    const select=el('model-select');
    select.disabled=true;el('export').disabled=true;
    try{
      if(next==='white')await ensureWhite();
      if(next==='beijing')await ensureBeijing();
      mode=next;
      model.group.visible=next==='recon';
      whiteGroup.visible=next==='white';
      beijingGroup.visible=next==='beijing';
      if(next==='recon'){
        model.buildings.visible=el('buildings').checked;
        model.ground.visible=el('terrain').checked;
      }
      grid.visible=next!=='beijing';
      applyModeUI(next);
      frameObject(activeGroup(),false,next==='recon'?1:0.35);
      updateStatus();
      updateDiagnostics();
    }catch(error){
      select.value=mode;
      status(`模型加载失败：${error.message}`);
    }finally{
      select.disabled=false;
      el('export').disabled=false;
    }
  }
  el('model-select').onchange=()=>setMode(el('model-select').value);
  const sidebarToggle=el('sidebar-toggle');
  function setSidebarCollapsed(value){
    app.classList.toggle('sidebar-collapsed',value);
    sidebarToggle.setAttribute('aria-expanded',String(!value));
    sidebarToggle.setAttribute('aria-label',value?'显示侧栏':'隐藏侧栏');
    sidebarToggle.title=value?'显示侧栏':'隐藏侧栏';
    sidebarToggle.innerHTML=value?'›<span>显示侧栏</span>':'‹<span>隐藏侧栏</span>';
    updateDiagnostics();
  }
  sidebarToggle.onclick=()=>setSidebarCollapsed(!app.classList.contains('sidebar-collapsed'));
  el('buildings').onchange=()=>{model.buildings.visible=el('buildings').checked;};
  el('terrain').onchange=()=>{model.ground.visible=el('terrain').checked;};
  el('imagery').onchange=()=>{
    const old=model.ground.material;
    model.ground.material=el('imagery').checked
      ?new THREE.MeshBasicMaterial({map:imageryTexture,side:THREE.DoubleSide})
      :new THREE.MeshStandardMaterial({color:0x243d46,roughness:1,side:THREE.DoubleSide});
    old.dispose();
  };
  el('wire').onchange=()=>{model.buildings.material.wireframe=el('wire').checked;};
  el('export').onclick=async()=>{
    const names={recon:'zhengzhou-city-enu.glb',white:'zhengzhou-original-nolod.glb',beijing:'beijing-forbidden-city-gba.glb'};
    const target=activeGroup();
    el('export').disabled=true;status(`正在导出${modeInfo(mode).label}…`);
    let wire;
    if(mode==='recon'){wire=model.buildings.material.wireframe;model.buildings.material.wireframe=false;}
    try {const buffer=await new GLTFExporter().parseAsync(target,{binary:true,onlyVisible:false});download(buffer,names[mode],'model/gltf-binary');updateStatus();}
    catch(error){status(`导出失败：${error.message}`);}
    finally{if(mode==='recon')model.buildings.material.wireframe=wire;el('export').disabled=false;}
  };
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down;
  renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(mode!=='recon'||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5||!model.buildings.visible)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(model.buildings)[0];if(!hit)return;
    const b=model.ranges.find(r=>hit.faceIndex>=r.start&&hit.faceIndex<r.end)?.building;if(!b)return;
    el('details').textContent=`${b.name} | 高度 ${b.height} m | 地面海拔 ${b.ground.toFixed(1)} m | ID ${b.id}`;
  });
  const resize=()=>{camera.aspect=viewport.clientWidth/viewport.clientHeight;camera.updateProjectionMatrix();renderer.setSize(viewport.clientWidth,viewport.clientHeight);};
  new ResizeObserver(resize).observe(viewport);resize();
  let planning,sensors;
  landmarks=mountLandmarks({city,scene,camera,controls,viewport});
  renderer.setAnimationLoop(stamp=>{controls.update();landmarks.update();planning?.update(stamp);if(!sensors?.render())renderer.render(scene,camera);});
  disableControls(false);el('imagery').disabled=!imageryTexture;el('imagery').checked=!!imageryTexture;el('export').disabled=false;
  sensors=mountSensorUI({app,scene,camera,controls,renderer,model,city});
  planning=mountPlanningUI({app,city,scene,camera,controls,renderer,sensors,model});
  mountStudentCapabilities({app,city,scene,camera,controls,renderer,model});
  applyModeUI('recon');
  updateStatus();
  updateDiagnostics();
  document.documentElement.dataset.ready='true';
}catch(error){status(`无法建立场景：${error.message}。请先执行数据准备，并使用支持 WebGL 的浏览器。`);document.documentElement.dataset.ready='error';console.error(error);}
