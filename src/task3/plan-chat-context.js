function summarizeConditions(plan) {
  return plan.metrics.map(metric => ({
    id: metric.condition,
    coverageRate: metric.coverageRate,
    blindRate: metric.blindRate,
    coreCoverageRate: metric.coreCoverageRate,
    coreRedundantRate: metric.coreRedundantRate,
    covered: metric.covered,
    total: metric.total,
  }));
}

function summarizeEmc(emc) {
  return {
    verdict: emc?.verdict,
    severe: emc?.counts?.fail,
    warnings: emc?.counts?.warning,
  };
}

export function createPlanChatSummary({status, report, activePlan, conditionId, mobileSnapshots}) {
  if (status !== 'ready') return {status};

  // Use the report's scored comparison for ranking. The active plan may have
  // since been supplemented, so keep its recalculated totals independent.
  const plans = report.comparison.rows.map(row => {
    const original = mobileSnapshots.get(row.id);
    const plan = original?.plan ?? report.plans.find(item => item.id === row.id);
    const scored = report.scoring.plans.find(item => item.id === row.id);
    return {
      id: row.id,
      rank: row.rank,
      score: row.score,
      scoreBeforeEmc: scored?.scoreRaw,
      emcFactor: scored?.emcFactor,
      deviceCount: row.deviceCount,
      cost: row.cost,
      budget: plan.budget,
      deviceLimit: plan.maxDevices,
      coverage: row.coverage,
      blindRatio: row.blindRatio,
      feasibility: row.feasibility,
      emc: summarizeEmc(original?.emc ?? report.emc[row.id]),
      conditions: summarizeConditions(plan),
    };
  });
  const {coverage, blind, cost, feasibility} = report.comparison.weights;
  const summary = {
    status,
    activePlanId: activePlan.id,
    recommendedPlanId: report.recommendedId,
    recommendationStatus: report.scoring.recommendationStatus,
    conditionId,
    budget: report.settings.budget,
    deviceLimit: report.settings.maxDevices,
    scopeClipped: report.scope?.clipped === true,
    weights: {coverage, blind, cost, feasibility},
    plans,
  };

  if (activePlan.derivation) {
    summary.supplement = {
      deviceCount: activePlan.devices.length,
      addedDeviceCount: activePlan.derivation.addedDeviceCount,
      cost: activePlan.cost,
      addedCost: activePlan.derivation.addedCost,
      emc: summarizeEmc(report.emc[activePlan.id]),
      conditions: summarizeConditions(activePlan),
    };
  }
  return summary;
}
