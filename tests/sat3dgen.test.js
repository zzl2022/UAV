import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const data=fileURLToPath(new URL('public/data/sat3dgen/',root));
const available=existsSync(`${data}manifest.json`);
test('Sat3DGen manifest and input crop stay consistent',{skip:!available&&'run npm run prepare:sat3dgen first'},()=>{
 const manifest=JSON.parse(readFileSync(`${data}manifest.json`,'utf8'));
 assert.ok(['pending','ready'].includes(manifest.status));
 assert.equal(manifest.center.length,2);
 for(const value of manifest.center)assert.ok(Number.isFinite(value));
 assert.ok(manifest.size>0);
 const satellite=`${data}${manifest.satellite}`;
 assert.equal(existsSync(satellite),true,`missing ${manifest.satellite}`);
 assert.ok(statSync(satellite).size>1000);
 if(manifest.status==='ready'){
  assert.ok(manifest.mesh);assert.equal(existsSync(`${data}${manifest.mesh}`),true);
  assert.ok(manifest.resolution>=128);assert.ok(statSync(`${data}${manifest.mesh}`).size>1e6);
  for(const key of ['streetviewVideo','panoramaVideo','orbitVideo']){
   if(manifest[key])assert.equal(existsSync(`${data}${manifest[key]}`),true);
  }
  if(manifest.fullMesh){
   assert.equal(existsSync(`${data}${manifest.fullMesh}`),true);
   assert.ok(manifest.fullResolution>=128);
  }
  if(manifest.cnbhMesh){
   assert.equal(existsSync(`${data}${manifest.cnbhMesh}`),true);
   assert.ok(manifest.cnbhBuildingCount>0);
   assert.match(manifest.cnbhLicense,/CC BY/);
  }
 }
});
