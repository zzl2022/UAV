import * as THREE from 'three';
import {DEMO_METRICS,prepareDemo,probeDemo,sampleDemo} from './equipment-demo-model.js';
import {rampColor,volumeGrid} from './volume.js';
import {createVolumeRenderer} from './volume-renderer.js';
import {DEMO_MAX_SAMPLES} from './equipment-demo-limits.js';

const RAMP_START=.22;
const PROBE_STATES=['地形数据不足','有效模型采样','超出范围、视场或信号条件不满足','位于建筑或地形内部','超出离地高度上限'];
export const DEMO_GRADIENT=`linear-gradient(to right,${Array.from({length:32},(_,i)=>`rgb(${rampColor(RAMP_START+(1-RAMP_START)*i/31).map(v=>Math.round(v*255)).join(',')})`).join(',')})`;
export const DEMO_PROBE_INSTRUCTION='移动指针到地图或仿真体场查看参数';

export function prepareEquipmentDemoRun({profile,settings,position,scenario,model,getQuery}){
 if(!model?.ground?.geometry||!model?.buildings)throw Error('当前地图缺少建筑或地形，无法仿真');
 const spec=prepareDemo(profile,settings,position),geometry=model.ground.geometry;
 if(!geometry.boundingBox)geometry.computeBoundingBox();
 const b=geometry.boundingBox,r=spec.settings.radius,p=spec.position;
 const region={west:Math.max(b.min.x,p[0]-r),east:Math.min(b.max.x,p[0]+r),south:Math.max(b.min.z,p[2]-r),north:Math.min(b.max.z,p[2]+r)};
 if(region.east<=region.west||region.north<=region.south)throw Error('仿真范围与当前地图地形没有交集');
 const grid=volumeGrid(region,{spacing:spec.settings.spacing,verticalSpacing:Math.max(10,spec.settings.spacing/2),
  minY:b.min.y+1,maxY:Math.max(p[1]+10,b.max.y+spec.settings.ceiling),maxSamples:DEMO_MAX_SAMPLES});
 return {spec,grid,scenario:structuredClone(scenario),model,query:getQuery(spec.settings.reflections)};
}

export function createEquipmentDemoSession({group,renderer,scene,camera}){
 const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();ray.firstHitOnly=true;
 let active=null,field=null,volume=null,autoRange=null;

 function stop(){
  active=null;field=null;autoRange=null;
  volume?.dispose();volume=null;
 }
 async function start(run,{onProgress}={}){
  stop();active=run;
  const result=await sampleDemo({...run,cancelled:()=>active!==run,
   onProgress:(done,total)=>{if(active===run)onProgress?.(done,total);}});
  if(active!==run||!result)return null;
  field=result;
  const metric=run.spec.metric,floor=run.spec.settings.floor??metric.floor,visible=[];
  for(let i=0;i<field.grid.total;i++)if(field.values[i*4+3]===1&&field.values[i*4]>=floor)visible.push(field.values[i*4]);
  visible.sort((a,b)=>a-b);
  const min=visible[0],max=visible[Math.floor((visible.length-1)*.98)];
  autoRange=metric.max<=1?[0,1]:Number.isFinite(min)?[min,Math.max(min+1,max)]:[metric.min,metric.max];
  if(field.counts.signal)volume=createVolumeRenderer(group,field);
  return field;
 }
 function configure(settings=active?.spec.settings){
  if(!active||!field)return null;
  const metric=active.spec.metric,range=settings.autoscale?autoRange:[metric.min,metric.max],floor=settings.floor??metric.floor;
  volume?.configure({metric:'margin',range,floor,density:settings.density,opacityDistance:active.spec.settings.radius*.25,
   minExtinction:.55,rampStart:RAMP_START,clip:settings.clip,style:settings.style});
  return {metric,range,floor};
 }
 function probe(clientX,clientY){
  if(!active||!field)return null;
  const rect=renderer.domElement.getBoundingClientRect();
  if(!rect.width||!rect.height)return null;
  ndc.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
  ray.setFromCamera(ndc,camera);
  const {spec,scenario,model,query}=active;
  const surface=ray.intersectObjects([model.buildings,model.ground])[0],hit=volume?.probe(ray);
  const useVolume=hit&&(!surface||hit.distance<=surface.distance+.1);
  if(!useVolume&&!surface)return null;
  const point=useVolume?hit.point.toArray():surface.point.toArray();
  if(!useVolume)point[1]+=spec.settings.mountHeight;
  const value=probeDemo(spec,point,scenario,query),source=useVolume?'volume':'surface';
  const hint=`${useVolume?'可见体场位置':`表面上方 ${spec.settings.mountHeight} m`} · ${PROBE_STATES[value.mask]??'暂无数据'}`;
  const format=(v,unit='',digits=1)=>Number.isFinite(v)?`${v.toFixed(digits)}${unit?' '+unit:''}`:'—';
  const rows=[
   ['东 / 北 / 上坐标',[point[0],-point[2],point[1]].map(n=>format(n)).join(' / ')+' m'],
   ['离地高度',format(value.heightAboveGround,'m')],['距装备距离',format(value.distance,'m')],
   ['方位角 / 仰角',`${format(value.azimuth,'°')} / ${format(value.elevation,'°')}`],
   ...DEMO_METRICS[spec.type].map(metric=>[metric.label,format(value.metrics.find(item=>item.id===metric.id)?.value,metric.unit,metric.max<=1?3:1)]),
  ];
  return {point,hint,rows,data:{...value,source}};
 }
 return {start,stop,configure,probe,render:()=>volume?.render(renderer,scene,camera)??false,
  get hasVolume(){return Boolean(volume);}};
}

export const demoMetricLabel=metric=>metric.label+(metric.unit?' / '+metric.unit:'');

export function renderDemoLegend(hud,{metric,range,floor}){
 const digits=metric.max<=1?2:1;
 hud.querySelector('.demo-hud-metric').textContent=`${demoMetricLabel(metric)} · 显示 ≥ ${Number(floor).toFixed(digits)}`;
 hud.querySelector('.demo-scale').replaceChildren(...[0,.5,1].map(t=>{
  const label=document.createElement('span');label.textContent=(range[0]+t*(range[1]-range[0])).toFixed(digits);return label;
 }));
}

export function renderDemoRows(list,rows){
 list.replaceChildren(...rows.flatMap(([label,text])=>{
  const term=document.createElement('dt'),data=document.createElement('dd');
  term.textContent=label;data.textContent=text;return [term,data];
 }));
}

export function demoSampleMessage(field){
 return field.counts.signal?`${field.counts.signal.toLocaleString()} 个有效采样 · 实际步长 ${field.grid.step.map(v=>v.toFixed(0)).join(' / ')} m`:'当前条件下没有可显示的采样';
}
