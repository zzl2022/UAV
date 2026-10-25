import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,openSync,readSync,closeSync,statSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const dir=fileURLToPath(new URL('public/data/beijing/',root));
const paths={
 json:`${dir}beijing-osm.json`,
 glb:`${dir}beijing-osm.glb`,
 meta:`${dir}beijing-osm-meta.json`,
};
const available=Object.values(paths).every(path=>existsSync(path));
test('Beijing OSM + CNBH per-building model is valid',{skip:!available&&'run npm run prepare:beijing:win first'},()=>{
 const data=JSON.parse(readFileSync(paths.json,'utf8')),meta=JSON.parse(readFileSync(paths.meta,'utf8'));
 assert.match(data.metadata.license,/ODbL/);
 assert.match(data.metadata.license,/CC BY 4\.0/);
 assert.equal(data.buildings.length,data.metadata.buildingCount);
 assert.ok(data.buildings.length>1000);
 assert.ok(data.metadata.minHeight>=3&&data.metadata.maxHeight<400);
 const cnbhHeights=data.buildings.filter(building=>building.heightSource==='CNBH-10m');
 assert.ok(cnbhHeights.length>data.buildings.length*0.9,'CNBH join should cover most footprints');
 assert.ok(data.metadata.skipped.defaultHeight<data.buildings.length*0.01,'6 m fallback should be rare');
 for(const building of data.buildings){
  assert.ok(Number.isFinite(building.height)&&building.height>=3);
  for(const ring of building.rings){
   assert.ok(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));
   for(const point of ring){assert.equal(point.length,3);for(const value of point)assert.ok(Number.isFinite(value));}
  }
 }
 assert.equal(meta.glb.file,'beijing-osm.glb');
 assert.equal(meta.glb.bytes,statSync(paths.glb).size);
 const fd=openSync(paths.glb,'r');
 try{
  const header=Buffer.alloc(20);readSync(fd,header,0,20,0);
  assert.equal(header.toString('ascii',0,4),'glTF');
  assert.equal(header.readUInt32LE(4),2);
  assert.equal(header.readUInt32LE(8),meta.glb.bytes);
  const length=header.readUInt32LE(12);assert.equal(header.toString('ascii',16,20),'JSON');
  const chunk=Buffer.alloc(length);readSync(fd,chunk,0,length,20);
  const gltf=JSON.parse(chunk.toString('utf8'));
  assert.equal(gltf.asset.version,'2.0');
  assert.equal(gltf.meshes.length,1);
  assert.equal(gltf.accessors[0].count,meta.mesh.vertices);
 }finally{closeSync(fd);}
});
