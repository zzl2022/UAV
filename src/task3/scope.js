// 任务三范围设置与数据覆盖元数据；默认仍为河南博物院周边 2.4×2.4 km。
import {DEFAULT_SETTINGS,validateSettings} from '../planning/optimizer.js';
import {DEFAULT_SCOPE,DEFAULT_SCOPE_WIDTH_M,DEFAULT_SCOPE_DEPTH_M} from './constants.js';

export const TASK3_DEFAULT_SETTINGS={...DEFAULT_SETTINGS,scope:DEFAULT_SCOPE,siteSpacing:500,scopeWidthM:DEFAULT_SCOPE_WIDTH_M,scopeDepthM:DEFAULT_SCOPE_DEPTH_M};

export function resolveTask3Settings(settings=TASK3_DEFAULT_SETTINGS){
 const source=settings??TASK3_DEFAULT_SETTINGS,scope=source.scope??DEFAULT_SCOPE;
 const resolved={...source,scope};
 if(scope!=='custom'){
  resolved.scopeWidthM??=DEFAULT_SCOPE_WIDTH_M;
  resolved.scopeDepthM??=DEFAULT_SCOPE_DEPTH_M;
 }
 validateSettings(resolved);
 return resolved;
}

const copyBounds=bounds=>bounds?{west:bounds.west,east:bounds.east,south:bounds.south,north:bounds.north,...(bounds.core?{core:[...bounds.core]}:{})}:null;
const differs=(a,b)=>['west','east','south','north'].some(key=>Math.abs(a[key]-b[key])>1e-9);

export function createScopeMetadata(settings,sampling,dataBounds=null){
 const requestedBounds=copyBounds(sampling.bounds),demBounds=copyBounds(dataBounds?.dem),gisBounds=copyBounds(dataBounds?.gis);
 let effectiveBounds=copyBounds(sampling.effectiveBounds??sampling.bounds);
 if(!sampling.effectiveBounds&&demBounds){
  const intersection={west:Math.max(requestedBounds.west,demBounds.west),east:Math.min(requestedBounds.east,demBounds.east),south:Math.max(requestedBounds.south,demBounds.south),north:Math.min(requestedBounds.north,demBounds.north),core:requestedBounds.core};
  if(intersection.west<intersection.east&&intersection.south<intersection.north)effectiveBounds=intersection;
 }
 const boundaryClipped=differs(requestedBounds,effectiveBounds),outsideDem=sampling.excluded?.outsideDem??0,clipped=boundaryClipped||outsideDem>0;
 return {
  scope:settings.scope,widthM:requestedBounds.east-requestedBounds.west,depthM:requestedBounds.north-requestedBounds.south,center:[...requestedBounds.core],
  requestedBounds,effectiveBounds,demBounds,gisBounds,boundaryClipped,clipped,excluded:{...(sampling.excluded??{})},
  note:clipped?'请求范围存在 DEM 数据裁切或无数据采样点；仅对有效采样点计算覆盖，不外推范围外覆盖。':'采样仅使用实际 GIS/DEM 数据，不外推无数据区域覆盖。',
 };
}
