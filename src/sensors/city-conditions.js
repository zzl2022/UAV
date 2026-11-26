import {ENV_FIELDS,DEFAULT_ENV,DEFAULT_TARGET} from './presets.js';
import {validateEnvironment} from './engine.js';
import {DRONE_TARGET_PRESETS,TARGET_EDITOR_FIELDS,targetDraft,targetFromDraft,importTargetDraft,readDroneCatalog,selectTargetPreset} from './target-profiles.js';
import {createDroneLibrary} from './drone-catalog-ui.js';

const environmentGroups=[
 ['气象环境',['rainMmH','visibilityKm','illuminanceLux','temperatureC','windSpeed']],
 ['噪声环境',['trafficDb','constructionDb','crowdDb','windNoiseDb','rainNoiseDb']],
 ['电磁环境',['emNoiseDb','cochannelDb','crosstalkDb']],
];
const targetKeys=['size','width_m','height_m','rcs','speed','count','thermalContrast','emitting','fhss','frequencyGHz','eirpDbm','sourceDb','acousticFrequencyHz','check_band','bandLow','bandHigh'];
const draftTarget=targetDraft;
export function mountCityConditions({panel,getState,onEnvironment,onTarget}){
 const scene=document.createElement('div');scene.id='city-scene-page';scene.className='city-page';scene.append(...panel.childNodes);
 const tabs=document.createElement('div');tabs.className='city-mode-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','城市建模');
 const pages=new Map([['scene',scene]]);let active='scene';
 const droneModels=new Map(DRONE_TARGET_PRESETS.map(model=>[model.id,model]));
 const editors={
  environment:{name:'环境情况',groups:environmentGroups,fields:ENV_FIELDS,draft:structuredClone(getState().environment),dirty:false,group:'气象环境'},
  target:{name:'侦测目标',fields:TARGET_EDITOR_FIELDS,draft:draftTarget(getState().target),dirty:false},
 };
 function commitTarget(editor,draft=editor.draft){
  try{
   const next=targetFromDraft(getState().target,draft);
   onTarget(next);editor.draft=draft;editor.dirty=false;editor.apply.disabled=true;editor.message.textContent='设置成功，目标参数已生效';return true;
  }catch(error){editor.apply.disabled=false;editor.message.textContent=error.message;return false;}
 }
 function activate(id){active=id;for(const [name,page] of pages)page.hidden=name!==id;for(const button of tabs.children){const selected=button.dataset.page===id;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}}
 for(const [id,name] of [['scene','区域选择'],['environment','环境情况'],['target','侦测目标']]){
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
  if(editor.groups)content.append(nav);
  content.append(form);page.append(title,content,footer);panel.append(page);pages.set(id,page);Object.assign(editor,{page,nav,form,message,apply});
  if(id==='environment'){
   const load=document.createElement('button');load.type='button';load.id='city-environment-import';load.textContent='导入';
   load.title='导入 JSON 环境参数，导入后点击应用生效';
   const file=document.createElement('input');file.type='file';file.id='city-environment-file';file.accept='.json,application/json';file.hidden=true;file.setAttribute('aria-label','导入环境情况参数');
   load.onclick=()=>file.click();footer.insertBefore(load,message);page.append(file);
   const template=document.createElement('button');template.type='button';template.id='city-environment-template';template.textContent='模板';template.title='下载 JSON 环境参数导入模板';
   template.onclick=()=>{
    const keys=environmentGroups.flatMap(([,items])=>items),data={environment:Object.fromEntries(keys.map(key=>[key,editor.draft[key]]))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='环境情况-导入模板.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   };
   footer.insertBefore(template,message);
   file.onchange=async()=>{
    const selected=file.files[0];if(!selected)return;
    try{
     if(selected.size>1024*1024)throw Error('文件不能大于 1 MB');
     const data=JSON.parse(await selected.text()),values=data?.environment??data;
     if(!values||typeof values!=='object'||Array.isArray(values))throw Error('环境参数必须为 JSON 对象');
     const keys=environmentGroups.flatMap(([,items])=>items),imported=Object.keys(values);
     if(imported.some(key=>!Object.hasOwn(ENV_FIELDS,key)))throw Error('包含无法识别的环境参数');
     if(!imported.some(key=>keys.includes(key)))throw Error('文件中没有环境情况参数');
     const next={...editor.draft};for(const key of keys)if(Object.hasOwn(values,key))next[key]=values[key];
     validateEnvironment(next);
     editor.draft=next;editor.dirty=true;editor.apply.disabled=false;renderEditor(id);editor.message.textContent='已导入，待应用';
    }catch(error){editor.message.textContent=`导入失败：${error.message}`;}
    finally{file.value='';}
   };
  }
  if(id==='target'){
   const actions=document.createElement('div');actions.className='city-target-actions';
   const load=document.createElement('button');load.type='button';load.id='city-target-import';load.textContent='导入';load.title='导入 JSON 目标参数或无人机型号库';
   const template=document.createElement('button');template.type='button';template.id='city-target-template';template.textContent='模板';template.onclick=()=>{
    const data={target:Object.fromEntries(Object.entries(TARGET_EDITOR_FIELDS).map(([key])=>[key,targetDraft(getState().target)[key]]))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='侦测目标-导入模板.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   };
   const file=document.createElement('input');file.type='file';file.id='city-target-file';file.accept='.json,application/json';file.hidden=true;file.setAttribute('aria-label','导入侦测目标参数或无人机型号库');load.onclick=()=>file.click();
   const currentModel=document.createElement('p');currentModel.id='city-target-current-model';
   const libraryButton=document.createElement('button');libraryButton.type='button';libraryButton.id='city-target-library-open';
   libraryButton.textContent='无人机设备库导入';libraryButton.setAttribute('aria-haspopup','dialog');
   libraryButton.setAttribute('aria-controls','city-target-library');
   const library=createDroneLibrary({models:droneModels,onImport:modelId=>{
    const next=selectTargetPreset(editor.draft,modelId,droneModels);
    if(!commitTarget(editor,next))return editor.message.textContent;
    renderEditor(id);
    editor.message.textContent=`已导入 ${droneModels.get(modelId).name}，目标参数已生效`;
   }});
   libraryButton.onclick=()=>library.open(editor.draft.dronePresetId);
   actions.append(load,template,libraryButton,currentModel);footer.prepend(actions);editor.currentModel=currentModel;
   page.append(file,library.dialog);
   file.onchange=async()=>{
    const selected=file.files[0];if(!selected)return;
    try{
     if(selected.size>1024*1024)throw Error('文件不能大于 1 MB');
     const data=JSON.parse(await selected.text());
     if(Object.hasOwn(data??{},'models')){
      const imported=readDroneCatalog(data);
      const additions=imported.filter(model=>!droneModels.has(model.id));
      for(const model of additions)droneModels.set(model.id,model);
      editor.message.textContent=`已读取 ${imported.length} 款型号，新增 ${additions.length} 款，库内共 ${droneModels.size} 款`;
      return;
     }
     editor.draft=importTargetDraft(getState().target,editor.draft,data);
     editor.dirty=true;if(commitTarget(editor))editor.message.textContent='设置成功，已导入并生效';renderEditor(id);
    }catch(error){editor.message.textContent=`导入失败：${error.message}`;}
    finally{file.value='';}
   };
  }
  for(const [name] of editor.groups??[]){const item=document.createElement('button');item.type='button';item.textContent=name;item.onclick=()=>{editor.group=name;renderEditor(id);};nav.append(item);}
  const applyValues=()=>{
   if(id==='target'){commitTarget(editor);return;}
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
     onTarget(targetFromDraft(getState().target,editor.draft));
    }
    editor.dirty=false;editor.apply.disabled=true;editor.message.textContent='设置成功，环境参数已生效';
   }catch(error){editor.message.textContent=error.message;editor.form.querySelector(':invalid')?.reportValidity();}
  };
  apply.onclick=applyValues;form.onsubmit=event=>{event.preventDefault();applyValues();};
  reset.onclick=()=>{
   if(id==='environment')for(const [,keys] of environmentGroups)for(const key of keys)editor.draft[key]=DEFAULT_ENV[key];
   else editor.draft=draftTarget({...DEFAULT_TARGET,position:getState().target.position});
   editor.dirty=true;editor.apply.disabled=false;editor.message.textContent='未应用';renderEditor(id);
  };
  renderEditor(id);
 }
 function renderCurrentModel(editor){
  const preset=droneModels.get(editor.draft.dronePresetId);
  editor.currentModel.textContent=`当前目标　${preset?.name??'自定义目标'}`;
 }
 function renderEditor(id){
  const editor=editors[id];if(!editor.form)return;
  if(id==='target')renderCurrentModel(editor);
  editor.form.replaceChildren();
  if(editor.groups){
   for(const button of editor.nav.children)button.setAttribute('aria-current',String(button.textContent===editor.group));
   const heading=document.createElement('h3');heading.textContent=editor.group;editor.form.append(heading);
  }
  const grid=document.createElement('div');grid.className='profile-field-grid';editor.form.append(grid);
  if(id==='target'){const hint=document.createElement('p');hint.textContent='尺寸为等效尺寸与成像投影尺寸。';editor.form.append(hint);}
  const keys=id==='target'?targetKeys:editor.groups.find(([name])=>name===editor.group)[1];
  for(const key of keys){
   if(id==='target'&&['bandLow','bandHigh'].includes(key)&&!editor.draft.check_band)continue;
   const spec=editor.fields[key],label=document.createElement('label');label.className=`profile-field${spec.boolean?' profile-switch':''}`;
   const title=document.createElement('span');title.className='profile-field-label';title.textContent=spec.label;
   const control=document.createElement('div');control.className='profile-field-control';const input=document.createElement('input');input.id=`city-${id}-${key}`;input.setAttribute('aria-label',spec.label);
   if(spec.boolean){input.type='checkbox';input.checked=editor.draft[key];}
   else{input.type='number';input.min=spec.min;input.max=spec.max;input.step=['count'].includes(key)?1:'any';input.required=!spec.nullable;input.value=editor.draft[key]??'';if(spec.nullable)input.placeholder='未设置';}
   control.append(input);
   if(spec.unit){const unit=document.createElement('span');unit.className='profile-unit';unit.textContent=spec.unit;control.append(unit);}
   label.append(title,control);grid.append(label);
   input.addEventListener(spec.boolean?'change':'input',()=>{
    editor.draft[key]=spec.boolean?input.checked:input.value.trim()===''?null:Number(input.value);editor.dirty=true;
    if(id==='target'){
     if(editor.draft.dronePresetId){editor.draft.dronePresetId=null;renderCurrentModel(editor);}
     commitTarget(editor);
    }
    else{editor.apply.disabled=false;editor.message.textContent='未应用';}
    if(key==='check_band'){
     const scrollTop=editor.form.scrollTop;renderEditor(id);editor.form.scrollTop=scrollTop;
     editor.form.querySelector('#city-target-check_band').focus({preventScroll:true});
    }
   });
  }

 }
 tabs.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const ids=['scene','environment','target'],index=ids.indexOf(active),next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:-1)+3)%3;event.preventDefault();activate(ids[next]);tabs.children[next].focus();
 });
 activate('scene');
 return {
  refresh(){if(!editors.environment.dirty)editors.environment.draft=structuredClone(getState().environment);if(!editors.target.dirty)editors.target.draft=draftTarget(getState().target);for(const id of Object.keys(editors))renderEditor(id);},
 };
}
