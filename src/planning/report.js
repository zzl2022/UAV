import {PLAN_VERSION,validateSettings} from './optimizer.js';
import {validateDevice,validatePosition} from '../sensors/engine.js';
export function validateReport(report,city){
 if(report?.version!==PLAN_VERSION||!Array.isArray(report.plans)||!report.plans.length||!report.plans.some(p=>p.id===report.selectedId))throw Error('部署示例版本或方案列表无效');
 validateSettings(report.settings);
 for(const [key,hash] of Object.entries(city.metadata.sources))if(report.inputHashes?.[key]!==hash)throw Error('部署方案与当前 GIS 数据不一致，请重新优化');
 if(!Array.isArray(report.origin)||report.origin.length!==3||report.origin.some((v,i)=>!Number.isFinite(v)||Math.abs(v-city.metadata.origin[i])>1e-7))throw Error('部署方案坐标原点不匹配');
 const n=report.sampling?.samples?.length;if(!n||n>20000)throw Error('覆盖采样数量无效');
 for(const sample of report.sampling.samples)validatePosition(sample.position);
 for(const plan of report.plans){
  if(!Array.isArray(plan.devices)||plan.devices.length>64||!Number.isFinite(plan.cost)||plan.cost<0)throw Error('设备或成本无效');
  for(const d of plan.devices)validateDevice(d);
  if(plan.coverage?.length!==report.conditions.length)throw Error('缺少工况覆盖矩阵');
  for(let c=0;c<plan.coverage.length;c++){
   const row=plan.coverage[c];if(row.length!==n||row.some(x=>!Number.isInteger(x)||x<0||x>64))throw Error('覆盖矩阵无效');
   const covered=row.filter(x=>x>0).length;
   if(plan.metrics[c]?.covered!==covered||Math.abs(plan.metrics[c].coverageRate-covered/n)>1e-10)throw Error('覆盖率与采样结果不一致');
  }
 }
 if(!report.route?.points?.length||!report.flight?.frames?.length)throw Error('缺少已验证的飞行轨迹与报警帧');
 let previous=-1;for(const point of report.route.points){validatePosition(point.position);if(!Number.isFinite(point.time)||point.time<previous)throw Error('轨迹时间无效');previous=point.time;}
 if(Math.abs(report.route.duration-previous)>1e-6)throw Error('轨迹时长不一致');
 return report;
}
export function enrichReport(report,city){
 if(city)report.ecefTransform=city.metadata.ecefTransform;
 for(const plan of report.plans){
  plan.typeCounts=plan.devices.reduce((counts,d)=>(counts[d.type]=(counts[d.type]??0)+1,counts),{});
  plan.areaEstimates=Object.fromEntries(report.conditions.map((condition,c)=>[condition.id,report.settings.heights.map(height=>{
   const grid=report.sampling.samples.map((p,j)=>({p,j})).filter(({p})=>p.kind==='grid'&&p.agl===height);
   const blind=grid.filter(({j})=>!plan.coverage[c][j]).length;
   return {height,validGridCells:grid.length,blindGridCells:blind,approximateAreaMeters2:grid.length*report.settings.spacing**2,approximateBlindAreaMeters2:blind*report.settings.spacing**2,meaning:'按网格中心外推的单高度层面积估计，边界和楼体未做精确多边形裁剪'};
  })]));
 }
 return report;
}
