import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createModel} from './model.js';
import './style.css';
import {mountLandmarks} from './landmarks.js';
import {mountPlanningUI} from './planning/ui.js';
import {mountSensorUI} from './sensors/ui.js';

const app=document.querySelector('#app');
app.innerHTML=`<aside>
  <div class="brand"><span class="mark">◈</span> UAV <small>地理空间实验室</small></div>
  <div class="eyebrow">CITY RECONSTRUCTION / 01</div>
  <h1>城市三维<br>地理建模<span>。</span></h1>
  <p class="intro">郑州 · 河南博物院片区<br>基于仓库建筑轮廓与 DEM 的真实数据重建</p>
  <div class="stats"><div><strong id="count">—</strong><span>建筑要素</span></div><div><strong id="height">—</strong><span>最高建筑 / m</span></div></div>
  <section><h2>场景图层 <span>LAYERS</span></h2>
  <label><input type="checkbox" id="buildings" checked>建筑重建 <small>SHP / high</small></label>
  <label><input type="checkbox" id="terrain" checked>真实地形 <small>DEM / 30 m 级</small></label>
  <label><input type="checkbox" id="imagery" checked>影像底图 <small>GeoTIFF / RGB</small></label>
  <label><input type="checkbox" id="wire">建筑线框 <small>WIREFRAME</small></label>
  <label><input type="checkbox" id="original">原始白模对比 <small>GLB</small></label>
  <p class="hint">启用原始白模时隐藏重建建筑，避免重复叠加。原始白模的垂直基准未注明。</p></section>
  <section><h2>模型工具 <span>TOOLS</span></h2><div class="buttons"><button id="reset">↗ 全域视角</button><button id="top">⌖ 俯视平面</button></div>
  <button id="export" class="primary" disabled>导出三维模型 · GLB ↓</button>
  <a class="download" href="./data/buildings.geojson" download>下载建筑 GeoJSON ↗</a></section>
  <section id="selection"><h2>建筑属性 <span>INSPECT</span></h2><p class="hint" id="details">点击建筑查看名称、真实高度与地面海拔。</p></section>
  <footer>坐标：WGS84 → 局部 ENU / 米<br>高程按源 DEM 使用，垂直基准未标注。<br>影像按坐标贴合地形，不改变建筑高度。</footer>
</aside><main><header><div><span class="live"></span> 郑州城市数字底座 <span class="tag">REPOSITORY DATA</span></div><a href="./data/report.json" target="_blank" rel="noopener">数据报告 ↗</a></header>
<div id="viewport" aria-label="可旋转的三维城市场景"></div><div class="north">N<br>↑</div><div id="status" role="status">正在读取仓库数据…</div><div class="navigation">左键旋转 · 右键平移 · 滚轮缩放</div><div id="location">LOCAL ENU · METERS</div></main>`;
const el=id=>document.getElementById(id);
let renderer,model,city,terrain,controls,original;
let scene,camera,imageryTexture;
const viewport=el('viewport');
const status=text=>{el('status').textContent=text;};
const disableControls=value=>{for (const id of ['buildings','terrain','imagery','wire','original','reset','top']) el(id).disabled=value;};
disableControls(true);
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function fetchJSON(path){const response=await fetch(path);if(!response.ok)throw Error(`${path}: HTTP ${response.status}`);return response.json();}
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
  let imageryError;
  if(terrain.imagery){
    try {
      imageryTexture=await new THREE.TextureLoader().loadAsync(`./data/${terrain.imagery.texture}`);
      imageryTexture.colorSpace=THREE.SRGBColorSpace;
      imageryTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      model.ground.material=new THREE.MeshBasicMaterial({map:imageryTexture,side:THREE.DoubleSide});
    }catch(error){imageryError=error;console.warn('影像加载失败',error);}
  }
  const box=new THREE.Box3().setFromObject(model.group),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const span=Math.max(size.x,size.z);
  function fit(top=false){controls.target.copy(center);camera.up.set(0,1,0);camera.position.copy(center).add(new THREE.Vector3(top?0:span*.7,top?span*1.55:span*.9,top?.001:span*.95));controls.update();}
  fit();el('reset').onclick=()=>fit();el('top').onclick=()=>fit(true);
  const grid=new THREE.GridHelper(Math.ceil(span/1000)*1000,Math.ceil(span/1000)*2,0x33515b,0x20333b);grid.position.y=box.min.y-1;scene.add(grid);
  el('count').textContent=city.metadata.sourceFeatures.toLocaleString('zh-CN');el('height').textContent=city.metadata.maxHeight;
  el('location').textContent=`${city.metadata.origin[0].toFixed(5)}° E / ${city.metadata.origin[1].toFixed(5)}° N · ENU`;
  const ready=()=>status(`已建模 ${city.metadata.sourceFeatures.toLocaleString('zh-CN')} 栋建筑 · 地形 ${terrain.cols} × ${terrain.rows} · ${imageryTexture?'影像已对齐':'米制坐标'}${imageryError?'（影像加载失败，可重新准备数据后刷新）':''}`);
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
    el('original').disabled=true;status('正在加载仓库原始白模…');
    const loaded=[];
    try {
      const loader=new GLTFLoader();
      for(const file of ['NoLod_0.glb','NoLod_1.glb']) loaded.push((await loader.loadAsync(`./data/${file}`)).scene);
      original=new THREE.Group();original.name='Source_White_Model';original.add(...loaded);scene.add(original);original.visible=el('original').checked;
      ready();
    }catch(error){for(const item of loaded)item.traverse(o=>{o.geometry?.dispose();});el('original').checked=false;model.buildings.visible=el('buildings').checked;status(`白模加载失败：${error.message}`);}
    finally{el('original').disabled=false;}
  };
  el('export').onclick=async()=>{
    el('export').disabled=true;status('正在导出重建建筑与 DEM（不含原始白模）…');
    const wire=model.buildings.material.wireframe;model.buildings.material.wireframe=false;
    try {const buffer=await new GLTFExporter().parseAsync(model.group,{binary:true,onlyVisible:false});download(buffer,'zhengzhou-city-enu.glb','model/gltf-binary');ready();}
    catch(error){status(`导出失败：${error.message}`);}finally{model.buildings.material.wireframe=wire;el('export').disabled=false;}
  };
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down;
  renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5||!model.buildings.visible)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(model.buildings)[0];if(!hit)return;
    const b=model.ranges.find(r=>hit.faceIndex>=r.start&&hit.faceIndex<r.end)?.building;if(!b)return;
    el('details').textContent=`${b.name} | 高度 ${b.height} m | 地面海拔 ${b.ground.toFixed(1)} m | ID ${b.id}`;
  });
  const resize=()=>{camera.aspect=viewport.clientWidth/viewport.clientHeight;camera.updateProjectionMatrix();renderer.setSize(viewport.clientWidth,viewport.clientHeight);};
  new ResizeObserver(resize).observe(viewport);resize();
  let planning;
  const landmarks=mountLandmarks({city,scene,camera,controls,viewport});
  renderer.setAnimationLoop(stamp=>{controls.update();landmarks.update();planning?.update(stamp);renderer.render(scene,camera);});
  disableControls(false);el('imagery').disabled=!imageryTexture;el('imagery').checked=!!imageryTexture;el('export').disabled=false;ready();
  const sensors=mountSensorUI({app,scene,camera,controls,renderer,model,city});
  planning=mountPlanningUI({app,city,scene,camera,controls,renderer,sensors,model});
  document.documentElement.dataset.ready='true';
  // Expose diagnostic counts only, for reproducible headless browser verification.
  window.cityDiagnostics={features:city.metadata.sourceFeatures,parts:city.buildings.length,terrainVertices:terrain.positions.length/3,buildingTriangles:model.buildings.geometry.attributes.position.count/3,imagery:!!imageryTexture};
}catch(error){status(`无法建立场景：${error.message}。请先执行数据准备，并使用支持 WebGL 的浏览器。`);document.documentElement.dataset.ready='error';console.error(error);}
