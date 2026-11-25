import {evaluate} from './engine.js';

export const VOLUME_METRICS={margin:{label:'探测裕量',unit:'dB',min:-20,max:40},snr:{label:'处理后 SNR',unit:'dB',min:-10,max:60},pd:{label:'统计模型 Pd',unit:'',min:0,max:1}};
// Continuous scientific ramp, not detection classes. Values are interpolated
// in scalar space first; hard geometry failures have a separate mask.
export const RAMP=[[0,.075,.09,.24],[.2,.27,.16,.56],[.4,.1,.48,.75],[.6,.07,.78,.68],[.8,.55,.87,.32],[1,1,.78,.18]];
export function rampColor(t){
 t=Math.max(0,Math.min(1,t));let i=1;while(i<RAMP.length-1&&t>RAMP[i][0])i++;
 const a=RAMP[i-1],b=RAMP[i],f=(t-a[0])/(b[0]-a[0]);return a.slice(1).map((v,k)=>v+(b[k+1]-v)*f);
}
export function volumeGrid(bounds,{spacing=125,verticalSpacing=50,minY=0,maxY=800,maxSamples=180000}={}){
 if(![...Object.values(bounds),spacing,verticalSpacing,minY,maxY,maxSamples].every(Number.isFinite)||spacing<25||verticalSpacing<5||maxY<=minY||bounds.east<=bounds.west||bounds.north<=bounds.south||maxSamples<8)throw Error('三维探测场采样参数无效');
 let dx=spacing,dy=verticalSpacing;
 const dims=()=>[Math.max(2,Math.ceil((bounds.east-bounds.west)/dx)+1),Math.max(2,Math.ceil((maxY-minY)/dy)+1),Math.max(2,Math.ceil((bounds.north-bounds.south)/dx)+1)];
 while(dims().reduce((a,b)=>a*b,1)>maxSamples){dx*=1.12;dy*=1.06;}
 const dimensions=dims(),size=[bounds.east-bounds.west,maxY-minY,bounds.north-bounds.south];
 return {dimensions,origin:[bounds.west,minY,bounds.south],size,step:size.map((v,i)=>v/(dimensions[i]-1)),total:dimensions.reduce((a,b)=>a*b,1),requestedSpacing:spacing,requestedVerticalSpacing:verticalSpacing};
}
export function signalAvailable(result){
 if(result.geometry.known!==true)return false;
 return result.reasons.every(r=>r==='信噪比低于模型阈值'||r==='FHSS observation window insufficient');
}
// Keep below-threshold statistical Pd; engine.modelPd is the decision-masked
// result while signalPd is the actual assumed distribution's response.
export function continuousResult(results){
 const available=results.filter(signalAvailable);
 if(!available.length)return {state:results.some(r=>r.geometry.known!==true)?0:2,margin:null,snr:null,pd:null,deviceId:null};
 const best=available.reduce((a,b)=>a.marginDb>=b.marginDb?a:b);
 const bestSnr=available.reduce((a,b)=>a.snrDb>=b.snrDb?a:b);
 const probabilities=available.filter(r=>Number.isFinite(r.extras.signalPd));
 const bestPd=probabilities.length?probabilities.reduce((a,b)=>a.extras.signalPd>=b.extras.signalPd?a:b):null;
 return {state:1,margin:best.marginDb,snr:bestSnr.snrDb,pd:bestPd?.extras.signalPd??null,deviceId:best.id,winnerIds:[best.id,bestSnr.id,bestPd?.id??null]};
}
export async function sampleVolume({grid,query,devices,target,environment,cancelled=()=>false,onProgress=()=>{},yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
 const [nx,ny,nz]=grid.dimensions,n=grid.total;
 const values=new Float32Array(n*4); // margin, SNR, Pd, mask: 0 unknown, 1 signal, 2 hard failure, 3 solid.
 const winners=new Int16Array(n*3).fill(-1),counts={signal:0,detected:0,hard:0,unknown:0,inside:0,outside:0};
 let deadline=performance.now()+14,done=0;
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const px=grid.origin[0]+x*grid.step[0],pz=grid.origin[2]+z*grid.step[2],ground=query.groundAt(px,pz),surface=ground===null?null:query.surfaceAt(px,pz);
  for(let y=0;y<ny;y++){
   if(cancelled())return null;
   const index=x+nx*(y+ny*z),offset=index*4,py=grid.origin[1]+y*grid.step[1];
   if(ground===null){counts.unknown++;}
   else if(grid.maxAgl&&py-ground>grid.maxAgl){values[offset+3]=4;counts.outside++;}
   else if(py<=Math.max(ground,surface??ground)+.1){values[offset+3]=3;counts.inside++;}
   else{
    const position=[px,py,pz],results=[];
    for(const device of devices){
     if(cancelled())return null;
     results.push(evaluate(device,{...target,position},environment,query.trace(device.position,position)));
     if(performance.now()>deadline){onProgress(done,n);await yieldTask();deadline=performance.now()+14;}
    }
    const r=continuousResult(results);values[offset+3]=r.state;
    if(r.state===1){values[offset]=r.margin;values[offset+1]=r.snr;values[offset+2]=r.pd??-1;for(let k=0;k<3;k++)winners[index*3+k]=devices.findIndex(d=>d.id===r.winnerIds[k]);counts.signal++;if(results.some(r=>r.status==='within-model'))counts.detected++;}
    else if(r.state===0)counts.unknown++;else counts.hard++;
   }
   done++;
   if(performance.now()>deadline){onProgress(done,n);await yieldTask();deadline=performance.now()+14;}
  }
 }
 if(cancelled())return null;
 return {grid,values,winners,counts,deviceIds:devices.map(d=>d.id)};
}
// CPU sampler mirrors the shader: nearest mask is authoritative, continuous
// values interpolate only valid signal neighbours, never through a blind voxel.
export function sampleField(field,position,metric='margin'){
 const {grid,values}=field,[nx,ny,nz]=grid.dimensions,q=position.map((v,i)=>(v-grid.origin[i])/grid.step[i]);
 if(q.some((v,i)=>v<0||v>grid.dimensions[i]-1))return null;
 const nearest=q.map(Math.round),index=nearest[0]+nx*(nearest[1]+ny*nearest[2]),state=values[index*4+3];
 if(state!==1)return {state,value:null,index};
 const channel={margin:0,snr:1,pd:2}[metric],base=q.map(Math.floor),f=q.map((v,i)=>v-base[i]);let sum=0,weight=0;
 for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
  const c=[x,y,z].map((v,i)=>Math.min(grid.dimensions[i]-1,base[i]+v)),o=4*(c[0]+nx*(c[1]+ny*c[2])),w=(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);
  if(values[o+3]!==1||(metric==='pd'&&values[o+2]<0))continue;sum+=values[o+channel]*w;weight+=w;
 }
 return {state,value:weight>0?sum/weight:null,index};
}
