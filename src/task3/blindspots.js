// 任务三四类盲区归因：楼栋夹缝(gap)、建筑背面阴影区(shadow)、低空贴楼区域(lowFacade)、围墙边角(corner)、其他(other)。
// 几何阈值全部取自 BLIND_THRESHOLDS；同一采样只归一类，判定优先级 gap > shadow > lowFacade > corner > other。
import {evaluate} from '../sensors/engine.js';
import {BLIND_THRESHOLDS} from './constants.js';

const GEOMETRIC=['近距盲区','超出标称距离','超出方位视场','超出俯仰视场'];
const CELL=100;

function ringCenter(ring){let x=0,z=0;const n=ring.length-1;for(let i=0;i<n;i++){x+=ring[i][0];z+=ring[i][2];}return [x/n,z/n];}
function pointInRing(ring,x,z){
 let inside=false;
 for(let i=0,j=ring.length-2;i<ring.length-1;j=i++){
  const xi=ring[i][0],zi=ring[i][2],xj=ring[j][0],zj=ring[j][2];
  if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside;
 }
 return inside;
}
function segmentDistance(x,z,ax,az,bx,bz){
 const dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz,t=l2?Math.min(1,Math.max(0,((x-ax)*dx+(z-az)*dz)/l2)):0;
 return Math.hypot(x-ax-t*dx,z-az-t*dz);
}
// 点到 rings[0] 外环的平面(x/z)距离；多边形内部为 0。
function polygonDistance(ring,x,z){
 if(pointInRing(ring,x,z))return 0;
 let d=Infinity;for(let i=0;i<ring.length-1;i++)d=Math.min(d,segmentDistance(x,z,ring[i][0],ring[i][2],ring[i+1][0],ring[i+1][2]));
 return d;
}

// 网格桶空间索引：key=`${Math.floor(x/100)},${Math.floor(z/100)}`，按质心归桶并记录最大外接半径。
export function buildBuildingIndex(city,cell=CELL){
 const buckets=new Map();let maxRadius=0,minGX=Infinity,maxGX=-Infinity,minGZ=Infinity,maxGZ=-Infinity;
 for(const building of city.buildings){
  const ring=building.rings[0],[cx,cz]=ringCenter(ring);
  let radius=0;for(let i=0;i<ring.length-1;i++)radius=Math.max(radius,Math.hypot(ring[i][0]-cx,ring[i][2]-cz));
  const gx=Math.floor(cx/cell),gz=Math.floor(cz/cell),key=`${gx},${gz}`,entry={building,cx,cz,radius};
  const list=buckets.get(key);if(list)list.push(entry);else buckets.set(key,[entry]);
  maxRadius=Math.max(maxRadius,radius);minGX=Math.min(minGX,gx);maxGX=Math.max(maxGX,gx);minGZ=Math.min(minGZ,gz);maxGZ=Math.max(maxGZ,gz);
 }
 return {cell,buckets,maxRadius,minGX,maxGX,minGZ,maxGZ};
}

// 由近及远逐环扫描网格桶，用“质心距离−外接半径”下界预过滤，避免逐栋算多边形距离。
export function nearestBuildings(index,x,z,limit=4){
 const {cell,buckets,maxRadius}=index,found=[];if(!buckets.size)return found;
 const gx=Math.floor(x/cell),gz=Math.floor(z/cell),kth=()=>found.length>=limit?found[limit-1].distanceM:Infinity;
 const maxR=Math.max(Math.abs(gx-index.minGX),Math.abs(gx-index.maxGX),Math.abs(gz-index.minGZ),Math.abs(gz-index.maxGZ))+1;
 for(let r=0;r<=maxR;r++){
  for(let i=-r;i<=r;i++)for(let j=-r;j<=r;j++){
   if(Math.max(Math.abs(i),Math.abs(j))!==r)continue;
   const list=buckets.get(`${gx+i},${gz+j}`);if(!list)continue;
   for(const e of list){
    if(Math.hypot(e.cx-x,e.cz-z)-e.radius>=kth())continue;
    const distanceM=polygonDistance(e.building.rings[0],x,z);
    if(distanceM<kth()){found.push({building:e.building,distanceM});found.sort((a,b)=>a.distanceM-b.distanceM);if(found.length>limit)found.length=limit;}
   }
  }
  if(found.length>=limit&&r*cell-maxRadius>=kth())break; // 未访问网格的距离下界已超当前第 limit 名
 }
 return found;
}

// 楼栋夹缝：两侧各有一栋楼近似对向（方向夹角 >120°）、多边形距离之和 ≤gapMaxWidthM、楼顶均高于采样点。
function findGap(sample,near){
 const [x,y,z]=sample.position,T=BLIND_THRESHOLDS;let best=null;
 for(let i=0;i<near.length;i++)for(let j=i+1;j<near.length;j++){
  const a=near[i],b=near[j],sum=a.distanceM+b.distanceM;
  if(sum>T.gapMaxWidthM)continue;
  if(a.building.ground+a.building.height<=y||b.building.ground+b.building.height<=y)continue;
  const [ax,az]=ringCenter(a.building.rings[0]),[bx,bz]=ringCenter(b.building.rings[0]);
  const vax=ax-x,vaz=az-z,vbx=bx-x,vbz=bz-z,la=Math.hypot(vax,vaz),lb=Math.hypot(vbx,vbz);
  if(!la||!lb)continue;
  if((vax*vbx+vaz*vbz)/(la*lb)>=-0.5)continue; // cosθ<-1/2 ⟺ θ>120°
  if(!best||sum<best.gapWidthM)best={gapWidthM:sum,buildingIds:[a.building.id,b.building.id],agl:sample.agl};
 }
 return best;
}

// 建筑背面阴影区：全部“几何上本可覆盖”的设备都被距采样点 ≤shadowMaxBlockerDistanceM 的遮挡截断。
function checkShadow(sample,devices,query,target,environment){
 const T=BLIND_THRESHOLDS,coverable=[];
 for(const device of devices){
  const quick=evaluate(device,{...target,position:sample.position},environment,{known:true,blocked:false,buildingCount:0});
  if(quick.reasons.some(r=>GEOMETRIC.includes(r)))continue;
  coverable.push({device,distance:quick.geometry.distance});
 }
 if(!coverable.length)return null;
 let blockerDistanceM=Infinity;
 for(const {device,distance} of coverable){
  const context=query.trace(device.position,sample.position);
  if(!context.blocked||context.obstacleDistance===null||context.obstacleDistance<distance-T.shadowMaxBlockerDistanceM)return null;
  blockerDistanceM=Math.min(blockerDistanceM,distance-context.obstacleDistance);
 }
 return {blockerDistanceM,deviceCount:coverable.length};
}

// 距最近建筑 rings[0] 顶点的最小水平距离。
function nearestCorner(near,x,z){
 let best=null;
 for(const {building} of near){
  const ring=building.rings[0];
  for(let i=0;i<ring.length-1;i++){
   const d=Math.hypot(x-ring[i][0],z-ring[i][2]);
   if(!best||d<best.cornerDistanceM)best={cornerDistanceM:d,nearestBuildingId:building.id};
  }
 }
 return best;
}

export function classifySample({sample,index,devices,query,target,environment}){
 const [x,,z]=sample.position,T=BLIND_THRESHOLDS,near=nearestBuildings(index,x,z,4);
 const gap=findGap(sample,near);if(gap)return {category:'gap',cause:gap};
 const shadow=checkShadow(sample,devices,query,target,environment);if(shadow)return {category:'shadow',cause:shadow};
 if(near.length&&sample.agl<=T.lowFacadeMaxAglM&&near[0].distanceM<=T.lowFacadeMaxDistanceM)
  return {category:'lowFacade',cause:{distanceToFacadeM:near[0].distanceM,agl:sample.agl,nearestBuildingId:near[0].building.id}};
 const corner=nearestCorner(near,x,z);
 if(corner&&corner.cornerDistanceM<=T.cornerMaxDistanceM)return {category:'corner',cause:corner};
 return {category:'other',cause:{reason:'不满足四类几何特征'}};
}

// coverageRow 为整数数组（0=盲点），仅对盲点归因。
export function classifyBlindSpots({city,samples,coverageRow,devices,query,target,environment,conditionId}){
 const index=buildBuildingIndex(city),points=[],byCategory={gap:0,corner:0,lowFacade:0,shadow:0,other:0};
 for(let j=0;j<coverageRow.length;j++){
  if(coverageRow[j]!==0)continue;
  const sample=samples[j],{category,cause}=classifySample({sample,index,devices,query,target,environment});
  points.push({sampleId:sample.id,position:sample.position,agl:sample.agl,core:sample.core??false,category,cause});
  byCategory[category]++;
 }
 return {conditionId,points,stats:{total:points.length,byCategory}};
}
