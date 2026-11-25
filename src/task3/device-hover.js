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

// 通用设备悬停：调用方只提供设备网格和详情；网格通过 deviceId/deployment 绑定，固定与移动设备均可复用。
export function createDeviceHover({canvas,camera,container=canvas?.parentElement,getTargets=()=>[],getDetails=()=>null,isEnabled=()=>true,documentRef=globalThis.document,requestFrame=globalThis.requestAnimationFrame?.bind(globalThis),cancelFrame=globalThis.cancelAnimationFrame?.bind(globalThis)}={}){
 if(!canvas||!camera||!container||!documentRef||!requestFrame||!cancelFrame)throw Error('设备悬停缺少画布、相机、容器或帧调度器');
 const card=documentRef.createElement('section'),title=documentRef.createElement('h2'),list=documentRef.createElement('dl');
 card.id='task3-device-hover';card.className='task3-device-hover';card.hidden=true;card.setAttribute('role','tooltip');card.setAttribute('aria-hidden','true');
 title.className='task3-device-hover-title';list.className='task3-device-hover-list';card.append(title,list);container.append(card);
 const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2();
 let pointer=null,frameId=null,activeDeviceId=null,destroyed=false;
 const cancelPending=()=>{if(frameId!==null)cancelFrame(frameId);frameId=null;};
 const hide=()=>{cancelPending();pointer=null;activeDeviceId=null;card.hidden=true;card.setAttribute('aria-hidden','true');delete card.dataset.deviceId;canvas.style.cursor='';};
 const render=()=>{
  frameId=null;if(destroyed||!pointer||!isEnabled()){hide();return;}
  const rect=canvas.getBoundingClientRect(),{clientX,clientY}=pointer;
  if(!rect.width||!rect.height||clientX<rect.left||clientX>rect.right||clientY<rect.top||clientY>rect.bottom){hide();return;}
  ndc.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
  const target=pickDeviceTarget({camera,targets:getTargets(),ndc,raycaster});
  if(!target){hide();return;}
  const deviceId=target.userData.deviceId,details=getDetails({deviceId,deployment:target.userData.deployment??null,object:target});
  if(!details){hide();return;}
  title.textContent=details.title??details.displayName??'设备详情';
  list.replaceChildren(...(details.rows??[]).map(({label,value})=>{
   const row=documentRef.createElement('div'),dt=documentRef.createElement('dt'),dd=documentRef.createElement('dd');
   dt.textContent=label;dd.textContent=value===null||value===undefined||value===''?'未提供':String(value);row.append(dt,dd);return row;
  }));
  activeDeviceId=deviceId;card.dataset.deviceId=deviceId;card.hidden=false;card.setAttribute('aria-hidden','false');canvas.style.cursor='pointer';
  const bounds=container.getBoundingClientRect(),position=constrainDeviceHoverPosition(
   {x:clientX-bounds.left,y:clientY-bounds.top},
   {width:card.offsetWidth,height:card.offsetHeight},
   {width:container.clientWidth||bounds.width,height:container.clientHeight||bounds.height},
  );
  card.style.left=`${position.x}px`;card.style.top=`${position.y}px`;
 };
 const onPointerMove=event=>{
  if(event.buttons){hide();return;}
  pointer={clientX:event.clientX,clientY:event.clientY};if(frameId===null)frameId=requestFrame(render);
 };
 const onPointerDown=()=>hide();
 container.addEventListener('pointermove',onPointerMove);container.addEventListener('pointerleave',hide);container.addEventListener('pointercancel',hide);container.addEventListener('pointerdown',onPointerDown);container.addEventListener('wheel',hide,{passive:true});
 return {
  element:card,hide,
  get activeDeviceId(){return activeDeviceId;},
  destroy(){if(destroyed)return;destroyed=true;hide();container.removeEventListener('pointermove',onPointerMove);container.removeEventListener('pointerleave',hide);container.removeEventListener('pointercancel',hide);container.removeEventListener('pointerdown',onPointerDown);container.removeEventListener('wheel',hide);card.remove();},
 };
}
