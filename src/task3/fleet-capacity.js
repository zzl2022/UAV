// Maximize the number of distinct originally uncovered samples served with a fixed fleet.
// Each row represents samples with identical visibility across validated stationary vehicles.
export function estimateFleetCoverage(solver,{available,totalCars,groups}){
 if(!Number.isSafeInteger(available)||available<0||!Number.isSafeInteger(totalCars)||totalCars<0)throw Error('警车数量必须是非负整数。');
 const valid=groups.filter(g=>g.cars.length),total=groups.reduce((sum,g)=>sum+g.count,0);
 if(!available||!valid.length)return {covered:0,total,used:0};
 const cars=Array.from({length:totalCars},(_,i)=>'v'+i);
 const model=['Maximize',' score: '+valid.map((g,i)=>g.count+' y'+i).join(' + '),'Subject To',
  ' fleet: '+cars.join(' + ')+' <= '+Math.min(available,totalCars),
  ...valid.map((g,i)=>' group'+i+': y'+i+' - '+g.cars.map(j=>cars[j]).join(' - ')+' <= 0'),
  'Binary',...cars,...valid.map((_,i)=>'y'+i),'End'].join('\n');
 const result=solver.solve(model,{time_limit:10,mip_rel_gap:0});
 if(result.Status!=='Optimal')throw Error('求解器未在时限内确认最优汇总值，请调整输入后重试。');
 return {covered:Math.round(result.ObjectiveValue),total,used:cars.filter(c=>result.Columns[c].Primal>.5).length};
}
