import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_TARGET} from '../src/sensors/presets.js';
import {DRONE_TARGET_PRESETS,targetDraft,targetFromDraft,importTargetDraft,selectTargetPreset} from '../src/sensors/target-profiles.js';

const current=()=>({...structuredClone(DEFAULT_TARGET),position:[12,80,-40]});
test('official presets update geometry and speed while preserving scene position and unreported signatures',()=>{
 assert.equal(DRONE_TARGET_PRESETS.length,5);
 for(const preset of DRONE_TARGET_PRESETS){
  const base=current(),draft=selectTargetPreset(targetDraft(base),preset.id),value=targetFromDraft(base,draft);
  assert.deepEqual(value.position,base.position);
  assert.equal(value.rcs,base.rcs);assert.equal(value.sourceDb,base.sourceDb);
  assert.equal(value.eirpDbm,base.eirpDbm);assert.equal(value.speed,preset.speed);
  assert.equal(value.capability.width_m,preset.dimensions[1]);assert.equal(value.capability.height_m,preset.dimensions[2]);
  assert.equal(value.dronePresetId,preset.id);
 }
});
test('partial and exported target JSON imports remain drafts and preserve position',()=>{
 const base=current(),draft=targetDraft(base);
 const imported=importTargetDraft(base,draft,{speed:14,capability:{width_m:.4,height_m:.12}});
 assert.equal(draft.speed,base.speed);
 const value=targetFromDraft(base,imported);assert.equal(value.speed,14);assert.deepEqual(value.position,base.position);
 const exported=importTargetDraft(base,draft,{target:{...value,position:[999,999,999]}});
 assert.deepEqual(targetFromDraft(base,exported).position,base.position);
});
test('invalid import rejects unknown fields, nonnumeric values, invalid switches and reversed bands without mutating drafts',()=>{
 const base=current(),draft=targetDraft(base),before=structuredClone(draft);
 for(const data of [null,[],{}, {unknown:3},{speed:-1},{speed:'12'},{emitting:1},{count:1.2},{capability:{band_hz:[2000,500]}},{capability:{width_m:'bad'}}])assert.throws(()=>importTargetDraft(base,draft,data));
 assert.deepEqual(draft,before);
});
