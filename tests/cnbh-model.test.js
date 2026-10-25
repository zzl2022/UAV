import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,openSync,readSync,closeSync,statSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const paths={
 json:fileURLToPath(new URL('public/data/sat3dgen/cnbh-model.json',root)),
 glb:fileURLToPath(new URL('public/data/sat3dgen/cnbh-model.glb',root)),
 meta:fileURLToPath(new URL('public/data/sat3dgen/cnbh-model-meta.json',root)),
};
const available=Object.values(paths).every(path=>existsSync(path));
test('CNBH-10m full-extent model carries provenance, valid rings and a matching GLB',{skip:!available&&'run npm run prepare:cnbh first'},()=>{
 const data=JSON.parse(readFileSync(paths.json,'utf8')),meta=JSON.parse(readFileSync(paths.meta,'utf8'));
 assert.match(data.metadata.license,/CC BY 4\.0/);
 assert.match(data.metadata.source,/CNBH-10m/);
 assert.equal(data.buildings.length,data.metadata.buildingCount);
 assert.ok(data.buildings.length>10000);
 assert.ok(data.metadata.minHeight>0&&data.metadata.maxHeight<300);
 assert.equal(data.metadata.cnbhResolutionMeters,10);
 for(const building of data.buildings){
  assert.ok(Number.isFinite(building.height)&&building.height>0);
  assert.ok(Number.isFinite(building.foundationDepth)&&building.foundationDepth>=0);
  for(const ring of building.rings){
   assert.ok(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));
   for(const point of ring){assert.equal(point.length,3);for(const value of point)assert.ok(Number.isFinite(value));}
  }
 }
 assert.equal(meta.glb.file,'cnbh-model.glb');
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
  assert.equal(gltf.accessors[0].count,meta.mesh.vertices);
 }finally{closeSync(fd);}
});
