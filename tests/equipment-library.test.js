import test from 'node:test';
import assert from 'node:assert/strict';
import {createEquipmentLibrary,EQUIPMENT_LIBRARY_KEY,equipmentLibrarySummary} from '../src/sensors/equipment-library.js';
import {defaultProfile} from '../src/sensors/equipment-catalog.js';

test('装备库持久化引用，满 50 项时允许更新已有条目',()=>{
  const disk=new Map(),storage={getItem:key=>disk.get(key),setItem:(key,value)=>disk.set(key,value)};
  const library=createEquipmentLibrary(storage);
  const profile=index=>({presetId:`测试型号-${index}`,type:'radar',name:`测试装备 ${index}`,parameters:{custom:42}});
  for(let i=0;i<50;i++)library.add(profile(i));
  assert.throws(()=>library.add(profile(50)),/最多保存 50 项/);
  library.add({...profile(0),name:'更新后的测试装备'});
  const saved=JSON.parse(disk.get(EQUIPMENT_LIBRARY_KEY));
  assert.equal(saved.length,50);
  assert.deepEqual(Object.keys(saved[0]).sort(),['addedAt','name','presetId','type']);
  assert.equal(saved[0].name,'更新后的测试装备');
  const reopened=createEquipmentLibrary(storage);
  assert.deepEqual(reopened.entries(),saved);
  reopened.remove(profile(4).presetId);
  reopened.add(profile(50));
  assert.ok(!reopened.has(profile(4).presetId)&&reopened.has(profile(50).presetId));
});

test('参数摘要沿用目录字段、限定词和缺失状态',()=>{
  assert.equal(equipmentLibrarySummary(undefined),'参数未提供');
  const fivega=defaultProfile('fivega-zte-a9650-s49');
  assert.match(equipmentLibrarySummary(fivega),/1500 m以上.*128 通道/);
  const electrostatic=defaultProfile('electrostatic-crsc-er1');
  assert.match(equipmentLibrarySummary(electrostatic),/≥100 m.*≤50 mW/);
  electrostatic.parameters.detectionDistance=null;
  assert.doesNotMatch(equipmentLibrarySummary(electrostatic),/标称探测距离|100 m/);
});
