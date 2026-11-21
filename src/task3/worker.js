// 任务三后台 Worker：加载城市/地形数据，执行完整流水线或当前方案的独立派生计算。
import {createModel} from '../model.js';
import {createSceneQuery} from '../sensors/scene.js';
import {runTask3Pipeline} from './pipeline.js';
import {repairPlanWithMobileRadars} from './mobile-repair.js';
import {buildCustomRoute,simulateThreat,threatSummaryText} from './threats.js';
import {loadSiteCity} from '../site-analysis.js';
let city,query,sceneKey='recon';
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));

// 独立导出便于单元测试；input 全部可序列化，plan 必须来自发起请求时的当前方案快照。
export async function computeCustomSingleThreat({query,input,yieldTask=async()=>{}}){
 const {plan,waypoints,aglM,speedMps,target,environment,core,coreRadius=700,interval=2}=input??{};
 if(!plan||typeof plan.id!=='string'||!plan.id||!Array.isArray(plan.devices))throw Error('自定义威胁计算缺少当前方案及设备快照');
 const route=buildCustomRoute(query,{waypoints,aglM,speedMps,id:'single-custom'});
 const result=await simulateThreat({query,devices:plan.devices,routes:[route],target:{...target,emitting:true,count:1},environment,core,coreRadius,interval,simultaneous:false,yieldTask});
 const config={count:1,directions:1,azimuthsDeg:[0],aglM:[aglM],speedMps,simultaneous:false,custom:true,waypoints:route.waypoints.map(p=>[...p])};
 const single={...result,custom:true,config,text:threatSummaryText(result)};
 return {planId:plan.id,scenarioKey:'single',single};
}

async function ensureScene(data){
 if(data.site){
  if(sceneKey===data.site.base)return;
  const {city:siteCity,terrain}=await loadSiteCity(data.site,data.baseURL);
  city=siteCity;query=createSceneQuery(createModel(city,terrain));sceneKey=data.site.base;return;
 }
 if(sceneKey==='recon'&&query)return;
 const read=async name=>{const r=await fetch(new URL(`data/${name}.json`,data.baseURL));if(!r.ok)throw Error('缺少预处理数据，请执行 npm run prepare:data');return r.json();};const terrain=await read('terrain');city=await read('city');query=createSceneQuery(createModel(city,terrain));sceneKey='recon';
}
if(typeof self!=='undefined')self.onmessage=async({data})=>{
 try{
  await ensureScene(data);
  const exclusions=(data.settings??data.input?.settings)?.buildingExclusions;
  if(exclusions&&exclusions.sceneKey!==(data.site?.base??'recon'))throw Error('建筑禁部署约束与当前地图不一致，请重新选择');
  const progress=value=>self.postMessage({type:'progress',requestId:data.requestId??null,value});
  if(data.type==='pipeline'){
   const {report,run}=await runTask3Pipeline({city,query,settings:data.settings,environment:data.environment,target:data.target,weights:data.weights,presetIds:data.presetIds,equipmentSnapshot:data.equipmentSnapshot,planTypes:data.planTypes,progress,yieldTask});
   self.postMessage({type:'report',requestId:data.requestId,report,run});
  }else if(data.type==='mobile-repair'){
   const result=await repairPlanWithMobileRadars({city,query,...data.input,equipmentSnapshot:data.equipmentSnapshot??data.input.equipmentSnapshot,progress:value=>self.postMessage({type:'mobile-progress',requestId:data.requestId,value}),yieldTask});
   self.postMessage({type:'mobile-repair-result',requestId:data.requestId,result});
  }else if(data.type==='custom-single-threat'){
   const result=await computeCustomSingleThreat({query,input:data.input,yieldTask});
   self.postMessage({type:'custom-single-threat-result',requestId:data.requestId,result});
  }
 }catch(error){self.postMessage({type:'error',message:error.message,requestId:data.requestId??null,operation:data.type});}
};
// 取消由调用方 terminate Worker 并递增 requestId；响应同时携带 requestId/planId，旧请求与旧方案结果不得合并。
