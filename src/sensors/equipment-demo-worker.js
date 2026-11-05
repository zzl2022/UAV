import {createModel} from '../model.js';
import {createSceneQuery} from './scene.js';
import {sampleDemo} from './equipment-demo-model.js';
let ready,model,queries={};
self.onmessage=async({data})=>{
 const {id}=data;
 try{
  ready??=(async()=>{const read=async name=>{const response=await fetch(new URL(`data/${name}.json`,data.baseURL));if(!response.ok)throw Error('无法读取城市模型');return response.json();};const [city,terrain]=await Promise.all([read('city'),read('terrain')]);model=createModel(city,terrain);})();await ready;
  const key=data.spec.settings.reflections?'reflection':'direct';queries[key]??=createSceneQuery(model,{reflections:data.spec.settings.reflections});
  const result=await sampleDemo({...data,query:queries[key],onProgress:(done,total)=>self.postMessage({id,type:'progress',done,total})});
  self.postMessage({id,type:'result',result},[result.values.buffer]);
 }catch(error){self.postMessage({id,type:'error',message:error.message});}
};
