import {evaluate} from './engine.js';

export const HEAT_COLORS={strong:0x32d6a0,marginal:0xffcf57,blind:0xf46b78,unknown:0x8796aa};
export function heatDevices(devices,mode,selectedId){
 return devices.filter(d=>['radar','radio'].includes(d.type)&&(mode==='selected'?d.id===selectedId:mode==='combined'||d.type===mode));
}
export function heatClass(result){
 if(!result||result.status==='uncertain'||result.geometry.known!==true)return 'unknown';
 return result.status!=='within-model'?'blind':result.marginDb>=3?'strong':'marginal';
}
// Union means at least one device meets its model conditions; never add
// probabilities from correlated receivers or treat two failed links as a pass.
export function bestDetection(results){
 const rank=r=>r.status==='within-model'?2:r.status==='uncertain'?1:0;
 return results.reduce((best,r)=>!best||rank(r)>rank(best)||(rank(r)===rank(best)&&(r.marginDb??-Infinity)>(best.marginDb??-Infinity))?r:best,null);
}
export function heatGrid(bounds,spacing,heights,maxSamples=4096){
 if(![bounds.west,bounds.east,bounds.south,bounds.north,spacing,...heights].every(Number.isFinite)||bounds.east<=bounds.west||bounds.north<=bounds.south||spacing<25||!heights.length||heights.some(h=>h<1||h>2000))throw Error('探测切片参数无效');
 let actual=spacing;
 const count=()=>Math.ceil((bounds.east-bounds.west)/actual)*Math.ceil((bounds.north-bounds.south)/actual)*heights.length;
 while(count()>maxSamples)actual+=25;
 const points=[];
 for(const height of heights)for(let z=bounds.south+actual/2;z<bounds.north;z+=actual)for(let x=bounds.west+actual/2;x<bounds.east;x+=actual)points.push({x,z,height});
 return {points,spacing:actual};
}
export async function sampleHeatmap({query,devices,target,environment,grid,cancelled=()=>false,onProgress=()=>{},yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}){
 const cells=[],counts={strong:0,marginal:0,blind:0,unknown:0,missing:0,inside:0};
 let deadline=performance.now()+12;
 for(let i=0;i<grid.points.length;i++){
  if(cancelled())return null;
  const {x,z,height}=grid.points[i],ground=query.groundAt(x,z);
  if(ground===null){counts.missing++;}
  else{
   const position=[x,ground+height,z],surface=query.surfaceAt(x,z);
   if(surface!==null&&surface>=position[1]-0.1)counts.inside++;
   else{
    const results=[];
    for(const device of devices){
     if(cancelled())return null;
     results.push(evaluate(device,{...target,position},environment,query.trace(device.position,position)));
     if(performance.now()>deadline){onProgress(i,grid.points.length);await yieldTask();deadline=performance.now()+12;}
    }
    const best=bestDetection(results),category=heatClass(best);counts[category]++;
    cells.push({position,category,deviceId:best?.id??null,marginDb:best?.marginDb??null,snrDb:best?.snrDb??null,reason:best?.reasons.join('；')??'',height});
   }
  }
  if(performance.now()>deadline){onProgress(i+1,grid.points.length);await yieldTask();deadline=performance.now()+12;}
 }
 if(cancelled())return null;
 return {cells,counts,spacing:grid.spacing,total:grid.points.length};
}
