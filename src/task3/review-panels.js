import {matchDeploymentRules} from './rule-matches.js';
import {createDeviceDisplayMap} from './device-display.js';

function append(parent,tag,text){
 const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;
}

export function renderRuleBook(pane,book,report,plan,previous){
 pane.replaceChildren();
 append(pane,'h3','通用布设规则');
 append(pane,'p',`${book.independentMaps} 张地图 · ${book.optimizationRuns} 次推演 · 更新于 ${book.createdAt.slice(0,10)}`);
 if(report?.plans.length>1){
  const label=append(pane,'label','查看本轮方案'),select=document.createElement('select');label.append(select);
  for(const p of report.plans)select.add(new Option(p.name,p.id,false,p.id===plan.id));
  select.onchange=()=>renderRuleBook(pane,book,report,report.plans.find(p=>p.id===select.value),previous);
 }
 const rows=report&&plan?matchDeploymentRules(book.acceptedRules,report,plan,previous):book.acceptedRules.map(rule=>({rule,deviceIds:[]}));
 const names=createDeviceDisplayMap(plan?.devices??[]);
 append(pane,'p',plan?`当前方案：${plan.name} · ${plan.devices.length} 台设备 · ${rows.filter(r=>r.deviceIds.length).length} 条规则关联到设备`:'完成当前参数的部署推演后，此处显示对应设备。');
 for(const {rule,deviceIds,basis} of rows){
  const section=document.createElement('section');section.className='task3-rule';pane.append(section);
  append(section,'h4',`${rule.id} · ${rule.condition}`);
  append(section,'p',rule.conclusion);
  if(!report)continue;
  const details=document.createElement('details');section.append(details);
  append(details,'summary',`本轮关联设备（${deviceIds.length}）`);
  append(details,'p',basis);
  if(deviceIds.length){
   const list=document.createElement('ul');details.append(list);
   for(const id of deviceIds){const d=names.details(id);append(list,'li',`${d.displayName} · ${d.modelName} · ${d.typeName}`);}
  }
 }
}

export function renderEmcReview(box,emc,kinds,display){
 const initial=emc.remediation?.before?.conflicts??[],severe=[...initial,...emc.conflicts].filter(c=>c.severity==='fail');
 append(box,'h4','严重问题与处置');
 if(!severe.length)append(box,'p','本次部署过程未发现严重问题。');
 for(const kind of new Set(severe.map(c=>c.kind))){
  const before=initial.filter(c=>c.severity==='fail'&&c.kind===kind),after=emc.conflicts.filter(c=>c.severity==='fail'&&c.kind===kind);
  append(box,'p',`${kinds[kind]??kind} · 初检 ${before.length} 项，当前 ${after.length} 项。处置建议：${[...new Set([...before,...after].map(c=>c.recommendation))].join('；')}。`);
 }
 const review=emc.remediation?.warningReview;
 if(!review)return;
 append(box,'h4','提示修复前后对比');
 append(box,'p',`提示 ${review.before.counts.warning} → ${review.after.counts.warning} 项，严重 ${review.before.counts.fail} → ${review.after.counts.fail} 项。`);
 if(review.actions.length){
  const table=document.createElement('table');table.className='task3-table';box.append(table);
  const header=table.createTHead().insertRow();for(const heading of ['调整设备','调整前','调整后'])append(header,'th',heading);
  const body=table.createTBody();
  for(const a of review.actions){
   const tr=body.insertRow(),retune=a.action==='retune';
   append(tr,'td',display.nameOf(a.replacementDeviceId??a.deviceId));
   for(const state of [a.before,a.after])append(tr,'td',retune?`${state.frequencyGHz} GHz`:`${state.siteId} · ${state.position.map(x=>x.toFixed(1)).join(', ')} m`);
  }
 }
 if(review.reason)append(box,'p',review.reason);
}
