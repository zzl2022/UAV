// Read-only audit of real GIS model outputs. Writes only reproducible artifacts.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {defaultScenario} from '../src/sensors/scenario.js';
import {evaluate} from '../src/sensors/engine.js';
import {volumeGrid,continuousResult} from '../src/sensors/volume.js';
const city=JSON.parse(await readFile('public/data/city.json','utf8')),terrain=JSON.parse(await readFile('public/data/terrain.json','utf8'));
const model=createModel(city,terrain),query=createSceneQuery(model,{reflections:true}),scenario=defaultScenario(city),devices=scenario.devices.filter(d=>['radar','radio'].includes(d.type));
const source=devices[0].position,b=model.ground.geometry.boundingBox;
const grid=volumeGrid({west:source[0]-1500,east:source[0]+1500,south:source[2]-1500,north:source[2]+1500},{spacing:100,verticalSpacing:40,minY:b.min.y+2,maxY:b.max.y+600});grid.maxAgl=600;
const [nx,ny,nz]=grid.dimensions,out={scenario,grid,sourceGround:query.groundAt(source[0],source[2]),inputHashes:city.metadata.sources,devices:{},examples:[],sensitivity:{}};
const radial=[0,150,300,450,600,900,1500,3000];
const rows=['device,x,y,z,dx,dy,dz,agl,distance,horizontal,state,margin,snr,pd,blocked,known,reasons'];
for(const device of devices){
 const values=new Float32Array(grid.total*4),counts={},reasons={},bins=radial.slice(0,-1).map((r,i)=>({min:r,max:radial[i+1],states:{}}));
 let done=0,last=Date.now(),positiveInterior=0,negativeSignal=0;
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const px=grid.origin[0]+x*grid.step[0],pz=grid.origin[2]+z*grid.step[2],ground=query.groundAt(px,pz),surface=ground===null?null:query.surfaceAt(px,pz);
  for(let y=0;y<ny;y++){
   const py=grid.origin[1]+y*grid.step[1],position=[px,py,pz],index=x+nx*(y+ny*z),distance=Math.hypot(px-source[0],py-source[1],pz-source[2]),horizontal=Math.hypot(px-source[0],pz-source[2]);
   let state,margin=null,snr=null,pd=null,known=false,blocked=false,rs=[];
   if(ground===null)state='missing-dem';
   else if(py-ground>grid.maxAgl)state='height-cap';
   else if(py<=(surface??ground)+.1)state='solid';
   else{
    const ctx=query.trace(device.position,position),r=evaluate(device,{...scenario.target,position},scenario.environment,ctx),c=continuousResult([r]);
    state=c.state===0?'unknown-path':c.state===2?'hard-failure':r.marginDb>=0?'detectable':'weak-signal';
    margin=r.marginDb;snr=r.snrDb;pd=r.extras.signalPd;known=ctx.known;blocked=ctx.blocked;rs=r.reasons;
    if(c.state===1){values[index*4]=c.margin;values[index*4+1]=c.snr;values[index*4+2]=c.pd;}
    for(const reason of rs)reasons[reason]=(reasons[reason]??0)+1;
    if(state==='detectable'&&horizontal<750&&py>source[1]&&py<source[1]+400)positiveInterior++;
    if(state==='weak-signal')negativeSignal++;
   }
   values[index*4+3]={'missing-dem':0,'unknown-path':0,'hard-failure':2,'solid':3,'height-cap':4,detectable:1,'weak-signal':1}[state];
   counts[state]=(counts[state]??0)+1;
   const bin=bins.find(bin=>horizontal>=bin.min&&horizontal<bin.max);if(bin)bin.states[state]=(bin.states[state]??0)+1;
   rows.push([device.type,...position,px-source[0],py-source[1],pz-source[2],ground===null?'':py-ground,distance,horizontal,state,margin??'',snr??'',pd??'',blocked,known,rs.join('|')].join(','));
   done++;if(Date.now()-last>1500){console.log(`${device.type}: ${done}/${grid.total}`);last=Date.now();await new Promise(r=>setTimeout(r,0));}
  }
 }
 out.devices[device.type]={counts,reasons,bins,positiveInterior,negativeSignal,position:device.position};
 await mkdir('artifacts/volume-audit',{recursive:true});await writeFile(`artifacts/volume-audit/${device.type}.json`,JSON.stringify({grid,values:Array.from(values),device}));
}
// Probe actual city positions on the centre line and in the near volume.
for(const [dx,dy,dz] of [[0,100,0],[0,300,0],[0,500,0],[100,100,0],[300,100,0],[600,100,0],[0,100,-600],[0,300,-600],[0,100,600]]){
 const position=source.map((v,i)=>v+[dx,dy,dz][i]),context=query.trace(source,position);
 out.examples.push({offset:[dx,dy,dz],position,ground:query.groundAt(position[0],position[2]),surface:query.surfaceAt(position[0],position[2]),context,results:devices.map(d=>evaluate(d,{...scenario.target,position},scenario.environment,context))});
}
await writeFile('artifacts/volume-audit/summary.json',JSON.stringify(out,null,2));await writeFile('artifacts/volume-audit/voxels.csv',rows.join('\n'));
console.log(JSON.stringify({source,ground:out.sourceGround,grid,devices:out.devices,examples:out.examples.map(e=>({offset:e.offset,known:e.context.known,results:e.results.map(r=>({type:r.type,status:r.status,margin:r.marginDb,reasons:r.reasons}))}))},null,2));
