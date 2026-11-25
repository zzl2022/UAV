import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
const building={id:'courtyard',name:'fixture',height:20,foundationDepth:0,rings:[[[0,10,0],[10,10,0],[10,10,10],[0,10,10],[0,10,0]],[[3,10,3],[3,10,7],[7,10,7],[7,10,3],[3,10,3]]]};
const terrain={positions:[-100,0,-100,100,0,-100,-100,0,100,100,0,100],indices:[0,2,1,1,2,3]};
const model=createModel({metadata:{},buildings:[building]},terrain),query=createSceneQuery(model);
test('BVH LOS intersects actual building volume but leaves courtyard empty',()=>{
 const blocked=query.trace([-10,20,1],[20,20,1]);assert.ok(blocked.blocked);assert.equal(blocked.buildingCount,1);assert.equal(blocked.clearance,10);
 const above=query.trace([-10,40,1],[20,40,1]);assert.ok(!above.blocked);
 const courtyard=query.trace([5,15,5],[5,50,5]);assert.ok(!courtyard.blocked);assert.equal(courtyard.buildingCount,0);
});
test('geometry visibility never disables physical occlusion and face ordering remains stable',()=>{
 model.buildings.visible=false;assert.ok(query.trace([-10,20,1],[20,20,1]).blocked);
 assert.equal(query.featureAt(0).id,'courtyard');assert.equal(query.featureAt(100000),null);
});
test('terrain blocks subsurface paths and missing terrain reports uncertainty',()=>{
 assert.equal(query.groundAt(0,0),0);assert.equal(query.groundAt(500,500),null);
 const below=query.trace([-10,-5,0],[20,-5,0]);assert.ok(below.blocked);assert.ok(below.clearance>=5);
 const outside=query.trace([200,50,200],[300,50,200]);assert.ok(!outside.known);
});
