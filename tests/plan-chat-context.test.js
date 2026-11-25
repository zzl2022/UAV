import assert from 'node:assert/strict';
import test from 'node:test';
import {createPlanChatSummary} from '../src/task3/plan-chat-context.js';

test('plan Q&A keeps original ranking separate from recalculated totals', () => {
  const original = {
    id:'balanced', budget:450, maxDevices:32,
    metrics:[{condition:'nominal', coverageRate:.76, blindRate:.24, covered:76, total:100}],
  };
  const emc = {verdict:'pass', counts:{fail:0, warning:0}};
  const derived = {
    ...original, cost:132, devices:Array(16).fill({position:[900, 0, -400]}),
    metrics:[{condition:'nominal', coverageRate:.81, blindRate:.19, covered:81, total:100}],
    derivation:{addedDeviceCount:2, addedCost:14, selected:['private-location-marker']},
  };
  const summary = createPlanChatSummary({
    status:'ready', activePlan:derived, conditionId:'nominal',
    report:{
      settings:{budget:600, maxDevices:48}, scope:{clipped:true},
      recommendedId:'balanced',
      scoring:{recommendationStatus:'deployable', plans:[{id:'balanced', scoreRaw:.842, emcFactor:1}]},
      comparison:{
        weights:{coverage:.4, blind:.25, cost:.2, feasibility:.15},
        rows:[{id:'balanced', rank:1, score:.842, deviceCount:14, cost:118, coverage:.78, blindRatio:.24, feasibility:.56}],
      },
      plans:[derived],
      emc:{balanced:{verdict:'degraded', counts:{fail:0, warning:2}}},
      threatsByPlan:{balanced:{test:{routes:['private-route-marker']}}},
    },
    mobileSnapshots:new Map([['balanced', {plan:original, emc}]]),
  });
  assert.equal(summary.recommendedPlanId, 'balanced');
  assert.equal(summary.plans[0].score, .842);
  assert.equal(summary.plans[0].cost, 118);
  assert.equal(summary.plans[0].emc.verdict, 'pass');
  assert.equal(summary.plans[0].conditions[0].coverageRate, .76);
  assert.equal(summary.supplement.cost, 132);
  assert.equal(summary.supplement.emc.verdict, 'degraded');
  assert.equal(summary.supplement.conditions[0].coverageRate, .81);
  assert.doesNotMatch(JSON.stringify(summary), /position|private-/);
});

test('unfinished, switched, or outdated plans only send their status', () => {
  for (const status of ['none', 'switching', 'working', 'stale']) {
    assert.deepEqual(createPlanChatSummary({status, report:{anything:'old'}}), {status});
  }
});
