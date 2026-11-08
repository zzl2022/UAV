// Shared adapter: turn a GBA site (JSON + meta) into the city/terrain shape
// used by the planning and task3 analysis pipelines.  The site ground is flat;
// local coordinates are the site's local_tmerc metres.

export function enuToEcefMatrix(center){
 const lon=center[0]*Math.PI/180,lat=center[1]*Math.PI/180,h=0;
 const a=6378137,e2=6.6943799901413165e-3;
 const N=a/Math.sqrt(1-e2*Math.sin(lat)**2);
 const x=(N+h)*Math.cos(lat)*Math.cos(lon);
 const y=(N+h)*Math.cos(lat)*Math.sin(lon);
 const z=(N*(1-e2)+h)*Math.sin(lat);
 const east=[-Math.sin(lon),Math.cos(lon),0];
 const north=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)];
 const up=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];
 return [east[0],east[1],east[2],0,north[0],north[1],north[2],0,up[0],up[1],up[2],0,x,y,z,1];
}

export function siteAnalysisMetadata(meta,site){
 const center=meta?.center??[0,0];
 return {
  name:site?.label??meta?.name??meta?.shortName??'站点场景',
  origin:[center[0],center[1],0],
  coordinateSystem:'local metric [east, up, -north]; site local_tmerc',
  ecefTransform:enuToEcefMatrix(center),
  sourceFeatures:meta?.buildingCount??0,
  minHeight:meta?.minHeight??0,
  maxHeight:meta?.maxHeight??0,
  sources:{site:meta?.rawSha256??meta?.name??site?.base??'site'},
  coreBuilding:meta?.coreBuilding??null,
  terrain:{min:0,max:0,resolution:null,bounds:meta?.localBounds??null},
 };
}

export async function loadSiteCity(site,baseURL){
 const base=new URL(`${site.base}.json`,baseURL);
 const metaURL=new URL(`${site.base}-meta.json`,baseURL);
 const [meta,data]=await Promise.all([
  fetch(metaURL).then(response=>{if(!response.ok)throw Error(`站点元数据加载失败：HTTP ${response.status}`);return response.json();}),
  fetch(base).then(response=>{if(!response.ok)throw Error(`站点建筑数据加载失败：HTTP ${response.status}`);return response.json();}),
 ]);
 const [x0,x1,z0,z1]=meta.localBounds;
 const terrain={
  positions:[x0,0,z0,x1,0,z0,x1,0,z1,x0,0,z1],
  indices:[0,2,1,0,3,2],
  uvs:[0,1,1,1,1,0,0,0],
  rows:1,cols:1,min:0,max:0,resolution:null,bounds:meta.localBounds,
 };
 return {city:{metadata:siteAnalysisMetadata(meta,site),buildings:data.buildings},terrain,meta};
}
