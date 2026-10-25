import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,openSync,readSync,closeSync,statSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const paths={
 json:fileURLToPath(new URL('public/data/open-lod1.json',root)),
 glb:fileURLToPath(new URL('public/data/open-lod1.glb',root)),
 meta:fileURLToPath(new URL('public/data/open-lod1-meta.json',root)),
};
const available=Object.values(paths).every(path=>existsSync(path));
test('GBA LoD1 comparison model carries provenance, valid ENU rings and a matching GLB',{skip:!available&&'run npm run prepare:open-model first'},()=>{
 const data=JSON.parse(readFileSync(paths.json,'utf8')),meta=JSON.parse(readFileSync(paths.meta,'utf8'));
 assert.equal(data.metadata.source,'GlobalBuildingAtlas LoD1');
 assert.match(data.metadata.license,/CC BY-NC 4\.0/);
 assert.match(data.metadata.attribution,/GlobalBuildingAtlas/);
 assert.match(data.metadata.attribution,/OpenStreetMap/);
 assert.equal(data.buildings.length,data.metadata.buildingCount);
 assert.ok(data.buildings.length>10000);
 assert.ok(data.metadata.minHeight>=2&&data.metadata.maxHeight<200);
 assert.equal(data.metadata.origin.length,3);for(const value of data.metadata.origin)assert.ok(Number.isFinite(value));
 for(const building of data.buildings){
  assert.ok(Number.isFinite(building.height)&&building.height>=2);
  assert.ok(Number.isFinite(building.foundationDepth)&&building.foundationDepth>=0);
  for(const ring of building.rings){
   assert.ok(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));
   for(const point of ring){assert.equal(point.length,3);for(const value of point)assert.ok(Number.isFinite(value));}
  }
 }
 assert.equal(meta.glb.file,'open-lod1.glb');
 assert.equal(meta.glb.bytes,statSync(paths.glb).size);
 const fd=openSync(paths.glb,'r');
 try{
  const header=Buffer.alloc(20);readSync(fd,header,0,20,0);
  assert.equal(header.toString('ascii',0,4),'glTF');
  assert.equal(header.readUInt32LE(4),2);
  assert.equal(header.readUInt32LE(8),meta.glb.bytes);
  const jsonLength=header.readUInt32LE(12),jsonType=header.toString('ascii',16,20);
  assert.equal(jsonType,'JSON');
  const chunk=Buffer.alloc(jsonLength);readSync(fd,chunk,0,jsonLength,20);
  const gltf=JSON.parse(chunk.toString('utf8'));
  assert.equal(gltf.asset.version,'2.0');
  assert.equal(gltf.meshes.length,1);
  assert.equal(gltf.meshes[0].primitives.length,1);
  assert.equal(gltf.accessors[0].count,meta.mesh.vertices);
  assert.equal(meta.mesh.triangles,meta.mesh.vertices/3);
 }finally{closeSync(fd);}
});
