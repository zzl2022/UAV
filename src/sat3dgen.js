import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {buildTerrainGeometry} from './model.js';
import './sat3dgen.css';

const $=id=>document.getElementById(id);
const ENV_TK=import.meta.env.VITE_TIANDITU_TK||'';
const STORE='uav.tdt.';
const CENTER=[113.66613626120788,34.789408907490646];
const FULL_BOUNDS=[113.6083764673866,34.76282050772163,113.71696057969844,34.81497794369403];
const FULL_CENTER=[(FULL_BOUNDS[0]+FULL_BOUNDS[2])/2,(FULL_BOUNDS[1]+FULL_BOUNDS[3])/2];
const state={map:null,tk:null,baseLayers:[],manifest:null,view:'map',meshVariant:'cnbh',
  model:{renderer:null,scene:null,camera:null,controls:null,object:null,terrain:null,grid:null,loading:false,raf:0}};

function setStatus(text){$('tdt-status').textContent=text;}
function setModelStatus(text){$('model-status').textContent=text;}

function loadScript(src){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=src;script.async=true;
    script.onload=resolve;
    script.onerror=()=>reject(Error('天地图 API 脚本加载失败'));
    document.head.append(script);
  });
}
async function waitFor(test,timeout=20000){
  const start=Date.now();
  while(!test()){
    if(Date.now()-start>timeout)throw Error('天地图 API 初始化超时');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
}

function wmts(layer,tk){
  return `https://t0.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0`
    + `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles`
    + `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(tk)}`;
}

function addBaseLayers(kind){
  if(!state.map)return;
  for(const layer of state.baseLayers)state.map.removeLayer(layer);
  state.baseLayers=[];
  const layers=kind==='sat'?['img','cia']:kind==='terrain'?['ter','cta']:['vec','cva'];
  for(const layer of layers){
    const tile=new window.T.TileLayer(wmts(layer,state.tk),{minZoom:2,maxZoom:18});
    state.map.addLayer(tile);state.baseLayers.push(tile);
  }
}

async function initTdtMap(){
  const tk=$('tdt-tk').value.trim();
  if(!tk){setStatus('请填写天地图浏览器端 tk 后再加载。');$('tdt-tk').focus();return;}
  try{
  setStatus('正在加载天地图 API…');
  localStorage.setItem(STORE+'tk',tk);
  if(!window.T)await loadScript(`https://api.tianditu.gov.cn/api?v=4.0&tk=${encodeURIComponent(tk)}`);
  await waitFor(()=>window.T?.Map);
  if(state.map){setStatus('地图已加载。修改 tk 后请刷新页面。');return;}
  const map=new window.T.Map('tdt-map');
  if(map.clearLayers)map.clearLayers();
  map.centerAndZoom(new window.T.LngLat(FULL_CENTER[0],FULL_CENTER[1]),13);
  map.enableScrollWheelZoom(true);
  state.map=map;state.tk=tk;
  window.__tdtMap=map;
  addBaseLayers($('tdt-layer').value);
  const fullPolygon=new window.T.Polygon([
    new window.T.LngLat(FULL_BOUNDS[0],FULL_BOUNDS[1]),
    new window.T.LngLat(FULL_BOUNDS[2],FULL_BOUNDS[1]),
    new window.T.LngLat(FULL_BOUNDS[2],FULL_BOUNDS[3]),
    new window.T.LngLat(FULL_BOUNDS[0],FULL_BOUNDS[3]),
    new window.T.LngLat(FULL_BOUNDS[0],FULL_BOUNDS[1]),
  ],{color:'#6ce5c3',weight:2,fillColor:'#6ce5c3',fillOpacity:0.04});
  map.addOverLay(fullPolygon);
  const marker=new window.T.Marker(new window.T.LngLat(CENTER[0],CENTER[1]));
  map.addOverLay(marker);
  const circle=new window.T.Circle(new window.T.LngLat(CENTER[0],CENTER[1]),700,{
    color:'#c9aa68',weight:2,fillColor:'#ffd783',fillOpacity:0.08,
  });
  map.addOverLay(circle);
  map.addEventListener('click',event=>{
    const point=event.lnglat||event.latLng;
    if(!point)return;
    $('tdt-center').textContent=`${point.getLng().toFixed(6)}° E / ${point.getLat().toFixed(6)}° N`;
    marker.setLngLat(point);circle.setCenter(point);
  });
  $('map-hint').hidden=true;
  setStatus('天地图已加载。点击地图可查看重建中心坐标。');
  window.sat3dgenDiagnostics={...window.sat3dgenDiagnostics,mapLoaded:true,tkConfigured:true};
  if(state.view==='map')map.checkResize?.();
  }catch(error){
    setStatus(`天地图加载失败：${error.message}`);
    window.sat3dgenDiagnostics={...window.sat3dgenDiagnostics,mapError:error.message};
  }
}

function setView(view){
  state.view=view;
  for(const button of document.querySelectorAll('[data-view]')){
    button.classList.toggle('active',button.dataset.view===view);
  }
  for(const panel of document.querySelectorAll('.sat-view'))panel.hidden=panel.id!==`view-${view}`;
  if(view==='map')state.map?.checkResize?.();
  if(view==='model'){initModelViewer();resizeModel();}
  if(view==='street')loadMedia();
}

function initModelViewer(){
  if(state.model.renderer)return;
  const canvas=$('model-canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0x0c171f);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x0c171f);
  const camera=new THREE.PerspectiveCamera(45,1,0.1,100000);
  const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.maxDistance=50000;
  scene.add(new THREE.HemisphereLight(0xd9efff,0x63757b,2.3));
  const sun=new THREE.DirectionalLight(0xffeed5,2.5);sun.position.set(-400,800,300);scene.add(sun);
  const grid=new THREE.GridHelper(1000,20,0x33515b,0x20333b);grid.position.y=-1;scene.add(grid);
  state.model={...state.model,renderer,scene,camera,controls,grid};
  const loop=()=>{state.model.raf=requestAnimationFrame(loop);controls.update();renderer.render(scene,camera);};
  loop();
  loadModel();
}

function resizeModel(){
  const canvas=$('model-canvas');
  if(!canvas||!state.model.renderer)return;
  const width=canvas.clientWidth||canvas.parentElement.clientWidth;
  const height=canvas.clientHeight||canvas.parentElement.clientHeight;
  if(!width||!height)return;
  state.model.renderer.setSize(width,height,false);
  state.model.camera.aspect=width/height;state.model.camera.updateProjectionMatrix();
}

async function ensureImageryBasemap(){
  if(state.model.terrain)return true;
  try{
    const [terrain,texture]=await Promise.all([
      fetch('./data/terrain.json').then(response=>{
        if(!response.ok)throw Error(`terrain.json HTTP ${response.status}`);
        return response.json();
      }),
      new THREE.TextureLoader().loadAsync('./data/terrain-imagery.png'),
    ]);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=Math.min(8,state.model.renderer.capabilities.getMaxAnisotropy());
    const mesh=new THREE.Mesh(buildTerrainGeometry(terrain),
      new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
    mesh.name='Imagery_Basemap';
    state.model.scene.add(mesh);state.model.terrain=mesh;
    return true;
  }catch(error){
    console.warn('影像底图加载失败',error);
    return false;
  }
}

function showImageryBasemap(visible){
  if(state.model.terrain)state.model.terrain.visible=visible;
  if(state.model.grid)state.model.grid.visible=!visible;
}

function fitObject(object){
  const box=new THREE.Box3().setFromObject(object);
  const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const span=Math.max(size.x,size.y,size.z)||100;
  state.model.controls.target.copy(center);
  state.model.camera.position.copy(center).add(new THREE.Vector3(span*.7,span*.8,span*.9));
  state.model.controls.update();
  const grid=state.model.scene.children.find(child=>child.isGridHelper);
  if(grid)grid.position.y=box.min.y-1;
}

function clearModel(){
  if(!state.model.object||!state.model.scene)return;
  state.model.scene.remove(state.model.object);
  state.model.object.traverse(child=>{
    child.geometry?.dispose();
    if(Array.isArray(child.material))child.material.forEach(material=>material.dispose());
    else child.material?.dispose();
  });
  state.model.object=null;
}

async function loadModel(){
  if(state.model.loading||!state.model.scene)return;
  state.model.loading=true;clearModel();
  const manifest=state.manifest||{};
  let variant=state.meshVariant;
  if(variant==='full'&&!manifest.fullMesh)variant='detail';
  if(variant==='cnbh'&&!manifest.cnbhMesh)variant='detail';
  const meshPath=variant==='full'?manifest.fullMesh:manifest.mesh;
  try{
    if(variant==='cnbh'){
      setModelStatus('正在加载 CNBH-10m 全域重建与正射影像底图…');
      showImageryBasemap(false);
      const basemap=await ensureImageryBasemap();
      const gltf=await new GLTFLoader().loadAsync(`./data/sat3dgen/${manifest.cnbhMesh}`);
      const object=gltf.scene;
      object.traverse(child=>{if(child.isMesh&&child.material)child.material.side=THREE.DoubleSide;});
      state.model.scene.add(object);state.model.object=object;fitObject(object);
      showImageryBasemap(basemap);
      setModelStatus('CNBH-10m 全域重建已加载');
      $('model-caption').textContent='CNBH-10m 全域重建（SHP 轮廓 + 10 m 高度 + DEM + 正射影像底图）';
    }else if(variant==='gba'){
      setModelStatus('正在加载 GBA 全域白模与正射影像底图…');
      showImageryBasemap(false);
      const basemap=await ensureImageryBasemap();
      const gltf=await new GLTFLoader().loadAsync('./data/open-lod1.glb');
      const object=gltf.scene;
      object.traverse(child=>{if(child.isMesh&&child.material)child.material.side=THREE.DoubleSide;});
      state.model.scene.add(object);state.model.object=object;fitObject(object);
      showImageryBasemap(basemap);
      setModelStatus('GBA 全域白模已加载');
      $('model-caption').textContent='GBA LoD1 全域白模（覆盖完整片区 + 正射影像底图）';
    }else if(meshPath){
      showImageryBasemap(false);
      setModelStatus(variant==='full'?'正在加载全域概览网格…':'正在加载 Sat3DGen 网格…');
      const loader=new OBJLoader();
      const object=await loader.loadAsync(`./data/sat3dgen/${meshPath}`);
      object.traverse(child=>{
        if(!child.isMesh)return;
        const hasVertexColors=!!child.geometry?.getAttribute('color');
        child.material=new THREE.MeshStandardMaterial({
          color:hasVertexColors?0xffffff:0xe8eef1,
          vertexColors:hasVertexColors,
          roughness:0.9,metalness:0,side:THREE.DoubleSide,
        });
      });
      state.model.scene.add(object);state.model.object=object;fitObject(object);
      setModelStatus(variant==='full'?'Sat3DGen 全域概览已加载':'Sat3DGen 网格已加载');
      $('model-caption').textContent=variant==='full'
        ?'Sat3DGen 全域概览（含边缘填充，低精度）'
        :'Sat3DGen 重点区网格（河南博物院周边）';
    }else{
      setModelStatus('尚未找到 Sat3DGen 结果，先加载当前 GBA 白模作为参照…');
      showImageryBasemap(false);
      const basemap=await ensureImageryBasemap();
      const gltf=await new GLTFLoader().loadAsync('./data/open-lod1.glb');
      const object=gltf.scene;
      object.traverse(child=>{if(child.isMesh&&child.material)child.material.side=THREE.DoubleSide;});
      state.model.scene.add(object);state.model.object=object;fitObject(object);
      showImageryBasemap(basemap);
      setModelStatus('当前显示 GBA 白模；运行 Sat3DGen 后将替换为重建网格。');
      $('model-caption').textContent='GBA 全域白模（参照，含正射影像底图）';
    }
  }catch(error){
    setModelStatus(`模型加载失败：${error.message}`);
  }finally{
    state.model.loading=false;
  }
}

function loadMedia(){
  const manifest=state.manifest||{};
  const assign=(id,path)=>{
    const video=$(id);
    if(!video)return;
    if(path){if(!video.src.endsWith(path))video.src=`./data/sat3dgen/${path}`;video.hidden=false;}
    else{video.hidden=true;}
  };
  assign('street-video',manifest.streetviewVideo);
  assign('panorama-video',manifest.panoramaVideo);
  assign('orbit-video',manifest.orbitVideo);
  const streetImage=$('street-image');
  streetImage.hidden=!!manifest.streetviewVideo||!manifest.streetImage;
  if(manifest.streetImage)streetImage.src=`./data/sat3dgen/${manifest.streetImage}`;
  $('street-pending').hidden=!!(manifest.streetviewVideo||manifest.streetImage);
  $('street-caption').textContent=manifest.generatedAt
    ?`Sat3DGen 生成于 ${manifest.generatedAt}${manifest.model?` · ${manifest.model}`:''}`
    :'尚未生成街景/全景视频。运行 scripts/run_sat3dgen.py 后刷新。';
  const image=$('sat-input');
  const satellite=manifest.satellite||'input/zhengzhou_museum.png';
  image.src=`./data/sat3dgen/${satellite}`;
}

async function loadManifest(){
  try{
    const response=await fetch('./data/sat3dgen/manifest.json',{cache:'no-store'});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    state.manifest=await response.json();
    const resolution=state.manifest.resolution?` · ${state.manifest.resolution} 体素`:'';
    const full=state.manifest.fullMesh
      ?` · 全域概览 ${state.manifest.fullResolution||''} 体素`:'';
    const cnbh=state.manifest.cnbhMesh
      ?` · CNBH 10 m / ${(state.manifest.cnbhBuildingCount||0).toLocaleString('zh-CN')} 栋`:'';
    $('sat-meta').textContent=state.manifest.status==='pending'
      ?'尚未生成 Sat3DGen 结果。运行 scripts/run_sat3dgen.py 后刷新。'
      :`重建结果：${state.manifest.generatedAt||'已生成'} · ${state.manifest.model||''}${resolution}${full}${cnbh}`;
    $('model-variant-row').hidden=false;
    const fullOption=$('model-variant').querySelector('option[value="full"]');
    fullOption.disabled=!state.manifest.fullMesh;
    fullOption.hidden=!state.manifest.fullMesh;
    const cnbhOption=$('model-variant').querySelector('option[value="cnbh"]');
    cnbhOption.disabled=!state.manifest.cnbhMesh;
    cnbhOption.hidden=!state.manifest.cnbhMesh;
    if(!state.manifest.fullMesh&&state.meshVariant==='full')state.meshVariant='detail';
    if(!state.manifest.cnbhMesh&&state.meshVariant==='cnbh')state.meshVariant='detail';
    $('model-variant').value=state.meshVariant;
    $('model-status').textContent='正在准备 Sat3DGen 网格…';
    if(state.model.scene)loadModel();
  }catch(error){
    state.manifest=null;
    $('sat-meta').textContent='尚未生成 Sat3DGen 结果（manifest.json 不存在）。';
    if(state.model.scene)loadModel();
  }
  loadMedia();
  window.sat3dgenDiagnostics={manifest:state.manifest,center:CENTER,tkConfigured:!!($('tdt-tk').value.trim())};
}

function restoreTk(){
  const tk=localStorage.getItem(STORE+'tk')||ENV_TK;
  $('tdt-tk').value=tk;
  if(tk){
    setStatus('已读取天地图 tk，点击“加载天地图”。');
    $('map-hint').innerHTML='已读取本地 tk。<br>点击“加载天地图”显示底图。';
  }
}

$('tdt-load').onclick=initTdtMap;
$('tdt-layer').onchange=()=>{if(state.map)addBaseLayers($('tdt-layer').value);};
$('tdt-locate').onclick=()=>{if(state.map)state.map.centerAndZoom(new window.T.LngLat(FULL_CENTER[0],FULL_CENTER[1]),13);};
$('tdt-tk').addEventListener('keydown',event=>{if(event.key==='Enter')initTdtMap();});
$('refresh-results').onclick=()=>{state.manifest=null;loadManifest();};
$('model-variant').onchange=()=>{state.meshVariant=$('model-variant').value;clearModel();loadModel();};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>setView(button.dataset.view);
window.addEventListener('resize',()=>{resizeModel();state.map?.checkResize?.();});

restoreTk();
loadManifest();
setView('map');
