// Finite vertical LoD1 walls, image-source first reflection; deliberately bounded
// to nearby walls. This is a local proxy, not an exhaustive urban ray tracer.
export function facadeIndex(buildings){
 const cells=new Map(),size=150;
 for(const b of buildings)for(const ring of b.rings)for(let i=0;i<ring.length;i++){
  const a=ring[i],z=ring[(i+1)%ring.length],dx=z[0]-a[0],dz=z[2]-a[2],length=Math.hypot(dx,dz);
  if(length<1)continue;
  const wall={a,z,dx,dz,length,bottom:Math.min(a[1],z[1]),top:Math.max(a[1],z[1])+b.height};
  // Store long walls in every crossed cell so midpoint lookup cannot lose them.
  for(let x=Math.floor(Math.min(a[0],z[0])/size);x<=Math.floor(Math.max(a[0],z[0])/size);x++)for(let y=Math.floor(Math.min(a[2],z[2])/size);y<=Math.floor(Math.max(a[2],z[2])/size);y++){
   const key=`${x},${y}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(wall);
  }
 }
 return (from,to,visible)=>{
  const mx=(from[0]+to[0])/2,mz=(from[2]+to[2])/2,candidates=new Set();
  for(let x=Math.floor(mx/size)-1;x<=Math.floor(mx/size)+1;x++)for(let z=Math.floor(mz/size)-1;z<=Math.floor(mz/size)+1;z++)for(const w of cells.get(`${x},${z}`)??[])candidates.add(w);
  const paths=[];
  const ranked=[...candidates].sort((a,b)=>Math.hypot((a.a[0]+a.z[0])/2-mx,(a.a[2]+a.z[2])/2-mz)-Math.hypot((b.a[0]+b.z[0])/2-mx,(b.a[2]+b.z[2])/2-mz)).slice(0,24);
  for(const w of ranked){
   const nx=-w.dz/w.length,nz=w.dx/w.length;
   const sf=(from[0]-w.a[0])*nx+(from[2]-w.a[2])*nz,st=(to[0]-w.a[0])*nx+(to[2]-w.a[2])*nz;
   if(sf*st<=0||Math.abs(sf)<0.1)continue;
   const mirror=[from[0]-2*sf*nx,from[1],from[2]-2*sf*nz],u=sf/(sf+st);
   const hit=mirror.map((v,i)=>v+(to[i]-v)*u),along=((hit[0]-w.a[0])*w.dx+(hit[2]-w.a[2])*w.dz)/w.length**2;
   if(along<=0||along>=1||hit[1]<=w.bottom||hit[1]>=w.top)continue;
   if(!visible(from,hit)||!visible(hit,to))continue;
   const distance=Math.hypot(...hit.map((v,i)=>v-from[i]))+Math.hypot(...to.map((v,i)=>v-hit[i]));
   paths.push({point:hit,distance});
  }
  return paths.sort((a,b)=>a.distance-b.distance).slice(0,3);
 };
}
