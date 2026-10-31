export function createWorkspace(app){
 const sidebar=app.querySelector('#workspace-sidebar'),host=app.querySelector('#deployment-panels');
 const windows=new Map(),panels=new Map();let sidebarView='task3';
 const nav={city:app.querySelector('#open-city-model'),equipment:app.querySelector('#toggle-sensors')};
 function closeWindow(id,notify=false){
  const item=windows.get(id);if(!item?.dialog.open)return;
  item.dialog.close();item.content.hidden=true;nav[id]?.setAttribute('aria-pressed','false');
  if(notify){item.opener?.focus();item.onClose?.();}
 }
 function restoreWindow(id){
  const item=windows.get(id);if(!item?.dialog.open)return;
  item.dialog.classList.remove('is-minimized');item.minimize.textContent='收起';item.minimize.setAttribute('aria-expanded','true');
 }
 function minimizeWindow(id){
  const item=windows.get(id);if(!item?.dialog.open)return;
  item.dialog.classList.add('is-minimized');item.minimize.textContent='展开';item.minimize.setAttribute('aria-expanded','false');
  item.minimize.focus();
 }
 function mountWindow(id,title,content,{closeId,onClose}={}){
  const dialog=document.createElement('dialog');dialog.id=`${id}-window`;dialog.className='workspace-window';
  dialog.setAttribute('aria-labelledby',`${id}-window-title`);dialog.setAttribute('aria-modal','false');
  const bar=document.createElement('div');bar.className='window-bar';
  const heading=document.createElement('h2');heading.id=`${id}-window-title`;heading.textContent=title;
  const actions=document.createElement('div');actions.className='window-actions';
  const minimize=document.createElement('button');minimize.type='button';minimize.id=`${id}-window-minimize`;minimize.textContent='收起';minimize.setAttribute('aria-label',`收起或展开${title}窗口`);minimize.setAttribute('aria-expanded','true');
  const close=document.createElement('button');close.type='button';close.id=closeId??`${id}-window-close`;close.textContent='×';close.className='window-close';close.setAttribute('aria-label',`关闭${title}窗口`);
  actions.append(minimize,close);bar.append(heading,actions);dialog.append(bar,content);app.append(dialog);content.hidden=true;
  windows.set(id,{dialog,content,minimize,onClose});
  close.onclick=()=>closeWindow(id,true);
  minimize.onclick=()=>dialog.classList.contains('is-minimized')?restoreWindow(id):minimizeWindow(id);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeWindow(id,true);});
  return dialog;
 }
 function showWindow(id){
  const item=windows.get(id);if(!item)return;
  for(const other of windows.keys())if(other!==id)closeWindow(other);
  item.opener=document.activeElement;item.content.hidden=false;
  if(!item.dialog.open)item.dialog.show();restoreWindow(id);nav[id]?.setAttribute('aria-pressed','true');
 }
 function activateView(view){
  if(view==='planning'||view==='task3'){
   sidebarView=view;
   for(const [name,panel] of panels)panel.hidden=name!==view;
   for(const name of ['planning','task3']){const tab=app.querySelector(`#toggle-${name}`);tab.setAttribute('aria-selected',String(name===view));tab.tabIndex=name===view?0:-1;}
   for(const id of windows.keys())closeWindow(id);
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
