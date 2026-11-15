export function createWorkspace(app){
 const sidebar=app.querySelector('#workspace-sidebar'),host=app.querySelector('#deployment-panels');
 const windows=new Map(),panels=new Map();let sidebarView='task3';
 const nav={city:app.querySelector('#open-city-model'),equipment:app.querySelector('#toggle-sensors'),deployment:app.querySelector('#toggle-deployment')};
 function closeWindow(id,notify=false){
  const item=windows.get(id);if(!item?.dialog.open)return;
  item.dialog.close();item.content.hidden=true;nav[id]?.setAttribute('aria-pressed','false');
  item.onClose?.();
  if(notify)item.opener?.focus();
 }
 function minimizeWindow(id){
  const item=windows.get(id);if(!item?.dialog.open)return;
  if(item.custom)item.rect={left:item.dialog.style.left,top:item.dialog.style.top,width:item.dialog.style.width,height:item.dialog.style.height};
  item.dialog.style.left=item.dialog.style.top=item.dialog.style.width=item.dialog.style.height=item.dialog.style.transform=item.dialog.style.inset='';
  item.dialog.classList.add('is-minimized');item.minimize.textContent='展开';item.minimize.setAttribute('aria-expanded','false');
  item.minimize.focus();
 }
 function restoreWindow(id){
  const item=windows.get(id);if(!item?.dialog.open)return;
  item.dialog.classList.remove('is-minimized');
  if(item.rect){const {dialog}=item;dialog.style.inset='auto';dialog.style.transform='none';dialog.style.left=item.rect.left;dialog.style.top=item.rect.top;dialog.style.width=item.rect.width;dialog.style.height=item.rect.height;}
  item.minimize.textContent='收起';item.minimize.setAttribute('aria-expanded','true');
 }
 function toPixels(item){
  if(item.custom)return;
  const {dialog}=item,rect=dialog.getBoundingClientRect();
  dialog.style.inset='auto';dialog.style.transform='none';
  dialog.style.left=`${rect.left}px`;dialog.style.top=`${rect.top}px`;dialog.style.width=`${rect.width}px`;dialog.style.height=`${rect.height}px`;
  item.custom=true;
 }
 function makeMovable(item,bar,handle){
  const {dialog}=item;
  const startDrag=(event,resize)=>{
   if(event.button!==0)return;
   if(!resize&&(event.target.closest('button')))return;
   if(dialog.classList.contains('is-minimized'))return;
   event.preventDefault();toPixels(item);
   const rect=dialog.getBoundingClientRect(),left=rect.left,top=rect.top,width=rect.width,height=rect.height;
   const startX=event.clientX,startY=event.clientY,pointerId=event.pointerId,target=event.currentTarget;
   target.setPointerCapture(pointerId);
   const move=ev=>{
    if(resize){
     const w=Math.max(420,Math.min(width+ev.clientX-startX,innerWidth-left-8));
     const h=Math.max(260,Math.min(height+ev.clientY-startY,innerHeight-top-8));
     dialog.style.width=`${w}px`;dialog.style.height=`${h}px`;
    }else{
     const x=Math.min(Math.max(left+ev.clientX-startX,120-dialog.offsetWidth),innerWidth-120);
     const y=Math.min(Math.max(top+ev.clientY-startY,0),innerHeight-52);
     dialog.style.left=`${x}px`;dialog.style.top=`${y}px`;
    }
   };
   const end=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);if(target.hasPointerCapture(pointerId))target.releasePointerCapture(pointerId);};
   target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);
  };
  bar.addEventListener('pointerdown',event=>startDrag(event,false));
  handle.addEventListener('pointerdown',event=>startDrag(event,true));
 }
 function mountWindow(id,title,content,{closeId,onClose,closable=true}={}){
  const dialog=document.createElement('dialog');dialog.id=`${id}-window`;dialog.className='workspace-window';
  dialog.setAttribute('aria-labelledby',`${id}-window-title`);dialog.setAttribute('aria-modal','false');
  const bar=document.createElement('div');bar.className='window-bar';
  const heading=document.createElement('h2');heading.id=`${id}-window-title`;heading.textContent=title;
  const actions=document.createElement('div');actions.className='window-actions';
  const minimize=document.createElement('button');minimize.type='button';minimize.id=`${id}-window-minimize`;minimize.textContent='收起';minimize.setAttribute('aria-label',`收起或展开${title}窗口`);minimize.setAttribute('aria-expanded','true');
  actions.append(minimize);
  let close=null;
  if(closable){close=document.createElement('button');close.type='button';close.id=closeId??`${id}-window-close`;close.textContent='×';close.className='window-close';close.setAttribute('aria-label',`关闭${title}窗口`);actions.append(close);}
  const watermark=document.createElement('div');watermark.className='window-watermark';watermark.setAttribute('aria-hidden','true');
  const resizeHandle=document.createElement('div');resizeHandle.className='window-resize';resizeHandle.setAttribute('aria-hidden','true');
  bar.append(heading,actions);dialog.append(bar,content,watermark,resizeHandle);app.append(dialog);content.hidden=true;
  const item={dialog,content,minimize,onClose,custom:false,rect:null};
  windows.set(id,item);
  if(close)close.onclick=()=>closeWindow(id,true);
  minimize.onclick=()=>dialog.classList.contains('is-minimized')?restoreWindow(id):minimizeWindow(id);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeWindow(id,true);});
  makeMovable(item,bar,resizeHandle);
  return dialog;
 }
 function showWindow(id){
  const item=windows.get(id);if(!item)return;
  for(const other of windows.keys())if(other!==id)closeWindow(other);
  item.opener=document.activeElement;item.content.hidden=false;
  if(!item.dialog.open)item.dialog.show();restoreWindow(id);nav[id]?.setAttribute('aria-pressed','true');
 }
 function activateView(view){
  if(view==='task3'){
   sidebarView=view;
   for(const [name,panel] of panels)panel.hidden=name!==view;
   const tab=app.querySelector(`#toggle-${view}`);
   if(tab){tab.setAttribute('aria-selected','true');tab.tabIndex=0;}
   for(const id of windows.keys())if(id!=='deployment')closeWindow(id);
  }
  app.dataset.activeView=view;app.dispatchEvent(new CustomEvent('view-change',{detail:view}));
 }
 function activateSidebar(){app.querySelector(`#toggle-${sidebarView}`).click();}
 function mountSidebarPanel(panel,name){
  panels.set(name,panel);panel.hidden=name!==sidebarView;host.append(panel);
  panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',`toggle-${name}`);
  app.querySelector(`#toggle-${name}`).disabled=false;
  app.querySelector('#deployment-loading')?.remove();
 }
 nav.city.onclick=()=>{
  if(windows.get('city')?.dialog.open){closeWindow('city');return;}
  if(windows.get('equipment')?.dialog.open){closeWindow('equipment');activateSidebar();}
  showWindow('city');
 };
 app.querySelector('.deployment-tabs').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const tabs=[...app.querySelectorAll('.deployment-tabs button:not(:disabled)')];if(!tabs.length)return;
  const index=tabs.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  event.preventDefault();tabs[next].click();tabs[next].focus();
 });
 document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.defaultPrevented)return;
  for(const [id,item] of windows)if(item.dialog.open){event.preventDefault();closeWindow(id,true);break;}
 });
 return {sidebar,mountWindow,showWindow,closeWindow,minimizeWindow,restoreWindow,mountSidebarPanel,activateView,activateSidebar};
}
