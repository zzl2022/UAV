import {fieldsFor,createDevice} from './presets.js';
import {PHYSICS_FIELDS} from './physics.js';
import {CATALOG_MODELS,catalogModel} from './equipment-models.js';

export const CATALOG_SCHEMA='equipment-catalog/1';
export const CATALOG_STORAGE_KEY='uav.equipment-catalog.v1';
const field=(label,unit,min,max,value,options={})=>({label,unit,min,max,value,step:'any',...options});
const modelGroups={
 radar:[['覆盖精度',['azimuthFov','elevationMin','elevationMax','rangeAccuracy','azimuthAccuracy','elevationAccuracy']],['工作频率',['frequencyGHz']]],
 optical:[['图像尺寸',['imageWidth','imageHeight','thermalWidth','thermalHeight']],['光学性能',['wideHfov','narrowHfov','thermalHfov','minLux','requiredPixels']]],
 radio:[['接收频段',['bandMinGHz','bandMaxGHz','bandToleranceMHz']],['测向覆盖',['networkAccuracy','bearingAccuracy','azimuthFov','elevationMin','elevationMax']]],
 acoustic:[['声压范围',['minSoundDb','maxSoundDb','dynamicRangeDb']],['测角精度',['bearingAccuracy','elevationAccuracy']]],
};
const workingFields={
 optical:{channel:field('成像通道','',0,0,'visible',{options:[['visible','可见光'],['thermal','热成像']],source:'资料'}),focalMm:field('工作焦距','mm',6.5,312,6.5,{source:'资料'}),yawMin:field('云台水平下限','°',0,360,0,{source:'资料'}),yawMax:field('云台水平上限','°',0,360,360,{source:'资料'}),pitchMin:field('云台俯仰下限','°',-90,90,-90,{source:'资料'}),pitchMax:field('云台俯仰上限','°',-90,90,90,{source:'资料'})},
 acoustic:{arrayDiameter:field('阵列规格','m',.3,1.1,1.1,{options:[['0.3','30 cm'],['0.7','70 cm'],['1.1','110 cm']],source:'资料'}),frequencyMin:field('频率下限','Hz',1,100000,20,{nullable:true,source:'资料'}),frequencyMax:field('频率上限','Hz',1,100000,20000,{nullable:true,source:'资料'})},
};
const opticalMissing=new Set(['maxRange','minRange','wideHfov','narrowHfov','thermalHfov','minLux','requiredPixels']);
const integerKeys=new Set(['capacity','imageWidth','imageHeight','thermalWidth','thermalHeight','pulses']);
const path=(scope,key)=>`${scope}.${key}`;

export function catalogFields(presetId){
 const preset=catalogModel(presetId);
 if(preset.catalogOnly)return structuredClone(preset.fields);
 const definitions={};
 for(const [key,spec] of Object.entries(fieldsFor(preset.type))){
  if(['heading','pitch'].includes(key)||preset.type==='acoustic'&&['azimuthFov','elevationMin','elevationMax'].includes(key))continue;
  const nullable=preset.type==='optical'&&opticalMissing.has(key)||preset.type==='acoustic'&&['bearingAccuracy','elevationAccuracy'].includes(key);
  definitions[path('parameters',key)]={...spec,step:integerKeys.has(key)?1:spec.step,integer:integerKeys.has(key),source:nullable?'未提供':preset.provenance[key]==='文档'?'资料':'假设',nullable};
 }
 for(const [key,spec] of Object.entries(PHYSICS_FIELDS[preset.type]??{}))definitions[path('physics',key)]={...spec,source:'假设',integer:integerKeys.has(key),step:integerKeys.has(key)?1:'any'};
 for(const [key,spec] of Object.entries(workingFields[preset.type]??{}))definitions[path('working',key)]=spec;
 return definitions;
}
export function defaultProfile(presetId){
 const preset=catalogModel(presetId),profile={presetId,type:preset.type,name:preset.name,parameters:{},physics:{},working:{}};
 if(preset.catalogOnly){for(const [key,spec] of Object.entries(catalogFields(presetId))){const [scope,name]=key.split('.');profile[scope][name]=spec.value??null;}return profile;}
 const device=createDevice(presetId,'profile');
 for(const [key,spec] of Object.entries(catalogFields(presetId))){const [scope,name]=key.split('.');profile[scope][name]=spec.nullable&&spec.source==='未提供'?null:scope==='working'?spec.value:device[scope][name];}
 return profile;
}
export function getProfileValue(profile,key){const [scope,name]=key.split('.');return profile[scope]?.[name];}
export function setProfileValue(profile,key,value){const [scope,name]=key.split('.');if(!Object.hasOwn(catalogFields(profile.presetId),key))throw Error('参数无效');profile[scope][name]=value;}
export function profileGroups(presetId){
 const preset=catalogModel(presetId),used=new Set(),groups=[];
 const add=(name,keys)=>{keys=keys.filter(key=>Object.hasOwn(catalogFields(presetId),key));keys.forEach(key=>used.add(key));if(keys.length)groups.push({name,keys});};
 if(preset.catalogOnly){
  for(const [name,keys] of preset.groups)add(name,keys.map(key=>path('parameters',key)));
  return {groups,advanced:[]};
 }
 add('基础参数',['maxRange','minRange','capacity','updateSeconds'].map(key=>path('parameters',key)));
 if(preset.type==='optical')add('通道焦距',['working.channel','working.focalMm']);
 if(preset.type==='acoustic')add('阵列频带',['working.arrayDiameter','working.frequencyMin','working.frequencyMax']);
 for(const [name,keys] of modelGroups[preset.type])add(name,keys.map(key=>path('parameters',key)));
 if(preset.type==='optical')add('云台范围',['working.yawMin','working.yawMax','working.pitchMin','working.pitchMax']);
 const advanced=Object.keys(catalogFields(presetId)).filter(key=>!used.has(key));
 return {groups,advanced};
}
export function validateProfile(profile){
 const base=defaultProfile(profile?.presetId);
 if(profile.type!==base.type||profile.name!==base.name)throw Error('装备型号信息不一致');
 if(Object.keys(profile).some(key=>!Object.hasOwn(base,key)))throw Error('包含不支持的装备信息');
 for(const scope of ['parameters','physics','working']){
  if(!profile[scope]||typeof profile[scope]!=='object'||Array.isArray(profile[scope]))throw Error('参数格式无效');
  for(const name of Object.keys(profile[scope]))if(!Object.hasOwn(base[scope],name))throw Error('包含不支持的参数');
 }
 for(const [key,spec] of Object.entries(catalogFields(profile.presetId))){
  const value=getProfileValue(profile,key);if(value===null&&spec.nullable)continue;
  if(spec.options){if(!spec.options.some(([option])=>String(option)===String(value)))throw Error(`${spec.label}无效`);continue;}
  if(typeof value!=='number'||!Number.isFinite(value)||value<spec.min||value>spec.max||spec.integer&&!Number.isInteger(value))throw Object.assign(Error(`请检查${spec.label}`),{field:key});
 }
 const ordered=(scope,low,high,label,allowEqual=false)=>{const a=profile[scope][low],b=profile[scope][high];if(a!=null&&b!=null&&(allowEqual?a>b:a>=b))throw Object.assign(Error(`${label}上下限无效`),{field:path(scope,low)});};
 ordered('parameters','minRange','maxRange','探测距离');ordered('parameters','elevationMin','elevationMax','俯仰角');ordered('parameters','bandMinGHz','bandMaxGHz','接收频段');ordered('parameters','minSoundDb','maxSoundDb','声压');
 ordered('working','yawMin','yawMax','云台水平');ordered('working','pitchMin','pitchMax','云台俯仰');ordered('working','frequencyMin','frequencyMax','频率');
 ordered('parameters','fieldMinVpm','fieldMaxVpm','场强量程');ordered('parameters','temperatureMin','temperatureMax','工作温度',true);
 if(profile.type==='optical'){
  const p=profile.parameters;if(p.narrowHfov!=null&&p.wideHfov!=null&&p.narrowHfov>p.wideHfov)throw Error('窄视场不能大于宽视场');
  if(profile.working.channel==='thermal'&&profile.working.focalMm!==75)throw Object.assign(Error('热成像通道焦距为 75 mm'),{field:'working.focalMm'});
 }
 return structuredClone(profile);
}
export function validateCatalogFile(value){
 if(value?.schema!==CATALOG_SCHEMA||!Array.isArray(value.profiles)||!value.profiles.length||value.profiles.length>CATALOG_MODELS.length)throw Error('请选择装备参数文件');
 const ids=new Set();return value.profiles.map(profile=>{if(ids.has(profile.presetId))throw Error('装备型号重复');ids.add(profile.presetId);return validateProfile(profile);});
}
export function resolveEquipmentProfiles(equipment){
 if(equipment instanceof Map)return equipment;
 const source=structuredClone(equipment??null),list=Array.isArray(source)?source:Array.isArray(source?.profiles)?source.profiles:source?.presetId?[source]:[],profiles=new Map();
 for(const profile of list)try{const valid=validateProfile(profile);if(!profiles.has(valid.presetId))profiles.set(valid.presetId,valid);}catch{}
 return profiles;
}
export function applyEquipmentProfile(device,equipment){
 const profile=(equipment instanceof Map?equipment:resolveEquipmentProfiles(equipment)).get(device.presetId);if(!profile)return device;
 for(const scope of ['parameters','physics'])if(device[scope])for(const [key,value] of Object.entries(profile[scope]))if(Object.hasOwn(device[scope],key)&&typeof value==='number'&&Number.isFinite(value))device[scope][key]=value;
 return device;
}
export function createCatalogStore(storage){
 const saved=new Map(CATALOG_MODELS.map(p=>[p.id,defaultProfile(p.id)])),listeners=new Set();let readError=false;
 try{const raw=storage?.getItem(CATALOG_STORAGE_KEY);if(raw)for(const profile of validateCatalogFile(JSON.parse(raw)))saved.set(profile.presetId,profile);}catch{readError=true;}
 const snapshot=()=>({schema:CATALOG_SCHEMA,profiles:[...saved.values()].map(p=>structuredClone(p))});
 const publish=()=>{const value=snapshot();for(const listener of [...listeners])listener(structuredClone(value));};
 const persist=next=>{if(!storage)throw Error('当前浏览器无法保存，请导出参数');storage.setItem(CATALOG_STORAGE_KEY,JSON.stringify({schema:CATALOG_SCHEMA,profiles:[...next.values()]}));};
 return {
  readError,get:id=>structuredClone(saved.get(id)),getSnapshot:snapshot,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  save(profile){const valid=validateProfile(profile),next=new Map(saved);next.set(profile.presetId,valid);persist(next);saved.set(profile.presetId,valid);publish();},
  import(value){const profiles=validateCatalogFile(value),next=new Map(saved);for(const p of profiles)next.set(p.presetId,p);persist(next);for(const p of profiles)saved.set(p.presetId,p);publish();return profiles;},
  export(profile){return profile?{schema:CATALOG_SCHEMA,profiles:[validateProfile(profile)]}:snapshot();},
 };
}
