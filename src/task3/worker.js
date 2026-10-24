// 任务三后台 Worker：加载城市/地形数据，执行 runTask3Pipeline 全流程并回报进度。
import {createModel} from '../model.js';
import {createSceneQuery} from '../sensors/scene.js';
import {runTask3Pipeline} from './pipeline.js';
let city,query;
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
self.onmessage=async({data})=>{
 try{
  if(!query){const read=async name=>{const r=await fetch(new URL(`data/${name}.json`,data.baseURL));if(!r.ok)throw Error('缺少预处理数据，请执行 npm run prepare:data');return r.json();};const terrain=await read('terrain');city=await read('city');query=createSceneQuery(createModel(city,terrain));}
  const progress=value=>self.postMessage({type:'progress',value});
  if(data.type==='pipeline'){
   const {report,run}=await runTask3Pipeline({city,query,settings:data.settings,environment:data.environment,target:data.target,weights:data.weights,presetIds:data.presetIds,progress,yieldTask});
   self.postMessage({type:'report',report,run});
  }
 }catch(error){self.postMessage({type:'error',message:error.message});}
};
