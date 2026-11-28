import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevice} from '../src/sensors/presets.js';
import {angles} from '../src/sensors/engine.js';
import {defaultProfile} from '../src/sensors/equipment-catalog.js';
import {equipmentLibrarySnapshot} from '../src/sensors/equipment-library.js';
import {generateCandidatesWithEquipment,runTask3Pipeline,resolveTask3EquipmentSelection} from '../src/task3/pipeline.js';
import {EQUIPMENT_CHANNELS_GHZ} from '../src/task3/constants.js';

const city={buildings:[{id:'museum',name:'河南博物院',height:50,rings:[[[-20,0,-20],[20,0,-20],[20,0,20],[-20,0,20],[-20,0,-20]]]}],metadata:{origin:[0,0,0],sources:{},ecefTransform:{}}};
const query={groundAt:()=>0,surfaceAt:()=>50,trace:()=>({known:true,blocked:false,buildingCount:0,obstacleDistance:null,clearance:0,sensorGround:0,targetGround:0})};
const settings={scope:'custom',scopeWidthM:150,scopeDepthM:150,spacing:150,siteSpacing:300,heights:[30,60,100],maxSites:4,maxDevices:4,budget:100,costs:{radar:12,radio:5,optical:4,acoustic:2},coreRadius:100,coreWeight:3,marginReserveDb:3};

test('普通候选仅采用有效装备参数，后续姿态、合法频道和运行字段规则不变',()=>{
 const radar=defaultProfile('radar-03d');radar.parameters.maxRange=7123;radar.parameters.frequencyGHz=15;radar.physics.peakPowerW=3333;
 const optical=defaultProfile('optical-nvt');optical.parameters.maxRange=1800;
 const sampling={bounds:{west:-75,east:75,south:-75,north:75,core:[100,50,100]}};
 const {candidates}=generateCandidatesWithEquipment(city,query,settings,sampling,['radar-03d','optical-nvt'],{profiles:[radar,optical]});
 const radarCandidates=candidates.filter(c=>c.device.presetId==='radar-03d');assert.deepEqual(radarCandidates.map(c=>c.device.parameters.pitch),[0,-15,-30]);
 for(const [index,candidate] of radarCandidates.entries()){
  const device=candidate.device;assert.equal(device.parameters.maxRange,7123);assert.equal(device.physics.peakPowerW,3333);assert.equal(device.parameters.frequencyGHz,EQUIPMENT_CHANNELS_GHZ['radar-03d'][0]);assert.equal(device.id,`task3-1-radar-03d-${[0,-15,-30][index]}`);assert.equal(device.type,'radar');assert.deepEqual(device.position,candidate.site.position);
 }
 const device=candidates.find(c=>c.device.presetId==='optical-nvt').device;assert.equal(device.parameters.maxRange,1800);assert.equal(device.parameters.wideHfov,createDevice('optical-nvt').parameters.wideHfov,'目录 null 占位不得覆盖仿真默认值');assert.equal(device.parameters.heading,angles(device.position,sampling.bounds.core).azimuth);
});

test('流水线入口克隆装备快照，残余补点使用同次参数并保留原俯仰和频道赋值',async()=>{
 const profile=defaultProfile('radar-03d');profile.parameters.maxRange=7123;profile.parameters.frequencyGHz=15;profile.physics.peakPowerW=3333;profile.physics.pulseWidthUs=.1;profile.physics.switchTimeUs=.1;
 const pending=runTask3Pipeline({city,query,settings,presetIds:['radar-03d'],equipmentSnapshot:{profiles:[profile]},withThreatFrames:false});
 profile.parameters.maxRange=1;profile.physics.peakPowerW=1;
 const {report}=await pending,repairs=report.plans.flatMap(plan=>plan.devices.filter(device=>device.id.startsWith('task3-repair-')));
 assert.ok(report.candidateCount>3);assert.ok(repairs.length>0,'夹具应产生残余补点');
 for(const device of repairs){assert.equal(device.parameters.maxRange,7123);assert.equal(device.physics.peakPowerW,3333);assert.ok(EQUIPMENT_CHANNELS_GHZ[device.presetId].includes(device.parameters.frequencyGHz));assert.notEqual(device.parameters.frequencyGHz,15);}
 const repair=repairs[0],direction=angles(repair.position,report.sampling.samples[0].position);assert.equal(repair.parameters.pitch,Math.max(-60,Math.min(0,direction.elevation-30)));
});

test('优化推演直接采用装备建模已选型号并过滤无仿真模型的目录装备',()=>{
 const selected=['radio-mini','radio-mini','fivega-zte-a9650-s49','radar-03d'];
 assert.deepEqual(resolveTask3EquipmentSelection({selectedPresetIds:selected}),['radio-mini','radar-03d']);
 assert.throws(()=>resolveTask3EquipmentSelection({profiles:[]}),/尚未提供已选型号/);
 assert.throws(()=>resolveTask3EquipmentSelection({selectedPresetIds:['fivega-zte-a9650-s49']}),/没有可用于优化推演的装备/);
 assert.throws(()=>resolveTask3EquipmentSelection(equipmentLibrarySnapshot([],()=>null)),/没有可用于优化推演的装备/);
});

test('同预设装备选用最近更新的库条目，自定义参数注入真实任务三候选',()=>{
 const base=defaultProfile('radar-03d'),custom=structuredClone(base),radio=defaultProfile('radio-mini');
 custom.presetId='custom:radar-03d:task3-test';custom.name='自定义样例雷达';
 custom.parameters.maxRange=7123;custom.physics.peakPowerW=3333;
 const catalogOnly=defaultProfile('fivega-zte-a9650-s49');
 const profiles=new Map([base,custom,radio,catalogOnly].map(profile=>[profile.presetId,profile]));
 const items=[
  {...base,addedAt:'2026-01-01T00:00:00Z'},
  {...custom,addedAt:'2026-01-03T00:00:00Z'},
  {...base,addedAt:'2026-01-02T00:00:00Z'},
  {...radio,addedAt:'2026-01-01T00:00:00Z'},
  {...catalogOnly,addedAt:'2026-01-01T00:00:00Z'},
  {presetId:'custom:radar-03d:missing',type:'radar',addedAt:'2026-01-04T00:00:00Z'},
 ];
 const snapshot=equipmentLibrarySnapshot(items,id=>profiles.get(id));
 assert.deepEqual(resolveTask3EquipmentSelection(snapshot),['radar-03d','radio-mini']);
 assert.deepEqual(snapshot.selectedEquipment[0],{presetId:base.presetId,profileId:custom.presetId,type:base.type,name:custom.name});
 assert.equal(snapshot.profiles[0].name,base.name);
 assert.equal(profiles.get(base.presetId).parameters.maxRange,base.parameters.maxRange);
 const sampling={bounds:{west:-75,east:75,south:-75,north:75,core:[100,50,100]}};
 const {candidates}=generateCandidatesWithEquipment(city,query,settings,sampling,snapshot.selectedPresetIds,snapshot);
 const device=candidates.find(item=>item.device.presetId===base.presetId).device;
 assert.equal(device.parameters.maxRange,7123);
 assert.equal(device.physics.peakPowerW,3333);
 assert.deepEqual(equipmentLibrarySnapshot(items.filter(item=>item.type!=='radar'),id=>profiles.get(id)).selectedPresetIds,['radio-mini']);
});
