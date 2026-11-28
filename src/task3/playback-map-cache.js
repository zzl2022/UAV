import * as THREE from 'three';

const CAPTURE_LAYER=0x20000000;

export function createPlaybackMapCache({renderer,scene,camera,lights,renderSurfaces}){
 const gl=renderer.getContext();
 const samples=gl.getParameter(gl.SAMPLES);
 let supported=renderer.extensions.has('EXT_color_buffer_float')&&
   (!samples||gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES)?.includes(samples));
 const size=new THREE.Vector2(),cameraWorld=new THREE.Matrix4(),projection=new THREE.Matrix4();
 const buildingWorld=new THREE.Matrix4(),groundWorld=new THREE.Matrix4();
 const copyScene=new THREE.Scene(),copyCamera=new THREE.Camera();
 let target=null,copyMaterial=null,steady=false,current=false,drawIdentity=null;

 function invalidate(){current=false;}
 renderer.domElement.addEventListener('webglcontextrestored',invalidate);
 function clear(){
  target?.dispose();target=null;steady=false;current=false;drawIdentity=null;
  if(copyMaterial){copyMaterial.uniforms.mapColor.value=null;copyMaterial.uniforms.mapDepth.value=null;}
 }
 function ensureTarget(width,height){
  if(!target){
   target=new THREE.WebGLRenderTarget(width,height,{samples,type:THREE.HalfFloatType,
    minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,
    depthTexture:new THREE.DepthTexture(width,height,THREE.UnsignedIntType)});
  }
  target.setSize(width,height);
  if(!copyMaterial){
   copyMaterial=new THREE.ShaderMaterial({
    uniforms:{mapColor:{value:null},mapDepth:{value:null}},
    vertexShader:`varying vec2 mapUv;
     void main(){mapUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`varying vec2 mapUv;
     uniform sampler2D mapColor;
     uniform sampler2D mapDepth;
     void main(){
      gl_FragColor=texture2D(mapColor,mapUv);
      gl_FragDepth=texture2D(mapDepth,mapUv).r;
      #include <colorspace_fragment>
     }`,
    depthFunc:THREE.AlwaysDepth,blending:THREE.NoBlending,toneMapped:false,
   });
   const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),copyMaterial);
   quad.frustumCulled=false;copyScene.add(quad);
  }
  copyMaterial.uniforms.mapColor.value=target.texture;
  copyMaterial.uniforms.mapDepth.value=target.depthTexture;
 }
 function capture(buildings,ground){
  const objects=[buildings,ground,...lights],masks=objects.map(object=>object.layers.mask);
  const previousLayers=camera.layers.mask;
  try{
   renderer.setRenderTarget(target);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)return false;
   for(const object of objects)object.layers.mask|=CAPTURE_LAYER;
   camera.layers.mask=CAPTURE_LAYER;
   renderSurfaces(buildings);return true;
  }finally{
   for(let index=0;index<objects.length;index++)objects[index].layers.mask=masks[index];
   camera.layers.mask=previousLayers;renderer.setRenderTarget(null);
  }
 }
 function usesOpaqueMaterial(mesh){
  const material=mesh?.material;
  return mesh?.isMesh&&mesh.visible&&!mesh.children.length&&material?.visible&&
   material.depthWrite&&!material.transparent&&!material.clippingPlanes?.length&&camera.layers.test(mesh.layers);
 }
 function render(buildings,ground){
  if(!supported||gl.isContextLost())return false;
  if(!usesOpaqueMaterial(buildings)||!usesOpaqueMaterial(ground)||scene.background||renderer.xr.isPresenting||
     renderer.getRenderTarget()||!renderer.autoClear||renderer.clippingPlanes.length||renderer.toneMapping!==THREE.NoToneMapping)return false;
  camera.updateWorldMatrix(true,false);
  buildings.updateWorldMatrix(true,false);ground.updateWorldMatrix(true,false);
  if(!steady||!cameraWorld.equals(camera.matrixWorld)||!projection.equals(camera.projectionMatrix)||
     !buildingWorld.equals(buildings.matrixWorld)||!groundWorld.equals(ground.matrixWorld)){
   cameraWorld.copy(camera.matrixWorld);projection.copy(camera.projectionMatrix);
   buildingWorld.copy(buildings.matrixWorld);groundWorld.copy(ground.matrixWorld);
   steady=true;current=false;return false;
  }
  renderer.getDrawingBufferSize(size);
  if(!current||drawIdentity?.buildings!==buildings||drawIdentity.ground!==ground||
     drawIdentity.buildingMaterial!==buildings.material||drawIdentity.groundMaterial!==ground.material||
     target.width!==size.x||target.height!==size.y){
   if(!size.x||!size.y||Math.max(size.x,size.y)>renderer.capabilities.maxTextureSize)return false;
   ensureTarget(size.x,size.y);
   if(!capture(buildings,ground)){supported=false;clear();return false;}
   drawIdentity={buildings,ground,buildingMaterial:buildings.material,groundMaterial:ground.material};
   current=true;
  }
  renderer.render(copyScene,copyCamera);
  buildings.visible=false;ground.visible=false;renderer.autoClear=false;
  try{renderer.render(scene,camera);}
  finally{buildings.visible=true;ground.visible=true;renderer.autoClear=true;}
  return true;
 }
 return {render,clear,invalidate};
}
