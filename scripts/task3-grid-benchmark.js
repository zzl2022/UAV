// Run each spacing in a fresh process so that peak RSS includes the same model and pipeline.
import {readFileSync} from 'node:fs';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';
import {evaluate} from '../src/sensors/engine.js';
import {runTask3Pipeline} from '../src/task3/pipeline.js';
import {TASK3_DEFAULT_SETTINGS,parseTask3Spacing} from '../src/task3/scope.js';

const spacing=parseTask3Spacing(process.argv[2]);
const read=name=>JSON.parse(readFileSync(new URL('../public/data/'+name+'.json',import.meta.url)));
const city=read('city'),query=createSceneQuery(createModel(city,read('terrain')));
const settings={...TASK3_DEFAULT_SETTINGS,scope:'custom',scopeWidthM:900,scopeDepthM:900,spacing,maxSites:12,maxDevices:12};
const {report}=await runTask3Pipeline({city,query,settings,presetIds:['radar-03d','radio-tdoa','optical-nvt','acoustic-cry'],planTypes:['balanced']});
const peakProcessMiB=process.resourceUsage().maxRSS/1024;
const plan=report.plans[0],b=report.sampling.bounds,penalties=report.emc[plan.id].penalties;
let total=0,covered=0;
for(let x=b.west+9;x<b.east;x+=25)for(let z=b.south+11;z<b.north;z+=25){
 const ground=query.groundAt(x,z),surface=query.surfaceAt(x,z);if(ground===null||surface===null)continue;
 for(const height of settings.heights){
  const position=[x,ground+height,z];if(position[1]<=surface+1)continue;
  total++;
  if(plan.devices.some(d=>{
   const env={...DEFAULT_ENV,cochannelDb:DEFAULT_ENV.cochannelDb+(penalties[d.id]??0)};
   const r=evaluate(d,{...DEFAULT_TARGET,position,emitting:true,count:1},env,query.trace(d.position,position));
   return r.status==='within-model'&&r.marginDb>=settings.marginReserveDb;
  }))covered++;
 }
}
console.log(JSON.stringify({spacing,samples:report.sampling.samples.length,candidates:report.candidateCount,
 devices:plan.devices.length,durationMs:report.durationMs,peakProcessMiB,reportBytes:Buffer.byteLength(JSON.stringify(report)),
 estimatedCoverage:plan.metrics[0].coverageRate,auditSamples:total,auditCoverage:covered/total}));
