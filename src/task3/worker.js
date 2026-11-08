// 任务三后台 Worker：加载城市/地形数据，执行 runTask3Pipeline 全流程并回报进度。
import {createModel} from '../model.js';
import {createSceneQuery} from '../sensors/scene.js';
import {runTask3Pipeline} from './pipeline.js';
import {repairPlanWithMobileRadars} from './mobile-repair.js';
import {loadSiteCity} from '../site-analysis.js';
let city,query,sceneKey='recon';
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
async function ensureScene(data){
 if(data.site){
  if(sceneKey===data.site.base)return;
  const {city:siteCity,terrain}=await loadSiteCity(data.site,data.baseURL);
  city=siteCity;query=createSceneQuery(createModel(city,terrain));sceneKey=data.site.base;return;
 }
 if(sceneKey==='recon'&&query)return;
 const read=async name=>{const r=await fetch(new URL(`data/${name}.json`,data.baseURL));if(!r.ok)throw Error('缺少预处理数据，请执行 npm run prepare:data');return r.json();};const terrain=await read('terrain');city=await read('city');query=createSceneQuery(createModel(city,terrain));sceneKey='recon';
}
self.onmessage=async({data})=>{
 try{
  await ensureScene(data);
  const progress=value=>self.postMessage({type:'progress',requestId:data.requestId??null,value});
  if(data.type==='pipeline'){
   const {report,run}=await runTask3Pipeline({city,query,settings:data.settings,environment:data.environment,target:data.target,weights:data.weights,presetIds:data.presetIds,equipmentSnapshot:data.equipmentSnapshot,progress,yieldTask});
   self.postMessage({type:'report',requestId:data.requestId,report,run});
  }else if(data.type==='mobile-repair'){
   const result=await repairPlanWithMobileRadars({city,query,...data.input,equipmentSnapshot:data.equipmentSnapshot??data.input.equipmentSnapshot,progress:value=>self.postMessage({type:'mobile-progress',requestId:data.requestId,value}),yieldTask});
   self.postMessage({type:'mobile-repair-result',requestId:data.requestId,result});
  }
 }catch(error){self.postMessage({type:'error',message:error.message,requestId:data.requestId??null,operation:data.type});}
};
