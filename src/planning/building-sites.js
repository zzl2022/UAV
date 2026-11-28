import {ShapeUtils,Vector2} from 'three';
import {containsBuildingFootprint} from '../task3/building-constraints.js';

function inBounds(x,z,bounds){
 return x>=bounds.west&&x<bounds.east&&z>=bounds.south&&z<bounds.north;
}

function makeSite(building,position,ground,kind,supportY,mount,installation){
 const aboveGroundM=position[1]-ground;
 return {buildingId:building?.id??null,name:building?.name??'地面候选点',position,mountKind:kind,supportY,mountHeightM:mount,aboveGroundM,
  installationProxy:1+(aboveGroundM-2)/100,installation};
}

// Use the renderer's Three.js / Earcut triangulation for concavities and holes.
function* roofPoints(building){
 const rings=building.rings.map(ring=>ring.map(p=>new Vector2(p[0],p[2])));
 for(const ring of rings)if(ring.length>1&&ring[0].equals(ring.at(-1)))ring.pop();
 const rim=rings[0];
 const mean=rim.reduce((sum,v)=>sum.add(v),new Vector2()).divideScalar(rim.length);
 yield mean;
 const triangles=ShapeUtils.triangulateShape(rim,rings.slice(1)),vertices=rings.flat();
 const area=([i,j,k])=>Math.abs((vertices[j].x-vertices[i].x)*(vertices[k].y-vertices[i].y)-(vertices[j].y-vertices[i].y)*(vertices[k].x-vertices[i].x));
 for(const [i,j,k] of triangles.sort((a,b)=>area(b)-area(a))){
  yield vertices[i].clone().add(vertices[j]).add(vertices[k]).divideScalar(3);
 }
}

function* roofSites(building,query,bounds,guard,mount){
 const top=building.rings[0][0][1]+building.height;
 for(const {x,y:z} of roofPoints(building)){
  if(!inBounds(x,z,bounds)||!containsBuildingFootprint(building,x,z)||guard.blocked([x,0,z],building.id))continue;
  const ground=query.groundAt(x,z);
  if(!Number.isFinite(ground))continue;
  const hit=query.surfaceHitAt?.(x,z);
  const surface=query.surfaceHitAt?hit?.height:query.surfaceAt(x,z);
  if(query.surfaceHitAt&&hit?.buildingId!==building.id)continue;
  if(!Number.isFinite(surface)||Math.abs(surface-top)>2||surface<=ground)continue;
  yield makeSite(building,[x,surface+mount,z],ground,'roof',surface,mount,`屋面上方 ${mount} m；承载与接入条件待核`);
  return;
 }
}

function* facadeSites(building,query,bounds,guard,mount){
 const rim=building.rings[0],base=rim[0][1],top=base+building.height;
 const edges=rim.map((a,i)=>{
  const b=rim[(i+1)%rim.length],dx=b[0]-a[0],dz=b[2]-a[2];
  return {x:(a[0]+b[0])/2,z:(a[2]+b[2])/2,dx,dz,length:Math.hypot(dx,dz)};
 }).filter(e=>e.length>0).sort((a,b)=>b.length-a.length);
 for(const fraction of [1/3,2/3]){
  const supportY=base+fraction*building.height,y=supportY+mount;
  if(y>=top)continue;
  for(const edge of edges){
   const nx=-edge.dz/edge.length*.25,nz=edge.dx/edge.length*.25;
   let placed=false;
   for(const sign of [1,-1]){
    const x=edge.x+sign*nx,z=edge.z+sign*nz;
    if(!inBounds(x,z,bounds)||containsBuildingFootprint(building,x,z)||!containsBuildingFootprint(building,edge.x-sign*nx,edge.z-sign*nz))continue;
    if(guard.blocked([x,y,z],building.id))continue;
    const ground=query.groundAt(x,z),surface=query.surfaceAt(x,z);
    if(!Number.isFinite(ground)||!Number.isFinite(surface)||supportY<=Math.max(ground,surface))continue;
    yield makeSite(building,[x,y,z],ground,'facade',supportY,mount,`外立面模拟支承标高 ${(supportY-base).toFixed(1)} m（相对楼底），架设 ${mount} m；实际楼层与固定条件待核`);
    placed=true;break;
   }
   if(placed)break;
  }
 }
}

function* roundRobin(iterators){
 let active=iterators;
 while(active.length){
  const remaining=[];
  for(const iterator of active){
   const next=iterator.next();
   if(!next.done){yield next.value;remaining.push(iterator);}
  }
  active=remaining;
 }
}

function* groundSites(query,bounds,guard,mount,spacing){
 const dem=query.getDataBounds?.()?.dem??bounds;
 const west=Math.max(bounds.west,dem.west),east=Math.min(bounds.east,dem.east);
 const south=Math.max(bounds.south,dem.south),north=Math.min(bounds.north,dem.north);
 for(let left=west;left<east;left+=spacing)for(let bottom=south;bottom<north;bottom+=spacing){
  const x=(left+Math.min(left+spacing,east))/2,z=(bottom+Math.min(bottom+spacing,north))/2;
  if(guard.blocked([x,0,z]))continue;
  const ground=query.groundAt(x,z),hit=query.surfaceHitAt?.(x,z);
  const surface=query.surfaceHitAt?hit?.height:query.surfaceAt(x,z);
  if(hit?.buildingId!=null||!Number.isFinite(ground)||!Number.isFinite(surface)||Math.abs(surface-ground)>.05)continue;
  yield makeSite(null,[x,surface+mount,z],ground,'ground',surface,mount,`地表上方 ${mount} m；用地与基础条件待核`);
 }
}

export function buildingSites(city,query,settings,bounds,guard){
 const cells=new Map(),excluded=new Set(guard.buildingIds),mount=settings.installationHeightM??2;
 for(const building of city.buildings){
  if(excluded.has(building.id)||!(building.height>0))continue;
  const ring=building.rings[0];
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for(const [x,,z] of ring){west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,z);north=Math.max(north,z);}
  if(east+.25<bounds.west||west-.25>=bounds.east||north+.25<bounds.south||south-.25>=bounds.north)continue;
  const x=(west+east)/2,z=(south+north)/2,distance=Math.hypot(x-bounds.core[0],z-bounds.core[2]);
  const key=[Math.floor((x-bounds.west)/settings.siteSpacing),Math.floor((z-bounds.south)/settings.siteSpacing)].join(',');
  if(!cells.has(key))cells.set(key,[]);
  cells.get(key).push({building,distance});
 }
 const groups=[...cells.values()];
 for(const group of groups)group.sort((a,b)=>a.distance-b.distance||String(a.building.id).localeCompare(String(b.building.id)));
 groups.sort((a,b)=>a[0].distance-b[0].distance);
 function* inCell(group,generate){
  for(const {building} of group)yield* generate(building,query,bounds,guard,mount);
 }
 const roofs=roundRobin(groups.map(group=>inCell(group,roofSites)));
 const facades=roundRobin(groups.map(group=>inCell(group,facadeSites)));
 const ground=groundSites(query,bounds,guard,mount,settings.siteSpacing);
 const order=[roofs,facades,roofs,ground];
 const sites=[];
 // Keep some of a large site budget available to the existing residual-site search.
 const limit=settings.maxSites-Math.min(64,Math.max(0,settings.maxSites-128));
 while(sites.length<limit){
  const preferred=order[sites.length%order.length];
  let next=preferred.next();
  for(const fallback of [roofs,facades,ground]){if(!next.done)break;if(fallback!==preferred)next=fallback.next();}
  if(next.done)break;
  sites.push({...next.value,id:`site-${sites.length+1}`});
 }
 if(!sites.length)throw Error('没有可用部署候选点');
 return sites;
}
