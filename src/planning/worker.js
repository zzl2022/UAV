import {createModel} from '../model.js';
import {createSceneQuery} from '../sensors/scene.js';
import {buildFlightRoute,simulateFlight} from './flight.js';
let query;
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
self.onmessage=async({data})=>{
 try{
  if(data.type!=='simulate')return;
  if(!query){const read=async name=>{const r=await fetch(new URL(`data/${name}.json`,data.baseURL));if(!r.ok)throw Error('缺少预处理数据，请执行 npm run prepare:data');return r.json();};const terrain=await read('terrain'),city=await read('city');query=createSceneQuery(createModel(city,terrain));}
  const progress=value=>self.postMessage({type:'progress',requestId:data.requestId,value});
  const route=buildFlightRoute(query,data.bounds);
  const flight=await simulateFlight({query,devices:data.devices,route,target:data.target,environment:data.environment,core:data.core,coreRadius:data.coreRadius,progress,yieldTask});
  self.postMessage({type:'flight',requestId:data.requestId,route,flight});
 }catch(error){self.postMessage({type:'error',requestId:data.requestId??null,message:error.message});}
};
