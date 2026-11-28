import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {advanceRecordedFrame,createRecordedPlaybackVisuals,seekRecordedFrame} from '../src/task3/recorded-playback.js';

test('回放增量推进至当前时间，二分拖动保留读到下一帧的交互',()=>{
 const frames=[0,1,2,2,4.5,6].map(time=>({time}));
 let cursor=0;
 for(const [time,expected] of [[-1,0],[.5,0],[1,1],[1.99,1],[2,3],[3,3],[4.5,4],[6,5],[10,5]]){
  cursor=advanceRecordedFrame(frames,cursor,time);
  assert.equal(cursor,expected);
 }
 assert.equal(seekRecordedFrame(frames,2),2);
 assert.equal(seekRecordedFrame(frames,3),4);
 assert.equal(seekRecordedFrame(frames,10),5);
 assert.equal(seekRecordedFrame(frames,0),0);
});

test('同一记录保留网格、航线和线缓冲区，变化只写可见数据，停止释放资源',()=>{
 const target=(id,position,detectedBy=[])=>({id,position,detectedBy:detectedBy.map(id=>({id}))});
 const devices=new Map([['device',{position:[-1,2,-3]}]]);
 const frames=[
  {time:0,targets:[target('one',[0,1,0],['device','device','absent'])]},
  {time:1,targets:[target('one',[2,1,1]),target('two',[6,3,0],['device'])]},
  {time:2,targets:[]},
  {time:3,targets:[target('one',[5,1,2],['device'])]},
 ];
 const scene=new THREE.Group(),playback=createRecordedPlaybackVisuals(scene),record={frames};
 playback.select(record);
 assert.equal(playback.routes.length,1);assert.equal(playback.targets.length,0);
 const route=playback.routes[0];
 playback.prepare(record,devices);
 const first=playback.drones.get('one'),second=playback.drones.get('two'),line=playback.lines;
 const {geometry,material}=line,buffer=geometry.getAttribute('position'),counts={...playback.allocations};
 assert.equal(playback.routes[0],route);
 assert.equal(buffer.count,4);
 playback.install(0);
 assert.deepEqual([...buffer.array.subarray(0,6)],[-1,2,-3,0,1,0]);
 assert.equal(geometry.drawRange.count,2);
 assert.equal(playback.segmentCount,1);
 assert.equal(first.quaternion.toArray().every(Number.isFinite),true);assert.equal(first.visible,true);assert.equal(second.visible,false);
 assert.deepEqual([...playback.detectedIds],['device','absent']);
 playback.install(1);assert.equal(second.visible,true);assert.equal(geometry.drawRange.count,2);
 playback.install(2);assert.equal(geometry.drawRange.count,0);assert.equal(line.visible,false);assert.equal(first.visible,false);
 playback.install(0);playback.prepare(record,devices);
 assert.equal(playback.drones.get('one'),first);assert.equal(playback.lines.geometry,geometry);assert.equal(playback.lines.material,material);
 assert.deepEqual(playback.allocations,counts);
 let disposed=0;geometry.addEventListener('dispose',()=>disposed++);material.addEventListener('dispose',()=>disposed++);
 playback.clear();playback.clear();
 assert.equal(disposed,2);assert.equal(scene.children.length,0);assert.equal(playback.drones.size,0);
});
