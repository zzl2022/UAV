import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {evaluate} from '../src/sensors/engine.js';
import {scenarios,emcCheck} from '../src/planning/optimizer.js';
const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url)));
const city=json('../public/data/city.json'),terrain=json('../public/data/terrain.json'),report=json('../public/deployment-example.json');
const plan=report.plans.find(p=>p.id===report.selectedId),query=createSceneQuery(createModel(city,terrain),{fastGround:false});
test('independent real-scene ray checks reproduce covered samples and retained interference blind spots',()=>{
 const conditions=scenarios(report.environment),emc=emcCheck(plan.devices);
 for(const c of [0,3]){
  const blind=plan.coverage[c].map((count,j)=>count===0?j:-1).filter(j=>j>=0).slice(0,2);
  for(const j of new Set([0,Math.floor(report.sampling.samples.length/2),report.sampling.samples.length-1,...blind])){
   const position=report.sampling.samples[j].position,condition=conditions[c];let covered=false;
   for(const device of plan.devices){const result=evaluate(device,{...report.target,...condition.target,position},{...condition.environment,cochannelDb:condition.environment.cochannelDb+emc.penalties[device.id]},query.trace(device.position,position));if(result.status==='within-model'&&result.marginDb>=report.settings.marginReserveDb){covered=true;break;}}
   assert.equal(covered,plan.coverage[c][j]>0,`condition ${c}, sample ${j}`);
  }
 }
});
test('representative route segments are collision-free and respect the configured climb envelope',()=>{
 const points=report.route.points;
 for(let i=1;i<points.length;i++){const a=points[i-1].position,b=points[i].position,horizontal=Math.hypot(b[0]-a[0],b[2]-a[2]);assert.ok(Math.abs(b[1]-a[1])<=horizontal/3+1e-6);}
 for(const i of [1,Math.floor(points.length/2),points.length-1]){const result=query.trace(points[i-1].position,points[i].position);assert.ok(!result.blocked);assert.ok(result.known);}
});
