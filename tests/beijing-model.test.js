import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,openSync,readSync,closeSync,statSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const dir=fileURLToPath(new URL('public/data/beijing/',root));
const paths={
 json:`${dir}beijing-cnbh.json`,
 glb:`${dir}beijing-cnbh.glb`,
 meta:`${dir}beijing-cnbh-meta.json`,
 imagery:`${dir}beijing-imagery.jpg`,
 imageryMeta:`${dir}beijing-imagery.json`,
};
const available=Object.values(paths).every(path=>existsSync(path));
test('Beijing CNBH 5 km blocks and 天地图 imagery are consistent',{skip:!available&&'run npm run prepare:beijing:win first'},()=>{
 const data=JSON.parse(readFileSync(paths.json,'utf8')),meta=JSON.parse(readFileSync(paths.meta,'utf8'));
 assert.match(data.metadata.license,/CC BY 4\.0/);
 assert.match(data.metadata.source,/CNBH-10m/);
 assert.equal(data.metadata.cellSizeMeters,20);
 assert.equal(data.metadata.sourceCellSizeMeters,10);
 assert.equal(data.buildings.length,data.metadata.blockCount);
 assert.ok(data.buildings.length>1000);
 assert.ok(data.metadata.minHeight>=2&&data.metadata.maxHeight<200);
 for(const building of data.buildings){
  assert.ok(Number.isFinite(building.height)&&building.height>0);
  for(const ring of building.rings){
   assert.ok(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));
   for(const point of ring){assert.equal(point.length,3);for(const value of point)assert.ok(Number.isFinite(value));}
  }
 }
 assert.ok(statSync(paths.imagery).size>1000);
 const imagery=JSON.parse(readFileSync(paths.imageryMeta,'utf8'));
 assert.equal(imagery.bbox.length,4);assert.ok(imagery.width>=1024);
 assert.equal(meta.glb.file,'beijing-cnbh.glb');
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
