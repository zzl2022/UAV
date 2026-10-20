import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {museumLandmark} from '../src/landmarks.js';
import {nominalCoverage} from '../src/sensors/coverage.js';
import {createDevice,DEFAULT_TARGET,DEFAULT_ENV} from '../src/sensors/presets.js';
import {MODEL_VERSION,validateScenario} from '../src/sensors/engine.js';
const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));
test('museum marker uses the four named museum buildings and excludes residences',()=>{
 const landmark=museumLandmark(city);assert.equal(landmark.name,'河南博物院');assert.equal(landmark.buildingIds.length,4);
 for(const id of landmark.buildingIds)assert.equal(city.buildings.find(b=>b.id===id).name,'河南博物院');
 assert.ok(landmark.position[0]>200&&landmark.position[0]<500);assert.ok(landmark.position[1]>150);
 assert.equal(museumLandmark({buildings:[]}),null);
});
test('nominal shading respects slant range, blind zone, heading and FOV',()=>{
 const device=createDevice('radar-02c','test');Object.assign(device.parameters,{minRange:50,maxRange:500,azimuthFov:30,heading:90,pitch:0,elevationMin:0,elevationMax:40});
 const geometry=nominalCoverage(device,DEFAULT_TARGET),p=geometry.attributes.position;
 let maxRadius=0,minRadius=Infinity;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),r=Math.hypot(x,y,z);minRadius=Math.min(r,minRadius);maxRadius=Math.max(r,maxRadius);assert.ok(x>0);assert.ok(y>=0);assert.ok(Math.abs(Math.atan2(-z,x))<=15*Math.PI/180+1e-6);}
 assert.ok(Math.abs(minRadius-50)<0.001);assert.ok(Math.abs(maxRadius-500)<0.001);geometry.dispose();
 device.parameters.maxRange=900;const next=nominalCoverage(device,DEFAULT_TARGET);assert.equal(next.userData.maxRange,900);assert.ok(next.boundingBox.max.x>850);next.dispose();
});
test('optical shading changes with wide/narrow modes and respects pole limits',()=>{
 const device=createDevice('optical-nvt','test');
 const wide=nominalCoverage(device,{...DEFAULT_TARGET,opticalMode:'wide'}),narrow=nominalCoverage(device,{...DEFAULT_TARGET,opticalMode:'narrow'});
 assert.ok(wide.boundingBox.max.x>narrow.boundingBox.max.x*10);wide.dispose();narrow.dispose();
 device.parameters.pitch=90;const pole=nominalCoverage(device,DEFAULT_TARGET);assert.ok(pole.userData.elevationMax<=90);assert.ok(pole.userData.elevationMin>=-90);pole.dispose();
});
test('empty scenarios can be exported and imported without silently repopulating devices',()=>{
 const value={modelVersion:MODEL_VERSION,origin:city.metadata.origin,devices:[],target:structuredClone(DEFAULT_TARGET),environment:{...DEFAULT_ENV}};
 assert.deepEqual(validateScenario(JSON.parse(JSON.stringify(value)),city.metadata.origin),value);
});
