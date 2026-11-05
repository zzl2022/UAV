import {TARGET_FIELDS} from './presets.js';
import {validateTarget} from './engine.js';

// Official aircraft specifications checked 2026-11-05. Dimensions are L × W × H.
export const DRONE_TARGET_PRESETS=[
 {id:'mini-4-pro',name:'DJI Mini 4 Pro',type:'轻型航拍',dimensions:[.298,.373,.101],speed:16,dimensionsNote:'展开、含桨',speedNote:'运动模式',source:'https://www.dji.com/mini-4-pro/specs'},
 {id:'air-3s',name:'DJI Air 3S',type:'航拍',dimensions:[.26611,.32547,.106],speed:21,dimensionsNote:'展开、不含桨',speedNote:'海平面无风，非欧盟版本',source:'https://www.dji.com/air-3s/specs'},
 {id:'avata-2',name:'DJI Avata 2',type:'穿越机',dimensions:[.185,.212,.064],speed:27,dimensionsNote:'机身尺寸',speedNote:'手动模式，非欧盟版本',source:'https://www.dji.com/avata-2/specs'},
 {id:'mavic-3e',name:'DJI Mavic 3E',type:'行业巡检',dimensions:[.3475,.283,.1077],speed:21,dimensionsNote:'展开、不含桨',speedNote:'运动模式前飞，海平面无风，非 EU C1 电池配置',source:'https://enterprise.dji.com/mavic-3-enterprise/specs'},
 {id:'matrice-350-rtk',name:'DJI Matrice 350 RTK',type:'工业多旋翼',dimensions:[.81,.67,.43],speed:23,dimensionsNote:'展开、不含桨',speedNote:'最大水平速度',source:'https://enterprise.dji.com/matrice-350-rtk/specs'},
];
const extra=(label,unit,min,max,options={})=>({label,unit,min,max,...options});
export const TARGET_EDITOR_FIELDS={...TARGET_FIELDS,
 width_m:extra('目标宽度','m',.001,100,{nullable:true}),height_m:extra('目标高度','m',.001,100,{nullable:true}),
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
export function selectTargetPreset(draft,id){
 const preset=DRONE_TARGET_PRESETS.find(item=>item.id===id);if(!preset)throw Error('未知无人机型号');
 const [length,width,height]=preset.dimensions;
 return {...structuredClone(draft),size:Math.max(length,width),width_m:width,height_m:height,speed:preset.speed,dronePresetId:id};
}
