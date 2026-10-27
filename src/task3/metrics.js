// 任务三 四指标综合择优：① 覆盖完整性 ② 盲区面积占比 ③ 装备配置成本（相对成本单位，非人民币报价）④ 现场施工可行性代理。
import {EQUIPMENT_FACTS,METRIC_WEIGHTS,METRIC_LABELS,FEASIBILITY_MODEL} from './constants.js';

const clamp01=v=>Math.min(1,Math.max(0,v));
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
// 架设方式评分（模型假设）：固定式及多模架设记 1.0；车载式/固定式需车载硬化场地，记 0.85。
const MOUNT_SCORE={'固定式':1,'固定式/车载/铁塔':1,'车载式/固定式':0.85};
const WEIGHT_KEYS=['coverage','blind','cost','feasibility'];

// 单设备施工可行性代理分：重量/体积越大、安装越高越难；返回 score∈[0,1] 及逐项数值来源。
export function deviceFeasibility(device,site,ground=0){
 const facts=EQUIPMENT_FACTS[device.presetId];
 if(!facts)throw Error(`缺少装备事实数据: ${device.presetId}`);
 const {maxWeightKg,maxVolumeM3,heightPenaltyPer100M,weights:w}=FEASIBILITY_MODEL,provenance={};
 const mass=clamp01(1-facts.weightKg/maxWeightKg);
 provenance.mass=`重量 ${facts.weightKg} kg（装备参数.doc）；maxWeightKg=${maxWeightKg} 为模型假设`;
 let volume;
 if(facts.sizeMm){
  const v=facts.sizeMm[0]*facts.sizeMm[1]*facts.sizeMm[2]/1e9;
  volume=clamp01(1-v/maxVolumeM3);
  provenance.volume=`尺寸 ${facts.sizeMm.join('×')} mm（文档），体积 ${v.toFixed(3)} m³；maxVolumeM3=${maxVolumeM3} 为模型假设`;
 }else{
  volume=0.9;provenance.volume='文档未给尺寸，体积项取 0.9（模型假设：小型设备）';
 }
 const mount=MOUNT_SCORE[facts.mount]??0.7;
 provenance.mount=`架设方式「${facts.mount}」（文档）→ ${mount}；车载式/固定式需车载硬化场地记 0.85（模型假设）`;
 const elevation=site?.position?.[1]??device.position[1],heightM=Math.max(0,elevation-ground);
 const height=clamp01(1-heightPenaltyPer100M*heightM/100);
 provenance.height=`安装点高出地面 ${heightM.toFixed(1)} m（安装点高程 − 地面高程 ${ground}）；heightPenaltyPer100M=${heightPenaltyPer100M} 为模型假设`;
 return {score:clamp01(w.mass*mass+w.volume*volume+w.mount*mount+w.height*height),parts:{mass,volume,mount,height},heightM,provenance,source:FEASIBILITY_MODEL.source};
}

function validateWeights(weights){
 for(const key of WEIGHT_KEYS)if(!Number.isFinite(weights?.[key])||weights[key]<0)throw Error(`四指标权重必须齐全且非负（${key}）`);
 if(Object.keys(weights??{}).some(k=>!WEIGHT_KEYS.includes(k)))throw Error('四指标权重含未知键');
 const sum=WEIGHT_KEYS.reduce((s,k)=>s+weights[k],0);
 if(Math.abs(sum-1)>1e-6)throw Error(`四指标权重之和须为 1，当前 ${sum}`);
}

// 未显式传入地面高程时，按 optimizer 约定 installationProxy=1+楼高/100、安装点=表面上方 2 m 反推。
function groundFor(site,ground){
 if(typeof ground==='function')return ground(site);
 if(Number.isFinite(ground))return ground;
 if(site&&Number.isFinite(site.installationProxy))return site.position[1]-((site.installationProxy-1)*100+2);
 return 0;
}

const normUp=(v,[min,max])=>max>min?(v-min)/(max-min):1;
const normDown=(v,[min,max])=>max>min?(max-v)/(max-min):1;

// 多方案四指标综合择优：跨方案 min-max 归一化，盲区占比与成本反向，加权合成后推荐得分最高者（并列取成本较低者）。
export function scorePlans({plans,conditions=[],weights=METRIC_WEIGHTS,ground}={}){
 validateWeights(weights);
 if(!Array.isArray(plans)||!plans.length)throw Error('缺少待择优方案');
 const rows=plans.map(plan=>{
  const perCondition=plan.metrics.map(m=>({condition:m.condition,coverageRate:m.coverageRate,blindRate:m.blindRate}));
  const coreRedundant=plan.metrics[0]?.coreRedundantRate??0;
  const feasibility=plan.devices.length?mean(plan.devices.map((d,i)=>deviceFeasibility(d,plan.sites?.[i]??null,groundFor(plan.sites?.[i],ground)).score)):0;
  return {id:plan.id,name:plan.name,deviceCount:plan.devices.length,perCondition,
   indicators:{coverage:Math.min(1,Math.min(...perCondition.map(m=>m.coverageRate))+0.15*coreRedundant),coverageRaw:Math.min(...perCondition.map(m=>m.coverageRate)),coverageMean:mean(perCondition.map(m=>m.coverageRate)),coreRedundantRate:coreRedundant,blindRatio:mean(perCondition.map(m=>m.blindRate)),cost:plan.cost,feasibility}};
 });
 const range=key=>{const vs=rows.map(r=>r.indicators[key]);return [Math.min(...vs),Math.max(...vs)];};
 const ranges={coverage:range('coverage'),blindRatio:range('blindRatio'),cost:range('cost'),feasibility:range('feasibility')};
 for(const r of rows){
  r.normalized={coverage:normUp(r.indicators.coverage,ranges.coverage),blindRatio:normDown(r.indicators.blindRatio,ranges.blindRatio),cost:normDown(r.indicators.cost,ranges.cost),feasibility:normUp(r.indicators.feasibility,ranges.feasibility)};
  r.score=weights.coverage*r.normalized.coverage+weights.blind*r.normalized.blindRatio+weights.cost*r.normalized.cost+weights.feasibility*r.normalized.feasibility;
 }
 [...rows].sort((a,b)=>b.score-a.score||a.indicators.cost-b.indicators.cost).forEach((r,i)=>r.rank=i+1);
 rows.sort((a,b)=>a.rank-b.rank);
 return {plans:rows,recommendedId:rows[0].id,weights:{...weights},
  method:'覆盖完整性 = min(各工况 coverageRate) + 0.15×核心区二重覆盖率（coreRedundantRate，封顶 1，另附 coverageRaw/coverageMean）；盲区面积占比 = 各工况 blindRate 均值；成本为相对成本单位（非人民币报价）；施工可行性为全部设备 FEASIBILITY_MODEL 代理分均值。四指标跨方案 min-max 归一化至 [0,1]，盲区占比与成本反向（越小越好），score=Σ 权重×归一值；推荐得分最高方案，并列取成本较低者。'};
}

// 纯数据对比表（行=方案，列=四指标原值+归一值+score+rank+设备数），供 UI 与导出复用，不做 DOM。
export function comparisonTable(scored,conditions=[]){
 const nameOf=id=>conditions.find(c=>c.id===id)?.name??id;
 const columns=[
  {key:'rank',label:'排名'},{key:'name',label:'方案'},{key:'deviceCount',label:'设备数'},
  {key:'coverage',label:METRIC_LABELS.coverage},{key:'coverageNorm',label:'覆盖完整性（归一化）'},
  {key:'blindRatio',label:METRIC_LABELS.blind},{key:'blindRatioNorm',label:'盲区占比（归一化）'},
  {key:'cost',label:METRIC_LABELS.cost},{key:'costNorm',label:'成本（归一化）'},
  {key:'feasibility',label:METRIC_LABELS.feasibility},{key:'feasibilityNorm',label:'施工可行性（归一化）'},
  {key:'score',label:'综合得分'},
 ];
 const rows=scored.plans.map(p=>{
  const weakest=p.perCondition.reduce((a,b)=>b.coverageRate<a.coverageRate?b:a);
  return {rank:p.rank,id:p.id,name:p.name??p.id,deviceCount:p.deviceCount,
   coverage:p.indicators.coverage,coverageNorm:p.normalized.coverage,
   blindRatio:p.indicators.blindRatio,blindRatioNorm:p.normalized.blindRatio,
   cost:p.indicators.cost,costNorm:p.normalized.cost,
   feasibility:p.indicators.feasibility,feasibilityNorm:p.normalized.feasibility,
   score:p.score,weakestCondition:{condition:weakest.condition,name:nameOf(weakest.condition),coverageRate:weakest.coverageRate}};
 });
 return {columns,rows,weights:scored.weights,method:scored.method};
}
