import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fixture,generate,audit} from './fixtures.mjs';

const out='artifacts/domain-study';
const {weights,compiled,lean,mixing,reference}=JSON.parse(await readFile(`${out}/calibrator.json`,'utf8'));
const confirm=process.argv.includes('--confirm');
const methods=confirm?['economy','balanced','enhanced','calibrated']:['economy','balanced','enhanced','search','compiled'];
const seeds=confirm?[311,312,313,314]:[201,202,203,204];
const profiles=['small','medium','large'];
function predict(x){
 let z=x.map((v,i)=>(v-weights.mu[i])/weights.scale[i]);
 for(const [i,layer] of weights.layers.entries()){
  z=layer.weight.map((w,j)=>{
   const value=w.reduce((sum,a,k)=>sum+a*z[k],layer.bias[j]);
   return i<2?Math.max(0,value):value;
  });
 }
 return Math.min(1,Math.max(0,x[0]+z.reduce((a,b)=>a+b,0)/z.length));
}
function features(row){
 const metrics=['nominal','silent','weather','interference'].map(id=>row.trainMetrics.find(m=>m.condition===id));
 return [...metrics.map(m=>m.coverageRate),...metrics.map(m=>m.redundant/m.total),
  ...['radar','radio','optical','acoustic'].map(k=>row.typeCounts[k]),row.deviceCount,row.cost,row.budgetLimit,row.deviceLimit];
}
for(const r of reference)assert.ok(Math.abs(predict(r.x)-r.prediction)<1e-5,'Python / JS prediction mismatch');
async function solve(ctx,method){
 if(!['compiled','search','calibrated'].includes(method)){
  const g=await generate(ctx,method);
  return {g,prediction:g.row.trainMetrics.find(m=>m.condition==='nominal').coverageRate};
 }
 const options=[];
 for(const name of method==='search'?profiles:[method==='calibrated'?lean:compiled]){
  const g=await generate(ctx,name);
  if(g.row.feasible){
   const x=features(g.row),prediction=predict(x);
   options.push({g,prediction:method==='calibrated'?x[0]+mixing*(prediction-x[0]):prediction});
  }
 }
 if(!options.length)return null;
 const best=Math.max(...options.map(o=>o.prediction));
 return options.filter(o=>o.prediction>=best-.01).sort((a,b)=>a.g.row.cost-b.g.row.cost||b.prediction-a.prediction||a.g.row.key.localeCompare(b.g.row.key))[0];
}
const mean=arr=>arr.reduce((sum,x)=>sum+x,0)/arr.length;
const median=arr=>[...arr].sort((a,b)=>a-b)[Math.floor(arr.length/2)];
const rows=[];
await solve(fixture(97),'search');
for(const seed of seeds)for(let repeat=0;repeat<3;repeat++){
 for(let i=0;i<methods.length;i++){
  const method=methods[(i+repeat+seed)%methods.length];
  const ctx=fixture(seed),start=performance.now(),selected=await solve(ctx,method);
  const elapsedMs=performance.now()-start;
  if(!selected){rows.push({method,seed,repeat,elapsedMs,feasible:false});continue;}
  const {g,prediction}=selected,validation=audit(ctx,g);
  rows.push({method,seed,repeat,elapsedMs,profile:g.row.key,feasible:g.row.feasible,cost:g.row.cost,prediction,
   coverage:validation.auditCoverage,error:Math.abs(prediction-validation.auditCoverage),auditPoints:validation.validationPointCount});
 }
}
const summary={};
for(const method of methods){
 const group=rows.filter(r=>r.method===method);
 const stats={feasible:group.filter(r=>r.feasible).length,requested:group.length};
 for(const field of ['cost','elapsedMs','coverage','error']){
  stats[field]=group.every(r=>Number.isFinite(r[field]))?mean(seeds.map(seed=>median(group.filter(r=>r.seed===seed).map(r=>r[field])))):null;
 }
 summary[method]=stats;
}
const passed={};
for(const method of methods.slice(3)){
 const result=summary[method],base=methods.slice(0,3).map(k=>summary[k]);
 passed[method]={feasible:result.feasible===result.requested,
  cost:result.cost!==null&&base.every(b=>result.cost<b.cost),
  time:base.every(b=>result.elapsedMs<b.elapsedMs),
  precision:result.error!==null&&base.every(b=>result.error<b.error),
  service:result.coverage!==null&&base.every(b=>result.coverage>=b.coverage)};
}
await writeFile(`${out}/${confirm?'confirmation':'paired-benchmark'}.json`,JSON.stringify({rows,summary,passed,hardware:process.arch,node:process.version},null,2));
console.log(JSON.stringify({summary,passed},null,2));
