import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {constrainDeviceHoverPosition,pickDeviceTarget,createDeviceHover} from '../src/task3/device-hover.js';

const makeCamera=()=>{const camera=new THREE.PerspectiveCamera(45,800/600,0.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld();return camera;};
const makeMarker=(id,position=[0,0,0])=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshBasicMaterial());mesh.position.fromArray(position);mesh.userData.deviceId=id;mesh.updateMatrixWorld();return mesh;};

test('task3 device hover: 卡片靠近光标并在四边和小视口内约束',()=>{
 const viewport={width:800,height:600},card={width:320,height:280};
 assert.deepEqual(constrainDeviceHoverPosition({x:10,y:10},card,viewport),{x:24,y:24});
 const bottomRight=constrainDeviceHoverPosition({x:790,y:590},card,viewport);
 assert.deepEqual(bottomRight,{x:456,y:296});
 assert.ok(bottomRight.x+card.width<=792&&bottomRight.y+card.height<=592);
 assert.deepEqual(constrainDeviceHoverPosition({x:190,y:140},card,{width:200,height:150}),{x:8,y:8});
});

test('task3 device hover: 射线只返回带 deviceId 的设备目标',()=>{
 const camera=makeCamera(),device=makeMarker('device-a');
 const blind=new THREE.Mesh(new THREE.SphereGeometry(2,12,8),new THREE.MeshBasicMaterial());blind.position.z=2;blind.userData.sampleId='blind-a';blind.updateMatrixWorld();
 const threat=makeMarker(undefined,[0,0,3]);threat.userData={targetId:'threat-a'};threat.updateMatrixWorld();
 const hit=pickDeviceTarget({camera,targets:[blind,threat,device],ndc:new THREE.Vector2(0,0)});
 assert.equal(hit,device);assert.equal(hit.userData.deviceId,'device-a');
 assert.equal(pickDeviceTarget({camera,targets:[blind,threat],ndc:new THREE.Vector2(0,0)}),null);
});

class FakeElement{
 constructor(tag){this.tagName=tag;this.style={};this.dataset={};this.children=[];this.attributes={};this.hidden=false;this.textContent='';this.offsetWidth=300;this.offsetHeight=260;this.listeners=new Map();}
 append(...children){for(const child of children){this.children.push(child);child.parentElement=this;}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(type,listener){const list=this.listeners.get(type)??[];list.push(listener);this.listeners.set(type,list);}
 removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)??[]).filter(item=>item!==listener));}
 emit(type,event={}){for(const listener of this.listeners.get(type)??[])listener(event);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
}
class FakeCanvas extends FakeElement{
 constructor(){super('canvas');this.rect={left:0,top:0,right:800,bottom:600,width:800,height:600};}
 getBoundingClientRect(){return this.rect;}
}

test('task3 device hover: pointermove 单帧节流，移开和销毁清理卡片、帧与监听',()=>{
 const canvas=new FakeCanvas(),container=new FakeElement('div');container.clientWidth=800;container.clientHeight=600;container.getBoundingClientRect=()=>canvas.rect;canvas.parentElement=container;
 const documentRef={createElement:tag=>new FakeElement(tag)},frames=new Map();let sequence=0;
 const requestFrame=callback=>{frames.set(++sequence,callback);return sequence;},cancelFrame=id=>frames.delete(id);
 const device=makeMarker('device-a'),hover=createDeviceHover({canvas,camera:makeCamera(),container,documentRef,requestFrame,cancelFrame,getTargets:()=>[device],getDetails:({deviceId,deployment})=>({title:'设备-1',rows:[{label:'内部 ID',value:deviceId},{label:'部署方式',value:deployment??'未提供'}]})});
 for(let i=0;i<5;i++)container.emit('pointermove',{clientX:400,clientY:300,buttons:0});
 assert.equal(frames.size,1,'多次 pointermove 只能排队一个 RAF');
 for(const callback of [...frames.values()])callback();frames.clear();
 assert.equal(hover.activeDeviceId,'device-a');assert.equal(hover.element.hidden,false);assert.equal(hover.element.dataset.deviceId,'device-a');
 container.emit('pointermove',{clientX:700,clientY:500,buttons:0});for(const callback of [...frames.values()])callback();frames.clear();
 assert.equal(hover.activeDeviceId,null);assert.equal(hover.element.hidden,true);
 container.emit('pointermove',{clientX:400,clientY:300,buttons:0});assert.equal(frames.size,1);hover.destroy();
 assert.equal(frames.size,0);assert.equal(container.children.includes(hover.element),false);
 assert.ok([...container.listeners.values()].every(list=>list.length===0),'销毁后不得残留地图视口监听');
 hover.destroy();
});
