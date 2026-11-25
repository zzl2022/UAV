import test from 'node:test';
import assert from 'node:assert/strict';
import {createTask3RequestSnapshot,createTask3RunScheduler} from '../src/task3/live-optimization.js';
import {parseTask3Spacing,resolveTask3Settings,TASK3_DEFAULT_SETTINGS} from '../src/task3/scope.js';

function fakeTimers(){
 let serial=0;const timers=new Map();
 return {
  setTimer(callback,delay){const id=++serial;timers.set(id,{callback,delay});return id;},
  clearTimer(id){timers.delete(id);},
  flush(){const pending=[...timers.values()];timers.clear();for(const {callback} of pending)callback();},
  get size(){return timers.size;},
 };
}

test('task3 live: 手动与自动复用同一入口，连续发布按原因去重并防抖合批',()=>{
 const timers=fakeTimers(),runs=[];
 const scheduler=createTask3RunScheduler({run:request=>runs.push(request),...timers});
 assert.equal(scheduler.start('手动推演'),1);
 scheduler.schedule('装备保存/导入自动更新');
 scheduler.schedule('城市目标/环境应用自动更新');
 scheduler.schedule('装备保存/导入自动更新');
 assert.equal(timers.size,1);assert.equal(runs.length,1);
 assert.deepEqual(scheduler.getState().pendingUpdateReasons,['装备保存/导入自动更新','城市目标/环境应用自动更新']);
 timers.flush();
 assert.equal(runs.length,2);assert.equal(runs[1].requestId,2);
 assert.equal(runs[1].updateReason,'装备保存/导入自动更新、城市目标/环境应用自动更新');
 assert.equal(scheduler.getState().pending,false);assert.deepEqual(scheduler.getState().pendingUpdateReasons,[]);
});

test('task3 live: 请求号单调递增，旧成功和旧错误均不能更新最新状态',()=>{
 const scheduler=createTask3RunScheduler({run:()=>{}});
 const first=scheduler.start('手动推演'),second=scheduler.start('装备保存/导入自动更新');
 assert.ok(second>first);assert.equal(scheduler.isCurrent(first),false);assert.equal(scheduler.isCurrent(second),true);
 assert.equal(scheduler.succeed(first),false);assert.equal(scheduler.fail(first,'旧错误'),false);
 assert.equal(scheduler.getState().lastError,null);assert.equal(scheduler.getState().lastSuccessfulRequestId,null);
 assert.equal(scheduler.succeed(second),true);assert.equal(scheduler.getState().lastSuccessfulRequestId,second);
 const cancelled=scheduler.cancel();assert.ok(cancelled>second);assert.equal(scheduler.succeed(second),false);
});

test('task3 live: 新参数进入防抖队列后立即拒绝旧进度完成与旧错误',()=>{
 const timers=fakeTimers();let report={requestId:1};
 const scheduler=createTask3RunScheduler({run:()=>{},hasCurrentResult:()=>!!report,...timers});
 const first=scheduler.start('手动推演');scheduler.schedule('装备保存/导入自动更新');
 assert.equal(scheduler.isCurrent(first),false);assert.equal(scheduler.succeed(first),false);assert.equal(scheduler.fail(first,'旧错误'),false);
 assert.equal(scheduler.getState().staleResult,true);assert.equal(scheduler.getState().lastError,null);
 timers.flush();assert.equal(scheduler.getState().requestId,2);assert.equal(scheduler.isCurrent(first),false);
 assert.equal(scheduler.succeed(first),false);assert.equal(scheduler.succeed(2),true);
});

test('task3 live: 自动失败保留最后成功报告并明确标记非最新参数结果',()=>{
 let report=null;
 const scheduler=createTask3RunScheduler({run:()=>{},hasCurrentResult:()=>!!report});
 const first=scheduler.start('手动推演');assert.equal(scheduler.succeed(first),true);
 report={requestId:first,value:'last-success'};
 const second=scheduler.start('装备保存/导入自动更新');
 assert.equal(scheduler.getState().staleResult,true);
 assert.equal(scheduler.fail(second,new Error('最新输入无效')),true);
 const state=scheduler.getState();
 assert.equal(state.lastError,'最新输入无效');assert.equal(state.lastSuccessfulRequestId,first);assert.equal(state.staleResult,true);
 assert.deepEqual(report,{requestId:first,value:'last-success'});
 assert.equal(scheduler.succeed(first),false,'失败后到达的旧报告不得伪装成最新成功');
});

test('task3 live: 每轮输入快照与源对象隔离并递归冻结',()=>{
 const settings={spacing:425,costs:{radar:12}},weights={coverage:.4},presetIds=['radar-03d'];
 const equipmentSnapshot={profiles:[{id:'radar-03d',parameters:{maxRange:6000}}]};
 const scenarioSnapshot={environment:{rainMmH:2},target:{position:[1,2,3],emitting:true},devices:[{id:'ignored'}]};
 const snapshot=createTask3RequestSnapshot({settings,weights,presetIds,equipmentSnapshot,scenarioSnapshot});
 settings.costs.radar=99;weights.coverage=1;presetIds.push('optical-nvt');
 equipmentSnapshot.profiles[0].parameters.maxRange=1;scenarioSnapshot.environment.rainMmH=99;scenarioSnapshot.target.position[0]=99;
 assert.equal(snapshot.settings.costs.radar,12);assert.equal(snapshot.weights.coverage,.4);assert.deepEqual(snapshot.presetIds,['radar-03d']);
 assert.equal(snapshot.equipmentSnapshot.profiles[0].parameters.maxRange,6000);assert.equal(snapshot.environment.rainMmH,2);assert.deepEqual(snapshot.target.position,[1,2,3]);
 assert.equal('devices' in snapshot,false);
 for(const value of [snapshot,snapshot.settings,snapshot.settings.costs,snapshot.weights,snapshot.presetIds,snapshot.equipmentSnapshot,snapshot.equipmentSnapshot.profiles,snapshot.equipmentSnapshot.profiles[0].parameters,snapshot.environment,snapshot.target,snapshot.target.position])assert.equal(Object.isFrozen(value),true);
 assert.throws(()=>{snapshot.settings.spacing=500;},TypeError);
});

test('task3 spacing: 可编辑数值原样进入设置，空值、非数值和越界值明确拒绝',()=>{
 for(const value of [150,425,500,1000,'425.5'])assert.equal(parseTask3Spacing(value),Number(value));
 const settings=resolveTask3Settings({...TASK3_DEFAULT_SETTINGS,scope:'custom',scopeWidthM:2400,scopeDepthM:2400,spacing:parseTask3Spacing(425)});
 assert.equal(settings.spacing,425);
 for(const value of ['','   ','abc',NaN,Infinity,-Infinity,149,1001,null,undefined])assert.throws(()=>parseTask3Spacing(value),/网格间距必须是 150–1000 米的有限数值/);
});
