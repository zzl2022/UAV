import test from 'node:test';
import assert from 'node:assert/strict';
import {createTask3RequestSnapshot,createTask3RunScheduler} from '../src/task3/live-optimization.js';
import {parseTask3Spacing,resolveTask3Settings,TASK3_DEFAULT_SETTINGS} from '../src/task3/scope.js';

test('task3 live: 配置变化只标记过期，不创建优化请求或自动队列',()=>{
 const runs=[];let report=null;
 const scheduler=createTask3RunScheduler({run:request=>runs.push(request),hasCurrentResult:()=>!!report});
 const first=scheduler.start('方案生成');assert.equal(scheduler.succeed(first),true);report={requestId:first};runs.length=0;
 scheduler.markStale();scheduler.markStale();
 assert.equal(runs.length,0);assert.equal(scheduler.getState().requestId,first);
 assert.equal(scheduler.getState().staleResult,true);assert.equal(scheduler.getState().pending,false);
 assert.deepEqual(scheduler.getState().pendingUpdateReasons,[]);
 const second=scheduler.start('方案生成');
 assert.equal(runs.length,1);assert.deepEqual(runs[0],{requestId:second,updateReason:'方案生成'});
 assert.equal(scheduler.getState().pending,false);assert.deepEqual(scheduler.getState().pendingUpdateReasons,[]);
});

test('task3 live: 请求号单调递增，旧成功和旧错误均不能更新最新状态',()=>{
 const scheduler=createTask3RunScheduler({run:()=>{}});
 const first=scheduler.start('方案生成'),second=scheduler.start('方案生成');
 assert.ok(second>first);assert.equal(scheduler.isCurrent(first),false);assert.equal(scheduler.isCurrent(second),true);
 assert.equal(scheduler.succeed(first),false);assert.equal(scheduler.fail(first,'旧错误'),false);
 assert.equal(scheduler.getState().lastError,null);assert.equal(scheduler.getState().lastSuccessfulRequestId,null);
 assert.equal(scheduler.succeed(second),true);assert.equal(scheduler.getState().lastSuccessfulRequestId,second);
 const cancelled=scheduler.cancel();assert.ok(cancelled>second);assert.equal(scheduler.succeed(second),false);
});

test('task3 live: 计算中改参不取消当前请求，旧快照完成后仍明确过期',()=>{
 let report=null;
 const scheduler=createTask3RunScheduler({run:()=>{},hasCurrentResult:()=>!!report});
 const first=scheduler.start('方案生成');assert.equal(scheduler.succeed(first),true);report={requestId:first};
 const second=scheduler.start('方案生成');scheduler.markStale();
 assert.equal(scheduler.isCurrent(second),true,'输入变化不应把当前快照请求变成旧请求');
 assert.equal(scheduler.succeed(second),true,'当前快照仍应允许完成并替换上一轮展示');
 assert.equal(scheduler.getState().lastSuccessfulRequestId,second);assert.equal(scheduler.getState().staleResult,true);
 report={requestId:second};
 const third=scheduler.start('方案生成');assert.equal(scheduler.succeed(third),true);
 assert.equal(scheduler.getState().staleResult,false,'按最新输入重新生成后才清除过期状态');
});

test('task3 live: 首次计算中改参也会在首份快照完成后标记过期',()=>{
 const scheduler=createTask3RunScheduler({run:()=>{}});
 const request=scheduler.start('方案生成');scheduler.markStale();
 assert.equal(scheduler.getState().staleResult,false,'尚无展示结果时不显示过期横幅');
 assert.equal(scheduler.succeed(request),true);assert.equal(scheduler.getState().staleResult,true);
});

test('task3 live: 失败和取消保留最后成功报告并明确标记非最新参数结果',()=>{
 let report=null;
 const scheduler=createTask3RunScheduler({run:()=>{},hasCurrentResult:()=>!!report});
 const first=scheduler.start('方案生成');assert.equal(scheduler.succeed(first),true);
 report={requestId:first,value:'last-success'};
 const second=scheduler.start('方案生成');
 assert.equal(scheduler.getState().staleResult,true);
 assert.equal(scheduler.fail(second,new Error('最新输入无效')),true);
 const state=scheduler.getState();
 assert.equal(state.lastError,'最新输入无效');assert.equal(state.lastSuccessfulRequestId,first);assert.equal(state.staleResult,true);
 assert.deepEqual(report,{requestId:first,value:'last-success'});
 assert.equal(scheduler.succeed(first),false,'失败后到达的旧报告不得伪装成最新成功');
 const third=scheduler.start('方案生成'),cancelled=scheduler.cancel();
 assert.ok(cancelled>third);assert.equal(scheduler.isCurrent(third),false);assert.equal(scheduler.succeed(third),false);
 assert.equal(scheduler.getState().staleResult,true);assert.equal(scheduler.getState().pending,false);
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
