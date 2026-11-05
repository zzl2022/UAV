import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,openSync,readSync,closeSync,statSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const sitePath=fileURLToPath(new URL('public/data/sites/',root));
const sites=[
 {id:'daxing',dir:'daxing/',base:'daxing-gba',imagery:'daxing-imagery',name:/大兴/},
 {id:'nuclear',dir:'nuclear/',base:'nuclear-gba',imagery:'nuclear-imagery',name:/核/},
 {id:'railway',dir:'railway/',base:'railway-gba',imagery:'railway-imagery',name:/铁路/},
];
for(const site of sites){
 const dir=`${sitePath}${site.dir}`;
 const paths={
  json:`${dir}${site.base}.json`,
  glb:`${dir}${site.base}.glb`,
  meta:`${dir}${site.base}-meta.json`,
  imagery:`${dir}${site.imagery}.jpg`,
  imageryMeta:`${dir}${site.imagery}.json`,
 };
 const available=Object.values(paths).every(path=>existsSync(path));
 test(`GBA site model ${site.id} carries provenance, imagery and a matching GLB`,{skip:!available&&`run npm run prepare:${site.id} first`},()=>{
  const data=JSON.parse(readFileSync(paths.json,'utf8')),meta=JSON.parse(readFileSync(paths.meta,'utf8'));
  assert.match(data.metadata.license,/CC BY-NC 4\.0/);
  assert.match(data.metadata.source,/GlobalBuildingAtlas/);
  assert.match(data.metadata.name,site.name);
  assert.equal(data.buildings.length,data.metadata.buildingCount);
  assert.ok(data.buildings.length>0);
  assert.ok(data.metadata.minHeight>=3&&data.metadata.maxHeight<300);
  const core=data.metadata.coreBuilding;
  assert.ok(core&&core.name&&core.rings?.length,'core building metadata is required');
  assert.ok(Number.isFinite(core.height)&&core.height>0);
  assert.ok(Array.isArray(core.center)&&core.center.length===2);
  assert.ok(core.areaM2>0);
  if(site.id==='railway')assert.ok(data.metadata.route?.points?.length>=2,'railway route is required');
  assert.equal(new Set(data.buildings.map(building=>building.id)).size,data.buildings.length,'building ids must be unique');
  for(const building of data.buildings){
   assert.ok(Number.isFinite(building.height)&&building.height>=3);
   for(const ring of building.rings){
    assert.ok(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));
    for(const point of ring){assert.equal(point.length,3);for(const value of point)assert.ok(Number.isFinite(value));}
   }
  }
  const imagery=JSON.parse(readFileSync(paths.imageryMeta,'utf8'));
  assert.deepEqual(imagery.bbox,data.metadata.bbox);
  assert.ok(statSync(paths.imagery).size>1000);
  assert.ok(imagery.width>=1024);
  assert.equal(meta.glb.file,`${site.base}.glb`);
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
}
