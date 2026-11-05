// Exact barycentric height queries on the same terrain triangles used by Three.js.
// Cache stays outside geometry.userData so it is never embedded into GLB exports.
const caches=new WeakMap();
export function terrainSampler(geometry){
 if(caches.has(geometry))return caches.get(geometry);
 const p=geometry.attributes.position,index=geometry.index?.array,triangles=index?index.length/3:p.count/3,buckets=new Map(),size=64;
 for(let i=0;i<triangles;i++){
  const a=index?index[i*3]:i*3,b=index?index[i*3+1]:i*3+1,c=index?index[i*3+2]:i*3+2;
  const ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b),cx=p.getX(c),cz=p.getZ(c),den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
  if(Math.abs(den)<1e-12)continue;
  const t={cx,cz,den,ux:bz-cz,uz:cx-bx,vx:cz-az,vz:ax-cx,ay:p.getY(a),by:p.getY(b),cy:p.getY(c)};
  for(let x=Math.floor(Math.min(ax,bx,cx)/size);x<=Math.floor(Math.max(ax,bx,cx)/size);x++)for(let z=Math.floor(Math.min(az,bz,cz)/size);z<=Math.floor(Math.max(az,bz,cz)/size);z++){
   const key=`${x},${z}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(t);
  }
 }
 const sample=(x,z)=>{
  const candidates=buckets.get(`${Math.floor(x/size)},${Math.floor(z/size)}`);if(!candidates)return null;
  for(const t of candidates){const dx=x-t.cx,dz=z-t.cz,u=(t.ux*dx+t.uz*dz)/t.den,v=(t.vx*dx+t.vz*dz)/t.den,w=1-u-v;if(u>=-1e-10&&v>=-1e-10&&w>=-1e-10)return u*t.ay+v*t.by+w*t.cy;}
  return null;
 };
 caches.set(geometry,sample);return sample;
}
