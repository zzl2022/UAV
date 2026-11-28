import test from 'node:test';
import assert from 'node:assert/strict';
import {recordedScenariosForPlan,recordedDuration,resolvePlaybackAvailability} from '../src/task3/playback-availability.js';

test('回放只读取当前方案，旧报告的单份记录限于推荐方案',()=>{
 const record={single:{frames:[{time:0,targets:[]},{time:4,targets:[]}]}};
 assert.equal(recordedScenariosForPlan({recommendedId:'one',threats:record},'one'),record);
 assert.equal(recordedScenariosForPlan({recommendedId:'one',threats:record},'two'),null);
 const current={...record};assert.equal(recordedScenariosForPlan({recommendedId:'one',threats:record,threatsByPlan:{two:current}},'two'),current);
 assert.equal(recordedDuration(record.single),4);
 assert.equal(recordedDuration({frames:[{time:0}]}),0);
});

test('自定义区域、无报告、旧报告和设备仿真有各自的播放状态',()=>{
 const record={frames:[{time:0,targets:[]},{time:4,targets:[]}]};
 const custom=resolvePlaybackAvailability({custom:true,hasPlan:true,record});
 assert.equal(custom.status,'scene-unavailable');assert.equal(custom.blocked,true);assert.match(custom.message,/内置演示区域/);
 assert.equal(resolvePlaybackAvailability({hasPlan:false}).status,'no-plan');
 const old=resolvePlaybackAvailability({hasPlan:true});
 assert.equal(old.status,'no-recording');assert.equal(old.blocked,true);
 assert.equal(resolvePlaybackAvailability({hasPlan:true,record,deviceDemo:true}).status,'device-demo');
 assert.deepEqual(resolvePlaybackAvailability({hasPlan:true,record}),{status:'ready',blocked:false,message:''});
});
