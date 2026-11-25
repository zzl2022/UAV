import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainFloatingRect,initialFloatingRect,resizeFloatingRect} from '../src/task3/floating-window.js';

const options={minWidth:320,minHeight:240,maxWidth:700,maxHeight:600};
const inside=(rect,viewport)=>{
 assert.ok(rect.x>=8&&rect.y>=8);assert.ok(rect.x+rect.width<=viewport.width-8+1e-9);assert.ok(rect.y+rect.height<=viewport.height-8+1e-9);
};

test('task3 floating window: 初始位置靠右，尺寸适中且受最大尺寸约束',()=>{
 assert.deepEqual(initialFloatingRect({width:1200,height:800},{width:560,height:560,...options}),{x:616,y:88,width:560,height:560});
 const rect=initialFloatingRect({width:800,height:600},{width:720,height:580,...options});
 assert.equal(rect.width,700);assert.equal(rect.height,580);assert.equal(rect.x,76);assert.equal(rect.y,12);inside(rect,{width:800,height:600});
});

test('task3 floating window: 小视口保留可用尺寸，拖动后不能越出视口',()=>{
 const initial=initialFloatingRect({width:280,height:240},{width:480,height:620,minWidth:320,minHeight:240});
 assert.deepEqual(initial,{x:8,y:8,width:264,height:224});
 assert.deepEqual(constrainFloatingRect({x:-100,y:1000,width:400,height:300},{width:800,height:600},options),{x:8,y:292,width:400,height:300});
});

test('task3 floating window: 四边缩放保持对边固定并执行最小尺寸',()=>{
 const start={x:200,y:150,width:400,height:300},viewport={width:1000,height:800};
 assert.deepEqual(resizeFloatingRect(start,{dx:250,direction:'e'},viewport,options),{...start,width:650});
 assert.deepEqual(resizeFloatingRect(start,{dx:100,direction:'w'},viewport,options),{...start,x:280,width:320});
 assert.deepEqual(resizeFloatingRect(start,{dy:100,direction:'n'},viewport,options),{...start,y:210,height:240});
 assert.deepEqual(resizeFloatingRect(start,{dy:400,direction:'s'},viewport,options),{...start,height:600});
});

test('task3 floating window: 四角缩放和边缘拖拽均受视口约束',()=>{
 const start={x:200,y:150,width:400,height:300},viewport={width:1000,height:800};
 assert.deepEqual(resizeFloatingRect(start,{dx:50,dy:40,direction:'nw'},viewport,options),{x:250,y:190,width:350,height:260});
 assert.deepEqual(resizeFloatingRect(start,{dx:100,dy:-50,direction:'ne'},viewport,options),{x:200,y:100,width:500,height:350});
 assert.deepEqual(resizeFloatingRect(start,{dx:-50,dy:50,direction:'sw'},viewport,options),{x:150,y:150,width:450,height:350});
 assert.deepEqual(resizeFloatingRect(start,{dx:-1000,dy:-1000,direction:'se'},viewport,options),{...start,width:320,height:240});
 const west=resizeFloatingRect(start,{dx:-1000,direction:'w'},viewport,options),north=resizeFloatingRect(start,{dy:-1000,direction:'n'},viewport,options);
 assert.equal(west.x,8);assert.equal(west.x+west.width,600);assert.equal(north.y,8);assert.equal(north.y+north.height,450);inside(west,viewport);inside(north,viewport);
});
