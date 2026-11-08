import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevice,PRESETS} from '../src/sensors/presets.js';
import {CATALOG_SCHEMA,CATALOG_STORAGE_KEY,catalogFields,defaultProfile,createCatalogStore,validateProfile,validateCatalogFile} from '../src/sensors/equipment-catalog.js';

const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
test('model catalog retains seven identities and leaves undocumented optical and acoustic measurements unavailable',()=>{
 for(const preset of PRESETS)assert.deepEqual(validateProfile(defaultProfile(preset.id)),defaultProfile(preset.id));
 assert.equal(defaultProfile('optical-nvt').parameters.maxRange,null);
 assert.equal(defaultProfile('optical-nvt').parameters.wideHfov,null);
 assert.equal(defaultProfile('acoustic-cry').parameters.bearingAccuracy,null);
 assert.ok(!Object.hasOwn(catalogFields('acoustic-cry'),'parameters.azimuthFov'));
 for(const preset of PRESETS)for(const key of Object.keys(catalogFields(preset.id)))assert.ok(!['parameters.heading','parameters.pitch','environment.rainMmH','position'].includes(key));
});
test('saving a model persists independent copies without editing existing scene devices or built-in defaults',()=>{
 const storage=memory(),device=createDevice('radar-02c','scene-device',[10,100,20]),before=structuredClone(device),store=createCatalogStore(storage),profile=store.get('radar-02c');
 profile.parameters.maxRange=6500;store.save(profile);profile.parameters.maxRange=1;
 assert.equal(store.get('radar-02c').parameters.maxRange,6500);
 assert.equal(createCatalogStore(storage).get('radar-02c').parameters.maxRange,6500);
 assert.deepEqual(device,before);assert.equal(defaultProfile('radar-02c').parameters.maxRange,8000);
 assert.ok(storage.getItem(CATALOG_STORAGE_KEY));
});
test('model validation rejects contradictory bounds, invalid counts and thermal optics while preserving legitimate zero',()=>{
 const profile=defaultProfile('radar-02c');profile.parameters.minRange=0;assert.equal(validateProfile(profile).parameters.minRange,0);
 for(const edit of [p=>p.parameters.minRange=p.parameters.maxRange,p=>p.parameters.capacity=1.5,p=>p.physics.peakPowerW=NaN]){const bad=structuredClone(profile);edit(bad);assert.throws(()=>validateProfile(bad));}
 const optical=defaultProfile('optical-nvt');optical.working.channel='thermal';assert.throws(()=>validateProfile(optical));optical.working.focalMm=75;assert.doesNotThrow(()=>validateProfile(optical));
 const radio=defaultProfile('radio-x1c');radio.parameters.bandMinGHz=6;assert.throws(()=>validateProfile(radio));
});
test('catalog imports validate every model before replacing saved values and reject scene reports or extra fields',()=>{
 const store=createCatalogStore(memory()),one=defaultProfile('radar-02c'),two=defaultProfile('radio-tdoa');one.parameters.maxRange=6000;two.parameters.minRange=99999;
 assert.throws(()=>store.import({schema:CATALOG_SCHEMA,profiles:[one,two]}));assert.equal(store.get(one.presetId).parameters.maxRange,8000);
 assert.throws(()=>validateCatalogFile({schema:'scenario',devices:[one]}));
 assert.throws(()=>validateCatalogFile({schema:CATALOG_SCHEMA,profiles:[one,one]}));
 one.parameters.position=[0,0,0];assert.throws(()=>validateProfile(one));
});
test('storage errors leave saved models intact and damaged local data falls back to defaults',()=>{
 const store=createCatalogStore({getItem:()=>null,setItem:()=>{throw Error('storage full');}}),profile=defaultProfile('radar-03d');profile.parameters.maxRange=7000;
 assert.throws(()=>store.save(profile));assert.equal(store.get(profile.presetId).parameters.maxRange,8000);
 const corrupt=createCatalogStore({getItem:()=>'{invalid'});assert.equal(corrupt.readError,true);assert.equal(corrupt.get('radar-02c').parameters.maxRange,8000);
});
