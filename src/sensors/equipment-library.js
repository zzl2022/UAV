import {catalogFields,getProfileValue} from './equipment-catalog.js';
import {CATALOG_TYPES} from './equipment-models.js';

export const EQUIPMENT_LIBRARY_KEY='uav.equipment-library.v1';
const LIMIT=50;
const SUMMARY_FIELDS={
  radar:['parameters.maxRange','physics.peakPowerW'],
  optical:['working.channel','working.focalMm'],
  radio:['parameters.bandMinGHz','parameters.bandMaxGHz'],
  acoustic:['working.frequencyMin','working.frequencyMax'],
  fivega:['parameters.coverageDistance','parameters.channelCount'],
  electrostatic:['parameters.detectionDistance','parameters.staticPowerMw'],
};

export function createEquipmentLibrary(storage){
  let entries=new Map();
  try{
    const stored=JSON.parse(storage?.getItem(EQUIPMENT_LIBRARY_KEY)??'[]');
    if(Array.isArray(stored)){
      for(const item of stored){
        if(entries.size===LIMIT)break;
        if(typeof item?.presetId!=='string'||!item.presetId||!Object.hasOwn(CATALOG_TYPES,item.type)
          ||typeof item.name!=='string'||!item.name.trim()||typeof item.addedAt!=='string'||!Number.isFinite(Date.parse(item.addedAt)))continue;
        const {presetId,type,name,addedAt}=item;
        entries.set(presetId,{presetId,type,name,addedAt});
      }
    }
  }catch{}

  function write(next){
    try{
      if(!storage)throw Error();
      storage.setItem(EQUIPMENT_LIBRARY_KEY,JSON.stringify([...next.values()]));
    }catch{throw Error('装备库保存失败，请检查浏览器存储空间。');}
    entries=next;
  }
  function checkCapacity(presetId){
    if(!entries.has(presetId)&&entries.size>=LIMIT)throw Error('装备库最多保存 50 项，请先移除一项。');
  }
  return {
    entries:()=>[...entries.values()].map(entry=>({...entry})),
    has:presetId=>entries.has(presetId),
    checkCapacity,
    add({presetId,type,name}){
      checkCapacity(presetId);
      const next=new Map(entries);
      next.set(presetId,{presetId,type,name,addedAt:new Date().toISOString()});
      write(next);
    },
    remove(presetId){
      const entry=entries.get(presetId);
      if(!entry)return null;
      const next=new Map(entries);
      next.delete(presetId);
      write(next);
      return {...entry};
    },
  };
}

export function equipmentLibrarySummary(profile){
  if(!profile)return '参数未提供';
  const fields=catalogFields(profile.presetId),summary=[];
  for(const key of SUMMARY_FIELDS[profile.type]??[]){
    const spec=fields[key],value=getProfileValue(profile,key);
    if(!spec||value==null)continue;
    const label=spec.options?.find(([option])=>String(option)===String(value))?.[1]??String(value);
    const qualifier=spec.qualifier&&value===spec.value?spec.qualifier:'';
    const prefix=['≥','≤'].includes(qualifier)?qualifier:'';
    const suffix=prefix?'':qualifier;
    summary.push(`${spec.label} ${prefix}${label}${spec.unit?` ${spec.unit}`:''}${suffix}`);
  }
  return summary.join(' · ')||'关键参数未提供';
}
