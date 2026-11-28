import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createModel} from '../../src/model.js';
import {createSceneQuery} from '../../src/sensors/scene.js';
import {siteAnalysisMetadata} from '../../src/site-analysis.js';
import {createDevice,DEFAULT_TARGET,DEFAULT_ENV} from '../../src/sensors/presets.js';
import {evaluate} from '../../src/sensors/engine.js';
import {simulateThreat} from '../../src/task3/threats.js';
import {MAPS} from './design.js';

const root=new URL('../../',import.meta.url),out=new URL('artifacts/cross-map-study/',root),json=async path=>JSON.parse(await readFile(path,'utf8')),results=[];
for(const map of MAPS){
 const report=JSON.parse(gunzipSync(await readFile(new URL(`runs/${map.id}/B00.json.gz`,out)))).report;
 let city,terrain;
 if(!map.base){city=await json(new URL('public/data/city.json',root));terrain=await json(new URL('public/data/terrain.json',root));}
 else{
  const data=await json(new URL(`public/${map.base}.json`,root)),meta=await json(new URL(`public/${map.base}-meta.json`,root)),[x0,x1,z0,z1]=meta.localBounds;
  city={metadata:siteAnalysisMetadata(meta,map),buildings:data.buildings};terrain={positions:[x0,0,z0,x1,0,z0,x1,0,z1,x0,0,z1],indices:[0,2,1,0,3,2],uvs:[0,1,1,1,1,0,0,0],rows:1,cols:1,min:0,max:0,resolution:null,bounds:meta.localBounds};
 }
 const query=createSceneQuery(createModel(city,terrain)),site=report.plans.flatMap(p=>p.sites)[0];
 if(!site)throw Error(`${map.id} 无已优化点位，不能实施容量复核`);
 const targetPosition=[site.position[0],site.position[1]+100,site.position[2]],records=[];
 for(const presetId of ['radio-tdoa','radio-mini','radio-x1c']){
  const device=createDevice(presetId,`capacity-${presetId}`,site.position),link=evaluate(device,{...DEFAULT_TARGET,position:targetPosition},DEFAULT_ENV,query.trace(device.position,targetPosition));
  if(link.status!=='within-model'||!link.eligible)throw Error(`${map.id}/${presetId} 容量试验前置链路不成立`);
  const routes=Array.from({length:42},(_,i)=>({id:`capacity-target-${i+1}`,azimuthDeg:0,startDelayS:0,duration:2,speed:0,points:[{position:[...targetPosition],time:0},{position:[...targetPosition],time:2}]}));
  const result=await simulateThreat({query,devices:[device],routes,target:DEFAULT_TARGET,environment:DEFAULT_ENV,core:report.sampling.bounds.core,simultaneous:true});
  const maximumDetected=Math.max(...result.frames.map(f=>f.targets.filter(t=>t.detectedBy.length).length)),expected=Math.min(42,device.parameters.capacity);
  if(maximumDetected!==expected||result.summary.overflowEvents!==(42-expected)*result.frames.length)throw Error(`${map.id}/${presetId} 并发容量实判不一致`);
  records.push({presetId,capacity:device.parameters.capacity,maximumDetected,expected,overflowPerFrame:42-expected,summary:result.summary,frames:result.frames});
 }
 results.push({mapId:map.id,optimizedSite:site,targetPosition,count:42,durationS:2,records});console.log(`${map.id}: 单站并发 35/30/15 与溢出 7/12/27 逐帧核对通过`);
}
await writeFile(new URL('capacity-validation.json',out),JSON.stringify({schema:'cross-map-capacity/1',createdAt:new Date().toISOString(),scriptSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),meaning:'在每图已优化点位，以真实地图上方同位置42目标作单节点极限压力试验；它不是主优化中的自动入侵航线，不计入252轮优化次数，也不代表现实蜂群轨迹分布',results},null,2));
