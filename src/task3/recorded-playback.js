import * as THREE from 'three';
import {createDroneMesh} from '../planning/drone-mesh.js';

export function seekRecordedFrame(frames,time){
 // 拖动进度条沿用选取到达请求时间的第一帧。
 let low=0,high=frames.length;
 while(low<high){
  const middle=Math.floor((low+high)/2);
  if(frames[middle].time<time)low=middle+1;
  else high=middle;
 }
 return Math.max(0,Math.min(low,frames.length-1));
}

export function advanceRecordedFrame(frames,index,time){
 while(index+1<frames.length&&frames[index+1].time<=time)index++;
 return index;
}

export function createRecordedPlaybackVisuals(layer){
 const drones=new Map(),targets=[],routes=[],detectedIds=new Set(),targetDetectors=new Set();
 const prevPositions=new Map(),nextPositions=new Map();
 const direction=new THREE.Vector3(),previous=new THREE.Vector3(),forward=new THREE.Vector3(0,0,1);
 const allocations={geometries:0,materials:0};
 let record=null,devices=null,lines=null,segmentCount=0;

 function collectResources(object,geometries,materials){
  object.traverse(mesh=>{
   if(mesh.geometry)geometries.add(mesh.geometry);
   if(Array.isArray(mesh.material))for(const material of mesh.material)materials.add(material);
   else if(mesh.material)materials.add(mesh.material);
  });
 }
 function add(object){
  const geometries=new Set(),materials=new Set();
  collectResources(object,geometries,materials);
  allocations.geometries+=geometries.size;allocations.materials+=materials.size;
  layer.add(object);
 }
 function release(objects){
  const geometries=new Set(),materials=new Set();
  for(const object of objects){
   collectResources(object,geometries,materials);
   layer.remove(object);
  }
  for(const geometry of geometries)geometry.dispose();
  for(const material of materials)material.dispose();
 }
 function clear(){
  release(lines?[...drones.values(),...routes,lines]:[...drones.values(),...routes]);
  record=null;devices=null;lines=null;segmentCount=0;
  routes.length=0;targets.length=0;drones.clear();detectedIds.clear();
  prevPositions.clear();nextPositions.clear();targetDetectors.clear();
 }
 function select(nextRecord){
  if(record===nextRecord)return;
  clear();record=nextRecord;
  const frames=record?.frames;
  if(!frames?.length)return;
  const samplesById=new Map();
  for(const target of frames[0].targets)samplesById.set(target.id,[]);
  for(let index=0;index<frames.length;index+=3){
   for(const target of frames[index].targets){
    const points=samplesById.get(target.id);
    if(points)points.push(new THREE.Vector3().fromArray(target.position));
   }
  }
  for(const points of samplesById.values()){
   if(points.length<2)continue;
   const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xff7a4a,transparent:true,opacity:.28,depthTest:false}));
   line.renderOrder=57;add(line);routes.push(line);
  }
 }
 function prepare(nextRecord,devicesById){
  if(record===nextRecord&&devices&&devices!==devicesById)clear();
  select(nextRecord);
  if(devices===devicesById)return;
  devices=devicesById;
  for(const frame of record.frames)for(const target of frame.targets){
   if(drones.has(target.id))continue;
   const drone=createDroneMesh();
   drone.scale.setScalar(5);drone.userData.targetId=target.id;drone.visible=false;
   drones.set(target.id,drone);add(drone);
  }
  const capacity=devices.size*drones.size;
  if(capacity){
   const position=new THREE.BufferAttribute(new Float32Array(capacity*6),3).setUsage(THREE.DynamicDrawUsage);
   const geometry=new THREE.BufferGeometry().setAttribute('position',position);
   geometry.setDrawRange(0,0);
   lines=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xff776d,transparent:true,opacity:.55}));
   lines.visible=false;lines.frustumCulled=false;add(lines);
  }
 }
 function install(index){
  const frames=record.frames,frame=frames[index];
  prevPositions.clear();nextPositions.clear();
  for(const target of frames[Math.max(0,index-1)].targets)prevPositions.set(target.id,target.position);
  for(const target of frames[Math.min(frames.length-1,index+1)].targets)nextPositions.set(target.id,target.position);
  for(const drone of targets)drone.visible=false;
  targets.length=0;detectedIds.clear();
  const position=lines?.geometry.getAttribute('position');
  let vertex=0;
  for(const target of frame.targets){
   const drone=drones.get(target.id),next=nextPositions.get(target.id),prev=prevPositions.get(target.id);
   drone.visible=true;drone.position.fromArray(target.position);targets.push(drone);
   direction.set(0,0,0);
   if(next)direction.fromArray(next).sub(drone.position);
   if(direction.lengthSq()<1e-6&&prev)direction.copy(drone.position).sub(previous.fromArray(prev));
   if(direction.lengthSq()>1e-6)drone.quaternion.setFromUnitVectors(forward,direction.normalize());
   else drone.quaternion.identity();
   targetDetectors.clear();
   for(const detector of target.detectedBy){
    detectedIds.add(detector.id);
    const device=devices.get(detector.id);
    if(!position||!device||targetDetectors.has(detector.id))continue;
    targetDetectors.add(detector.id);
    position.setXYZ(vertex++,device.position[0],device.position[1],device.position[2]);
    position.setXYZ(vertex++,target.position[0],target.position[1],target.position[2]);
   }
  }
  segmentCount=vertex/2;
  if(lines){
   lines.visible=vertex>0;lines.geometry.setDrawRange(0,vertex);
   if(vertex>0){position.clearUpdateRanges();position.addUpdateRange(0,vertex*3);position.needsUpdate=true;}
  }
  return frame;
 }
 return {clear,select,prepare,install,drones,targets,routes,detectedIds,allocations,
  get record(){return record;},
  get lines(){return lines;},
  get segmentCount(){return segmentCount;},
 };
}
