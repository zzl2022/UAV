// 显示与优化共用的建筑实体索引。连通性基于几何，和名称、批量网格无关。
const EPS=0.001, CELL=128, cache=new WeakMap();
const cross=(a,b,p)=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
function onSegment(p,a,b){
 return Math.abs(cross(a,b,p))<=EPS*Math.max(1,Math.hypot(b[0]-a[0],b[2]-a[2]))&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[2]>=Math.min(a[2],b[2])-EPS&&p[2]<=Math.max(a[2],b[2])+EPS;
}
function ringState(p,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i];if(onSegment(p,a,b))return 0;
  if((a[2]>p[2])!==(b[2]>p[2])&&p[0]<(b[0]-a[0])*(p[2]-a[2])/(b[2]-a[2])+a[0])inside=!inside;
 }
 return inside?1:-1;
}
export function containsBuildingFootprint(building,x,z){
 const p=[x,0,z],outer=ringState(p,building.rings[0]);if(outer===-1)return false;
 // 庭院内部为空；孔洞边界仍属于建筑边界。
 return !building.rings.slice(1).some(r=>ringState(p,r)===1);
}
function segmentsTouch(a,b,c,d){
 if(onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b))return true;
 return (cross(a,b,c)>0)!==(cross(a,b,d)>0)&&(cross(c,d,a)>0)!==(cross(c,d,b)>0);
}
function connected(a,b){
 if(a.maxY<b.minY-EPS||b.maxY<a.minY-EPS||a.maxX<b.minX-EPS||b.maxX<a.minX-EPS||a.maxZ<b.minZ-EPS||b.maxZ<a.minZ-EPS)return false;
 for(const ra of a.building.rings)for(const rb of b.building.rings)for(let i=1;i<ra.length;i++)for(let j=1;j<rb.length;j++)if(segmentsTouch(ra[i-1],ra[i],rb[j-1],rb[j]))return true;
 return a.building.rings[0].some(p=>containsBuildingFootprint(b.building,p[0],p[2]))||b.building.rings[0].some(p=>containsBuildingFootprint(a.building,p[0],p[2]));
}
export function createBuildingIndex(city){
 if(cache.has(city))return cache.get(city);
 const entries=city.buildings.map((building,i)=>{
  const ring=building.rings[0],xs=ring.map(p=>p[0]),zs=ring.map(p=>p[2]),base=ring[0][1];
  return {i,building,minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs),minY:base-(building.foundationDepth??0),maxY:base+building.height};
 });
 const cells=new Map(),parents=entries.map((_,i)=>i),byId=new Map();
 const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 for(const entry of entries){
  const {i,minX,maxX,minZ,maxZ}=entry;byId.set(entry.building.id,entry);
  const seen=new Set();
  for(let x=Math.floor((minX-EPS)/CELL);x<=Math.floor((maxX+EPS)/CELL);x++)for(let z=Math.floor((minZ-EPS)/CELL);z<=Math.floor((maxZ+EPS)/CELL);z++){
   const key=`${x},${z}`,bucket=cells.get(key)??[];
   for(const other of bucket)if(!seen.has(other.i)){seen.add(other.i);if(connected(entry,other))parents[root(i)]=root(other.i);}
   bucket.push(entry);cells.set(key,bucket);
  }
 }
 const groups=new Map();for(const entry of entries){const key=root(entry.i),members=groups.get(key)??[];members.push(entry);groups.set(key,members);}
 const components=[...groups.values()].map(members=>({id:members.map(e=>e.building.id).sort()[0],buildingIds:members.map(e=>e.building.id).sort(),buildings:members.map(e=>e.building)}));
 const componentById=new Map();for(const component of components)for(const id of component.buildingIds)componentById.set(id,component);
 const at=(x,z,y=null)=>(cells.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)??[]).filter(e=>x>=e.minX-EPS&&x<=e.maxX+EPS&&z>=e.minZ-EPS&&z<=e.maxZ+EPS&&(y===null||y>=e.minY-EPS&&y<=e.maxY+EPS)&&containsBuildingFootprint(e.building,x,z));
 const result={components,byId,componentById,at};cache.set(city,result);return result;
}
export function createDeploymentExclusion(city,settings={}){
 const ids=settings.buildingExclusions?.buildingIds??[];
 if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('建筑禁部署约束必须包含建筑 ID 列表');
 if(!ids.length)return {blocked:()=>false,assertDevices:()=>true,buildingIds:[]};
 const index=createBuildingIndex(city),selected=new Set();
 for(const id of ids){const component=index.componentById.get(id);if(!component)throw Error(`禁部署建筑 ${id} 不在当前场景中，请重新选择`);for(const member of component.buildingIds)selected.add(member);}
 const blocked=(position,buildingId=null)=>selected.has(buildingId)||index.at(position[0],position[2]).some(e=>selected.has(e.building.id));
 const assertDevices=(devices,sites=[])=>{for(const [i,device] of devices.entries())if(blocked(device.position,sites[i]?.buildingId))throw Error(`设备 ${device.id} 进入禁部署建筑区域，已停止发布方案`);return true;};
 return {blocked,assertDevices,buildingIds:[...selected].sort()};
}
