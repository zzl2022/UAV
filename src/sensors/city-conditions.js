import {ENV_FIELDS,TARGET_FIELDS,DEFAULT_ENV} from './presets.js';
import {validateEnvironment,validateTarget} from './engine.js';

const environmentGroups=[
 ['气象环境',['rainMmH','visibilityKm','illuminanceLux','temperatureC','windSpeed']],
 ['噪声环境',['trafficDb','constructionDb','crowdDb','windNoiseDb','rainNoiseDb']],
 ['电磁环境',['emNoiseDb','cochannelDb','crosstalkDb']],
 ['传播衰减',['cloudDbKm','refractionDb']],
];
const extra=(label,unit,min,max,value,options={})=>({label,unit,min,max,value,step:'any',...options});
const targetFields={...TARGET_FIELDS,
 east:extra('东坐标','m',-30000,30000,0),north:extra('北坐标','m',-30000,30000,0),up:extra('上坐标','m',-20000,20000,100),
 width_m:extra('目标宽度','m',.001,100,.35,{nullable:true}),height_m:extra('目标高度','m',.001,100,.35,{nullable:true}),
 emitting:{label:'发射无线电',boolean:true},fhss:{label:'跳频发射',boolean:true},
 acousticFrequencyHz:extra('主声频','Hz',20,20000,2000),check_band:{label:'核对声学频带',boolean:true},bandLow:extra('频带下限','Hz',1,100000,500),bandHigh:extra('频带上限','Hz',1,100000,2000),
};
const targetGroups=[['基本属性',['size','width_m','height_m','rcs','speed','count','thermalContrast']],['无线电',['emitting','fhss','frequencyGHz','eirpDbm']],['声学',['sourceDb','acousticFrequencyHz','check_band','bandLow','bandHigh']]];
const targetDraft=target=>({...structuredClone(target),fhss:target.fhss??false,east:target.position[0],north:-target.position[2],up:target.position[1],width_m:target.capability&&Object.hasOwn(target.capability,'width_m')?target.capability.width_m:target.size,height_m:target.capability&&Object.hasOwn(target.capability,'height_m')?target.capability.height_m:target.size,check_band:target.capability?.check_band??false,bandLow:target.capability?.band_hz?.[0]??500,bandHigh:target.capability?.band_hz?.[1]??2000});
export function mountCityConditions({panel,getState,onEnvironment,onTarget,onPickTarget}){
 const scene=document.createElement('div');scene.id='city-scene-page';scene.className='city-page';scene.append(...panel.childNodes);
 const tabs=document.createElement('div');tabs.className='city-mode-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','城市建模');
 const pages=new Map([['scene',scene]]);let active='scene';
 const editors={
  environment:{name:'环境工况',groups:environmentGroups,fields:ENV_FIELDS,draft:structuredClone(getState().environment),dirty:false,group:'气象环境'},
  target:{name:'侦测目标',groups:targetGroups,fields:targetFields,draft:targetDraft(getState().target),dirty:false,group:'基本属性'},
 };
 function activate(id){active=id;for(const [name,page] of pages)page.hidden=name!==id;for(const button of tabs.children){const selected=button.dataset.page===id;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}}
 for(const [id,name] of [['scene','区域设置'],['environment','环境工况'],['target','侦测目标']]){
  const button=document.createElement('button');button.id=`city-tab-${id}`;button.type='button';button.dataset.page=id;button.textContent=name;button.setAttribute('role','tab');button.setAttribute('aria-controls',id==='scene'?scene.id:`city-${id}-page`);button.onclick=()=>activate(id);tabs.append(button);
 }
 panel.append(tabs,scene);scene.setAttribute('role','tabpanel');scene.setAttribute('aria-labelledby','city-tab-scene');
 for(const [id,editor] of Object.entries(editors)){
  const page=document.createElement('div');page.id=`city-${id}-page`;page.className='city-page city-settings-page';page.hidden=true;page.setAttribute('role','tabpanel');page.setAttribute('aria-labelledby',`city-tab-${id}`);
  const title=document.createElement('h2');title.textContent=editor.name;
  const content=document.createElement('div');content.className='city-settings-editor';const nav=document.createElement('nav');nav.className='city-settings-nav';nav.setAttribute('aria-label',editor.name);
  const form=document.createElement('form');form.className='city-settings-form';form.noValidate=true;
  const footer=document.createElement('div');footer.className='city-settings-footer';const reset=document.createElement('button');reset.type='button';reset.textContent='恢复默认';reset.id=`city-${id}-reset`;
  const message=document.createElement('span');message.id=`city-${id}-message`;message.setAttribute('role','status');const apply=document.createElement('button');apply.type='button';apply.className='primary';apply.textContent='应用';apply.id=`city-${id}-apply`;apply.disabled=true;footer.append(reset,message,apply);
  content.append(nav,form);page.append(title,content,footer);panel.append(page);pages.set(id,page);Object.assign(editor,{page,nav,form,message,apply});
  if(id==='environment'){
   const load=document.createElement('button');load.type='button';load.id='city-environment-import';load.textContent='导入';
   const file=document.createElement('input');file.type='file';file.id='city-environment-file';file.accept='.json,application/json';file.hidden=true;
   load.onclick=()=>file.click();footer.insertBefore(load,message);page.append(file);
   file.onchange=async()=>{
    const selected=file.files[0];if(!selected)return;
    try{
     if(selected.size>1024*1024)throw Error('文件不能大于 1 MB');
     const data=JSON.parse(await selected.text()),values=data?.environment??data;
     if(!values||typeof values!=='object'||Array.isArray(values))throw Error('环境参数必须为 JSON 对象');
     const keys=environmentGroups.flatMap(([,items])=>items),imported=Object.keys(values);
     if(imported.some(key=>!Object.hasOwn(ENV_FIELDS,key)))throw Error('包含无法识别的环境参数');
     if(!imported.some(key=>keys.includes(key)))throw Error('文件中没有环境工况参数');
     const next={...editor.draft};for(const key of keys)if(Object.hasOwn(values,key))next[key]=values[key];
     validateEnvironment(next);
     editor.draft=next;editor.dirty=true;editor.apply.disabled=false;renderEditor(id);editor.message.textContent='已导入，待应用';
    }catch(error){editor.message.textContent=`导入失败：${error.message}`;}
    finally{file.value='';}
   };
  }
  for(const [name] of editor.groups){const item=document.createElement('button');item.type='button';item.textContent=name;item.onclick=()=>{editor.group=name;renderEditor(id);};nav.append(item);}
  const applyValues=()=>{
   try{
    for(const [key,spec] of Object.entries(editor.fields)){
     if(id==='environment'&&!environmentGroups.some(([,keys])=>keys.includes(key)))continue;
     if(spec.boolean||spec.nullable&&editor.draft[key]===null)continue;
     const value=editor.draft[key];if(typeof value!=='number'||!Number.isFinite(value)||value<spec.min||value>spec.max||['count','rfStations'].includes(key)&&!Number.isInteger(value)){
      editor.group=editor.groups.find(([,keys])=>keys.includes(key))?.[0]??editor.group;renderEditor(id);throw Error(`请检查${spec.label}`);
     }
    }
    if(id==='environment'){const value={...getState().environment};for(const [,keys] of environmentGroups)for(const key of keys)value[key]=editor.draft[key];validateEnvironment(value);onEnvironment(value);}
    else{
     const value={...structuredClone(getState().target)};
     for(const key of [...Object.keys(TARGET_FIELDS),'emitting','fhss','acousticFrequencyHz'])value[key]=editor.draft[key];
     value.position=[editor.draft.east,editor.draft.up,-editor.draft.north];
     value.capability={...value.capability,width_m:editor.draft.width_m,height_m:editor.draft.height_m,check_band:editor.draft.check_band,band_hz:[editor.draft.bandLow,editor.draft.bandHigh]};
     if(value.capability.band_hz[0]>value.capability.band_hz[1])throw Error('频带下限不能大于上限');validateTarget(value);onTarget(value);
    }
    editor.dirty=false;editor.apply.disabled=true;editor.message.textContent='已应用';
   }catch(error){editor.message.textContent=error.message;editor.form.querySelector(':invalid')?.reportValidity();}
  };
  apply.onclick=applyValues;form.onsubmit=event=>{event.preventDefault();applyValues();};
  reset.onclick=()=>{
   if(id==='environment')for(const [,keys] of environmentGroups)for(const key of keys)editor.draft[key]=DEFAULT_ENV[key];
   else{const current=getState().target;editor.draft=targetDraft({...current,...Object.fromEntries(Object.entries(TARGET_FIELDS).map(([key,spec])=>[key,spec.value])),emitting:true,fhss:false,acousticFrequencyHz:2000,capability:{width_m:.35,height_m:.35,check_band:false,band_hz:[500,2000]}});}
   editor.dirty=true;editor.apply.disabled=false;editor.message.textContent='未应用';renderEditor(id);
  };
  renderEditor(id);
 }
 function renderEditor(id){
  const editor=editors[id];if(!editor.form)return;
  [...editor.nav.children].forEach(button=>button.setAttribute('aria-current',String(button.textContent===editor.group)));
  editor.form.replaceChildren();const heading=document.createElement('h3');heading.textContent=editor.group;const grid=document.createElement('div');grid.className='profile-field-grid';editor.form.append(heading,grid);
  for(const key of editor.groups.find(([name])=>name===editor.group)[1]){
   if(id==='target'&&['bandLow','bandHigh'].includes(key)&&!editor.draft.check_band)continue;
   const spec=editor.fields[key],label=document.createElement('label');label.className=`profile-field${spec.boolean?' profile-switch':''}`;
   const title=document.createElement('span');title.className='profile-field-label';title.textContent=spec.label;
   const control=document.createElement('div');control.className='profile-field-control';const input=document.createElement('input');input.id=`city-${id}-${key}`;input.setAttribute('aria-label',spec.label);
   if(spec.boolean){input.type='checkbox';input.checked=editor.draft[key];}
   else{input.type='number';input.min=spec.min;input.max=spec.max;input.step=['count'].includes(key)?1:'any';input.required=!spec.nullable;input.value=editor.draft[key]??'';if(spec.nullable)input.placeholder='未设置';}
   if(key==='up')label.title='局部 ENU 上坐标，单位米';control.append(input);
   if(spec.unit){const unit=document.createElement('span');unit.className='profile-unit';unit.textContent=spec.unit;control.append(unit);}
   label.append(title,control);grid.append(label);
   input.addEventListener(spec.boolean?'change':'input',()=>{editor.draft[key]=spec.boolean?input.checked:input.value.trim()===''?null:Number(input.value);editor.dirty=true;editor.apply.disabled=false;editor.message.textContent='未应用';if(key==='check_band')renderEditor(id);});
  }
 }
 tabs.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const ids=['scene','environment','target'],index=ids.indexOf(active),next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:-1)+3)%3;event.preventDefault();activate(ids[next]);tabs.children[next].focus();
 });
 activate('scene');
 return {
  refresh(){if(!editors.environment.dirty)editors.environment.draft=structuredClone(getState().environment);if(!editors.target.dirty)editors.target.draft=targetDraft(getState().target);for(const id of Object.keys(editors))renderEditor(id);},
  setTargetPosition(position){const editor=editors.target;Object.assign(editor.draft,{east:position[0],up:position[1],north:-position[2]});editor.dirty=true;editor.apply.disabled=false;editor.message.textContent='未应用';activate('target');renderEditor('target');},
 };
}
