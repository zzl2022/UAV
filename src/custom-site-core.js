import * as THREE from 'three';
import {requestCustomSites} from './custom-sites.js';
import {buildingAtFace} from './model.js';
import {siteCoreBuildings} from './site-analysis.js';

const DEFAULT_NAME='核心建筑';
const SELECTION_LIMIT=50;
const PICK_DISTANCE=5;

export function mountCustomSiteCore({app,canvas,camera,getActiveSite,setPicking,renderDraft,onSaved,announce}){
  const button=app.querySelector('#select-core-buildings');
  const select=app.querySelector('#model-select');
  const panel=document.createElement('section');
  panel.id='custom-core-panel';
  panel.hidden=true;
  panel.setAttribute('aria-labelledby','custom-core-title');
  panel.innerHTML=`
    <h2 id="custom-core-title">选择核心建筑</h2>
    <form novalidate>
      <label for="custom-core-name">核心建筑名称</label>
      <input id="custom-core-name" type="text" required>
      <p id="custom-core-count"></p>
      <p id="custom-core-status" role="status" aria-live="polite"></p>
      <div class="custom-site-actions">
        <button type="submit">保存</button>
        <button type="button" data-cancel>取消</button>
        <button type="button" data-clear>清除核心建筑</button>
      </div>
    </form>`;
  app.append(panel);
  const form=panel.querySelector('form'),name=panel.querySelector('#custom-core-name');
  const status=panel.querySelector('#custom-core-status'),count=panel.querySelector('#custom-core-count');
  const submit=panel.querySelector('[type=submit]'),cancel=panel.querySelector('[data-cancel]'),clear=panel.querySelector('[data-clear]');
  const ray=new THREE.Raycaster(),screenPoint=new THREE.Vector2();
  ray.firstHitOnly=true;
  let draft=null,gesture=null,submitting=false;

  function refresh(){
    const site=getActiveSite();
    const existing=siteCoreBuildings(site?.meta);
    button.disabled=!site||select.disabled||!!draft;
    button.title=site?'':'内置模型的核心建筑由模型元数据固定';
    button.textContent=existing.length?'修改核心建筑':'选择核心建筑';
  }

  function message(text,error=false){
    status.textContent=text;
    status.dataset.error=String(error);
  }

  function syncSelection(){
    count.textContent=`已选 ${draft.selection.size} 栋建筑`;
    submit.disabled=submitting||draft.selection.size===0;
    clear.disabled=submitting||(!draft.hadSelection&&!draft.selection.size);
    renderDraft([...draft.selection.values()]);
  }

  function open(){
    const site=getActiveSite();
    if(!site||select.disabled||draft)return;
    if(!site.parts.buildings.visible){announce('请先在场景图层中打开建筑。');return;}
    if(!setPicking(true)){announce('请先完成当前地图选点。');return;}
    const existing=siteCoreBuildings(site.meta);
    draft={...site,hadSelection:existing.length>0,selection:new Map(existing.map(core=>[core.id,core])),
      cursor:canvas.style.cursor};
    canvas.style.cursor='crosshair';
    app.classList.add('custom-core-picking');
    panel.hidden=false;
    name.value=site.meta.coreName??existing[0]?.name??DEFAULT_NAME;
    message('点击建筑加入核心区，再次点击取消。拖动地图可调整视角。');
    syncSelection();refresh();name.focus({preventScroll:true});
  }

  function close(){
    if(!draft||submitting)return;
    canvas.style.cursor=draft.cursor;
    gesture=null;draft=null;
    app.classList.remove('custom-core-picking');
    panel.hidden=true;
    renderDraft([]);
    setPicking(false);
    refresh();button.focus({preventScroll:true});
  }

  function pick(event){
    if(!draft.parts.buildings.visible||document.elementFromPoint(event.clientX,event.clientY)!==canvas)return null;
    const rect=canvas.getBoundingClientRect();
    screenPoint.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
    camera.updateMatrixWorld();
    ray.setFromCamera(screenPoint,camera);
    const hit=ray.intersectObject(draft.parts.buildings)[0];
    return hit?buildingAtFace(draft.parts.ranges,hit.faceIndex):null;
  }

  canvas.addEventListener('pointerdown',event=>{
    if(!draft||submitting||!event.isPrimary||event.button!==0)return;
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
  },true);
  window.addEventListener('pointermove',event=>{
    if(gesture?.id===event.pointerId&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>PICK_DISTANCE){
      gesture.moved=true;
    }
  },true);
  window.addEventListener('pointerup',event=>{
    if(gesture?.id!==event.pointerId)return;
    const {x,y,moved}=gesture;gesture=null;
    if(!draft||submitting||moved||Math.hypot(event.clientX-x,event.clientY-y)>PICK_DISTANCE)return;
    const building=pick(event);
    if(!building){message('此处未选中建筑，请单击当前模型的屋顶或立面。');return;}
    if(draft.selection.has(building.id)){
      draft.selection.delete(building.id);
      message(`已取消选择 ${building.name}。`);
    }else{
      if(draft.selection.size>=SELECTION_LIMIT){message('最多可选择 50 栋核心建筑。',true);return;}
      draft.selection.set(building.id,building);
      message(`已选择 ${building.name}，再次点击可取消。`);
    }
    syncSelection();
  },true);
  window.addEventListener('pointercancel',event=>{if(gesture?.id===event.pointerId)gesture=null;},true);
  window.addEventListener('blur',()=>{gesture=null;});
  window.addEventListener('keydown',event=>{
    if(!draft||event.key!=='Escape')return;
    event.preventDefault();
    event.stopPropagation();
    close();
  },true);

  async function save(buildingIds,coreName){
    const {slug}=draft;
    submitting=true;syncSelection();
    name.disabled=true;cancel.disabled=true;
    message('正在保存核心建筑…');
    let result;
    try{
      result=await requestCustomSites(`/${slug}/core`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:coreName,buildingIds}),
      });
    }catch(error){message(error.message,true);}
    finally{
      submitting=false;name.disabled=false;cancel.disabled=false;syncSelection();
    }
    if(result){
      onSaved(slug,result.metadata);
      close();
      announce(buildingIds.length?`核心建筑已保存（${buildingIds.length} 栋）：${result.metadata.coreName}`:'已清除核心建筑。');
    }
  }
  form.onsubmit=event=>{
    event.preventDefault();
    if(!draft||submitting||!draft.selection.size)return;
    const trimmed=name.value.trim();
    if(!trimmed||[...trimmed].length>24||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name.value)){
      message('核心建筑名称需为 1–24 个字符，且不能包含控制字符。',true);
      name.focus();
      return;
    }
    void save([...draft.selection.keys()],trimmed);
  };
  clear.onclick=()=>{
    if(draft&&!submitting&&window.confirm('清除该模型已保存的全部核心建筑？'))void save([],DEFAULT_NAME);
  };
  cancel.onclick=close;
  button.onclick=open;
  new MutationObserver(refresh).observe(select,{attributes:true,attributeFilter:['disabled']});
  refresh();
  return {refresh,close,get busy(){return submitting;}};
}
