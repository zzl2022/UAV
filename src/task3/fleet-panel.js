export function mountFleetPanel(pane,getState,startMobile){
 const section=document.createElement('section');pane.append(section);
 section.innerHTML=`<button type="button" aria-expanded="false" id="task3-daily-toggle">日常部署</button>
 <div hidden><label>可用警车数量 / 辆<input type="number" min="0" step="1" inputmode="numeric"></label>
 <button type="button" class="fleet-compute" hidden>计算当前工况</button><p class="hint">按当前地图和工况，估算有限车辆同时驻点能覆盖的采样点数。</p><p role="status"></p></div>`;
 const button=section.querySelector('button'),body=button.nextElementSibling,input=body.querySelector('input'),status=body.querySelector('[role=status]');
 const compute=body.querySelector('.fleet-compute');
 let worker=null,previous=null,timer=null,estimate=null;
 function remember(available,used,covered,total){
  const {planId,runId,condition,summary}=getState();
  estimate={planId,runId,conditionId:condition,summary,available,used,covered,total};
 }
 function getEstimate(){
  const state=getState();
  if(!state.fresh||!estimate||estimate.runId!==state.runId||estimate.planId!==state.planId||estimate.conditionId!==state.condition||estimate.summary!==state.summary||estimate.available!==input.valueAsNumber)return null;
  const {summary,...record}=estimate;return record;
 }
 function stop(){worker?.terminate();worker=null;clearTimeout(timer);}
 function refresh(prepare=false){
  const {summary,fresh,pending,condition,name,blindCount}=getState();
  const value=input.valueAsNumber;
  if(previous&&previous.summary===summary&&previous.fresh===fresh&&previous.pending===pending&&previous.condition===condition&&previous.name===name&&previous.raw===input.value&&!prepare)return;
  stop();previous={summary,fresh,pending,condition,name,raw:input.value};compute.hidden=true;
  if(body.hidden)return;
  if(pending){status.textContent='正在复核当前工况的车辆覆盖。';return;}
  if(!fresh){status.textContent='请先用当前参数生成方案。';return;}
  if(!Number.isSafeInteger(value)||value<0){status.textContent='请输入非负整数。';return;}
  if(value===0){const total=summary?.conditionId===condition?summary.beforeBlindCount:blindCount;remember(0,0,0,total);status.textContent=`${name} · 可用 0 辆，补足 0 个，剩余 ${total} 个采样盲点。`;return;}
  if(!summary){status.textContent='需要先复核本轮车辆的驻点覆盖。';compute.hidden=false;if(prepare)timer=setTimeout(startMobile,0);return;}
  if(summary.conditionId!==condition){status.textContent='工况已变化，请取消警车部署并按当前工况重新启用。';return;}
  if(!summary.addedDeviceCount){remember(value,0,0,summary.beforeBlindCount);status.textContent=`${name} · ${summary.message} · 计算前后剩余 ${summary.afterBlindCount} 个采样盲点。`;return;}
  status.textContent='正在计算有限车辆的覆盖量…';
  timer=setTimeout(()=>{
   const instance=new Worker(new URL('./fleet-worker.js',import.meta.url),{type:'module'});worker=instance;
   instance.onmessage=({data})=>{
    if(worker!==instance)return;
    stop();
    if(data.error){status.textContent=data.error;return;}
    const {covered,total,used}=data.result;
    remember(value,used,covered,total);
    status.textContent=`${name} · 可用 ${value} 辆，方案使用 ${used} 辆。初始采样盲点 ${total} 个，补足 ${covered} 个，剩余 ${total-covered} 个。按本轮已复核的 ${summary.addedDeviceCount} 个驻点进行组合比较。`;
   };
   instance.onerror=()=>{if(worker===instance){stop();status.textContent='求解器加载失败，请重新打开日常部署重试。';}};
   instance.postMessage({available:value,totalCars:summary.addedDeviceCount,groups:summary.coverageGroups});
  },200);
 }
 button.onclick=()=>{body.hidden=!body.hidden;button.setAttribute('aria-expanded',String(!body.hidden));previous=null;refresh(true);if(!body.hidden)input.focus();};
 compute.onclick=startMobile;
 input.oninput=()=>refresh(true);
 return {refresh,getEstimate};
}
