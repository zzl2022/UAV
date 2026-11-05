import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCityGeometry,buildTerrainGeometry} from '../src/model.js';
const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));
const terrain=JSON.parse(readFileSync(new URL('../public/data/terrain.json',import.meta.url)));
test('real repository dataset retains all source features, high values, and provenance',()=>{
 assert.equal(city.metadata.sourceFeatures,15889);
 assert.equal(city.metadata.excludedFeatures.length,0);
 assert.equal(city.metadata.heightField,'high');
 assert.equal(city.metadata.minHeight,3);assert.equal(city.metadata.maxHeight,136);
 assert.ok(city.metadata.origin[0]>113.6&&city.metadata.origin[0]<113.8);
 assert.ok(city.metadata.origin[1]>34.7&&city.metadata.origin[1]<34.9);
 assert.equal(city.metadata.missingDEMSamples,0);
 for(const b of city.buildings){assert.ok(b.height>=3&&b.height<=136);assert.ok(Number.isFinite(b.ground)&&b.ground>=64&&b.ground<=139);for(const r of b.rings){assert.deepEqual(r[0],r.at(-1));assert.ok(r.length>=4);}}
 for(const [path,hash] of Object.entries(city.metadata.sources)) assert.equal(createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex'),hash);
});
test('extrusion preserves a courtyard and height/foundation in metric space',()=>{
 const rings=[[[0,100,0],[10,100,0],[10,100,10],[0,100,10],[0,100,0]],[[3,100,3],[3,100,7],[7,100,7],[7,100,3],[3,100,3]]];
 const {geometry,ranges}=buildCityGeometry([{rings,height:20,foundationDepth:2}]);
 assert.equal(geometry.boundingBox.min.y,98);assert.equal(geometry.boundingBox.max.y,120);
 const p=geometry.attributes.position.array;let area=0;
 for(let i=0;i<p.length;i+=9)if(p[i+1]===120&&p[i+4]===120&&p[i+7]===120)area+=Math.abs((p[i+3]-p[i])*(p[i+8]-p[i+2])-(p[i+6]-p[i])*(p[i+5]-p[i+2]))/2;
 assert.equal(area,84);assert.equal(ranges[0].end,p.length/9);
 geometry.dispose();
});
test('real geometry contains every building and finite coordinates',()=>{
 const {geometry,ranges}=buildCityGeometry(city.buildings);
 assert.equal(ranges.length,city.buildings.length);assert.ok(geometry.attributes.position.count>100000);
 for(const n of geometry.attributes.position.array)assert.ok(Number.isFinite(n));
 assert.ok(geometry.boundingBox.max.x-geometry.boundingBox.min.x>9000);
 assert.ok(geometry.boundingBox.max.z-geometry.boundingBox.min.z>5000);
 geometry.dispose();
});
test('terrain excludes nodata and has upward normals and valid triangle indices',()=>{
 const g=buildTerrainGeometry(terrain);const count=g.attributes.position.count;
 assert.equal(count,terrain.rows*terrain.cols-city.metadata.terrainNodataCells);
 for(const i of g.index.array)assert.ok(i>=0&&i<count);
 for(let i=1;i<g.attributes.normal.array.length;i+=3)assert.ok(g.attributes.normal.array[i]>=0);
 assert.ok(terrain.indices.length>100000);g.dispose();
});
test('imagery UVs preserve georeferencing and north-up orientation',()=>{
 if(!terrain.imagery)return;
 const g=buildTerrainGeometry(terrain);const uv=g.getAttribute('uv');
 assert.equal(uv.count,g.attributes.position.count);
 for(let i=0;i<uv.count;i++){assert.ok(uv.getX(i)>=0&&uv.getX(i)<=1);assert.ok(uv.getY(i)>=0&&uv.getY(i)<=1);}
 // Terrain vertices are emitted north-to-south, west-to-east.
 assert.ok(uv.getY(0)>uv.getY(uv.count-1));
 assert.equal(terrain.imagery.sourceWidth,5259);assert.equal(terrain.imagery.sourceHeight,2416);
 assert.equal(terrain.imagery.textureWidth,4096);
 g.dispose();
});
