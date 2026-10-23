import {createModel} from '../model.js';
import {createSceneQuery} from './scene.js';
import {sampleVolume} from './volume.js';
let active=0,ready,model,queries={};
self.onmessage=async({data})=>{
 active=data.id;if(data.type==='cancel')return;
 const {id}=data;
 try{
  ready??=(async()=>{const read=async name=>{const r=await fetch(new URL(`data/${name}.json`,data.baseURL));if(!r.ok)throw Error('缺少地图预处理数据');return r.json();};const [city,terrain]=await Promise.all([read('city'),read('terrain')]);model=createModel(city,terrain);})();
  await ready;if(id!==active)return;
  const key=data.reflections?'reflections':'direct';queries[key]??=createSceneQuery(model,{reflections:data.reflections});
  const result=await sampleVolume({...data,query:queries[key],cancelled:()=>id!==active,onProgress:(done,total)=>self.postMessage({id,type:'progress',done,total})});
  if(result&&id===active)self.postMessage({id,type:'result',result},[result.values.buffer,result.winners.buffer]);
 }catch(error){if(id===active)self.postMessage({id,type:'error',message:error.message});}
};
