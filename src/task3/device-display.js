// 当前方案的设备显示映射：显示名与内部计算 ID 分离，移动设备追加后连续编号。
import {PRESETS,TYPES} from '../sensors/presets.js';

export function createDeviceDisplayMap(devices=[]){
 if(!Array.isArray(devices))throw Error('设备列表无效');
 const byId=new Map(),entries=devices.map((device,index)=>{
  if(!device||typeof device.id!=='string'||!device.id)throw Error('设备缺少内部 ID');
  if(byId.has(device.id))throw Error(`设备内部 ID 重复：${device.id}`);
  const preset=PRESETS.find(p=>p.id===device.presetId),entry={
   internalId:device.id,displayName:`设备-${index+1}`,type:device.type,typeName:TYPES[device.type]??'未知类型',
   presetId:device.presetId,modelName:preset?.name??device.name??device.presetId??'未知型号',
  };
  byId.set(device.id,entry);return Object.freeze(entry);
 });
 return {
  entries,
  get(internalId){return byId.get(internalId)??null;},
  nameOf(internalId){return byId.get(internalId)?.displayName??internalId;},
  details(internalId){return byId.get(internalId)??null;},
  toJSON(){return entries.map(entry=>({...entry}));},
 };
}
