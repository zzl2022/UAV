import {CATALOG_MODELS,CATALOG_TYPES,catalogModel} from './equipment-models.js';
import {CATALOG_SCHEMA,catalogFields,defaultProfile,getProfileValue,setProfileValue,profileGroups,createCatalogStore,createCustomProfile} from './equipment-catalog.js';
import './equipment-manager.css';

const order=Object.keys(CATALOG_TYPES);
const svg=paths=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons={
 radar:svg('<circle cx="12" cy="12" r="8"/><path d="M12 4v8l5-5M12 8a4 4 0 1 0 4 4"/><circle cx="12" cy="12" r="1"/>'),
 optical:svg('<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="12" cy="12" r="4"/><path d="M17.5 8h.01"/>'),
 radio:svg('<path d="M6.3 5a10 10 0 0 0 0 14M17.7 5a10 10 0 0 1 0 14M9 8a5.7 5.7 0 0 0 0 8M15 8a5.7 5.7 0 0 1 0 8"/><circle cx="12" cy="12" r="1.4"/>'),
 acoustic:svg('<path d="M4 10v4M8 6v12M12 3v18M16 6v12M20 10v4"/>'),
 fivega:svg('<path d="m8 20 4-15 4 15M9.5 15h5M10.5 11h3M5 5a10 10 0 0 0 0 8M19 5a10 10 0 0 1 0 8"/><circle cx="12" cy="4" r="1"/>'),
 electrostatic:svg('<path d="m13 2-7 11h5l-1 9 8-13h-5zM3 5h3M4.5 3.5v3M18 19h3"/>'),
};
export function mountEquipmentManager(panel,{demo}={}){
 let storage;try{storage=localStorage;}catch{}
 const store=createCatalogStore(storage),drafts=new Map(store.getSnapshot().profiles.map(p=>[p.presetId,p]));
 const remembered=Object.fromEntries(order.map(type=>[type,CATALOG_MODELS.find(p=>p.type===type).id]));
 const selectionKey='uav.equipment-selection.v1';
 try{const selected=JSON.parse(storage?.getItem(selectionKey)??'{}');for(const kind of order)if(drafts.get(selected[kind])?.type===kind)remembered[kind]=selected[kind];}catch{}
 const persistSelection=()=>{try{storage?.setItem(selectionKey,JSON.stringify(remembered));}catch{tell('型号选择无法保存，请检查浏览器存储空间');}};
 let autosaveTimer;
 const savePending=()=>{
  clearTimeout(autosaveTimer);
  for(const draft of drafts.values())if(JSON.stringify(draft)!==JSON.stringify(store.get(draft.presetId))){
   try{store.save(draft);persistSelection();tell('已自动保存');}catch(error){tell(`未保存：${error.message}`);}
  }
  status();
 };
 const scheduleSave=()=>{clearTimeout(autosaveTimer);autosaveTimer=setTimeout(savePending,400);};
 window.addEventListener('pagehide',savePending);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')savePending();});
 const selectionListeners=new Set(),getSnapshot=()=>{
  const snapshot=store.getSnapshot(),selectedPresetIds=[];
  for(const id of Object.values(remembered)){
   const model=catalogModel(id),baseId=model.basePresetId??id;selectedPresetIds.push(baseId);
   const saved=store.get(id);if(model.basePresetId&&saved){const index=snapshot.profiles.findIndex(p=>p.presetId===baseId);snapshot.profiles[index]={...saved,presetId:baseId,name:catalogModel(baseId).name};}
  }
  return {...snapshot,selectedPresetIds};
 };
 const publishSelection=()=>{const snapshot=getSnapshot();for(const listener of [...selectionListeners])listener(structuredClone(snapshot));};
 let type='radar',presetId=remembered.radar,groupName=null,menuType=null,menuTrigger=null;
 const root=document.createElement('div');root.id='equipment-manager';
 root.innerHTML=`<div class="equipment-type-tabs" role="tablist" aria-label="装备类别"></div>
 <div class="equipment-profile-heading"><div class="equipment-type-icon" aria-hidden="true"></div><div><span class="equipment-type-label"></span><h2 id="equipment-model-name"></h2></div><span id="equipment-save-state" role="status"></span></div>
 <div class="equipment-editor"><nav class="equipment-group-nav" aria-label="参数分组"></nav><form id="equipment-profile-form" novalidate><div id="equipment-profile-fields"></div></form></div>
 <div class="equipment-editor-footer"><div><button type="button" id="equipment-profile-reset">恢复默认</button><button type="button" id="equipment-profile-import">导入</button><button type="button" id="equipment-profile-template">模板</button><input id="equipment-profile-file" type="file" accept=".json,application/json" hidden><button type="button" id="equipment-profile-export">导出</button></div><div><span id="equipment-profile-message" role="status"></span><button type="button" id="equipment-profile-save" class="primary">保存参数</button></div></div>`;
 panel.prepend(root);panel.classList.add('catalog-mode');
 const $=id=>root.querySelector('#'+id),tabs=root.querySelector('.equipment-type-tabs'),nav=root.querySelector('.equipment-group-nav');
 const menu=document.createElement('div');menu.id='equipment-model-menu';menu.className='equipment-model-menu';menu.setAttribute('popover','manual');menu.setAttribute('role','menu');menu.hidden=true;document.body.append(menu);
 const profile=()=>drafts.get(presetId),dirty=()=>JSON.stringify(profile())!==JSON.stringify(store.get(presetId));
 const tell=text=>{$('equipment-profile-message').textContent=text;};
 function status(){const changed=dirty();$('equipment-save-state').textContent=changed?'未保存':JSON.stringify(profile())===JSON.stringify(defaultProfile(presetId))?'默认参数':'已保存';$('equipment-save-state').dataset.dirty=String(changed);$('equipment-profile-save').disabled=!changed;window.equipmentManagerDiagnostics={type,presetId,dirty:changed,group:groupName};}
 function closeMenu(restore=false){
  if(!menuType)return;try{if(menu.matches(':popover-open'))menu.hidePopover();}catch{}
  menu.hidden=true;menuType=null;menuTrigger?.setAttribute('aria-expanded','false');if(restore)menuTrigger?.focus();menuTrigger=null;
 }
function choose(nextType,id=remembered[nextType]){savePending();const selectionChanged=remembered[nextType]!==id;closeMenu();demo?.stop();const inDemo=groupName==='演示';type=nextType;presetId=id;remembered[type]=id;persistSelection();groupName=inDemo?'演示':null;tell('');render();if(selectionChanged)publishSelection();}
 function openMenu(nextType,trigger){
  if(menuType===nextType){closeMenu(true);return;}closeMenu();menuType=nextType;menuTrigger=trigger;menu.replaceChildren();
  const label=document.createElement('div');label.className='model-menu-title';label.textContent=`${CATALOG_TYPES[nextType]}型号`;menu.append(label);
  const create=document.createElement('button');create.type='button';create.setAttribute('role','menuitem');create.textContent='＋ 新建';create.className='equipment-model-create';create.onclick=()=>{
   const base=catalogModel(remembered[nextType]),draft=createCustomProfile(defaultProfile(base.basePresetId??base.id),`新建${CATALOG_TYPES[nextType]}`);drafts.set(draft.presetId,draft);groupName=null;choose(nextType,draft.presetId);$('profile-name')?.focus();
  };menu.append(create);
  for(const entry of [...drafts.values()].filter(p=>p.type===nextType)){
   const preset={id:entry.presetId,name:entry.name};
   const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(remembered[nextType]===preset.id));button.dataset.presetId=preset.id;
   const name=document.createElement('span');name.textContent=preset.name;const check=document.createElement('span');check.textContent=remembered[nextType]===preset.id?'✓':'';check.setAttribute('aria-hidden','true');button.append(name,check);button.onclick=()=>{choose(nextType,preset.id);tabs.querySelector(`[data-type="${nextType}"][role=tab]`).focus();};menu.append(button);
  }
  trigger.setAttribute('aria-expanded','true');menu.hidden=false;
  try{menu.showPopover();}catch{}
  const anchor=trigger.getBoundingClientRect(),bounds=menu.getBoundingClientRect();menu.style.left=`${Math.max(12,Math.min(innerWidth-bounds.width-12,anchor.right-bounds.width))}px`;menu.style.top=`${anchor.bottom+bounds.height+10>innerHeight?Math.max(12,anchor.top-bounds.height-8):anchor.bottom+8}px`;
  (menu.querySelector('[aria-checked=true]')??menu.querySelector('button')).focus();
 }
 for(const nextType of order){
  const group=document.createElement('div');group.className='equipment-type-tab';
  const tab=document.createElement('button');tab.type='button';tab.id=`equipment-tab-${nextType}`;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','equipment-profile-form');tab.dataset.type=nextType;
  const icon=document.createElement('span');icon.setAttribute('aria-hidden','true');icon.innerHTML=icons[nextType];tab.append(icon,document.createTextNode(CATALOG_TYPES[nextType]));tab.onclick=()=>choose(nextType);group.append(tab);
  {const expand=document.createElement('button');expand.type='button';expand.className='equipment-model-trigger';expand.dataset.type=nextType;expand.innerHTML=svg('<path d="m8 10 4 4 4-4"/>');expand.setAttribute('aria-label',`选择${CATALOG_TYPES[nextType]}型号`);expand.setAttribute('aria-haspopup','menu');expand.setAttribute('aria-controls',menu.id);expand.setAttribute('aria-expanded','false');expand.onclick=()=>openMenu(nextType,expand);group.append(expand);}
  tabs.append(group);
 }
 tabs.addEventListener('keydown',event=>{
  if(event.target.getAttribute('role')!=='tab'||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const index=order.indexOf(type),next=event.key==='Home'?0:event.key==='End'?order.length-1:(index+(event.key==='ArrowRight'?1:-1)+order.length)%order.length;event.preventDefault();choose(order[next]);tabs.querySelector(`[data-type="${type}"][role=tab]`).focus();
 });
 menu.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true);return;}
  if(event.key==='Tab'){closeMenu();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  const items=[...menu.querySelectorAll('button')],index=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;event.preventDefault();items[next].focus();
 });
 document.addEventListener('pointerdown',event=>{if(menuType&&!menu.contains(event.target)&&event.target!==menuTrigger)closeMenu();});
 window.addEventListener('resize',()=>closeMenu());
 document.querySelector('#equipment-window').addEventListener('close',()=>closeMenu());
 document.querySelector('#equipment-window-minimize').addEventListener('click',()=>closeMenu());
 function renderFields(){
const {groups,advanced}=profileGroups(presetId),available=[...(demo?[{name:'演示',keys:[]}]:[]),...groups,...(advanced.length?[{name:'高级参数',keys:advanced}]:[])];
  if(!available.some(g=>g.name===groupName))groupName=groups[0].name;
  root.dataset.demo=String(groupName==='演示');
  nav.replaceChildren();for(const group of available){const button=document.createElement('button');button.type='button';button.textContent=group.name;if(group.name==='演示')button.className='equipment-demo-entry';button.setAttribute('aria-current',String(group.name===groupName));button.onclick=()=>{groupName=group.name;tell('');renderFields();status();};nav.append(button);}
  const box=$('equipment-profile-fields');box.replaceChildren();
  if(groupName==='演示'){demo.mount(box,{getProfile:profile});return;}
  const heading=document.createElement('h3');heading.textContent=groupName;box.append(heading);
  const selected=available.find(g=>g.name===groupName);
  const grid=document.createElement('div');grid.className='profile-field-grid';box.append(grid);const defs=catalogFields(presetId);
  if(catalogModel(presetId).basePresetId&&groupName===groups[0].name){
   const label=document.createElement('label');label.className='profile-field equipment-name-field';const title=document.createElement('span');title.className='profile-field-label';title.textContent='装备名称';
   const control=document.createElement('div');control.className='profile-field-control';const input=document.createElement('input');input.type='text';input.id='profile-name';input.required=true;input.maxLength=120;input.value=profile().name;input.setAttribute('aria-label','装备名称');
   input.oninput=()=>{profile().name=input.value;$('equipment-model-name').textContent=input.value;demo?.profileChanged();tell('');status();scheduleSave();};control.append(input);label.append(title,control);grid.append(label);
  }
  for(const key of selected.keys){
   const spec=defs[key],label=document.createElement('label');label.className='profile-field';
   const title=document.createElement('span');title.className='profile-field-label';title.textContent=spec.label;
   const control=document.createElement('div');control.className='profile-field-control';let input;
   if(spec.options){input=document.createElement('select');for(const [value,name] of spec.options)input.add(new Option(name,value));input.value=String(getProfileValue(profile(),key));}
   else{input=document.createElement('input');input.type='number';input.min=spec.min;input.max=spec.max;input.step=spec.integer?1:'any';input.required=!spec.nullable;input.placeholder=spec.placeholder??'';input.value=getProfileValue(profile(),key)??'';}
   input.id=`profile-${key.replace('.','-')}`;input.dataset.profileKey=key;input.setAttribute('aria-label',spec.label);control.append(input);
   let qualifier;
   if(spec.qualifier){qualifier=document.createElement('span');qualifier.className='profile-value-qualifier';qualifier.textContent=spec.qualifier;if(['≥','≤'].includes(spec.qualifier))control.prepend(qualifier);}
   if(spec.unit&&!spec.options){const unit=document.createElement('span');unit.className='profile-unit';unit.textContent=spec.unit;control.append(unit);}
   if(qualifier&&!['≥','≤'].includes(spec.qualifier))control.append(qualifier);
   if(key==='working.focalMm'&&profile().working.channel==='thermal'){input.min=75;input.max=75;}
   label.append(title,control);grid.append(label);
   const updateQualifier=()=>{if(qualifier)qualifier.hidden=getProfileValue(profile(),key)!==spec.value;};
   updateQualifier();
   const edit=()=>{
    const raw=input.value,value=spec.options&&key==='working.channel'?raw:raw.trim()===''?null:Number(raw);setProfileValue(profile(),key,value);input.setCustomValidity('');
    if(key==='working.channel'){profile().working.focalMm=value==='thermal'?75:6.5;renderFields();}
    if(key==='working.arrayDiameter'){profile().working.frequencyMin=value===1.1?20:null;profile().working.frequencyMax=value===1.1?20000:null;renderFields();}
demo?.profileChanged();updateQualifier();tell('');status();scheduleSave();
   };
   input.addEventListener(spec.options?'change':'input',edit);
  }
 }
 function render(){
  for(const tab of tabs.querySelectorAll('[role=tab]')){const selected=tab.dataset.type===type;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;tab.parentElement.dataset.active=String(selected);}
  root.querySelector('.equipment-type-icon').innerHTML=icons[type];root.querySelector('.equipment-type-label').textContent=CATALOG_TYPES[type];$('equipment-model-name').textContent=profile().name;
  $('equipment-profile-form').setAttribute('aria-labelledby',`equipment-tab-${type}`);renderFields();status();
 }
$('equipment-profile-form').onsubmit=event=>{event.preventDefault();if(groupName==='演示')demo?.start();else $('equipment-profile-save').click();};
$('equipment-profile-save').onclick=()=>{try{store.save(profile());persistSelection();tell('已保存');status();}catch(error){if(error.field){const {groups,advanced}=profileGroups(presetId);groupName=error.field==='name'?groups[0].name:groups.find(group=>group.keys.includes(error.field))?.name??(advanced.includes(error.field)?'高级参数':groupName);renderFields();const input=$(`profile-${error.field.replace('.','-')}`);input?.focus();}tell(error.message);const bad=$('equipment-profile-form').querySelector(':invalid');bad?.reportValidity();}};
$('equipment-profile-reset').onclick=()=>{demo?.stop();const next=defaultProfile(presetId);if(catalogModel(presetId).basePresetId)next.name=profile().name;drafts.set(presetId,next);tell('');render();scheduleSave();};
 $('equipment-profile-import').onclick=()=>$('equipment-profile-file').click();
 $('equipment-profile-file').onchange=async()=>{
  const input=$('equipment-profile-file'),file=input.files[0];if(!file)return;
  try{if(file.size>1024*1024)throw Error('参数文件不能超过 1 MB');const profiles=store.importAsNew(JSON.parse(await file.text()));for(const p of profiles)drafts.set(p.presetId,structuredClone(p));groupName=null;choose(profiles[0].type,profiles[0].presetId);tell(`已新增 ${profiles.length} 个装备`);}catch(error){tell(`导入失败：${error.message}`);}finally{input.value='';}
 };
 const download=(data,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('equipment-profile-template').onclick=()=>{
  const model=catalogModel(presetId),template=createCustomProfile(defaultProfile(model.basePresetId??model.id),`自定义${CATALOG_TYPES[type]}`);
  download({schema:CATALOG_SCHEMA,profiles:[template]},`${CATALOG_TYPES[type]}-导入模板.json`);
 };
 $('equipment-profile-export').onclick=()=>{
  try{const data=store.export(profile()),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`${presetId}-参数.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);tell('已导出');}catch(error){tell(error.message);}
 };
demo?.setOpenSettings(()=>{groupName='演示';renderFields();status();});
render();if(store.readError)tell('已恢复有效参数，部分不兼容型号使用默认值');
return {refresh:()=>{closeMenu();render();},closeMenu,getSnapshot,subscribe(listener){const unsubscribe=store.subscribe(()=>listener(getSnapshot()));selectionListeners.add(listener);return()=>{unsubscribe();selectionListeners.delete(listener);};}};
}
