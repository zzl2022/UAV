import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url))),terrain=JSON.parse(readFileSync(new URL('../public/data/terrain.json',import.meta.url)));
const model=createModel(city,terrain),query=createSceneQuery(model);
test('accelerated terrain queries match original mesh ray heights and preserve nodata holes',()=>{
 const box=model.ground.geometry.boundingBox;let valid=0,missing=0;
 for(let i=0;i<250;i++){
  const x=box.min.x+((i*127)%251)/251*(box.max.x-box.min.x),z=box.min.z+((i*83)%257)/257*(box.max.z-box.min.z);
  const fast=query.groundAt(x,z),ray=query.groundAtRaycast(x,z);
  assert.equal(fast===null,ray===null,`coverage at ${x},${z}`);
  if(ray===null)missing++;else{valid++;assert.ok(Math.abs(fast-ray)<1e-6);}
 }
 assert.ok(valid>100);assert.ok(missing>10);
});
