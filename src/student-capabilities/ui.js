import * as THREE from 'three';
import {createSceneQuery} from '../sensors/scene.js';
import {defaultScenario} from '../sensors/scenario.js';
import {buildRequest,requestJSON,statusText,valueText,unitText,snapshotHTML,presentationNotes} from './api.js';
import './ui.css';

export function mountStudentCapabilities({app,scene,camera,controls,renderer,model,city}){
 const cityPanel=app.querySelector('aside');
 const panel=document.createElement('aside');panel.id='student-panel';panel.hidden=true;
 panel.innerHTML=`<div class="brand">光电与声学评估</div><p class="student-hint">设备能力评估 · 仿真场景<br>基于设备资料与三维场景进行计算</p>
 <button id="student-back">← 返回城市</button><button id="student-connect">刷新设备参数</button>
 <p id="student-message" role="status">正在连接模型服务…</p>
 <section><h2>设备与目标</h2><select id="student-device" aria-label="我的设备"><option value="student-optical">NVT-951 光电</option><option value="student-acoustic">CRY8500 声学</option></select>
 <div id="student-position"></div><div class="buttons"><button id="student-pick-device">地图选设备点</button><button id="student-pick-target">地图选目标点</button></div><button id="student-focus">聚焦设备与目标</button><p class="student-hint">可拖动彩色设备球和红色目标球；选点使用真实建筑／DEM表面。高度为局部上坐标，不是海拔或离地高度。新增设备点在表面上方2 m，目标上方50 m。</p></section>
 <section id="student-optical-settings"><h2>光电工作设置</h2><label>通道<select id="student-channel"><option value="visible">可见光</option><option value="thermal">热成像</option></select></label><div id="student-optics"></div><button id="student-aim">朝向当前目标</button>
 <details><summary>补充光学视场（可选，明确为用户假设）</summary><p class="student-hint">资料缺少传感器尺寸和光学视场。留空时显示未知；成对填写才启用。此为固定视场，焦距变化不驱动该假设视场变化。</p><div id="student-fov"></div></details></section>
 <section id="student-acoustic-settings" hidden><h2>声学阵列</h2><label>阵列规格<select id="student-array"><option value="0.3">30 cm</option><option value="0.7">70 cm</option><option value="1.1" selected>110 cm</option></select></label><p class="student-hint">20 Hz～20 kHz仅明确对应110 cm阵列；94°×76°不作为声学波束裁切条件。</p></section>
 <details><summary>目标位置与可选属性</summary><div id="student-target-position"></div><div id="student-target-settings"></div><p class="student-hint">宽高、频带可留空；填入的是用户场景条件，不是现场测量。</p></details>
 <section><h2>当前设备 · 评估结果</h2><div id="student-results"></div><details><summary>评估条件与数据状态</summary><div id="student-assessment-notes"></div></details></section>
 <details><summary>设备原始参数与来源</summary><div id="student-parameters"></div></details>
 <section><h2>场景对比</h2><label>场景名称<input id="student-snapshot-name" maxlength="80" value="场景1"></label><button id="student-save" disabled>保存当前两台设备结果</button><div id="student-comparison"></div><div class="buttons"><button id="student-export-json" disabled>导出JSON</button><button id="student-export-html" disabled>导出中文报告</button></div><button id="student-clear">清空对比记录</button><p class="student-hint">保存一个场景后移动目标或调整工作设置，再保存第二个。对比记录只保留本次页面会话，刷新前请导出。不会把相对指标当作成功率。</p></section>
 <footer id="student-scene-note"></footer>`;
 app.insertBefore(panel,app.querySelector('main'));
 const $=id=>panel.querySelector('#'+id);
 const toggle=document.createElement('button');toggle.id='toggle-student';toggle.textContent='我的光电／声学';app.querySelector('header').append(toggle);
 const base=defaultScenario(city);
 const devices=[{id:'student-optical',type:'optical',position:[...base.devices[0].position],heading_deg:0,pitch_deg:0,channel:'visible',focal_mm:6.5},
 {id:'student-acoustic',type:'acoustic',position:base.devices[0].position.map((v,i)=>v+(i===0?25:0)),array_diameter_m:1.1}];
 let target={position:[...base.target.position],width_m:null,height_m:null,band_hz:null};
 let catalog=null,query=null,selected='student-optical',payload=null,snapshots=[],timer,sequence=0,controller=null,pick=null,drag=null,down=null,markers=[];
 const layer=new THREE.Group();layer.name='Student_Python_Capabilities';layer.visible=false;scene.add(layer);
 const device=()=>devices.find(d=>d.id===selected);
 const message=x=>$('student-message').textContent=x;
 function number(container,label,value,key,min,max,step=1){const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type='number';input.value=value??'';input.dataset.field=key;input.min=min;input.max=max;input.step=step;input.setAttribute('aria-label',label);row.append(input);container.append(row);}
 function positions(container,p,scope){container.replaceChildren();number(container,'东坐标 / m',p[0],scope+'.0',-30000,30000);number(container,'北坐标 / m',-p[2],scope+'.2',-30000,30000);number(container,'上坐标 / m',p[1],scope+'.1',-20000,20000);}
 function form(){
  const d=device();positions($('student-position'),d.position,'device');positions($('student-target-position'),target.position,'target');
  $('student-optical-settings').hidden=d.type!=='optical';$('student-acoustic-settings').hidden=d.type!=='acoustic';
  $('student-optics').replaceChildren();$('student-fov').replaceChildren();
  if(d.type==='optical'){
   $('student-channel').value=d.channel;const range=catalog?.devices.optical.channels[d.channel].focal_range.value??[6.5,312];
   number($('student-optics'),'焦距 / mm',d.focal_mm,'focal_mm',range[0],range[1],.1);
   number($('student-optics'),'方位指向 / °',d.heading_deg,'heading_deg',0,360,.1);number($('student-optics'),'俯仰指向 / °',d.pitch_deg,'pitch_deg',-90,90,.1);
   number($('student-fov'),'补充水平视场 / °',d.direct_fov_deg?.[0],'fov.0',.001,179.999,.1);number($('student-fov'),'补充垂直视场 / °',d.direct_fov_deg?.[1],'fov.1',.001,179.999,.1);
  }else $('student-array').value=d.array_diameter_m;
  const t=$('student-target-settings');t.replaceChildren();number(t,'目标宽度 / m',target.width_m,'width_m',.001,100,.01);number(t,'目标高度 / m',target.height_m,'height_m',.001,100,.01);number(t,'频带下限 / Hz',target.band_hz?.[0],'band.0',1,100000,1);number(t,'频带上限 / Hz',target.band_hz?.[1],'band.1',1,100000,1);
 }
 function addMetric(parent,label,value){const row=document.createElement('div');row.className='student-metric';const a=document.createElement('span'),b=document.createElement('strong');a.textContent=label;b.textContent=value;row.append(a,b);parent.append(row);}
 function results(){
  const box=$('student-results');box.replaceChildren();const r=payload?.results.find(r=>r.id===selected);if(!r)return;
  addMetric(box,'评估依据','设备资料与三维场景');
  addMetric(box,'建筑／地形直达路径',{clear:'当前网格未检出遮挡',blocked:'当前网格存在遮挡',unknown:'无法判断'}[r.geometry.state]);
  for(const m of r.metrics)addMetric(box,m.label,`${valueText(m.value)} ${unitText(m.unit)} · ${statusText[m.status]??m.status}`);
  const notes=$('student-assessment-notes');notes.replaceChildren();
  for(const note of presentationNotes(r)){const p=document.createElement('p');p.className='student-hint';p.textContent=note;notes.append(p);}
  const params=$('student-parameters');params.replaceChildren();
  function show(obj,prefix=''){for(const [k,v] of Object.entries(obj)){if(v&&typeof v==='object'&&!Array.isArray(v)){if('value'in v&&'status'in v)addMetric(params,prefix+k,`${valueText(v.value)} ${v.unit} · ${statusText[v.status]??v.status}；${typeof v.source==='string'?v.source:JSON.stringify(v.source)}`);else show(v,prefix+k+'.');}}}
  show(r.configuration);
 }
 function dispose(){for(const child of [...layer.children]){child.geometry?.dispose();child.material?.dispose();layer.remove(child);}markers=[];}
 function draw(){
  dispose();
  for(const d of [...devices,{id:'target',type:'target',position:target.position}]){const mesh=new THREE.Mesh(new THREE.SphereGeometry(d.id===selected?11:8,14,10),new THREE.MeshBasicMaterial({color:d.type==='target'?0xff7e85:d.type==='optical'?0xffd783:0x69e2bd,depthTest:false}));mesh.position.fromArray(d.position);mesh.renderOrder=12;mesh.userData.id=d.id;layer.add(mesh);markers.push(mesh);}
  const r=payload?.results.find(x=>x.id===selected);
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...device().position),new THREE.Vector3(...target.position)]),new THREE.LineBasicMaterial({color:r?.geometry.state==='blocked'?0xff7e85:0x89bce5}));layer.add(line);layer.updateMatrixWorld(true);
  // No guessed optical cone or acoustic 94° cut: missing data stays unknown.
 }
 function diagnostics(){camera.updateMatrixWorld();const rect=renderer.domElement.getBoundingClientRect();window.studentDiagnostics={connected:!!catalog,pending:!payload,results:payload?.results,devicePositions:devices.map(d=>({id:d.id,position:[...d.position]})),targetPosition:[...target.position],snapshots:snapshots.length,markers:markers.map(m=>{const p=m.position.clone().project(camera);return {id:m.userData.id,x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2,visible:p.z>=-1&&p.z<=1};}),cameraControlsEnabled:controls.enabled};}
 async function compute(){
  clearTimeout(timer);const seq=++sequence;controller?.abort();controller=new AbortController();payload=null;$('student-save').disabled=true;
  $('student-results').textContent='正在评估设备能力…';draw();diagnostics();
  if(!catalog){message('请先启动 Python 服务，再点击“连接／重读配置”。');return;}
  try{
   const body=buildRequest(catalog,devices,target,(a,b)=>query.trace(a,b));
   const answer=await requestJSON('/api/capabilities/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   if(seq!==sequence||panel.hidden)return;
   payload=answer;results();draw();$('student-save').disabled=false;message('已使用比赛设备配置和平台实际网格完成基础评估。缺失值保留未知。');diagnostics();
  }catch(e){if(e.name==='AbortError'||seq!==sequence)return;message('无法计算：'+e.message);$('student-results').textContent='本次计算无有效结果，请修正输入。';diagnostics();}
 }
 function invalidate(){++sequence;controller?.abort();payload=null;$('student-save').disabled=true;$('student-results').textContent='输入已变化，等待重新计算…';draw();diagnostics();}
 async function connect(){
  invalidate();message('正在读取设备配置…');
  try{catalog=await requestJSON('/api/capabilities/catalog');
   if(JSON.stringify(catalog.scene.origin)!==JSON.stringify(city.metadata.origin))throw Error('Python服务与当前页面的城市原点不一致');
   $('student-scene-note').textContent=`场景建筑 ${catalog.scene.building_count} 栋 · 仿真评估 · 高程基准待核验`;
   form();await compute();
  }catch(e){catalog=null;message('连接失败：'+e.message);diagnostics();}
 }
 function focus(){const a=new THREE.Vector3(...device().position),b=new THREE.Vector3(...target.position),center=a.add(b).multiplyScalar(.5),span=Math.max(350,device().position.reduce((sum,v,i)=>sum+(v-target.position[i])**2,0)**.5*1.8);controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(span*.65,span*.65,span*.85));controls.update();diagnostics();}
 toggle.onclick=()=>{app.dispatchEvent(new CustomEvent('view-change',{detail:'student'}));cityPanel.hidden=true;panel.hidden=false;app.classList.add('equipment-mode');layer.visible=true;query??=createSceneQuery(model);form();draw();focus();connect();};
 function stopDrag(){drag=null;controls.enabled=true;renderer.domElement.style.cursor='';}
 app.addEventListener('view-change',e=>{if(e.detail!=='student'){panel.hidden=true;layer.visible=false;pick=null;stopDrag();clearTimeout(timer);++sequence;controller?.abort();}});
 $('student-back').onclick=()=>{app.dispatchEvent(new CustomEvent('view-change',{detail:'city'}));cityPanel.hidden=false;app.classList.remove('equipment-mode');};
 $('student-connect').onclick=connect;$('student-focus').onclick=focus;
 $('student-device').onchange=()=>{selected=$('student-device').value;form();results();draw();diagnostics();};
 $('student-channel').onchange=()=>{const d=device();d.channel=$('student-channel').value;d.focal_mm=catalog?.devices.optical.channels[d.channel].focal_range.value[0]??(d.channel==='thermal'?75:6.5);delete d.direct_fov_deg;form();compute();};
 $('student-array').onchange=()=>{device().array_diameter_m=Number($('student-array').value);compute();};
 $('student-aim').onclick=()=>{const d=device(),delta=target.position.map((v,i)=>v-d.position[i]);d.heading_deg=(Math.atan2(delta[0],-delta[2])*180/Math.PI+360)%360;d.pitch_deg=Math.atan2(delta[1],Math.hypot(delta[0],delta[2]))*180/Math.PI;form();compute();};
 panel.addEventListener('input',e=>{
  const input=e.target,key=input.dataset.field;if(!key)return;
  clearTimeout(timer);invalidate();
  const v=input.value.trim()===''?null:Number(input.value),d=device();
  if(key.startsWith('device.')||key.startsWith('target.')){const [scope,index]=key.split('.'),p=scope==='device'?d.position:target.position;p[Number(index)]=v===null?null:Number(index)===2?-v:v;}
  else if(key.startsWith('fov.')){const values=d.direct_fov_deg??[null,null];values[Number(key.split('.')[1])]=v;d.direct_fov_deg=values.every(x=>x===null)?null:values;}
  else if(key.startsWith('band.')){const values=target.band_hz??[null,null];values[Number(key.split('.')[1])]=v;target.band_hz=values.every(x=>x===null)?null:values;}
  else if(['width_m','height_m'].includes(key))target[key]=v;
  else d[key]=v;
  timer=setTimeout(compute,250);
 });
 $('student-pick-device').onclick=()=>{pick='device';message('请点击建筑或地面表面设置设备。');};$('student-pick-target').onclick=()=>{pick='target';message('请点击建筑或地面表面设置目标。');};
 function ray(e){const rect=renderer.domElement.getBoundingClientRect(),r=new THREE.Raycaster();r.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);r.firstHitOnly=true;return r;}
 function surface(e){return ray(e).intersectObjects([model.buildings,model.ground])[0];}
 const canvas=renderer.domElement;
 canvas.addEventListener('pointerdown',e=>{if(panel.hidden||e.button!==0)return;down=[e.clientX,e.clientY];if(pick)return;const hit=ray(e).intersectObjects(markers)[0];if(!hit)return;const id=hit.object.userData.id,p=id==='target'?target.position:devices.find(d=>d.id===id).position;drag={id,above:p[1]-(query.surfaceAt(p[0],p[2])??p[1])};controls.enabled=false;canvas.setPointerCapture(e.pointerId);e.stopImmediatePropagation();},true);
 canvas.addEventListener('pointermove',e=>{if(!drag||panel.hidden)return;const hit=surface(e);if(!hit)return;const p=hit.point.toArray();p[1]+=Math.max(.1,drag.above);if(drag.id==='target')target.position=p;else{selected=drag.id;$('student-device').value=selected;device().position=p;}invalidate();form();e.stopImmediatePropagation();},true);
 canvas.addEventListener('pointerup',e=>{if(panel.hidden)return;if(drag){stopDrag();compute();e.stopImmediatePropagation();return;}if(!pick||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const hit=surface(e);if(!hit){message('没有点到模型表面，请重新选择。');return;}const p=hit.point.toArray();p[1]+=pick==='device'?2:50;if(pick==='device')device().position=p;else target.position=p;pick=null;form();compute();},true);
 canvas.addEventListener('pointercancel',()=>{if(drag){stopDrag();compute();}});
 controls.addEventListener('change',()=>{if(!panel.hidden)diagnostics();});
 function comparisons(){
  const box=$('student-comparison');box.replaceChildren();
  for(const s of snapshots){const item=document.createElement('p');item.className='student-hint';item.textContent=s.name+'：'+s.payload.results.map(r=>`${r.device} ${valueText(r.metrics.find(m=>m.label==='目标距离')?.value)} m，${{clear:'网格未检出遮挡',blocked:'网格有遮挡',unknown:'未知'}[r.geometry.state]}`).join('；');box.append(item);}
  $('student-export-json').disabled=$('student-export-html').disabled=!snapshots.length;diagnostics();
 }
 $('student-save').onclick=()=>{if(!payload)return;if(snapshots.length>=30){message('最多保留30组，请导出或清空后继续。');return;}snapshots.push({name:$('student-snapshot-name').value.trim()||`场景${snapshots.length+1}`,payload:structuredClone(payload)});$('student-snapshot-name').value=`场景${snapshots.length+1}`;comparisons();};
 $('student-clear').onclick=()=>{snapshots=[];comparisons();};
 function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('student-export-json').onclick=()=>download(JSON.stringify({version:catalog.version,scenarios:snapshots},null,2),'光电声学平台场景对比.json','application/json');
 $('student-export-html').onclick=()=>download(snapshotHTML(snapshots),'光电声学平台场景对比.html','text/html;charset=utf-8');
 return {panel};
}
