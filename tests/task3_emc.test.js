import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deviceSpectrum,distance3D,emcAnalysis,emcVerdictText} from '../src/task3/emc.js';
import {EMC_RULES,EQUIPMENT_CHANNELS_GHZ} from '../src/task3/constants.js';
import {remediateEmcConflicts} from '../src/task3/pipeline.js';
import {emcCheck} from '../src/planning/optimizer.js';
import {createDevice} from '../src/sensors/presets.js';

test('deviceSpectrum reflects equipment facts and honors user-retuned frequency',()=>{
 const radar=createDevice('radar-03d','r1');
 assert.deepEqual(deviceSpectrum(radar).emissionGHz,[15]);
 radar.parameters.frequencyGHz=16.2;
 assert.deepEqual(deviceSpectrum(radar).emissionGHz,[16.2]);
 const tdoa=deviceSpectrum(createDevice('radio-tdoa','t1'));
 assert.deepEqual(tdoa.emissionGHz,[]);assert.deepEqual(tdoa.receiveRangeGHz,[0.1,6]);assert.equal(tdoa.powerW,null);
 const x1c=deviceSpectrum(createDevice('radio-x1c','x1'));
 assert.deepEqual(x1c.receiveDiscreteGHz,[0.9,1.2,2.4,5.2,5.8]);assert.equal(x1c.receiveRangeGHz,null);
 const optical=deviceSpectrum(createDevice('optical-nvt','o1'));
 assert.deepEqual(optical.emissionGHz,[]);assert.equal(optical.receiveRangeGHz,null);assert.equal(optical.receiveDiscreteGHz,null);
 assert.throws(()=>deviceSpectrum({presetId:'nope',parameters:{}}));
});
test('co-channel radar pair fails with penalty identical to planning emcCheck',()=>{
 const a=createDevice('radar-03d','a',[0,100,0]),b=createDevice('radar-03d','b',[50,100,0]);
 const result=emcAnalysis([a,b]),reference=emcCheck([a,b]),conflict=result.conflicts.find(c=>c.kind==='co-channel');
 assert.ok(conflict);assert.equal(conflict.severity,'fail');assert.equal(result.verdict,'fail');
 assert.equal(conflict.penaltyDb,reference.conflicts[0].penaltyDb);
 assert.deepEqual(result.penalties,reference.penalties);
 assert.equal(conflict.recommendation,'换频（错开 ≥0.1 GHz）或拉距至 ≥600 m');
 assert.ok(emcVerdictText(result).includes('不通过'));
});
test('adjacent-channel pair degrades without fail or penalty',()=>{
 const a=createDevice('radar-03d','a',[0,100,0]),b=createDevice('radar-03d','b',[200,100,0]);
 b.parameters.frequencyGHz=15.3;
 const result=emcAnalysis([a,b]);
 assert.deepEqual(result.conflicts.map(c=>c.kind),['adjacent-channel']);
 assert.equal(result.conflicts[0].severity,'warning');assert.equal(result.verdict,'degraded');
 assert.equal(result.penalties.a,0);assert.equal(result.penalties.b,0);
});
test('receiver-overlap: only a near transmitter-receiver pair fails; distant band overlap does not',()=>{
 const radar=createDevice('radar-02c','tx',[0,100,0]);radar.parameters.frequencyGHz=5.8;
 const near=createDevice('radio-x1c','rx',[100,120,0]);
 const result=emcAnalysis([radar,near]);
 assert.deepEqual(result.conflicts.map(c=>c.kind),['receiver-overlap']);
 const conflict=result.conflicts[0];
 assert.equal(conflict.severity,'fail');assert.equal(conflict.a,'tx');assert.equal(conflict.b,'rx');assert.equal(conflict.detailGHz,5.8);
 assert.equal(conflict.distanceM,Math.hypot(100,20));assert.equal(result.verdict,'fail');
 const far=createDevice('radio-x1c','far',[1000,100,0]),distant=emcAnalysis([radar,far]);
 assert.equal(distant.counts.fail,0);assert.equal(distant.conflicts.length,0);
});
test('frontend-block: high-power radar within 50 m of passive receiver warns',()=>{
 const radar=createDevice('radar-03d','tx',[0,100,0]),rx=createDevice('radio-tdoa','rx',[30,100,0]);
 const result=emcAnalysis([radar,rx]);
 assert.deepEqual(result.conflicts.map(c=>c.kind),['frontend-block']);
 assert.equal(result.conflicts[0].severity,'warning');assert.equal(result.conflicts[0].a,'tx');assert.equal(result.verdict,'degraded');
});
test('co-site: devices closer than 10 m warn and rf-silent devices are noted',()=>{
 const a=createDevice('optical-nvt','o',[0,100,0]),b=createDevice('acoustic-cry','s',[5,100,0]);
 // 纯无源/光电/声学共址无射频互扰，不报 co-site；
 const silent=emcAnalysis([a,b]);
 assert.deepEqual(silent.conflicts.map(c=>c.kind),[]);
 assert.ok(silent.notes.some(n=>n.includes('光电/声学设备无射频发射与接收')));
 // 至少一方有射频发射时才提示同点位过密
 const r=createDevice('radar-03d','r',[0,100,0]);r.parameters.frequencyGHz=16;
 const mixed=emcAnalysis([r,b]);
 assert.deepEqual(mixed.conflicts.map(c=>c.kind),['co-site']);
 assert.equal(mixed.verdict,'degraded');
});
test('conflict-free deployment passes',()=>{
 const a=createDevice('radar-03d','a',[0,100,0]),b=createDevice('radar-03d','b',[1000,100,0]);
 b.parameters.frequencyGHz=16;
 const c=createDevice('radio-tdoa','r',[2000,100,0]);
 const result=emcAnalysis([a,b,c]);
 assert.equal(result.verdict,'pass');assert.equal(result.conflicts.length,0);
 assert.ok(emcVerdictText(result).includes('通过'));
});
test('3D distance: non-colocated and sub-metre conflicts retain full precision',()=>{
 const a=createDevice('radar-03d','a',[0,100,0]),b=createDevice('radar-03d','b',[30,140,40]);
 assert.equal(distance3D(a,b),Math.hypot(30,40,40));
 const conflict=emcAnalysis([a,b]).conflicts.find(c=>c.kind==='co-channel');
 assert.equal(conflict.distanceM,Math.hypot(30,40,40));assert.equal(conflict.coLocated,false);
 b.position=[0.3,100,0.4];const close=emcAnalysis([a,b]).conflicts.find(c=>c.kind==='co-channel');
 assert.equal(close.distanceM,0.5);assert.equal(close.coLocated,false);
 b.position=[0,100,0];const same=emcAnalysis([a,b]);
 assert.ok(same.conflicts.every(c=>c.distanceM===0&&c.coLocated));
 assert.equal(same.penalties.a,6);assert.equal(same.penalties.b,6,'同一共址设备对不得重复罚同频损耗');
});
test('passive radio and optical/acoustic devices do not create RF conflicts',()=>{
 const radio=createDevice('radio-tdoa','r',[0,100,0]),optical=createDevice('optical-nvt','o',[0,100,0]),acoustic=createDevice('acoustic-cry','s',[1,100,0]);
 const result=emcAnalysis([radio,optical,acoustic]);
 assert.equal(result.verdict,'pass');assert.equal(result.conflicts.length,0);
});
test('remediation retunes within existing model channels before moving',()=>{
 const a=createDevice('radar-03d','a',[0,100,0]),b=createDevice('radar-03d','b',[0,100,0]);
 a.parameters.frequencyGHz=b.parameters.frequencyGHz=16;
 const result=remediateEmcConflicts({devices:[a,b]});
 assert.equal(result.status,'resolved');assert.equal(result.after.counts.fail,0);assert.equal(result.actions.length,1);assert.equal(result.actions[0].action,'retune');
 for(const d of result.devices)assert.ok(EQUIPMENT_CHANNELS_GHZ[d.presetId].includes(d.parameters.frequencyGHz));
 assert.deepEqual(result.devices.map(d=>d.position),[a.position,b.position]);
});
function channelConflictCandidates(withAlternative){
 const channels=EQUIPMENT_CHANNELS_GHZ['radar-03d'],frequencies=[...channels,channels[0]];
 const devices=frequencies.map((f,i)=>{const d=createDevice('radar-03d',`r${i}`,[0,100,0]);d.parameters.frequencyGHz=f;return d;});
 const sites=devices.map((d,i)=>({id:`s${i}`,position:[...d.position],installationProxy:1}));
 const candidates=devices.map((device,i)=>({device:structuredClone(device),site:structuredClone(sites[i]),cover:[]}));
 if(withAlternative){const device=createDevice('radar-03d','moved',[700,100,0]);device.parameters.frequencyGHz=channels[0];const site={id:'alternative',position:[...device.position],installationProxy:1};candidates.push({device,site,cover:[]});}
 return {devices,sites,candidates,indices:[0,1,2,3,4]};
}
test('remediation moves to an existing nearby candidate when four channels cannot separate five co-located radars',()=>{
 const input=channelConflictCandidates(true),result=remediateEmcConflicts(input);
 assert.equal(result.before.counts.fail,1);assert.equal(result.status,'resolved');assert.equal(result.after.counts.fail,0);
 assert.equal(result.actions.length,1);assert.equal(result.actions[0].action,'relocate');assert.equal(result.actions[0].after.siteId,'alternative');
 assert.ok(result.devices.some(d=>d.id==='moved'&&d.position[0]===700));
});
test('remediation keeps an explicit unresolved state when no legal action can remove fail',()=>{
 const input=channelConflictCandidates(false),result=remediateEmcConflicts({...input,candidates:[]});
 assert.equal(result.status,'unresolved');assert.equal(result.deployable,false);assert.ok(result.after.counts.fail>0);assert.ok(result.unresolved.length>0);assert.match(result.reason,/人工/);
});
test('shipped example plan: structure complete and co-channel penalties match planning emcCheck',()=>{
 const report=JSON.parse(readFileSync(new URL('../public/deployment-example.json',import.meta.url)));
 const selected=report.plans.find(p=>p.id===report.selectedId);
 const result=emcAnalysis(selected.devices),reference=emcCheck(selected.devices);
 assert.ok(['pass','degraded','fail'].includes(result.verdict));
 assert.equal(result.counts.fail+result.counts.warning,result.conflicts.length);
 assert.deepEqual(Object.keys(result.penalties).sort(),selected.devices.map(d=>d.id).sort());
 assert.equal(result.source,EMC_RULES.source);
 assert.equal(result.conflicts.filter(c=>c.kind==='co-channel').length,reference.conflicts.length);
 assert.deepEqual(result.penalties,reference.penalties);
 assert.equal(typeof emcVerdictText(result),'string');
});
