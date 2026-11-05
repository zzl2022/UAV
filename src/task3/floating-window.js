// 任务三独立非模态浮窗：内容节点关闭时仅隐藏而不销毁。
import {constrainFloatingRect,initialFloatingRect,resizeFloatingRect} from '../workspace.js';

export {constrainFloatingRect,initialFloatingRect,resizeFloatingRect};

export function createFloatingWindow({container,id,title,content,width=560,height=560,minWidth=320,minHeight=240,maxWidth=Infinity,maxHeight=Infinity,returnFocus=null,onOpen=null,onClose=null}={}){
 if(!container||!id||!title)throw Error('浮窗缺少容器、ID 或标题');
 const root=document.createElement('section'),titleId=`${id}-title`;
 root.id=id;root.className='task3-floating-window';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','false');root.setAttribute('aria-labelledby',titleId);
 const header=document.createElement('div');header.className='task3-floating-header';
 const heading=document.createElement('h2');heading.id=titleId;heading.textContent=title;
 const closeButton=document.createElement('button');closeButton.type='button';closeButton.className='task3-floating-close';closeButton.textContent='×';closeButton.setAttribute('aria-label',`关闭${title}`);
 header.append(heading,closeButton);
 const body=document.createElement('div');body.className='task3-floating-body';if(content)body.append(content);
 root.append(header,body);
 for(const direction of ['n','s','w','e','nw','ne','sw','se']){const handle=document.createElement('span');handle.className=`task3-resize-handle task3-resize-${direction}`;handle.dataset.resize=direction;handle.setAttribute('aria-hidden','true');root.append(handle);}
 container.append(root);
 const options={minWidth,minHeight,maxWidth,maxHeight};
 let rect=null,open=false,gesture=null;
 const viewport=()=>({width:window.innerWidth,height:window.innerHeight});
 const apply=()=>{if(!rect)return;Object.assign(root.style,{left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`});};
 const bringToFront=()=>{const current=Number(root.dataset.zIndex??1);const z=Math.max(current,createFloatingWindow.topZ)+1;createFloatingWindow.topZ=z;root.dataset.zIndex=String(z);root.style.zIndex=String(z);};
 const fit=()=>{if(rect){rect=constrainFloatingRect(rect,viewport(),options);apply();}};
 const show=()=>{
  rect=rect?constrainFloatingRect(rect,viewport(),options):initialFloatingRect(viewport(),{width,height,...options});
  open=true;root.hidden=false;apply();bringToFront();onOpen?.();closeButton.focus({preventScroll:true});
 };
 const hide=()=>{
  if(!open)return;open=false;root.hidden=true;onClose?.();
  if(root.contains(document.activeElement))returnFocus?.focus({preventScroll:true});
 };
 const endGesture=event=>{
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  const target=gesture.target;gesture=null;
  if(target.hasPointerCapture?.(event.pointerId))target.releasePointerCapture(event.pointerId);
 };
 header.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.target.closest('button'))return;
  fit();gesture={kind:'move',pointerId:event.pointerId,target:header,startX:event.clientX,startY:event.clientY,rect:{...rect}};
  header.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();bringToFront();
 });
 header.addEventListener('pointermove',event=>{
  if(gesture?.kind!=='move'||event.pointerId!==gesture.pointerId)return;
  rect=constrainFloatingRect({...gesture.rect,x:gesture.rect.x+event.clientX-gesture.startX,y:gesture.rect.y+event.clientY-gesture.startY},viewport(),options);apply();event.preventDefault();
 });
 header.addEventListener('pointerup',endGesture);header.addEventListener('pointercancel',endGesture);
 for(const handle of root.querySelectorAll('[data-resize]')){
  handle.addEventListener('pointerdown',event=>{
   if(event.button!==0)return;fit();gesture={kind:'resize',pointerId:event.pointerId,target:handle,startX:event.clientX,startY:event.clientY,rect:{...rect},direction:handle.dataset.resize};
   handle.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();bringToFront();
  });
  handle.addEventListener('pointermove',event=>{
   if(gesture?.kind!=='resize'||event.pointerId!==gesture.pointerId||gesture.target!==handle)return;
   rect=resizeFloatingRect(gesture.rect,{dx:event.clientX-gesture.startX,dy:event.clientY-gesture.startY,direction:gesture.direction},viewport(),options);apply();event.preventDefault();event.stopPropagation();
  });
  handle.addEventListener('pointerup',endGesture);handle.addEventListener('pointercancel',endGesture);
 }
 closeButton.addEventListener('click',hide);
 root.addEventListener('pointerdown',bringToFront);
 root.addEventListener('keydown',event=>{if(event.key==='Escape'){hide();event.stopPropagation();}});
 window.addEventListener('resize',fit);
 return {element:root,body,open:show,close:hide,toggle:()=>open?hide():show(),bringToFront,destroy:()=>{window.removeEventListener('resize',fit);root.remove();},get isOpen(){return open;}};
}
createFloatingWindow.topZ=1;
