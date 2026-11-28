import * as THREE from 'three';
import {buildCityGeometry} from '../model.js';
import {createBuildingIndex} from './building-constraints.js';

export function mountBuildingSelector({canvas,camera,controls,scene,getContext,container,onChange,onModeChange=()=>{}}){
 const selections=new Map(),layer=new THREE.Group();layer.name='Building_Exclusions';scene.add(layer);
 let active=false,gesture=null,savedButtons=null,context=null,index=null;
 const ray=new THREE.Raycaster(),overlay=document.createElement('aside');overlay.id='task3-building-editor';overlay.hidden=true;
 overlay.innerHTML='<strong>建筑权重 · 禁止部署</strong><p>右键拖动调整视角；左键单击选择或取消，按住左键划过建筑批量追加。</p><span role="status"></span><button type="button">完成选择</button>';
 container.append(overlay);overlay.querySelector('button').onclick=()=>setActive(false);
 const current=()=>selections.get(context?.sceneKey)??new Set();
 function clearLayer(){for(const child of [...layer.children]){child.geometry?.dispose();child.material?.dispose();layer.remove(child);}}
 function sync(){
  const selected=current();overlay.querySelector('span').textContent=`已选择 ${selected.size} 个独立连通建筑`;
  clearLayer();if(!context||!index)return;
  const buildings=[...selected].flatMap(id=>index.componentById.get(id)?.buildings??[]);
  if(buildings.length){const {geometry}=buildCityGeometry(buildings);const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xff5879,transparent:true,opacity:.72,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,depthWrite:false}));mesh.renderOrder=12;layer.add(mesh);}
 }
 function refresh(){
  setActive(false);context=getContext();index=context?.city?createBuildingIndex(context.city):null;
  if(context&&!selections.has(context.sceneKey))selections.set(context.sceneKey,new Set());sync();
 }
 function release(){if(gesture&&canvas.hasPointerCapture(gesture.id))canvas.releasePointerCapture(gesture.id);gesture=null;}
 function setActive(value){
  if(value===active)return;
  if(value){
   context=getContext();if(!context?.city||!context.model?.buildings)throw Error('当前地图缺少建筑明细，无法选择建筑');
   index=createBuildingIndex(context.city);if(!selections.has(context.sceneKey))selections.set(context.sceneKey,new Set());
   savedButtons={...controls.mouseButtons};controls.mouseButtons.LEFT=null;controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;active=true;
  }else{release();active=false;if(savedButtons)Object.assign(controls.mouseButtons,savedButtons);savedButtons=null;}
  canvas.dataset.buildingSelecting=String(active);canvas.style.cursor=active?'crosshair':'';overlay.hidden=!active;onModeChange(active);sync();
 }
 function hit(x,y){
  if(!context?.model?.buildings?.visible||!index)return null;const rect=canvas.getBoundingClientRect();camera.updateMatrixWorld();
  ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),camera);ray.firstHitOnly=true;
  const h=ray.intersectObject(context.model.buildings,true)[0];if(!h)return null;
  return index.at(h.point.x,h.point.z,h.point.y).map(e=>index.componentById.get(e.building.id)).sort((a,b)=>a.id.localeCompare(b.id))[0]??null;
 }
 function changed(){sync();onChange(snapshot());}
 function paint(x,y){const component=hit(x,y);if(!component||gesture.visited.has(component.id))return false;gesture.visited.add(component.id);const selected=current();if(selected.has(component.id))return false;selected.add(component.id);return true;}
 canvas.addEventListener('pointerdown',event=>{
  if(!active||event.button!==0||gesture)return;event.preventDefault();event.stopImmediatePropagation();
  gesture={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,dragged:false,visited:new Set()};canvas.setPointerCapture(event.pointerId);
 },true);
 canvas.addEventListener('pointermove',event=>{
  if(!active||!gesture||gesture.id!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();
  if(!gesture.dragged&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<=5)return;
  gesture.dragged=true;const count=Math.max(1,Math.ceil(Math.hypot(event.clientX-gesture.lastX,event.clientY-gesture.lastY)/4));let any=false;
  for(let i=0;i<=count;i++)any=paint(gesture.lastX+(event.clientX-gesture.lastX)*i/count,gesture.lastY+(event.clientY-gesture.lastY)*i/count)||any;
  gesture.lastX=event.clientX;gesture.lastY=event.clientY;if(any)changed();
 },true);
 canvas.addEventListener('pointerup',event=>{
  if(!active||!gesture||gesture.id!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();
  if(!gesture.dragged){const component=hit(event.clientX,event.clientY);if(component){const selected=current();if(selected.has(component.id))selected.delete(component.id);else selected.add(component.id);changed();}}
  release();
 },true);
 canvas.addEventListener('pointercancel',release,true);canvas.addEventListener('lostpointercapture',()=>{gesture=null;},true);
 window.addEventListener('blur',()=>setActive(false));window.addEventListener('keydown',event=>{if(event.key==='Escape'&&active&&!event.defaultPrevented){event.preventDefault();setActive(false);}},true);
 function snapshot(){return {sceneKey:context?.sceneKey??'recon',buildingIds:[...current()].flatMap(id=>index?.componentById.get(id)?.buildingIds??[]).sort()};}
 return {refresh,setActive,snapshot,get active(){return active;},clear(){if(!current().size)return;current().clear();changed();},diagnostics(){return {active,sceneKey:context?.sceneKey??'recon',count:current().size,buildingIds:snapshot().buildingIds,highlightedBuildings:layer.children.length?current().size:0};}};
}
