import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest,snapshotHTML,valueText,VERSION,presentationNotes} from '../src/student-capabilities/api.js';
test('request uses platform origin and geometry, no borrowed weather parameters',()=>{
 const devices=[{id:'a',type:'optical',position:[10,20,-30]}],target={position:[100,40,-60]};
 const before=structuredClone(devices);
 const r=buildRequest({scene:{origin:[113,34,0],hash:'h'}},devices,target,()=>({known:true,blocked:false}));
 assert.equal(r.mode,'dataset_only');assert.equal(r.version,VERSION);assert.equal(r.scene_hash,'h');
 assert.equal(r.devices[0].context.known,true);assert.ok(!('environment'in r));assert.deepEqual(devices,before);
});
test('unknown, false and zero remain distinguishable in Chinese',()=>{
 assert.equal(valueText(null),'未知／未提供');assert.equal(valueText(false),'否');assert.equal(valueText(0),'0');assert.equal(valueText(.8),'0.8');
});
test('Chinese report includes all saved scenarios, metrics and escaped user text',()=>{
 const result={id:'x',device:'<img src=x onerror=alert(1)>',type:'optical',geometry:{state:'unknown'},metrics:[{label:'目标距离',value:200,unit:'m',status:'derived'},{label:'视场',value:null,unit:'deg',status:'missing'}],notes:['未知不等于无遮挡']};
 const snapshots=[{name:'场景一',payload:{results:[result]}},{name:'场景二',payload:{results:[result]}}];
 const before=structuredClone(snapshots),html=snapshotHTML(snapshots);
 assert.ok(html.includes('场景一')&&html.includes('场景二')&&html.includes('未知／未提供'));
 assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('识别率未评估'));
 assert.deepEqual(snapshots,before);
});

test('presentation keeps parameter limitations and moves implementation notes into technical data',()=>{
 const result={device:'NVT-951',type:'optical',geometry:{state:'unknown'},metrics:[],raw_result:{fov:{value:null,status:'missing'}},notes:['已复用原 Python field_of_view、Pose 和 Target 校验。']};
 const notes=presentationNotes(result);
 assert.ok(notes.some(n=>n.includes('视场参数待补充')));
 assert.ok(notes.some(n=>n.includes('高程基准待核验')));
 const html=snapshotHTML([{name:'公开展示',payload:{results:[result]}}]);
 const displayed=html.split('<details>')[0];
 assert.ok(!displayed.includes('field_of_view')&&!displayed.includes('老师平台'));
 assert.ok(html.includes('field_of_view'));
 const acoustic=presentationNotes({...result,type:'acoustic',geometry:{state:'blocked'}});
 assert.ok(acoustic.some(n=>n.includes('反射和绕射')));
 assert.ok(acoustic.some(n=>n.includes('实际探测能力待验证')));
});
