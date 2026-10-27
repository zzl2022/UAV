import * as THREE from 'three';
import {PRESETS,TYPES} from '../sensors/presets.js';
import {BLIND_COLORS,BLIND_CATEGORIES,TASK3_VERSION,METRIC_WEIGHTS,METRIC_LABELS,THREAT_SCENARIOS} from './constants.js';
import {PIPELINE_STAGES,STAGE_NAMES} from './pipeline.js';
import './ui.css';

const COLORS={radar:0x70d6ff,radio:0xb89aff,optical:0xffd783,acoustic:0x69e2bd};
const percent=x=>`${(x*100).toFixed(1)}%`;
const clock=t=>`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const VERDICT={pass:'通过',degraded:'降额',fail:'不通过'};

export function mountTask3UI({app,city,terrain,scene,camera,controls,renderer,sensors,model}){
 const panel=document.createElement('aside');panel.id='task3-panel';panel.hidden=true;
 panel.innerHTML=`<div class="brand"><span class="mark">◇</span> 任务三 · 优化部署推演 <small>${TASK3_VERSION}</small></div><button id="task3-back" class="back-button">← 返回城市建模</button>
 <p class="task3-note">核心防护目标：<strong>河南博物院</strong> · 推演范围：周边 2.4 × 2.4 km<br>候选生成 → 覆盖推演 → 多指标择优 → 威胁验证 → 电磁兼容校核，一键自动串联。</p>
 <section><h2>推演输入 <span>INPUT</span></h2>
  <details open><summary>装备类型（按装备参数.doc 七款）</summary><div id="task3-equipment"></div></details>
  <div class="task3-inputs">
   <label>网格间距 / m<select id="task3-spacing"><option value="350">350（细）</option><option value="500" selected>500（标准）</option><option value="700">700（快）</option></select></label>
   <label>预算 / 相对单位<input id="task3-budget" type="number" min="100" max="1000" step="50" value="600"></label>
   <label>设备上限<input id="task3-max-devices" type="number" min="4" max="64" step="1" value="64"></label>
  </div>
  <details><summary>四指标权重（和为 1）</summary><div class="task3-inputs" id="task3-weights">
   <label>覆盖完整性<input type="number" data-weight="coverage" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.coverage}"></label>
   <label>盲区占比<input type="number" data-weight="blind" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.blind}"></label>
   <label>成本<input type="number" data-weight="cost" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.cost}"></label>
   <label>施工可行性<input type="number" data-weight="feasibility" min="0" max="1" step="0.05" value="${METRIC_WEIGHTS.feasibility}"></label>
  </div><p class="hint">成本为相对成本单位，<strong>非人民币报价</strong>（装备参数.doc 未提供价格）。</p></details>
  <div class="buttons"><button id="task3-run" class="primary">▶ 开始推演</button><button id="task3-cancel" disabled>取消</button></div>
  <progress id="task3-progress" max="1" value="0"></progress><div id="task3-status" role="status">待命</div></section>
 <section><h2>流水线 <span>PIPELINE</span></h2><ol id="task3-pipeline" class="task3-pipeline">${PIPELINE_STAGES.map(s=>`<li data-stage="${s}">${STAGE_NAMES[s]}</li>`).join('')}</ol></section>
 <section><h2>方案对比 <span>PLANS</span></h2><div id="task3-plans-table"></div><label>当前方案<select id="task3-plan"></select></label><div id="task3-plan-detail"></div></section>
 <section><h2>盲区分布 <span>BLIND SPOTS</span></h2><label>覆盖工况<select id="task3-condition"></select></label>
  <div id="task3-blind-legend" class="task3-legend">${Object.entries(BLIND_CATEGORIES).map(([key,name])=>`<label><input type="checkbox" data-category="${key}" checked><i style="background:#${BLIND_COLORS[key].toString(16).padStart(6,'0')}"></i>${name}<b data-count="${key}"></b></label>`).join('')}</div>
  <div id="task3-blind-list"></div></section>
 <section><h2>威胁推演 <span>THREATS</span></h2><label>威胁场景<select id="task3-threat"></select></label>
  <div id="task3-threat-summary"></div><div class="buttons"><button id="task3-threat-play" class="primary" disabled>▶ 播放推演</button><button id="task3-threat-reset" disabled>↺</button></div>
  <input id="task3-threat-seek" type="range" min="0" max="1000" value="0" aria-label="推演进度"><div id="task3-threat-clock">00:00 / 00:00</div><div id="task3-threat-list"></div></section>
 <section><h2>电磁兼容 <span>EMC</span></h2><div id="task3-emc"></div></section>
 <section class="task3-io"><button id="task3-export">导出推演报告 JSON ↓</button><button id="task3-export-run">导出过程数据（规则依据）↓</button></section>`;
 app.insertBefore(panel,app.querySelector('main'));
 const cityPanel=app.querySelector('aside'),$=id=>panel.querySelector('#'+id);
 const button=document.createElement('button');button.id='toggle-task3';button.textContent='任务三推演 →';app.querySelector('header').append(button);
 const layer=new THREE.Group();layer.name='Task3_Pipeline';layer.visible=false;scene.add(layer);
 const setStatus=text=>{$('task3-status').textContent=text;};
 // 装备勾选
 $('task3-equipment').replaceChildren(...PRESETS.map(p=>{const l=document.createElement('label');l.className='task3-equip';const c=document.createElement('input');c.type='checkbox';c.checked=true;c.value=p.id;l.append(c,document.createTextNode(`${TYPES[p.type]} · ${p.name}`));return l;}));
 $('task3-threat').replaceChildren(...Object.entries(THREAT_SCENARIOS).map(([k,s])=>new Option(s.name,k)));
 let report=null,run=null,worker=null,busy=false,plan=null,blindMeshes={},targetMeshes=[],detectLines=null,playing=false,frameIndex=0,rafId=0,lastStamp=0;
 const conditionIndex=()=>report?report.conditions.findIndex(c=>c.id===$('task3-condition').value):0;
 function stage(id,cls){for(const li of panel.querySelectorAll('#task3-pipeline li'))if(li.dataset.stage===id)li.className=cls;}
 function resetStages(){for(const li of panel.querySelectorAll('#task3-pipeline li'))li.className='';}
 function focus(position,span=700){controls.target.fromArray(position);camera.position.fromArray(position).add(new THREE.Vector3(span*.55,span*.9,span*.75));controls.update();}
 function destroyLayer(){for(const child of [...layer.children]){child.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});layer.remove(child);}blindMeshes={};targetMeshes=[];detectLines=null;}
 function drawCommon(){
  destroyLayer();if(!report||!plan)return;
  const b=report.sampling.bounds,core=[];for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;core.push([b.core[0]+Math.cos(a)*report.settings.coreRadius,b.core[1]+8,b.core[2]+Math.sin(a)*report.settings.coreRadius]);}
  layer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(core.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:0xffd783,transparent:true,opacity:.7})));
  for(const d of plan.devices){const mesh=new THREE.Mesh(new THREE.SphereGeometry(22,10,7),new THREE.MeshBasicMaterial({color:COLORS[d.type],depthTest:false}));mesh.position.fromArray(d.position);layer.add(mesh);}
  // 盲区点：按类别分 InstancedMesh，图例开关控制可见性
  const rows=report.blindspots[plan.id]??[],row=rows[conditionIndex()]??rows[0];
  const byCat={};for(const p of row?.points??[])(byCat[p.category]??=[]).push(p);
  for(const [cat,points] of Object.entries(byCat)){
   const mesh=new THREE.InstancedMesh(new THREE.SphereGeometry(15,6,4),new THREE.MeshBasicMaterial({color:BLIND_COLORS[cat],depthTest:false,transparent:true,opacity:.85}),points.length);
   const m4=new THREE.Matrix4();points.forEach((p,i)=>{m4.makeTranslation(...p.position);mesh.setMatrixAt(i,m4);});
   mesh.visible=panel.querySelector(`input[data-category="${cat}"]`)?.checked??true;layer.add(mesh);blindMeshes[cat]={mesh,points};
  }
  renderBlindList(row);
 }
 function renderBlindList(row){
  const counts=row?.stats.byCategory??{};for(const [key] of Object.entries(BLIND_CATEGORIES)){const el=panel.querySelector(`b[data-count="${key}"]`);if(el)el.textContent=counts[key]?` ${counts[key]}`:' 0';}
  const list=$('task3-blind-list');list.replaceChildren();
  if(!row?.points?.length){list.innerHTML='<p class="hint">当前工况采样点全部覆盖，无盲区。</p>';return;}
  for(const p of row.points){const b=document.createElement('button');b.className='task3-blind-item';b.style.borderLeftColor=`#${BLIND_COLORS[p.category].toString(16).padStart(6,'0')}`;
   const cause=p.category==='gap'?`缝宽 ${p.cause.gapWidthM.toFixed(0)} m`:p.category==='shadow'?`遮挡距 ${p.cause.blockerDistanceM.toFixed(0)} m`:p.category==='lowFacade'?`贴楼 ${p.cause.distanceToFacadeM.toFixed(1)} m · 离地 ${p.agl} m`:p.category==='corner'?`距角部 ${p.cause.cornerDistanceM.toFixed(1)} m`:'不满足四类几何特征';
   b.textContent=`${BLIND_CATEGORIES[p.category]} · ${cause}`;b.onclick=()=>focus(p.position,500);list.append(b);}
 }
 function renderPlans(){
  const t=report.comparison,table=document.createElement('table');table.className='task3-table';
  table.innerHTML=`<thead><tr><th>排名</th><th>方案</th><th>设备</th><th>覆盖完整性</th><th>盲区占比</th><th>成本*</th><th>可行性</th><th>EMC</th><th>得分</th></tr></thead>`;
  const tbody=document.createElement('tbody');
  for(const r of t.rows){const tr=document.createElement('tr');if(r.id===report.recommendedId)tr.className='recommended';
   tr.innerHTML=`<td>${r.rank}</td><td>${r.name}${r.id===report.recommendedId?' ★':''}</td><td>${r.deviceCount}</td><td>${percent(r.coverage)}</td><td>${percent(r.blindRatio)}</td><td>${r.cost.toFixed(1)}</td><td>${r.feasibility.toFixed(2)}</td><td>${VERDICT[report.emc[r.id].verdict]}</td><td>${r.score.toFixed(3)}</td>`;
   tbody.append(tr);}
  table.append(tbody);$('task3-plans-table').replaceChildren(table);
  $('task3-plans-table').insertAdjacentHTML('beforeend','<p class="hint">* 相对成本单位，非人民币报价。覆盖完整性 = 最弱工况覆盖率 + 0.15×核心区二重覆盖率（封顶 1）。EMC 冲突方案得分已降权。</p>');
  $('task3-plan').replaceChildren(...report.plans.map(p=>new Option(`${p.name} · ${p.devices.length} 台`,p.id,false,p.id===plan.id)));
  const s=report.scoring.plans.find(r=>r.id===plan.id),m=plan.metrics[conditionIndex()];
  $('task3-plan-detail').innerHTML='';const rows=[['当前工况采样覆盖',`${m.covered}/${m.total} · ${percent(m.coverageRate)}`],['采样盲区占比',percent(m.blindRate)],['核心区覆盖 / 二重覆盖',`${percent(m.coreCoverageRate)} / ${percent(m.coreRedundantRate)}`],['施工可行性代理',s.indicators.feasibility.toFixed(3)],['EMC 结论',`${VERDICT[report.emc[plan.id].verdict]}（严重 ${report.emc[plan.id].counts.fail} · 提示 ${report.emc[plan.id].counts.warning}）`]];
  for(const [k,v] of rows){const d=document.createElement('div');d.className='sensor-metric';d.innerHTML=`<span>${k}</span><strong>${v}</strong>`;$('task3-plan-detail').append(d);}
 }
 function renderEmc(){
  const e=report.emc[plan.id],box=$('task3-emc');box.replaceChildren();
  const banner=document.createElement('div');banner.className=`task3-emc-banner ${e.verdict}`;banner.textContent=e.text;box.append(banner);
  if(e.conflicts.length){const t=document.createElement('table');t.className='task3-table';t.innerHTML='<thead><tr><th>设备对</th><th>类型</th><th>严重度</th><th>距离/m</th><th>建议</th></tr></thead>';const tb=document.createElement('tbody');
   for(const c of e.conflicts.slice(0,50)){const tr=document.createElement('tr');tr.innerHTML=`<td>${c.a} ↔ ${c.b}</td><td>${c.kind}</td><td>${c.severity}</td><td>${c.distanceM.toFixed(0)}</td><td>${c.recommendation}</td>`;tb.append(tr);}t.append(tb);box.append(t);
   if(e.conflicts.length>50)box.insertAdjacentHTML('beforeend',`<p class="hint">仅列前 50 条，共 ${e.conflicts.length} 条，完整清单见导出 JSON。</p>`);}
  box.insertAdjacentHTML('beforeend',`<p class="hint">${e.notes.join('；')||''} 工程代理规则，非频谱合规认证。</p>`);
 }
 function renderThreatSummary(){
  const key=$('task3-threat').value,th=report.threats[key],s=th.summary;
  $('task3-threat-summary').innerHTML='';
  for(const [k,v] of [['推演目标',`${s.targetCount} 架`],['被真实检出',`${th.perTarget.filter(p=>p.firstDetectionTime!==null).length} 架`],['平均首报',s.meanFirstDetectionTime===null?'—':`${s.meanFirstDetectionTime.toFixed(1)} s`],['平均检出占比',percent(s.meanDetectedFraction)],['容量溢出架次',`${s.overflowEvents}`]]){const d=document.createElement('div');d.className='sensor-metric';d.innerHTML=`<span>${k}</span><strong>${v}</strong>`;$('task3-threat-summary').append(d);}
  $('task3-threat-summary').insertAdjacentHTML('beforeend',`<p class="hint">${th.text}</p>`);
  $('task3-threat-list').replaceChildren(...th.perTarget.map(p=>{const b=document.createElement('button');b.className='task3-blind-item';b.textContent=`${p.id} · 首报 ${p.firstDetectionTime===null?'未检出':clock(p.firstDetectionTime)} · 检出 ${percent(p.detectedFraction)}`;return b;}));
 }
 function installThreatFrame(){
  const key=$('task3-threat').value,th=report.threats[key];if(!th?.frames?.length)return;
  const frames=th.frames,index=Math.min(frames.length-1,frameIndex),frame=frames[index];
  for(const mesh of targetMeshes){layer.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
  targetMeshes=[];
  for(const t of frame.targets){
   const mesh=new THREE.Mesh(new THREE.SphereGeometry(t.detectedBy.length?12:9,10,7),new THREE.MeshBasicMaterial({color:t.detectedBy.length?0xff776d:0xffd783,depthTest:false}));mesh.position.fromArray(t.position);layer.add(mesh);targetMeshes.push(mesh);
  }
  if(detectLines){layer.remove(detectLines);detectLines.geometry.dispose();detectLines.material.dispose();detectLines=null;}
  const pts=[];for(const t of frame.targets)for(const d of t.detectedBy){const device=plan.devices.find(x=>x.id===d.id);if(device){pts.push(device.position,t.position);}}
  if(pts.length){detectLines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:0xff776d,transparent:true,opacity:.55}));layer.add(detectLines);}
  const dur=frames.at(-1).time;$('task3-threat-clock').textContent=`${clock(frame.time)} / ${clock(dur)}`;$('task3-threat-seek').value=dur?frame.time/dur*1000:0;
  updateDiagnostics();
 }
 function threatPlayLoop(stamp){
  if(!playing)return;
  const key=$('task3-threat').value,th=report.threats[key];if(!th?.frames?.length){playing=false;return;}
  if(lastStamp)frameTime+=Math.min(0.2,(stamp-lastStamp)/1000)*10;lastStamp=stamp;
  const dur=th.frames.at(-1).time;
  if(frameTime>=dur){frameTime=dur;playing=false;$('task3-threat-play').textContent='↺ 再次播放';}
  const idx=Math.min(th.frames.length-1,th.frames.findIndex(f=>f.time>=frameTime));
  if(idx!==frameIndex&&idx>=0){frameIndex=idx;installThreatFrame();}
  rafId=requestAnimationFrame(threatPlayLoop);
 }
 let frameTime=0;
 function stopPlayback(){playing=false;lastStamp=0;cancelAnimationFrame(rafId);$('task3-threat-play').textContent='▶ 播放推演';updateDiagnostics();}
 function updateDiagnostics(){window.task3Diagnostics={ready:!!report,busy,version:TASK3_VERSION,plans:report?.plans.map(p=>({id:p.id,devices:p.devices.length,cost:p.cost})),recommendedId:report?.recommendedId,planId:plan?.id,blindStats:report&&plan?report.blindspots[plan.id]?.[conditionIndex()]?.stats:null,threatScenario:$('task3-threat').value,threatSummary:report?.threats?.[$('task3-threat').value]?.summary??null,emcVerdict:report&&plan?report.emc[plan.id].verdict:null,playing,frameIndex,condition:$('task3-condition').value};}
 function controlsEnabled(){$('task3-run').disabled=busy;$('task3-cancel').disabled=!busy;for(const id of ['task3-plan','task3-condition','task3-threat','task3-export','task3-export-run'])$(id).disabled=busy||!report;$('task3-threat-play').disabled=busy||!report?.threats?.[$('task3-threat').value]?.frames?.length;$('task3-threat-reset').disabled=$('task3-threat-play').disabled;}
 function getWorker(){if(worker)return worker;worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{if(data.type==='progress'){const v=data.value;$('task3-progress').value=v.total?v.completed/v.total:0;stage(v.stage,'running');setStatus(`${STAGE_NAMES[v.stage]??v.stage} ${v.completed}/${v.total}`);}else if(data.type==='report'){busy=false;({report,run}=data);plan=report.plans.find(p=>p.id===report.recommendedId);for(const s of PIPELINE_STAGES)stage(s,'done');$('task3-condition').replaceChildren(...report.conditions.map(c=>new Option(c.name,c.id)));stopPlayback();frameIndex=0;frameTime=0;renderAll();setStatus(`推演完成 · ${report.candidateCount} 候选 / ${report.sampling.samples.length} 采样 / ${(report.durationMs/1000).toFixed(1)} s · 推荐「${plan.name}」`);controlsEnabled();}else if(data.type==='error'){fail(data.message);}};
  worker.onerror=e=>fail(e.message||'后台计算失败');return worker;}
 function fail(text){worker?.terminate();worker=null;busy=false;resetStages();setStatus(`推演失败：${text}`);controlsEnabled();updateDiagnostics();}
 function renderAll(){renderPlans();renderEmc();renderThreatSummary();drawCommon();updateDiagnostics();}
 // 事件
 button.onclick=()=>{app.dispatchEvent(new CustomEvent('view-change',{detail:'task3'}));cityPanel.hidden=true;panel.hidden=false;app.classList.add('equipment-mode');layer.visible=true;};
 app.addEventListener('view-change',event=>{if(event.detail!=='task3'){panel.hidden=true;layer.visible=false;stopPlayback();}});
 $('task3-back').onclick=()=>{app.dispatchEvent(new CustomEvent('view-change',{detail:'city'}));panel.hidden=true;cityPanel.hidden=false;app.classList.remove('equipment-mode');};
 $('task3-run').onclick=()=>{if(busy)return;const presetIds=[...panel.querySelectorAll('#task3-equipment input:checked')].map(c=>c.value);
  const weights={};for(const input of panel.querySelectorAll('#task3-weights input'))weights[input.dataset.weight]=Number(input.value);
  const current=sensors.getScenario();
  const settings={scope:'core',spacing:Number($('task3-spacing').value),heights:[30,60,100],siteSpacing:500,maxSites:192,maxDevices:Number($('task3-max-devices').value),budget:Number($('task3-budget').value),costs:{radar:12,radio:5,optical:4,acoustic:2},coreRadius:700,coreWeight:3,marginReserveDb:3};
  busy=true;resetStages();destroyLayer();report=null;controlsEnabled();updateDiagnostics();setStatus('后台计算中，地图仍可操作。');
  getWorker().postMessage({type:'pipeline',baseURL:new URL('./',location.href).href,settings,weights,presetIds,environment:current.environment,target:current.target});};
 $('task3-cancel').onclick=()=>{worker?.terminate();worker=null;busy=false;resetStages();setStatus('已取消。');controlsEnabled();updateDiagnostics();};
 $('task3-plan').onchange=()=>{plan=report.plans.find(p=>p.id===$('task3-plan').value);stopPlayback();frameIndex=0;frameTime=0;renderAll();};
 $('task3-condition').onchange=()=>{renderPlans();drawCommon();updateDiagnostics();};
 $('task3-threat').onchange=()=>{stopPlayback();frameIndex=0;frameTime=0;renderThreatSummary();installThreatFrame();controlsEnabled();};
 $('task3-threat-play').onclick=()=>{if(!report)return;if(playing){stopPlayback();return;}const th=report.threats[$('task3-threat').value];if(frameTime>=th.frames.at(-1).time){frameTime=0;frameIndex=0;}playing=true;lastStamp=0;$('task3-threat-play').textContent='Ⅱ 暂停';rafId=requestAnimationFrame(threatPlayLoop);};
 $('task3-threat-reset').onclick=()=>{stopPlayback();frameIndex=0;frameTime=0;installThreatFrame();};
 $('task3-threat-seek').oninput=()=>{const th=report?.threats?.[$('task3-threat').value];if(!th?.frames?.length)return;stopPlayback();frameTime=Number($('task3-threat-seek').value)/1000*th.frames.at(-1).time;const idx=th.frames.findIndex(f=>f.time>=frameTime);frameIndex=Math.max(0,Math.min(th.frames.length-1,idx));installThreatFrame();};
 for(const cb of panel.querySelectorAll('#task3-blind-legend input'))cb.onchange=()=>{for(const [cat,{mesh}] of Object.entries(blindMeshes))mesh.visible=panel.querySelector(`input[data-category="${cat}"]`).checked;};
 $('task3-export').onclick=()=>{if(!report)return;const blob=new Blob([JSON.stringify({report,activePlanId:plan.id},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='task3-deployment-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
 $('task3-export-run').onclick=()=>{if(!run)return;const blob=new Blob([JSON.stringify(run,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${run.runId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
 controlsEnabled();updateDiagnostics();
 return {panel,layer,setStatus};
}
