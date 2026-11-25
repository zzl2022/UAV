import './drone-catalog.css';
import illustrationAtlas from './assets/drone-catalog-types.webp';

const photos=import.meta.glob('./assets/drone-catalog/*.webp',{eager:true,query:'?url',import:'default'});
const imageSlots={穿越机:1,跟拍:2,行业巡检:3,行业测绘:3,工业多旋翼:3,室内巡检:3,农业测绘:3,农业作业:4,物流运输:4,固定翼测绘:5};
const aliases={DJI:'大疆','Autel Robotics':'道通',FIMI:'飞米',Yuneec:'昊翔',Ryze:'睿炽'};

function element(tag,className,text){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text)node.textContent=text;
 return node;
}

function modelImage(model,lazy){
 const frame=element('div','drone-library-image');
 const showIllustration=()=>{
  frame.classList.add('is-illustration');
  frame.style.backgroundImage=`url("${illustrationAtlas}")`;
  frame.dataset.slot=imageSlots[model.type]??0;
  frame.setAttribute('role','img');
  frame.setAttribute('aria-label',`${model.type}无人机的类型示意图`);
 };
 const url=photos[`./assets/drone-catalog/${model.id}.webp`];
 if(url){
  const image=element('img');
  image.src=url;
  image.alt=`${model.name} 产品示例`;
  image.loading=lazy?'lazy':'eager';
  image.decoding='async';
  image.addEventListener('error',()=>{image.remove();showIllustration();},{once:true});
  frame.append(image);
 }else showIllustration();
 return frame;
}

export function createDroneLibrary({models,onImport}){
 const dialog=element('dialog','drone-library');
 dialog.id='city-target-library';
 dialog.setAttribute('aria-labelledby','drone-library-title');
 const heading=element('h2','','无人机设备库');
 heading.id='drone-library-title';
 const stats=element('p','drone-library-stats');
 const close=element('button','drone-library-close','×');
 close.type='button';close.setAttribute('aria-label','关闭无人机设备库');
 close.onclick=()=>dialog.close();
 const header=element('header','drone-library-header');
 const titles=element('div');titles.append(heading,stats);header.append(titles,close);

 const search=element('input');
 search.type='search';search.placeholder='搜索品牌、型号或用途';search.setAttribute('aria-label',search.placeholder);
 const brand=element('select');
 brand.setAttribute('aria-label','按品牌筛选');
 const results=element('span','drone-library-results');
 results.setAttribute('role','status');
 const filters=element('div','drone-library-filters');filters.append(search,brand,results);
 const list=element('div','drone-library-list');
 list.setAttribute('role','group');list.setAttribute('aria-label','机型列表');
 const content=element('div','drone-library-content');content.append(filters,list);
 const detail=element('section','drone-library-detail');
 detail.setAttribute('aria-label','所选机型规格');
 const error=element('p','drone-library-error');error.setAttribute('role','alert');
 const load=element('button','primary','导入到推演平台');
 load.type='button';load.disabled=true;
 const side=element('div','drone-library-side');side.append(detail,error,load);
 const layout=element('div','drone-library-layout');layout.append(content,side);
 dialog.append(header,layout);

 let selected=null;
 const cards=new Map();
 function selectModel(id){
  cards.get(selected)?.setAttribute('aria-pressed','false');
  selected=id;
  const model=models.get(id);
  cards.get(selected)?.setAttribute('aria-pressed','true');
  load.disabled=!model;error.textContent='';
  if(!model){
   detail.replaceChildren(element('p','drone-library-empty','选择左侧机型查看规格'));
   return;
  }
  const name=element('h3','',model.name);
  const kind=element('p','drone-library-kind',`${model.brand} · ${model.type}`);
  const specs=element('dl','drone-library-specs');
  for(const [title,value,note] of [
   ['长 × 宽 × 高',`${model.dimensions.map(size=>Number((size*1000).toFixed(2))).join(' × ')} mm`,model.dimensionsNote],
   ['飞行速度',`${model.speed} m/s`,model.speedNote],
  ]){
   const dd=element('dd','',value);dd.append(element('small','',note));
   specs.append(element('dt','',title),dd);
  }
  detail.replaceChildren(modelImage(model,false),name,kind,specs);
 }
 function renderList(){
  const terms=search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const nodes=[];cards.clear();
  for(const model of models.values()){
   if(brand.value&&model.brand!==brand.value)continue;
   const searchable=`${model.name} ${model.id} ${model.brand} ${model.type} ${aliases[model.brand]??''}`.toLowerCase();
   if(!terms.every(term=>searchable.includes(term)))continue;
   const card=element('button','drone-library-card');card.type='button';
   card.setAttribute('aria-pressed',String(model.id===selected));card.dataset.modelId=model.id;
   const body=element('div','drone-library-card-body');
   body.append(element('strong','',model.name),element('span','',model.type));
   card.append(modelImage(model,true),body);
   card.onclick=()=>selectModel(model.id);
   cards.set(model.id,card);nodes.push(card);
  }
  results.textContent=`${nodes.length} 款`;
  list.replaceChildren(...(nodes.length?nodes:[element('p','drone-library-empty','没有匹配的型号')]));
  list.scrollTop=0;
 }
 search.addEventListener('input',renderList);
 brand.addEventListener('change',renderList);
 load.onclick=()=>{
  const problem=onImport(selected);
  if(problem)error.textContent=problem;
  else dialog.close();
 };
 // The scene menu also handles Escape. Leave this keystroke to the dialog.
 dialog.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  event.preventDefault();event.stopPropagation();dialog.close();
 });
 return {
  dialog,
  open(currentId){
   const brands=[...new Set(Array.from(models.values(),model=>model.brand))].sort();
   stats.textContent=`${models.size} 款机型 · ${brands.length} 个品牌`;
   brand.replaceChildren(new Option('全部品牌',''),...brands.map(name=>new Option(name,name)));
   search.value='';
   selectModel(currentId);
   renderList();
   dialog.showModal();
   search.focus();
  },
 };
}
