import * as THREE from 'three';

const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

export function constrainDeviceHoverPosition(pointer,card,viewport,{offset=14,margin=8}={}){
 const width=Math.max(0,viewport.width),height=Math.max(0,viewport.height);
 const cardWidth=Math.min(card.width,Math.max(0,width-margin*2)),cardHeight=Math.min(card.height,Math.max(0,height-margin*2));
 const minX=Math.min(margin,Math.max(0,width-cardWidth)),minY=Math.min(margin,Math.max(0,height-cardHeight));
 const maxX=Math.max(minX,width-margin-cardWidth),maxY=Math.max(minY,height-margin-cardHeight);
 let x=pointer.x+offset,y=pointer.y+offset;
 if(x+cardWidth>width-margin)x=pointer.x-offset-cardWidth;
 if(y+cardHeight>height-margin)y=pointer.y-offset-cardHeight;
 return {x:clamp(x,minX,maxX),y:clamp(y,minY,maxY)};
}

export function pickDeviceTarget({camera,targets,ndc,raycaster=new THREE.Raycaster()}){
 raycaster.setFromCamera(ndc,camera);
 return raycaster.intersectObjects(targets.filter(target=>target?.visible&&target.userData?.deviceId),false)[0]?.object??null;
}

function renderDetails(documentRef,title,list,details){
 title.textContent=details.title??details.displayName??'设备详情';
 list.replaceChildren(...(details.rows??[]).map(({label,value})=>{
  const row=documentRef.createElement('div'),dt=documentRef.createElement('dt'),dd=documentRef.createElement('dd');
  dt.textContent=label;dd.textContent=value===null||value===undefined||value===''?'未提供':String(value);row.append(dt,dd);return row;
 }));
}

export function createDeviceHover({canvas,camera,controls,container=canvas?.parentElement,getTargets=()=>[],getDetails=()=>null,isEnabled=()=>true,pinActions,documentRef=globalThis.document,requestFrame=globalThis.requestAnimationFrame?.bind(globalThis),cancelFrame=globalThis.cancelAnimationFrame?.bind(globalThis)}={}){
 if(!canvas||!camera||!container||!documentRef||!requestFrame||!cancelFrame)throw Error('设备悬停缺少画布、相机、容器或帧调度器');
 const card=documentRef.createElement('section'),title=documentRef.createElement('h2'),list=documentRef.createElement('dl');
 card.id='task3-device-hover';card.className='task3-device-hover';card.hidden=true;card.setAttribute('role','tooltip');card.setAttribute('aria-hidden','true');
 title.className='task3-device-hover-title';list.className='task3-device-hover-list';card.append(title,list);container.append(card);
 const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2();
 let pointer=null,frameId=null,activeDeviceId=null,destroyed=false;
 const viewportWindow=documentRef.defaultView;
 let pinned=null,press=null,pinCard=null,pinTitle,pinList;
 const projected=new THREE.Vector3();
 const cancelPending=()=>{if(frameId!==null)cancelFrame(frameId);frameId=null;};
 const hide=()=>{cancelPending();pointer=null;activeDeviceId=null;card.hidden=true;card.setAttribute('aria-hidden','true');delete card.dataset.deviceId;canvas.style.cursor='';};
 function targetAt({clientX,clientY}){
  const rect=canvas.getBoundingClientRect();
  if(!rect.width||!rect.height||clientX<rect.left||clientX>rect.right||clientY<rect.top||clientY>rect.bottom)return null;
  ndc.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
  return pickDeviceTarget({camera,targets:getTargets(),ndc,raycaster});
 }
 const detailsFor=target=>getDetails({deviceId:target.userData.deviceId,deployment:target.userData.deployment??null,object:target});
 function closePin(){
  press=null;
  if(!pinned)return;
  pinned=null;pinCard.hidden=true;delete pinCard.dataset.deviceId;
  pinActions.onChange?.();
 }
 function placePin(){
  if(!pinned)return;
  camera.updateMatrixWorld();pinned.getWorldPosition(projected).project(camera);
  const bounds=container.getBoundingClientRect(),rect=canvas.getBoundingClientRect(),width=container.clientWidth||bounds.width,height=container.clientHeight||bounds.height;
  const reservedBottom=pinActions.getBottom?.();
  const safeHeight=Number.isFinite(reservedBottom)?Math.max(0,Math.min(height,reservedBottom-bounds.top)):height;
  pinCard.style.maxHeight=`${Math.max(0,Math.min(430,Math.floor(safeHeight/2)-36))}px`;
  const size={width:pinCard.offsetWidth,height:pinCard.offsetHeight};
  const visible=projected.z>=-1&&projected.z<=1&&Math.abs(projected.x)<=1&&Math.abs(projected.y)<=1;
  const position=visible?constrainDeviceHoverPosition(
   {x:rect.left-bounds.left+(projected.x+1)*rect.width/2,y:rect.top-bounds.top+(1-projected.y)*rect.height/2},
   size,{width,height:safeHeight},{offset:28,margin:10},
  ):{x:Math.max(10,width-size.width-10),y:10};
  pinCard.style.left=`${Math.round(position.x)}px`;pinCard.style.top=`${Math.round(position.y)}px`;
 }
 function selectPin(target){
  const details=target&&detailsFor(target);
  if(!details){closePin();return;}
  hide();
  pinned=target;pinCard.dataset.deviceId=pinned.userData.deviceId;
  renderDetails(documentRef,pinTitle,pinList,details);pinCard.hidden=false;placePin();
  pinActions.onChange?.();
 }
 const canPin=()=>isEnabled()&&pinActions.canPin?.()!==false;
 function pressStart(event){
  if(press||event.isPrimary===false||event.button!==0){press=null;return;}
  if(canPin())press={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
 }
 function trackPress(event){
  if(press?.id===event.pointerId&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>5)press.moved=true;
 }
 function finishPress(event){
  if(!press||press.id!==event.pointerId)return;
  trackPress(event);
  const moved=press.moved;press=null;
  if(!moved&&canPin()&&documentRef.elementFromPoint(event.clientX,event.clientY)===canvas)selectPin(targetAt(event));
 }
 const cancelPress=()=>{press=null;};
 function keyDown(event){
  if(pinned&&event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();closePin();}
 }
 let resizeObserver=null;
 if(pinActions&&viewportWindow){
  pinCard=documentRef.createElement('section');
  pinCard.id='task3-device-info';pinCard.className='task3-device-hover task3-device-pin';pinCard.hidden=true;
  pinCard.setAttribute('role','region');pinCard.setAttribute('aria-labelledby','task3-device-info-title');
  const heading=documentRef.createElement('div');heading.className='task3-device-pin-heading';
  pinTitle=documentRef.createElement('h2');pinTitle.id='task3-device-info-title';pinTitle.className='task3-device-hover-title';
  const close=documentRef.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','关闭设备信息');close.onclick=closePin;
  heading.append(pinTitle,close);
  pinList=documentRef.createElement('dl');pinList.className='task3-device-hover-list task3-device-pin-body';pinList.tabIndex=0;pinList.setAttribute('aria-label','设备详情');
  const actions=documentRef.createElement('div');actions.className='task3-device-pin-actions';
  for(const [label,handler] of [['设备仿真',pinActions.simulate],['定位设备',pinActions.locate]]){
   if(!handler)continue;
   const button=documentRef.createElement('button');button.type='button';button.textContent=label;
   button.onclick=()=>{if(pinned)handler(pinned);};actions.append(button);
  }
  pinCard.append(heading,pinList,actions);container.append(pinCard);
  canvas.addEventListener('pointerdown',pressStart);
  viewportWindow.addEventListener('pointermove',trackPress,true);
  viewportWindow.addEventListener('pointerup',finishPress,true);
  viewportWindow.addEventListener('pointercancel',cancelPress,true);
  viewportWindow.addEventListener('blur',cancelPress);
  viewportWindow.addEventListener('keydown',keyDown,true);
  controls?.addEventListener('change',placePin);
  if(typeof viewportWindow.ResizeObserver==='function'){resizeObserver=new viewportWindow.ResizeObserver(placePin);resizeObserver.observe(container);}
 }
 const render=()=>{
  frameId=null;if(destroyed||!pointer||pinned||!isEnabled()){hide();return;}
  const {clientX,clientY}=pointer,target=targetAt(pointer);
  if(!target){hide();return;}
  const deviceId=target.userData.deviceId,details=detailsFor(target);
  if(!details){hide();return;}
  renderDetails(documentRef,title,list,details);
  activeDeviceId=deviceId;card.dataset.deviceId=deviceId;card.hidden=false;card.setAttribute('aria-hidden','false');canvas.style.cursor='pointer';
  const bounds=container.getBoundingClientRect(),position=constrainDeviceHoverPosition(
   {x:clientX-bounds.left,y:clientY-bounds.top},
   {width:card.offsetWidth,height:card.offsetHeight},
   {width:container.clientWidth||bounds.width,height:container.clientHeight||bounds.height},
  );
  card.style.left=`${position.x}px`;card.style.top=`${position.y}px`;
 };
 const onPointerMove=event=>{
  if(event.buttons||pinned){hide();return;}
  pointer={clientX:event.clientX,clientY:event.clientY};if(frameId===null)frameId=requestFrame(render);
 };
 const onPointerDown=()=>hide();
 container.addEventListener('pointermove',onPointerMove);container.addEventListener('pointerleave',hide);container.addEventListener('pointercancel',hide);container.addEventListener('pointerdown',onPointerDown);container.addEventListener('wheel',hide,{passive:true});
 return {
  element:card,hide,closePin,
  get activeDeviceId(){return activeDeviceId;},
  get pinnedDeviceId(){return pinned?.userData.deviceId??null;},
  destroy(){
   if(destroyed)return;
   destroyed=true;hide();closePin();
   container.removeEventListener('pointermove',onPointerMove);container.removeEventListener('pointerleave',hide);container.removeEventListener('pointercancel',hide);container.removeEventListener('pointerdown',onPointerDown);container.removeEventListener('wheel',hide);card.remove();
   if(!pinCard)return;
   resizeObserver?.disconnect();controls?.removeEventListener('change',placePin);
   canvas.removeEventListener('pointerdown',pressStart);
   viewportWindow.removeEventListener('pointermove',trackPress,true);viewportWindow.removeEventListener('pointerup',finishPress,true);
   viewportWindow.removeEventListener('pointercancel',cancelPress,true);viewportWindow.removeEventListener('blur',cancelPress);
   viewportWindow.removeEventListener('keydown',keyDown,true);pinCard.remove();
  },
 };
}
