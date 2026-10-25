import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import './sat3dgen.css';

const $=id=>document.getElementById(id);
const ENV_TK=import.meta.env.VITE_TIANDITU_TK||'';
const STORE='uav.bj.';
const CENTER=[116.3972,39.9163];
const BBOX=[116.33864,39.87108,116.45576,39.96152];
const state={map:null,tk:null,baseLayers:[],view:'map',variant:'gba',
  model:{renderer:null,scene:null,camera:null,controls:null,object:null,
    imageryGround:false,loading:false,loadedVariant:null,raf:0}};
const VARIANTS={
  gba:{glb:'./data/beijing/beijing-gba.glb',meta:'./data/beijing/beijing-gba-meta.json',label:'GBA 逐栋 LoD1'},
  osm:{glb:'./data/beijing/beijing-osm.glb',meta:'./data/beijing/beijing-osm-meta.json',label:'OSM + CNBH 逐栋'},
  cnbh:{glb:'./data/beijing/beijing-cnbh.glb',meta:'./data/beijing/beijing-cnbh-meta.json',label:'CNBH-10m 20 m 体块'},
};

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
    map.centerAndZoom(new window.T.LngLat(CENTER[0],CENTER[1]),13);
    map.enableScrollWheelZoom(true);
    state.map=map;state.tk=tk;
    addBaseLayers($('tdt-layer').value);
    const polygon=new window.T.Polygon([
      new window.T.LngLat(BBOX[0],BBOX[1]),
      new window.T.LngLat(BBOX[2],BBOX[1]),
      new window.T.LngLat(BBOX[2],BBOX[3]),
      new window.T.LngLat(BBOX[0],BBOX[3]),
      new window.T.LngLat(BBOX[0],BBOX[1]),
    ],{color:'#6ce5c3',weight:2,fillColor:'#6ce5c3',fillOpacity:0.04});
    map.addOverLay(polygon);
    const marker=new window.T.Marker(new window.T.LngLat(CENTER[0],CENTER[1]));
    map.addOverLay(marker);
    const circle=new window.T.Circle(new window.T.LngLat(CENTER[0],CENTER[1]),5000,{
      color:'#ffd783',weight:2,fillColor:'#ffd783',fillOpacity:0.05,
    });
    map.addOverLay(circle);
    map.addEventListener('click',event=>{
      const point=event.lnglat||event.latLng;if(!point)return;
      $('tdt-center').textContent=`${point.getLng().toFixed(6)}° E / ${point.getLat().toFixed(6)}° N`;
      marker.setLngLat(point);circle.setCenter(point);
    });
    $('map-hint').hidden=true;
    setStatus('天地图已加载。青色框为 5 km 故宫范围，黄圈为 5 km 半径。');
    window.beijingDiagnostics={...window.beijingDiagnostics,mapLoaded:true};
    if(state.view==='map')map.checkResize?.();
  }catch(error){
    setStatus(`天地图加载失败：${error.message}`);
  }
}

function initViewer(){
  if(state.model.renderer)return;
  const canvas=$('model-canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0x0c171f);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x0c171f);
  const camera=new THREE.PerspectiveCamera(45,1,0.1,60000);
  const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.maxDistance=40000;
  scene.add(new THREE.HemisphereLight(0xd9efff,0x63757b,2.3));
  const sun=new THREE.DirectionalLight(0xffeed5,2.5);sun.position.set(-4000,7000,3000);scene.add(sun);
  state.model={...state.model,renderer,scene,camera,controls};
  const loop=()=>{state.model.raf=requestAnimationFrame(loop);controls.update();renderer.render(scene,camera);};
  loop();
}

function resize(){
  const canvas=$('model-canvas');
  if(!canvas||!state.model.renderer)return;
  const width=canvas.clientWidth||canvas.parentElement.clientWidth;
  const height=canvas.clientHeight||canvas.parentElement.clientHeight;
  if(!width||!height)return;
  state.model.renderer.setSize(width,height,false);
  state.model.camera.aspect=width/height;state.model.camera.updateProjectionMatrix();
}

function fitObject(object){
  const box=new THREE.Box3().setFromObject(object);
  const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const span=Math.max(size.x,size.z,size.y)||1000;
  state.model.controls.target.copy(center);
  state.model.camera.position.copy(center).add(new THREE.Vector3(span*.7,span*.85,span*.9));
  state.model.controls.update();
}

function focusCenter(){
  if(!state.model.controls)return;
  state.model.controls.target.set(0,20,0);
  state.model.camera.position.set(1200,900,1400);
  state.model.controls.update();
}

function addImageryGround(scene,meta,texture){
  const bounds=meta?.localBounds||[-5042,5038,-4989,4971];
  const [x0,x1,z0,z1]=bounds;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([
    x0,-0.5,z0, x1,-0.5,z0, x1,-0.5,z1, x0,-0.5,z1,
  ],3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute([
    0,1, 1,1, 1,0, 0,0,
  ],2));
  geometry.setIndex([0,2,1,0,3,2]);
  const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='TianDiTu_Imagery_Basemap';
  scene.add(mesh);
}

function clearObject(){
  if(!state.model.object||!state.model.scene)return;
  state.model.scene.remove(state.model.object);
  state.model.object.traverse(child=>{
    child.geometry?.dispose();
    if(Array.isArray(child.material))child.material.forEach(material=>material.dispose());
    else child.material?.dispose();
  });
  state.model.object=null;
}

async function loadVariant(variant){
  if(state.model.loading||!state.model.scene)return;
  if(state.model.loadedVariant===variant&&state.model.object)return;
  const config=VARIANTS[variant]||VARIANTS.gba;
  state.model.loading=true;state.variant=variant;
  $('bj-variant').value=variant;
  let fallbackToOsm=false;
  try{
    setModelStatus(`正在加载 ${config.label}…`);
    const meta=await fetch(config.meta,{cache:'no-store'})
      .then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json();});
    clearObject();
    const gltf=await new GLTFLoader().loadAsync(config.glb);
    const object=gltf.scene;
    object.traverse(child=>{if(child.isMesh&&child.material)child.material.side=THREE.DoubleSide;});
    state.model.scene.add(object);state.model.object=object;fitObject(object);focusCenter();
    if(!state.model.imageryGround){
      try{
        const texture=await new THREE.TextureLoader().loadAsync('./data/beijing/beijing-imagery.jpg');
        texture.colorSpace=THREE.SRGBColorSpace;
        texture.anisotropy=Math.min(8,state.model.renderer.capabilities.getMaxAnisotropy());
        addImageryGround(state.model.scene,meta,texture);
        state.model.imageryGround=true;
      }catch(error){console.warn('天地图影像底图加载失败',error);}
    }
    state.model.loadedVariant=variant;
    const count=meta.buildingCount??meta.blockCount??0;
    if(variant==='gba'){
      $('bj-meta').textContent=`${count.toLocaleString('zh-CN')} 栋 GBA 逐栋建筑 · 高度 ${meta.minHeight}–${meta.maxHeight} m · CC BY-NC 4.0`;
      $('model-caption').textContent='北京故宫 5 km · GBA 逐栋轮廓 + GBA 高度 + 天地图影像底图';
    }else if(variant==='osm'){
      $('bj-meta').textContent=`${count.toLocaleString('zh-CN')} 栋 OSM 建筑 · CNBH 高度 ${meta.minHeight}–${meta.maxHeight} m · ODbL / CC BY 4.0`;
      $('model-caption').textContent='北京故宫 5 km · OSM 逐栋轮廓 + CNBH 高度 + 天地图影像底图';
    }else{
      $('bj-meta').textContent=`${count.toLocaleString('zh-CN')} 个 20 m 体块 · 高度 ${meta.minHeight}–${meta.maxHeight} m · 10 m CNBH`;
      $('model-caption').textContent='北京故宫 5 km · CNBH-10m 体块 + 天地图影像底图';
    }
    setModelStatus(`${config.label} 已加载${state.model.imageryGround?' + 天地图影像底图':''}`);
    window.beijingDiagnostics={...window.beijingDiagnostics,modelLoaded:true,variant,
      buildings:meta.buildingCount??null,blocks:meta.blockCount??null,
      license:meta.license??null,imagery:state.model.imageryGround};
    resize();
  }catch(error){
    setModelStatus(`模型加载失败：${error.message}`);
    // A fresh export may not include the optional GBA download; keep the page
    // usable by falling back to the OSM + CNBH layer.
    fallbackToOsm=variant==='gba';
  }finally{
    state.model.loading=false;
  }
  if(fallbackToOsm){
    state.variant='osm';$('bj-variant').value='osm';
    return loadVariant('osm');
  }
}

function setView(view){
  state.view=view;
  for(const button of document.querySelectorAll('[data-view]')){
    button.classList.toggle('active',button.dataset.view===view);
  }
  for(const panel of document.querySelectorAll('.sat-view'))panel.hidden=panel.id!==`view-${view}`;
  if(view==='map')state.map?.checkResize?.();
  if(view==='model'){initViewer();resize();loadVariant(state.variant);}
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
$('bj-variant').onchange=()=>{state.variant=$('bj-variant').value;loadVariant(state.variant);};
$('focus-center').onclick=focusCenter;
$('fit-all').onclick=()=>{if(state.model.object)fitObject(state.model.object);};
$('tdt-layer').onchange=()=>{if(state.map)addBaseLayers($('tdt-layer').value);};
$('tdt-locate').onclick=()=>{if(state.map)state.map.centerAndZoom(new window.T.LngLat(CENTER[0],CENTER[1]),13);};
$('tdt-tk').addEventListener('keydown',event=>{if(event.key==='Enter')initTdtMap();});
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>setView(button.dataset.view);
window.addEventListener('resize',()=>{resize();state.map?.checkResize?.();});

restoreTk();
setView('map');
