import * as THREE from 'three';
import {terrainSampler} from './terrain-query.js';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';

export function createSceneQuery(model,{fastGround=true}={}){
 for(const mesh of [model.buildings,model.ground]){
  // Keep original triangle ordering: feature picking relies on face-index ranges.
  mesh.geometry.boundsTree??=new MeshBVH(mesh.geometry,{indirect:true});
  mesh.raycast=acceleratedRaycast;mesh.updateMatrixWorld(true);
 }
 const raycaster=new THREE.Raycaster();
 const sampleGround=fastGround?terrainSampler(model.ground.geometry):null;
 function groundAt(x,z){return sampleGround?sampleGround(x,z):groundAtRaycast(x,z);}
 function groundAtRaycast(x,z){
  raycaster.set(new THREE.Vector3(x,20000,z),new THREE.Vector3(0,-1,0));raycaster.near=0;raycaster.far=40000;raycaster.firstHitOnly=true;
  return raycaster.intersectObject(model.ground)[0]?.point.y??null;
 }
 function surfaceAt(x,z){
  raycaster.set(new THREE.Vector3(x,20000,z),new THREE.Vector3(0,-1,0));raycaster.near=0;raycaster.far=40000;raycaster.firstHitOnly=true;return raycaster.intersectObjects([model.buildings,model.ground])[0]?.point.y??null;
 }
 function featureAt(faceIndex){
  let lo=0,hi=model.ranges.length-1;
  while(lo<=hi){const m=(lo+hi)>>1,r=model.ranges[m];if(faceIndex<r.start)hi=m-1;else if(faceIndex>=r.end)lo=m+1;else return r.building;}
  return null;
 }
 function trace(from,to){
  const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),distance=a.distanceTo(b);
  const result={blocked:false,buildingCount:0,clearance:0,obstacleDistance:null,sensorGround:groundAt(from[0],from[2]),targetGround:groundAt(to[0],to[2]),known:true,coverageSamples:0,coverageSampleSpacingMeters:0};
  if(distance<0.002){result.known=result.sensorGround!==null;return result;}
  raycaster.set(a,b.clone().sub(a).normalize());raycaster.near=0.001;raycaster.far=distance-0.001;raycaster.firstHitOnly=false;
  const hits=raycaster.intersectObjects([model.buildings,model.ground]);
  const seen=new Set();
  for(const hit of hits){
   result.blocked=true;
   if(result.obstacleDistance===null)result.obstacleDistance=hit.distance;
   if(hit.object===model.buildings){const building=featureAt(hit.faceIndex);if(building){seen.add(building.id);const clearance=building.rings[0][0][1]+building.height-hit.point.y;if(clearance>result.clearance){result.clearance=clearance;result.obstacleDistance=hit.distance;}}}
  }
  result.buildingCount=seen.size;
  const horizontal=Math.hypot(to[0]-from[0],to[2]-from[2]);
  const samples=Math.max(1,Math.min(1024,Math.ceil(horizontal/15)));
  result.coverageSampleSpacingMeters=horizontal/samples;
  for(let i=0;i<=samples;i++){
   const t=i/samples,x=from[0]+(to[0]-from[0])*t,z=from[2]+(to[2]-from[2])*t;
   const ground=groundAt(x,z);result.coverageSamples++;
   if(ground===null){result.known=false;continue;}
   const lineY=from[1]+(to[1]-from[1])*t;
   if(ground-lineY>0.001){result.blocked=true;if(ground-lineY>result.clearance){result.clearance=ground-lineY;result.obstacleDistance=distance*t;}}
  }
  return result;
 }
 return {trace,groundAt,groundAtRaycast,surfaceAt,featureAt};
}
