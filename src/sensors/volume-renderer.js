import * as THREE from 'three';
import {VOLUME_METRICS,RAMP,sampleField} from './volume.js';

const vertexShader=`out vec3 vWorld;
void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`;
const fragmentShader=`precision highp sampler3D;
out vec4 outColor;
#define gl_FragColor outColor
uniform sampler3D field;uniform sampler2D sceneDepth;uniform sampler2D ramp;
uniform vec3 boxMin,boxSize,dimensions;uniform vec2 resolution;
uniform mat4 inverseProjection,cameraWorld;uniform float marchStep,density,valueMin,valueMax,displayFloor,clipX;uniform int channel,surfaceMode;
in vec3 vWorld;
vec4 voxel(ivec3 p){return texelFetch(field,clamp(p,ivec3(0),ivec3(dimensions)-1),0);}
// Interpolate scalar values, with a nearest-neighbour hard validity mask.
vec2 scalar(vec3 uv){
 vec3 p=uv*(dimensions-1.0);vec4 nearest=voxel(ivec3(floor(p+0.5)));
 if(abs(nearest.a-1.0)>.1)return vec2(0.0,0.0);
 vec3 f=fract(p);ivec3 base=ivec3(floor(p));float sum=0.0,wtotal=0.0;
 for(int z=0;z<2;z++)for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec4 v=voxel(base+ivec3(x,y,z));if(abs(v.a-1.0)>.1||(channel==2&&v.b<0.0))continue;
  float w=(x==1?f.x:1.0-f.x)*(y==1?f.y:1.0-f.y)*(z==1?f.z:1.0-f.z);
  sum+=v[channel]*w;wtotal+=w;
 }
 return vec2(sum/max(wtotal,1e-8),step(1e-8,wtotal));
}
void main(){
 vec3 direction=normalize(vWorld-cameraPosition),safeDir=direction;
 for(int j=0;j<3;j++)if(abs(safeDir[j])<1e-7)safeDir[j]=1e-7;
 vec3 a=(boxMin-cameraPosition)/safeDir,b=(boxMin+boxSize-cameraPosition)/safeDir;
 vec3 lo=min(a,b),hi=max(a,b);float nearT=max(0.0,max(lo.x,max(lo.y,lo.z))),farT=min(hi.x,min(hi.y,hi.z));
 vec2 uvScreen=gl_FragCoord.xy/resolution;float depth=texture(sceneDepth,uvScreen).r;
 if(depth<.999999){vec4 viewPoint=inverseProjection*vec4(uvScreen*2.0-1.0,depth*2.0-1.0,1.0);viewPoint/=viewPoint.w;vec3 worldPoint=(cameraWorld*viewPoint).xyz;farT=min(farT,dot(worldPoint-cameraPosition,direction));}
 if(farT<=nearT)discard;
 float dt=max(marchStep,(farT-nearT)/768.0);vec4 acc=vec4(0.0);
 for(int i=0;i<768;i++){
  float t=nearT+(float(i)+.5)*dt;if(t>farT||acc.a>.9)break;
  vec3 uv=(cameraPosition+direction*t-boxMin)/boxSize;
  if(uv.x>clipX)continue;
  vec2 s=scalar(uv);if(s.y<.5||s.x<displayFloor)continue;
  float v=clamp((s.x-valueMin)/(valueMax-valueMin),0.0,1.0);
  vec3 color=texture(ramp,vec2(v,.5)).rgb;
  if(surfaceMode==1){
   float left=max(nearT,t-dt),right=t;
   for(int j=0;j<7;j++){float mid=(left+right)*.5;vec3 p=(cameraPosition+direction*mid-boxMin)/boxSize;vec2 m=scalar(p);if(p.x<=clipX&&m.y>.5&&m.x>=displayFloor)right=mid;else left=mid;}
   vec3 p=(cameraPosition+direction*right-boxMin)/boxSize,grad=vec3(0.0),delta=1.0/(dimensions-1.0);
   for(int j=0;j<3;j++){vec3 e=vec3(0.0);e[j]=delta[j]*.5;vec2 a=scalar(clamp(p+e,0.0,1.0)),b=scalar(clamp(p-e,0.0,1.0));grad[j]=(a.y>.5?a.x:valueMin)-(b.y>.5?b.x:valueMin);}
   float lighting=.6+.4*abs(dot(normalize(grad+vec3(1e-5)),normalize(vec3(.4,.8,.5))));
   gl_FragColor=linearToOutputTexel(vec4(color*lighting,.78));return;
  }
  float alpha=1.0-exp(-density*dt/1100.0*(.2+.8*v));
  acc.rgb+=(1.0-acc.a)*color*alpha;acc.a+=(1.0-acc.a)*alpha;
 }
 if(acc.a<.004)discard;gl_FragColor=vec4(acc.rgb/max(acc.a,1e-6),acc.a);
 #include <colorspace_fragment>
}`;

export function createVolumeRenderer(group,field){
 const {grid}=field,[nx,ny,nz]=grid.dimensions;
 const texture=new THREE.Data3DTexture(field.values,nx,ny,nz);texture.format=THREE.RGBAFormat;texture.type=THREE.FloatType;texture.minFilter=THREE.NearestFilter;texture.magFilter=THREE.NearestFilter;texture.unpackAlignment=1;texture.needsUpdate=true;
 const colors=new Uint8Array(256*4);
 // RGB is display-encoded; use sRGB texture so shader blending is linear.
 for(let i=0;i<256;i++){let j=1,t=i/255;while(j<RAMP.length-1&&t>RAMP[j][0])j++;const a=RAMP[j-1],b=RAMP[j],f=(t-a[0])/(b[0]-a[0]);for(let k=0;k<3;k++)colors[i*4+k]=Math.round(255*(a[k+1]+(b[k+1]-a[k+1])*f));colors[i*4+3]=255;}
 const ramp=new THREE.DataTexture(colors,256,1);ramp.colorSpace=THREE.SRGBColorSpace;ramp.minFilter=THREE.LinearFilter;ramp.magFilter=THREE.LinearFilter;ramp.needsUpdate=true;
 const target=new THREE.WebGLRenderTarget(1,1,{depthTexture:new THREE.DepthTexture(1,1),minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
 const uniforms={field:{value:texture},ramp:{value:ramp},sceneDepth:{value:target.depthTexture},boxMin:{value:new THREE.Vector3(...grid.origin)},boxSize:{value:new THREE.Vector3(...grid.size)},dimensions:{value:new THREE.Vector3(...grid.dimensions)},resolution:{value:new THREE.Vector2()},inverseProjection:{value:new THREE.Matrix4()},cameraWorld:{value:new THREE.Matrix4()},marchStep:{value:Math.min(...grid.step)*.65},density:{value:1.3},valueMin:{value:-20},valueMax:{value:40},displayFloor:{value:0},clipX:{value:1},channel:{value:0},surfaceMode:{value:0}};
 const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader,uniforms,side:THREE.BackSide,transparent:true,depthTest:false,depthWrite:false,toneMapped:false});
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(...grid.size),material);mesh.position.fromArray(grid.origin.map((v,i)=>v+grid.size[i]/2));mesh.name='Raymarched_Detection_Volume';mesh.renderOrder=50;group.add(mesh);
 let metric='margin';
 return {mesh,
  configure({metric:key='margin',floor=0,density=1.3,clip=1,style='volume',range=null}){metric=key;const m=VOLUME_METRICS[key];uniforms.channel.value={margin:0,snr:1,pd:2}[key];uniforms.valueMin.value=range?.[0]??m.min;uniforms.valueMax.value=range?.[1]??m.max;uniforms.displayFloor.value=floor;uniforms.density.value=density;uniforms.clipX.value=clip;uniforms.surfaceMode.value=style==='surface'?1:0;},
  render(renderer,scene,camera){
   if(!group.visible)return false;
   const size=renderer.getDrawingBufferSize(new THREE.Vector2());if(target.width!==size.x||target.height!==size.y)target.setSize(size.x,size.y);
   uniforms.resolution.value.copy(size);uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);camera.updateMatrixWorld();uniforms.cameraWorld.value.copy(camera.matrixWorld);
   const old=renderer.getRenderTarget();group.visible=false;renderer.setRenderTarget(target);
   try{renderer.render(scene,camera);}finally{group.visible=true;renderer.setRenderTarget(old);}
   renderer.render(scene,camera);return true;
  },
  probe(ray){
   const box=new THREE.Box3(new THREE.Vector3(...grid.origin),new THREE.Vector3(...grid.origin.map((v,i)=>v+grid.size[i]))),entry=ray.ray.intersectBox(box,new THREE.Vector3());
   if(!entry)return null;
   const origin=box.containsPoint(ray.ray.origin)?ray.ray.origin.clone():entry;
   for(let t=0;t<grid.size.reduce((a,b)=>a+b,0);t+=Math.min(...grid.step)*.5){const p=origin.clone().addScaledVector(ray.ray.direction,t);if(!box.containsPoint(p))break;if((p.x-grid.origin[0])/grid.size[0]>uniforms.clipX.value)continue;const r=sampleField(field,p.toArray(),metric);if(r?.state===1&&r.value!==null&&r.value>=uniforms.displayFloor.value)return {point:p,distance:p.distanceTo(ray.ray.origin),sample:r};}
   return null;
  },
  dispose(){group.remove(mesh);mesh.geometry.dispose();material.dispose();texture.dispose();ramp.dispose();target.dispose();}
 };
}
