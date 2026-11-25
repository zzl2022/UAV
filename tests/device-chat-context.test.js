import assert from 'node:assert/strict';
import test from 'node:test';
import {resolvePlanChatDevice} from '../src/task3/device-chat-context.js';
import {createDeviceDisplayMap} from '../src/task3/device-display.js';

const radar = {id:'fixture-radar', type:'radar', presetId:'radar-02c'};
const optical = {id:'fixture-optical', type:'optical', presetId:'optical-nvt'};
const mobile = {id:'fixture-mobile', type:'radar', presetId:'radar-03d', mobileRepair:{platform:'police-car'}};
const activePlan = {
  id:'balanced',
  devices:[radar, optical, mobile],
  decisionEvidence:{
    [optical.id]:{selection:{event:{phase:'redundancy'}}, site:{name:'internal-site'}},
  },
};
const economy = {
  id:'economy',
  devices:[radar],
  optimizationTrace:{events:[{type:'select', phase:'greedy', deviceId:radar.id}]},
};
const report = {recommendedId:'economy', plans:[activePlan, economy]};
const activeDisplay = createDeviceDisplayMap(activePlan.devices);
const lookup = (question, {checkedIds = new Set(), previous = null} = {}) =>
  resolvePlanChatDevice({question, report, activePlan, activeDisplay, checkedIds, previous});

test('device lookup uses the plan and the same numbering as the equipment table', () => {
  const expected = {status:'found',planId:'balanced',number:2,type:'optical',presetId:'optical-nvt',role:'redundancy'};
  for (const question of ['设备－２有什么用途？', '第二台设备负责什么？', '二号设备负责什么？']) {
    assert.deepEqual(lookup(question), expected);
  }
  assert.deepEqual(lookup('推荐方案第1台做什么？'), {
    status:'found',planId:'economy',number:1,type:'radar',presetId:'radar-02c',role:'greedy',
  });
  assert.deepEqual(lookup('经济型设备-1有什么用途？'), lookup('推荐方案第1台做什么？'));
  assert.equal(lookup('设备-3的用途').role, 'mobile');
  assert.doesNotMatch(JSON.stringify(lookup('设备-2作用？')), /internal-site|fixture-optical/);
});

test('device context handles a checked row, follow-ups, and unavailable numbers', () => {
  const checkedIds = new Set([optical.id]);
  assert.equal(lookup('我勾选的设备有什么用途？', {checkedIds}).number, 2);
  assert.equal(lookup('那它在方案中干什么？', {previous:{planId:'balanced',viewPlanId:'balanced',number:3}}).role, 'mobile');
  assert.equal(lookup('这台呢？', {previous:{planId:'economy',viewPlanId:'balanced',number:1}}).planId, 'economy');
  assert.equal(lookup('这台呢？', {previous:{planId:'economy',viewPlanId:'economy',number:1}}).status, 'choose-device');
  assert.equal(lookup('设备-12做什么？').status, 'not-found');
  assert.equal(lookup('增强型设备-1是什么？').status, 'plan-not-found');
  assert.equal(lookup('均衡型还是经济型的设备-1？').status, 'choose-plan');
  assert.equal(lookup('设备-1还是设备-2？').status, 'choose-device');
  assert.equal(lookup('设备 15 台的总成本是多少？'), null);
});
