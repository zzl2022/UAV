import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createModel} from '../../src/model.js';
import {createSceneQuery} from '../../src/sensors/scene.js';
import {DEFAULT_ENV,DEFAULT_TARGET} from '../../src/sensors/presets.js';
import {runTask3Pipeline} from '../../src/task3/pipeline.js';
import {TASK3_DEFAULT_SETTINGS} from '../../src/task3/scope.js';
import {makeAuditSamples,makeAuditEvaluator,validateFinalPlan} from '../cross-map-study/measure.js';

const out='artifacts/domain-study';
const limits={economy:1,balanced:1,enhanced:1,small:0.45,medium:0.65,large:0.9};
export function fixture(seed){
 let state=seed;
 const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const buildings=[];
 for(let ix=-2;ix<=2;ix++)for(let iz=-2;iz<=2;iz++){
  const x=ix*135+random()*35,z=iz*135+random()*35,width=20+random()*45,depth=20+random()*45;
  buildings.push({id:`block-${ix}-${iz}`,name:'合成体块',height:8+random()*70,foundationDepth:0,rings:[[[x,0,z],[x+width,0,z],[x+width,0,z+depth],[x,0,z+depth],[x,0,z]]]});
 }
 const city={buildings,metadata:{origin:[0,0,0],coreBuilding:buildings[12],sources:{fixture:seed}}};
 const terrain={positions:[-800,0,-800,800,0,-800,800,0,800,-800,0,800],indices:[0,2,1,0,3,2]};
 return {city,query:createSceneQuery(createModel(city,terrain))};
}
export async function generate(ctx,key){
 const planId=['small','medium','large'].includes(key)?'balanced':key;
 const settings={...TASK3_DEFAULT_SETTINGS,scope:'custom',scopeWidthM:720,scopeDepthM:720,spacing:150,siteSpacing:300,maxSites:12,budget:Math.round(85*limits[key]),maxDevices:10,heights:[30,60,100]};
 const {report}=await runTask3Pipeline({...ctx,settings,presetIds:['radar-03d','radio-tdoa','optical-nvt','acoustic-cry'],planTypes:[planId],withThreatFrames:false});
 const plan=report.plans[0],validation=validateFinalPlan(ctx.city,ctx.query,report,plan);
 const row={key,planId,trainMetrics:plan.metrics,cost:plan.cost,deviceCount:plan.devices.length,typeCounts:validation.actualTypeCounts,
  budgetLimit:plan.budget,deviceLimit:plan.maxDevices,emcFail:report.emc[planId].counts.fail,feasible:validation.passed&&plan.deployable};
 return {row,plan,bounds:report.sampling.bounds,margin:settings.marginReserveDb};
}
export function audit(ctx,generated){
 const grid=makeAuditSamples(ctx.query,generated.bounds,{spacing:110,heights:[20,45,90],offset:.37});
 const metrics=makeAuditEvaluator(ctx.query,grid)(generated.plan.devices,DEFAULT_ENV,DEFAULT_TARGET,generated.margin);
 return {auditCoverage:metrics.metrics[0].coverageRate,validationPointCount:grid.points.length};
}
async function run(seed,key){
 const ctx=fixture(seed),start=performance.now();
 const g=await generate(ctx,key);
 return {...g.row,seed,elapsedMs:performance.now()-start,...audit(ctx,g)};
}

async function collect(){
 await mkdir(out,{recursive:true});
 await run(97,'balanced');
 const rows=[],keys=Object.keys(limits);
 for(const seed of [101,102,103]){
  for(let i=0;i<keys.length;i++){
   const key=keys[(i+seed)%keys.length];
   rows.push(await run(seed,key));
  }
 }
 await writeFile(`${out}/fixtures.json`,JSON.stringify(rows));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await collect();
