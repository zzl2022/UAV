const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const RECT_PROPS=['left','top','right','bottom','width','height','transform'];

function limits(viewport,{margin=8,minWidth=320,minHeight=240,maxWidth=Infinity,maxHeight=Infinity}={}){
 const width=Math.max(0,finite(viewport.width,0)),height=Math.max(0,finite(viewport.height,0));
 const availableWidth=Math.max(0,width-margin*2),availableHeight=Math.max(0,height-margin*2);
 const lowWidth=Math.min(Math.max(0,minWidth),availableWidth),lowHeight=Math.min(Math.max(0,minHeight),availableHeight);
 return {width,height,margin,lowWidth,lowHeight,highWidth:Math.max(lowWidth,Math.min(maxWidth,availableWidth)),highHeight:Math.max(lowHeight,Math.min(maxHeight,availableHeight))};
}

export function constrainFloatingRect(rect,viewport,options={}){
 const l=limits(viewport,options),width=clamp(finite(rect.width,l.lowWidth),l.lowWidth,l.highWidth),height=clamp(finite(rect.height,l.lowHeight),l.lowHeight,l.highHeight);
 const minX=Math.min(l.margin,Math.max(0,l.width-width)),minY=Math.min(l.margin,Math.max(0,l.height-height));
 return {x:clamp(finite(rect.x,minX),minX,Math.max(minX,l.width-l.margin-width)),y:clamp(finite(rect.y,minY),minY,Math.max(minY,l.height-l.margin-height)),width,height};
}

export function initialFloatingRect(viewport,{width=560,height=560,right=24,top=88,...options}={}){
 const sized=constrainFloatingRect({x:0,y:top,width,height},viewport,options);
 return constrainFloatingRect({...sized,x:viewport.width-right-sized.width},viewport,options);
}

export function resizeFloatingRect(start,{dx=0,dy=0,direction='se'},viewport,options={}){
 const base=constrainFloatingRect(start,viewport,options),l=limits(viewport,options);
 let {x,y,width,height}=base;
 if(direction.includes('e'))width=clamp(width+dx,l.lowWidth,Math.max(l.lowWidth,Math.min(l.highWidth,l.width-l.margin-x)));
 if(direction.includes('w')){const right=x+width,nextX=clamp(x+dx,Math.max(l.margin,right-l.highWidth),right-l.lowWidth);width=right-nextX;x=nextX;}
 if(direction.includes('s'))height=clamp(height+dy,l.lowHeight,Math.max(l.lowHeight,Math.min(l.highHeight,l.height-l.margin-y)));
 if(direction.includes('n')){const bottom=y+height,nextY=clamp(y+dy,Math.max(l.margin,bottom-l.highHeight),bottom-l.lowHeight);height=bottom-nextY;y=nextY;}
 return constrainFloatingRect({x,y,width,height},viewport,options);
}

export function createWorkspace(app){
 const sidebar=app.querySelector('#workspace-sidebar');
 const windows=new Map();let sidebarView='task3',stack=0,gesture=null;
 const nav={city:app.querySelector('#open-city-model'),equipment:app.querySelector('#toggle-sensors'),task3:app.querySelector('#toggle-task3')};
 const viewport=()=>({width:window.innerWidth,height:window.innerHeight});
 const bringToFront=item=>{stack=(stack+1)%40;item.dialog.style.zIndex=String((item.id==='task3'?100:60)+stack);};
 const clearRect=dialog=>{for(const prop of RECT_PROPS)dialog.style[prop]='';dialog.classList.remove('has-custom-rect');};
 const applyRect=(item,rect)=>{
  item.rect=constrainFloatingRect(rect,viewport());const r=item.rect;
  item.dialog.classList.add('has-custom-rect');Object.assign(item.dialog.style,{left:`${r.x}px`,top:`${r.y}px`,right:'auto',bottom:'auto',width:`${r.width}px`,height:`${r.height}px`,transform:'none'});
 };
 const currentRect=dialog=>{const b=dialog.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};};
 function closeWindow(id,notify=false){
  const item=windows.get(id);if(!item?.dialog.open)return;
  item.dialog.close();item.content.hidden=true;nav[id]?.setAttribute('aria-pressed','false');item.onVisibilityChange?.(false,'close');
  if(notify){item.opener?.focus();item.onClose?.();}
 }
 function restoreWindow(id){
  const item=windows.get(id);if(!item?.dialog.open)return;
  const minimized=item.dialog.classList.contains('is-minimized');item.dialog.classList.remove('is-minimized');item.minimize.textContent='收起';item.minimize.setAttribute('aria-expanded','true');
  if(item.customized)applyRect(item,item.rect);else if(minimized)clearRect(item.dialog);
  if(minimized)item.onVisibilityChange?.(true,'restore');
  bringToFront(item);
 }
 function minimizeWindow(id){
  const item=windows.get(id);if(!item?.dialog.open)return;
  if(item.customized)item.rect=currentRect(item.dialog);
  clearRect(item.dialog);item.dialog.classList.add('is-minimized');item.minimize.textContent='展开';item.minimize.setAttribute('aria-expanded','false');
  item.minimize.focus();item.onVisibilityChange?.(false,'minimize');bringToFront(item);
 }
 function mountWindow(id,title,content,{closeId,onClose,onVisibilityChange}={}){
  const dialog=document.createElement('dialog');dialog.id=`${id}-window`;dialog.className='workspace-window';
  dialog.setAttribute('aria-labelledby',`${id}-window-title`);dialog.setAttribute('aria-modal','false');
  const bar=document.createElement('div');bar.className='window-bar';
  const heading=document.createElement('h2');heading.id=`${id}-window-title`;heading.textContent=title;
  const actions=document.createElement('div');actions.className='window-actions';
  const minimize=document.createElement('button');minimize.type='button';minimize.id=`${id}-window-minimize`;minimize.textContent='收起';minimize.setAttribute('aria-label',`收起或展开${title}窗口`);minimize.setAttribute('aria-expanded','true');
  const close=document.createElement('button');close.type='button';close.id=closeId??`${id}-window-close`;close.textContent='×';close.className='window-close';close.setAttribute('aria-label',`关闭${title}窗口`);
  actions.append(minimize,close);bar.append(heading,actions);dialog.append(bar,content);app.append(dialog);content.hidden=true;
  const item={id,dialog,content,minimize,onClose,onVisibilityChange,rect:null,customized:false};windows.set(id,item);
  for(const direction of ['n','s','w','e','nw','ne','sw','se']){const handle=document.createElement('span');handle.className=`workspace-resize-handle workspace-resize-${direction}`;handle.dataset.resize=direction;handle.setAttribute('aria-hidden','true');dialog.append(handle);}
  const endGesture=event=>{
   if(!gesture||event.pointerId!==gesture.pointerId)return;const target=gesture.target;gesture=null;
   if(target.hasPointerCapture?.(event.pointerId))target.releasePointerCapture(event.pointerId);
  };
  bar.addEventListener('pointerdown',event=>{
   if(event.button!==0||event.target.closest('button')||dialog.classList.contains('is-minimized'))return;
   const rect=currentRect(dialog);item.customized=true;item.rect=rect;gesture={kind:'move',item,pointerId:event.pointerId,target:bar,startX:event.clientX,startY:event.clientY,rect};
   bar.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();bringToFront(item);
  });
  bar.addEventListener('pointermove',event=>{
   if(gesture?.kind!=='move'||gesture.item!==item||event.pointerId!==gesture.pointerId)return;
   applyRect(item,{...gesture.rect,x:gesture.rect.x+event.clientX-gesture.startX,y:gesture.rect.y+event.clientY-gesture.startY});event.preventDefault();
  });
  bar.addEventListener('pointerup',endGesture);bar.addEventListener('pointercancel',endGesture);
  for(const handle of dialog.querySelectorAll('[data-resize]')){
   handle.addEventListener('pointerdown',event=>{
    if(event.button!==0||dialog.classList.contains('is-minimized'))return;
    const rect=currentRect(dialog);item.customized=true;item.rect=rect;gesture={kind:'resize',item,pointerId:event.pointerId,target:handle,startX:event.clientX,startY:event.clientY,rect,direction:handle.dataset.resize};
    handle.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();bringToFront(item);
   });
   handle.addEventListener('pointermove',event=>{
    if(gesture?.kind!=='resize'||gesture.item!==item||gesture.target!==handle||event.pointerId!==gesture.pointerId)return;
    applyRect(item,resizeFloatingRect(gesture.rect,{dx:event.clientX-gesture.startX,dy:event.clientY-gesture.startY,direction:gesture.direction},viewport()));event.preventDefault();event.stopPropagation();
   });
   handle.addEventListener('pointerup',endGesture);handle.addEventListener('pointercancel',endGesture);
  }
  dialog.addEventListener('pointerdown',()=>bringToFront(item));
  close.onclick=()=>closeWindow(id,true);
  minimize.onclick=()=>dialog.classList.contains('is-minimized')?restoreWindow(id):minimizeWindow(id);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeWindow(id,true);});
  return dialog;
 }
 function showWindow(id){
  const item=windows.get(id);if(!item)return;
  for(const other of windows.keys())if(other!==id)closeWindow(other);
  item.opener=document.activeElement;item.content.hidden=false;
  if(!item.dialog.open){item.dialog.setAttribute('open','');item.minimize.focus({preventScroll:true});}restoreWindow(id);nav[id]?.setAttribute('aria-pressed','true');item.onVisibilityChange?.(true,'show');
 }
 function activateView(view){
  if(view==='task3'){
   sidebarView=view;
   for(const id of windows.keys())closeWindow(id);
  }
  app.dataset.activeView=view;app.dispatchEvent(new CustomEvent('view-change',{detail:view}));
 }
 function activateSidebar(){app.querySelector(`#toggle-${sidebarView}`).click();}
 nav.city.onclick=()=>{
  if(windows.get('city')?.dialog.open){closeWindow('city');return;}
  showWindow('city');
 };
 window.addEventListener('resize',()=>{for(const item of windows.values())if(item.dialog.open&&item.customized&&!item.dialog.classList.contains('is-minimized'))applyRect(item,item.rect);});
 document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.defaultPrevented)return;
  for(const [id,item] of windows)if(item.dialog.open){event.preventDefault();closeWindow(id,true);break;}
 });
 return {sidebar,mountWindow,showWindow,closeWindow,minimizeWindow,restoreWindow,activateView,activateSidebar};
}
