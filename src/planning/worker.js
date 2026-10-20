import {createModel} from '../model.js';
import {createSceneQuery} from '../sensors/scene.js';
import {optimizeDeployment,scenarios} from './optimizer.js';
import {enrichReport} from './report.js';
import {buildFlightRoute,simulateFlight} from './flight.js';
let city,query;
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
self.onmessage=async({data})=>{
 try{
  if(!query){const read=async name=>{const r=await fetch(new URL(`data/${name}.json`,data.baseURL));if(!r.ok)throw Error('缺少预处理数据，请执行 npm run prepare:data');return r.json();};const terrain=await read('terrain');city=await read('city');query=createSceneQuery(createModel(city,terrain));}
  const progress=value=>self.postMessage({type:'progress',value});
  if(data.type==='optimize'){
   const report=await optimizeDeployment({city,query,settings:data.settings,environment:data.environment,target:data.target,progress,yieldTask});
   report.route=buildFlightRoute(query,report.sampling.bounds);
   const selected=report.plans.find(p=>p.id===report.selectedId);
   report.flight=await simulateFlight({query,devices:selected.devices,route:report.route,target:{...report.target,...scenarios(report.environment)[0].target},environment:report.environment,core:report.sampling.bounds.core,coreRadius:report.settings.coreRadius,progress,yieldTask});
   self.postMessage({type:'report',report:enrichReport(report,city)});
  }else if(data.type==='simulate'){
   const flight=await simulateFlight({query,devices:data.devices,route:data.route,target:data.target,environment:data.environment,core:data.core,coreRadius:data.coreRadius,progress,yieldTask});
   self.postMessage({type:'flight',flight});
  }
 }catch(error){self.postMessage({type:'error',message:error.message});}
};
