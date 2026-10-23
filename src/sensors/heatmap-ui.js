import * as THREE from 'three';
import {heatDevices} from './heatmap.js';
import {volumeGrid,VOLUME_METRICS,rampColor} from './volume.js';
import {createVolumeRenderer} from './volume-renderer.js';
import './volume.css';

export function mountHeatmap({panel,scene,model,getState,getSelected,isActive,getQuery,onNominalChange,onProbeChange}){
 const section=document.createElement('section');section.id='detection-controls';
 section.innerHTML=`<h2>三维探测场 <span>VOLUMETRIC FIELD</span></h2>
 <label><input id="detection-enabled" type="checkbox" checked>显示三维体渲染</label>
 <label>装备图层<select id="detection-mode" aria-label="探测装备图层"><option value="selected">当前装备</option><option value="radar">全部雷达</option><option value="radio">全部无线电</option><option value="combined">雷达＋无线电联合</option></select></label>
 <label>连续物理量<select id="detection-metric" aria-label="探测渲染物理量"><option value="margin">探测裕量 / dB</option><option value="snr">处理后 SNR / dB</option><option value="pd">统计模型 Pd / 0–1</option></select></label>
 <label>渲染方式<select id="detection-style" aria-label="三维探测场渲染方式"><option value="volume">连续体渲染</option><option value="surface">门限等值面</option></select></label>
 <label><input id="detection-autoscale" type="checkbox" checked>按物理值自动缩放色带</label>
 <label>分析高度上限<select id="detection-height" aria-label="探测场离地高度上限"><option value="300">离地 300 m</option><option value="600" selected>离地 600 m</option><option value="1200">离地 1200 m</option><option value="3000">离地 3000 m</option><option value="8000">离地 8000 m</option></select></label>
 <label>采样范围<select id="detection-scope" aria-label="探测采样范围"><option value="local">当前装备周边 3 × 3 km</option><option value="city">整个建模城区</option></select></label>
 <label>空间精度<select id="detection-spacing" aria-label="探测空间采样精度"><option value="150">快速 · 水平150 / 垂直75 m</option><option value="100" selected>标准 · 水平100 / 垂直40 m</option><option value="50">精细 · 水平50 / 垂直20 m</option></select></label>
 <label>显示下限 <output id="detection-floor-value"></output><input id="detection-floor" aria-label="物理量显示下限" type="range" min="-20" max="40" step=".5" value="0"></label>
 <label>体密度<input id="detection-density" aria-label="体渲染密度" type="range" min=".1" max="2" step=".05" value="1.3"></label>
 <label>东西剖切<input id="detection-clip" aria-label="探测场剖切位置" type="range" min=".05" max="1" step=".01" value="1"></label>
 <label><input id="detection-reflections" type="checkbox" checked>计入一次立面反射</label>
 <label><input id="detection-nominal" type="checkbox">叠加标称范围体</label>
 <div class="buttons"><button id="detection-overview">俯视区域</button><button id="detection-oblique">三维观察</button><button id="detection-refresh">重新计算</button></div>
 <button id="detection-export" disabled>导出三维探测场 · JSON ↓</button>
 <p id="detection-progress" role="status" class="hint"></p>
 <p class="hint">独立计算 X/Y/Z 三维体素，连续色带显示模型物理量。近距盲区、视场外、实体阻断与数据缺口留空；低于门限的信号可通过显示下限查看。精细采样不等于实测精度。</p>`;
 panel.querySelector('.probe-setting').before(section);const $=id=>section.querySelector('#'+id);
 const legend=document.createElement('div');legend.id='detection-legend';legend.hidden=true;
 legend.innerHTML='<strong>三维探测能力 · 连续体渲染</strong><div id="detection-caption"></div><div id="detection-scale-title"></div><div id="detection-colorbar"></div><div id="detection-scale-ticks"></div><div id="detection-summary"></div><small>空白：硬边界失效、实体或数据不足；不跨盲区插值<br>模型 Pd 是统计假设，非实测概率；联合取最佳单设备<br>体颜色是局部数值，沿视线透明叠加不代表联合概率</small>';
 document.querySelector('main').append(legend);
 legend.querySelector('#detection-colorbar').style.background=`linear-gradient(to right,${Array.from({length:64},(_,i)=>`rgb(${rampColor(i/63).map(v=>Math.round(v*255)).join(',')})`).join(',')})`;
 const group=new THREE.Group();group.name='Effective_Detection_Volume';group.visible=false;scene.add(group);
 const bounds=model.ground.geometry.boundingBox;
 let volume=null,field=null,generation=0,timer,region=null,summary=null,worker=null,pending=null,overview=null,ranges={};
 const status=text=>{$('detection-progress').textContent=text;};
 const diagnostics=value=>{window.detectionDiagnostics=value;};
 function clear(){volume?.dispose();volume=null;field=null;}
 function configure(reset=false){
  const metric=$('detection-metric').value,m=VOLUME_METRICS[metric],input=$('detection-floor');
  if(reset){input.min=m.min;input.max=m.max;input.step=metric==='pd'?.01:.5;input.value=metric==='pd'?.1:metric==='snr'?-10:0;}
  const floor=Number(input.value);$('detection-floor-value').textContent=`${floor.toFixed(metric==='pd'?2:1)} ${m.unit}`;
  legend.querySelector('#detection-scale-title').textContent=`${m.label} ${m.unit} · 显示 ≥ ${floor.toFixed(metric==='pd'?2:1)}`;
  const range=$('detection-autoscale').checked&&ranges[metric]?ranges[metric]:[m.min,m.max];
  legend.querySelector('#detection-scale-ticks').replaceChildren(...[0,.25,.5,.75,1].map(t=>{const span=document.createElement('span');span.textContent=(range[0]+t*(range[1]-range[0])).toFixed(metric==='pd'?2:0);return span;}));
  volume?.configure({metric,floor,density:Number($('detection-density').value),clip:Number($('detection-clip').value),range,style:$('detection-style').value});
  if(summary){summary.metric=metric;summary.metricRange=range;summary.style=$('detection-style').value;summary.displayFloor=floor;summary.clip=Number($('detection-clip').value);publish();}
  onProbeChange();
 }
 function publish(){diagnostics({status:'ready',...summary,values:undefined,winners:undefined,rendering:'gpu-raymarch-3d-texture',scalarPrecision:'float32',colorLevels:256,cellCount:field.grid.total});}
 function invalidate(){generation++;clearTimeout(timer);worker?.postMessage({id:generation,type:'cancel'});clear();summary=null;pending=null;for(const id of ['detection-export','detection-overview','detection-oblique'])$(id).disabled=true;legend.querySelector('#detection-summary').textContent='';onProbeChange();}
 function hide(){invalidate();group.visible=false;legend.hidden=true;diagnostics({status:'hidden'});}
 function fail(message){clear();summary=null;status(`无法计算三维探测场：${message}`);legend.querySelector('#detection-caption').textContent='计算失败，请检查输入或降低空间精度';diagnostics({status:'error',error:message});}
 function install(result,meta){
  field=result;volume=result.counts.signal>0?createVolumeRenderer(group,field):null;ranges={};
  for(const [key,channel] of [['margin',0],['snr',1]]){let lo=Infinity,hi=-Infinity;for(let i=0;i<field.grid.total;i++)if(field.values[i*4+3]===1){lo=Math.min(lo,field.values[i*4+channel]);hi=Math.max(hi,field.values[i*4+channel]);}if(Number.isFinite(lo)){lo=Math.floor(Math.min(lo,key==='margin'?0:lo)/5)*5;hi=Math.ceil(hi/5)*5;ranges[key]=[lo,Math.max(lo+5,hi)];}}
  summary={...meta,grid:result.grid,counts:result.counts,deviceIds:result.deviceIds};
  configure();for(const id of ['detection-export','detection-overview','detection-oblique'])$(id).disabled=false;
  const c=result.counts,text=`${c.detected.toLocaleString()} 个体素满足门限 · 硬边界失效 ${c.hard.toLocaleString()} · 数据不足 ${c.unknown.toLocaleString()} · 实体 ${c.inside.toLocaleString()}`;
  legend.querySelector('#detection-summary').textContent=text;status(`已更新 · ${result.grid.total.toLocaleString()} 个三维采样 · ${text}`);publish();
  if(meta.autoFocus)overview?.(region,[meta.height],true);onProbeChange();
 }
 function ensureWorker(){
  if(worker)return;worker=new Worker(new URL('./volume-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
   if(data.id!==generation||!pending)return;
   if(data.type==='progress'){status(`三维建模 ${Math.round(data.done/data.total*100)}%（${data.done.toLocaleString()}/${data.total.toLocaleString()}）`);diagnostics({status:'computing',done:data.done,total:data.total,dimensions:pending.grid.dimensions});}
   else if(data.type==='error')fail(data.message);
   else if(data.type==='result'){const meta=pending;pending=null;try{install(data.result,meta);}catch(error){fail(error.message);}}
  };
  worker.onerror=error=>{fail(error.message||'三维计算线程不可用');worker.terminate();worker=null;};
 }
 let first=true;
 function run(ticket){
  try{
   const state=structuredClone(getState()),mode=$('detection-mode').value,devices=heatDevices(state.devices,mode,getSelected());
   if(!devices.length){status('此图层没有雷达或无线电设备，请切换图层或添加设备。');legend.querySelector('#detection-caption').textContent='暂无适用设备';diagnostics({status:'empty',deviceCount:0});return;}
   const center=state.devices.find(d=>d.id===getSelected())?.position??devices[0].position;
   region=$('detection-scope').value==='city'?{west:bounds.min.x,east:bounds.max.x,south:bounds.min.z,north:bounds.max.z}:{west:center[0]-1500,east:center[0]+1500,south:center[2]-1500,north:center[2]+1500};
   const height=Number($('detection-height').value),spacing=Number($('detection-spacing').value),verticalSpacing={150:75,100:40,50:20}[spacing];
   const grid=volumeGrid(region,{spacing,verticalSpacing,minY:bounds.min.y+2,maxY:bounds.max.y+height});grid.maxAgl=height;
   const caption=`${$('detection-mode').selectedOptions[0].text} · ${devices.length} 台 · 离地上限 ${height} m · ${grid.dimensions.join(' × ')} 体素 · 实际步长 ${grid.step.map(v=>v.toFixed(1)).join(' / ')} m`;
   legend.querySelector('#detection-caption').textContent=caption;
   status(`建立三维空间索引… 实际水平 ${grid.step[0].toFixed(1)} / 垂直 ${grid.step[1].toFixed(1)} m`);
   pending={mode,height,bounds:region,grid,reflections:$('detection-reflections').checked,caption,autoFocus:first,scenario:state};first=false;
   ensureWorker();worker.postMessage({id:ticket,baseURL:new URL(import.meta.env.BASE_URL,location.href).href,grid,devices,target:state.target,environment:state.environment,reflections:pending.reflections});
  }catch(error){fail(error.message);}
 }
 function schedule(){invalidate();if(!isActive()||!$('detection-enabled').checked){group.visible=false;legend.hidden=true;status('三维探测场已关闭。');diagnostics({status:'hidden'});return;}group.visible=true;legend.hidden=false;status('准备重算三维探测场…');legend.querySelector('#detection-caption').textContent='计算中，旧探测场已清除';diagnostics({status:'pending'});const ticket=generation;timer=setTimeout(()=>run(ticket),180);}
 for(const id of ['detection-enabled','detection-mode','detection-height','detection-scope','detection-spacing','detection-reflections'])$(id).onchange=schedule;
 $('detection-metric').onchange=()=>configure(true);for(const id of ['detection-floor','detection-density','detection-clip'])$(id).oninput=()=>configure();for(const id of ['detection-style','detection-autoscale'])$(id).onchange=()=>configure();
 $('detection-refresh').onclick=schedule;$('detection-nominal').onchange=()=>onNominalChange($('detection-nominal').checked);
 $('detection-export').onclick=()=>{
  if(!summary||!field)return;const payload={coordinateSystem:'Local ENU [east, up, -north], meters',origin:model.group.userData.origin,ecefTransform:model.group.userData.ecefTransform,visualization:summary,channels:['marginDb','snrDb','signalPd','mask'],indexing:'x + nx * (y + ny * z); values[index*4+channel]; winners[index*3+metric] for margin/SNR/Pd',mask:{0:'unknown',1:'signal',2:'hard-failure',3:'solid',4:'above-analysis-height'},values:Array.from(field.values),winners:Array.from(field.winners),meaning:'Model samples; Float32 scalar field. Interpolation preserves hard masks. Best single device per metric, not fused probabilities.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='detection-volume.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 configure(true);
 return {schedule,hide,nominalVisible:()=>$('detection-nominal').checked,render:(renderer,scene,camera)=>volume?.render(renderer,scene,camera)??false,
  setOverview(callback){overview=callback;$('detection-overview').onclick=()=>{if(summary)callback(region,[summary.height],false);};$('detection-oblique').onclick=()=>{if(summary)callback(region,[summary.height],true);};},
  probe(ray){if(!volume||!group.visible)return null;const hit=volume.probe(ray);if(!hit)return null;const i=hit.sample.index,channel={margin:0,snr:1,pd:2}[$('detection-metric').value],deviceId=field.deviceIds[field.winners[i*3+channel]],position=hit.point.toArray(),ground=getQuery(false).groundAt(position[0],position[2]);return {...hit,cell:{position,deviceId,height:ground===null?null:position[1]-ground,volume:true,interpolatedValue:hit.sample.value,metric:$('detection-metric').value}};}};
}
