import {createDeviceDisplayMap} from './device-display.js';

const PLAN_REFERENCES = [
  ['economy', /经济(?:型|方案)/],
  ['balanced', /均衡(?:型|方案)/],
  ['enhanced', /增强(?:型|方案)/],
];
const DEVICE_NUMBERS = [
  /设备\s*(?:(?:[-‐‑‒–—−:#]|编号(?:为)?)\s*)?(\d{1,6})(?!\d|\s*[台套个])/g,
  /第\s*(\d{1,6}|[〇零一二两三四五六七八九十百]{1,6})\s*台/g,
  /(?<!\d)(\d{1,6}|[〇零一二两三四五六七八九十百]{1,6})\s*号设备/g,
  /\bdevice\s*[-#]?\s*(\d{1,6})\b/gi,
];
const CHECKED_DEVICE = /(?:所选|勾选|选中)(?:的)?(?:这台|那台|这一台)?设备/;
const DEVICE_FOLLOW_UP = /这台|那台|该设备|这个设备|这件设备|\b(?:this|that) device\b/i;

function parseDeviceNumber(text) {
  const numerals = '零一二三四五六七八九';
  const value = text.replaceAll('〇', '零').replaceAll('两', '二');
  if (/^\d+$/.test(value)) return Number(value);
  if (!/[十百]/.test(value)) return Number([...value].map(char => numerals.indexOf(char)).join(''));

  let number = 0;
  let units;
  for (const char of value) {
    if (char === '十' || char === '百') {
      number += (units ?? 1) * (char === '十' ? 10 : 100);
      units = undefined;
    } else {
      units = numerals.indexOf(char);
    }
  }
  return number + (units ?? 0);
}

export function resolvePlanChatDevice({question, report, activePlan, activeDisplay, checkedIds, previous}) {
  const text = question.normalize('NFKC');
  const numbers = [...new Set(DEVICE_NUMBERS.flatMap(pattern =>
    Array.from(text.matchAll(pattern), ([, number]) => parseDeviceNumber(number))))];
  const asksAboutChecked = CHECKED_DEVICE.test(text);
  const followUp = DEVICE_FOLLOW_UP.test(text) || ((previous || checkedIds.size === 1) && text.includes('它'));
  if (numbers.length === 0 && !asksAboutChecked && !followUp) return null;

  const named = PLAN_REFERENCES.filter(([, pattern]) => pattern.test(text));
  if (named.length > 1) return {status: 'choose-plan'};
  const recent = followUp && !asksAboutChecked && previous?.viewPlanId === activePlan.id ? previous : null;
  const defaultPlanId = numbers.length || /当前方案/.test(text) ? activePlan.id : recent?.planId ?? activePlan.id;
  const planId = named[0]?.[0] ?? (/推荐(?:方案|的(?:方案|设备))/.test(text) ? report.recommendedId : defaultPlanId);
  const plan = report.plans.find(item => item.id === planId);
  if (!plan) return {status: 'plan-not-found', planId};
  const display = plan === activePlan ? activeDisplay : createDeviceDisplayMap(plan.devices);

  let number = numbers[0];
  if (number === undefined && recent?.planId === planId) {
    number = recent.number;
  }
  if (number === undefined && plan === activePlan && checkedIds.size === 1) {
    const [id] = checkedIds;
    const index = display.entries.findIndex(entry => entry.internalId === id);
    if (index >= 0) number = index + 1;
  }
  if (numbers.length > 1 || number === undefined) return {status: 'choose-device', planId};

  const requested = {planId, number};
  const entry = display.entries[number - 1];
  if (!entry) return {status: 'not-found', ...requested};
  const device = plan.devices[number - 1];
  const event = plan.decisionEvidence?.[entry.internalId]?.selection?.event ??
    plan.optimizationTrace?.events?.findLast(item => item.type === 'select' && item.deviceId === entry.internalId);
  return {
    status: 'found', ...requested, type: entry.type, presetId: entry.presetId,
    role: device.mobileRepair?.platform === 'police-car' ? 'mobile' : event?.phase,
  };
}
