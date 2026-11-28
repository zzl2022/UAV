import * as THREE from 'three';

const MIN_TRIANGLES=100000;
const MIN_TILE_SIZE=500;
const MAX_VISIBLE_SHARE=.7;

function partitionGeometry(geometry){
 const position=geometry.getAttribute('position'),index=geometry.getIndex();
 const count=index?.count??position.count;
 if(!geometry.boundingBox)geometry.computeBoundingBox();
 const {min,max}=geometry.boundingBox;
 const step=Math.max(MIN_TILE_SIZE,Math.max(max.x-min.x,max.z-min.z)/32);
 const columns=Math.floor((max.x-min.x)/step)+1;
 const tiles=new Map();
 for(let offset=0;offset<count;offset+=3){
  const a=index?index.getX(offset):offset,b=index?index.getX(offset+1):offset+1,c=index?index.getX(offset+2):offset+2;
  const ax=position.getX(a),bx=position.getX(b),cx=position.getX(c);
  const az=position.getZ(a),bz=position.getZ(b),cz=position.getZ(c);
  const column=Math.floor(((ax+bx+cx)/3-min.x)/step),row=Math.floor(((az+bz+cz)/3-min.z)/step);
  const key=row*columns+column;
  let tile=tiles.get(key);
  if(!tile){tile={bounds:new THREE.Box3(),indices:[]};tiles.set(key,tile);}
  const ay=position.getY(a),by=position.getY(b),cy=position.getY(c);
  const low=tile.bounds.min,high=tile.bounds.max;
  low.set(Math.min(low.x,ax,bx,cx),Math.min(low.y,ay,by,cy),Math.min(low.z,az,bz,cz));
  high.set(Math.max(high.x,ax,bx,cx),Math.max(high.y,ay,by,cy),Math.max(high.z,az,bz,cz));
  tile.indices.push(a,b,c);
 }
 return tiles;
}

export function createPlaybackBuildingBatches(){
 const clip=new THREE.Matrix4(),frustum=new THREE.Frustum();
 let cached=null;
 function clear(){
  if(!cached)return;
  for(const {mesh} of cached.tiles){
   const geometry=mesh.geometry;
   // The source mesh owns the shared vertex attributes.
   for(const name of Object.keys(geometry.attributes))geometry.deleteAttribute(name);
   geometry.dispose();
  }
  cached=null;
 }
 function prepare(source,position,index,count){
  clear();
  const group=new THREE.Group(),tiles=[],attributes=Object.entries(source.geometry.attributes);
  const IndexAttribute=position.count>65535?THREE.Uint32BufferAttribute:THREE.Uint16BufferAttribute;
  group.matrixAutoUpdate=false;
  for(const {bounds,indices} of partitionGeometry(source.geometry).values()){
   const geometry=new THREE.BufferGeometry();
   for(const [name,attribute] of attributes)geometry.setAttribute(name,attribute);
   geometry.setIndex(new IndexAttribute(indices,1));
   geometry.boundingBox=bounds;
   const mesh=new THREE.Mesh(geometry,source.material);
   mesh.frustumCulled=false;group.add(mesh);
   tiles.push({mesh,bounds,count:indices.length});
  }
  cached={source,geometry:source.geometry,position,positionVersion:position.version,index,indexVersion:index?.version,
   group,tiles,count,material:source.material};
 }
 function render(renderer,scene,camera,source){
  if(!source?.isMesh||!source.visible||!source.parent||source.children.length||source.isSkinnedMesh||source.isInstancedMesh||source.isBatchedMesh||
     !camera.layers.test(source.layers))return false;
  const {geometry,material}=source;
  const position=geometry.getAttribute('position'),index=geometry.getIndex(),count=index?.count??position?.count;
  if(!position||!Number.isFinite(count)||count%3!==0||count<MIN_TRIANGLES*3||geometry.drawRange.start!==0||
     geometry.drawRange.count<count||Array.isArray(material)||!material.visible||material.transparent||material.clippingPlanes?.length||
     source.morphTargetInfluences?.length)return false;
  if(cached?.source!==source||cached.geometry!==geometry||cached.position!==position||cached.positionVersion!==position.version||
     cached.index!==index||cached.indexVersion!==index?.version)prepare(source,position,index,count);
  const {group,tiles}=cached;
  source.updateWorldMatrix(true,false);
  camera.updateWorldMatrix(true,false);
  clip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(source.matrixWorld);
  frustum.setFromProjectionMatrix(clip,camera.coordinateSystem);
  let visibleCount=0;
  for(const tile of tiles){
   tile.mesh.visible=frustum.intersectsBox(tile.bounds);
   if(tile.mesh.visible)visibleCount+=tile.count;
  }
  if(visibleCount>cached.count*MAX_VISIBLE_SHARE)return false;
  for(const {mesh} of tiles){
   mesh.layers.mask=source.layers.mask;mesh.renderOrder=source.renderOrder;
   mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;
   if(cached.material!==material)mesh.material=material;
  }
  cached.material=material;
  group.matrix.copy(source.matrix);group.matrixWorldNeedsUpdate=true;
  const parent=source.parent;
  parent.add(group);source.visible=false;
  try{renderer.render(scene,camera);}
  finally{source.visible=true;parent.remove(group);}
  return true;
 }
 return {render,clear};
}
