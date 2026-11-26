import {TARGET_FIELDS} from './presets.js';
import {validateTarget} from './engine.js';
import catalog from './drone-target-catalog.json' with {type:'json'};

export const DRONE_TARGET_PRESETS=catalog.models;
export const DRONE_CATALOG_VERSION=catalog.schemaVersion;
const builtInModels=new Map(DRONE_TARGET_PRESETS.map(model=>[model.id,model]));
const extra=(label,unit,min,max,options={})=>({label,unit,min,max,...options});
export const TARGET_EDITOR_FIELDS={...TARGET_FIELDS,
 width_m:extra('成像水平尺寸','m',.001,100,{nullable:true}),height_m:extra('成像垂直尺寸','m',.001,100,{nullable:true}),
 emitting:{label:'发射无线电',boolean:true},fhss:{label:'跳频发射',boolean:true},
 acousticFrequencyHz:extra('主声频','Hz',20,20000),check_band:{label:'核对声学频带',boolean:true},bandLow:extra('频带下限','Hz',1,100000),bandHigh:extra('频带上限','Hz',1,100000),
};
export function targetDraft(target){return {...structuredClone(target),fhss:target.fhss??false,width_m:target.capability&&Object.hasOwn(target.capability,'width_m')?target.capability.width_m:target.size,height_m:target.capability&&Object.hasOwn(target.capability,'height_m')?target.capability.height_m:target.size,check_band:target.capability?.check_band??false,bandLow:target.capability?.band_hz?.[0]??500,bandHigh:target.capability?.band_hz?.[1]??2000};}
export function targetFromDraft(current,draft){
 for(const [key,spec] of Object.entries(TARGET_EDITOR_FIELDS)){
  const value=draft[key];
  if(spec.boolean){if(typeof value!=='boolean')throw Error(`${spec.label}必须为布尔值`);}
  else if(!(spec.nullable&&value===null)&&(typeof value!=='number'||!Number.isFinite(value)||value<spec.min||value>spec.max))throw Error(`请检查${spec.label}`);
 }
 const value=structuredClone(current);
 for(const key of [...Object.keys(TARGET_FIELDS),'emitting','fhss','acousticFrequencyHz'])value[key]=draft[key];
 value.capability={...value.capability,width_m:draft.width_m,height_m:draft.height_m,check_band:draft.check_band,band_hz:[draft.bandLow,draft.bandHigh]};
 value.dronePresetId=draft.dronePresetId??null;
 validateTarget(value);return value;
}
export function importTargetDraft(current,draft,data){
 const input=data?.target??data;
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('目标参数必须为 JSON 对象');
 const next=structuredClone(draft);let count=0;
 for(const [key,value] of Object.entries(input)){
  if(Object.hasOwn(TARGET_EDITOR_FIELDS,key)){next[key]=value;count++;}
  else if(key==='capability'){
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('目标能力参数必须为对象');
   for(const [name,item] of Object.entries(value)){
    if(['width_m','height_m','check_band'].includes(name)){next[name]=item;count++;}
    else if(name==='band_hz'){
     if(!Array.isArray(item)||item.length!==2)throw Error('目标频带需要两个数值');
     [next.bandLow,next.bandHigh]=item;count++;
    }else throw Error(`无法识别的目标能力参数：${name}`);
   }
  }else if(!['position','opticalMode','dronePresetId'].includes(key))throw Error(`无法识别的目标参数：${key}`);
 }
 if(!count)throw Error('文件中没有侦测目标参数');
 next.dronePresetId=null;targetFromDraft(current,next);return next;
}
export function readDroneCatalog(data){
 if(data?.schemaVersion!==DRONE_CATALOG_VERSION||!Array.isArray(data.models)||!data.models.length){
  throw Error('型号库需要版本 1 和非空 models 列表');
 }
 const seen=new Set();
 return data.models.map((item,index)=>{
  const {id,brand,name,type,dimensions,speed,dimensionsNote,speedNote,source}=item??{};
  const label=`第 ${index+1} 条型号`;
  if(typeof id!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw Error(`${label}的编号无效`);
  if(seen.has(id))throw Error(`型号编号重复：${id}`);
  if(![brand,name,type,dimensionsNote,speedNote,source].every(value=>typeof value==='string'&&value.trim())){
   throw Error(`${label}缺少品牌、名称、用途、规格说明或来源`);
  }
  if(URL.parse(source)?.protocol!=='https:')throw Error(`${label}需要 HTTPS 规格来源`);
  if(!Array.isArray(dimensions)||dimensions.length!==3||
    dimensions.some(value=>!Number.isFinite(value)||value<.001)||
    Math.max(dimensions[0],dimensions[1])<TARGET_FIELDS.size.min||
    Math.max(dimensions[0],dimensions[1])>TARGET_FIELDS.size.max||dimensions[2]>TARGET_EDITOR_FIELDS.height_m.max){
   throw Error(`${label}的长、宽、高须以米填写，并符合目标尺寸范围`);
  }
  if(!Number.isFinite(speed)||speed<TARGET_FIELDS.speed.min||speed>TARGET_FIELDS.speed.max){
   throw Error(`${label}的速度须以 m/s 填写，并符合目标速度范围`);
  }
  seen.add(id);
  return {id,brand:brand.trim(),name:name.trim(),type:type.trim(),dimensions:[...dimensions],speed,dimensionsNote:dimensionsNote.trim(),speedNote:speedNote.trim(),source:source.trim()};
 });
}
export function selectTargetPreset(draft,id,models=builtInModels){
 const preset=models.get(id);if(!preset)throw Error('未知无人机型号');
 const [length,width,height]=preset.dimensions;
 return {...structuredClone(draft),size:Math.max(length,width),width_m:width,height_m:height,speed:preset.speed,dronePresetId:id};
}
