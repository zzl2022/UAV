import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG_MODELS,catalogModel} from '../src/sensors/equipment-models.js';
import {CATALOG_SCHEMA,createCatalogStore,createCustomProfile,defaultProfile,validateProfile} from '../src/sensors/equipment-catalog.js';
import {demoDefaults,prepareDemo} from '../src/sensors/equipment-demo-model.js';

const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};

test('new models of every category persist independently and remain usable in demonstrations',()=>{
 const storage=memory(),store=createCatalogStore(storage);
 for(const model of CATALOG_MODELS){
  const original=defaultProfile(model.id),custom=createCustomProfile(original,'测试型号 '+model.name);
  assert.equal(catalogModel(custom.presetId).basePresetId,model.id);
  store.save(custom);assert.deepEqual(store.get(model.id),original);
  assert.deepEqual(createCatalogStore(storage).get(custom.presetId),custom);
  const spec=prepareDemo(custom,demoDefaults(custom),[0,100,0]);assert.equal(spec.profile.name,custom.name);
  if(spec.device)assert.equal(spec.device.presetId,model.id);
 }
});

test('import creates a fresh model on every import without replacing built-in or previous models',()=>{
 const store=createCatalogStore(memory()),original=defaultProfile('radar-02c'),edited=structuredClone(original);edited.parameters.maxRange=6000;
 const file={schema:CATALOG_SCHEMA,profiles:[edited]},[first]=store.importAsNew(file),[second]=store.importAsNew(file);
 assert.notEqual(first.presetId,second.presetId);assert.equal(first.parameters.maxRange,6000);
 assert.deepEqual(store.get(original.presetId),original);
 const portable=store.export({...first,name:'导出型号'}),[third]=store.importAsNew(portable);assert.equal(third.name,'导出型号');assert.notEqual(third.presetId,first.presetId);
 const before=store.getSnapshot();const invalid=structuredClone(edited);invalid.parameters.maxRange=0;
 assert.throws(()=>store.importAsNew({schema:CATALOG_SCHEMA,profiles:[edited,invalid]}));assert.deepEqual(store.getSnapshot(),before);
});

test('custom model identity cannot select arbitrary bases or bypass parameter and name validation',()=>{
 const custom=createCustomProfile(defaultProfile('radar-02c'),'新雷达');
 assert.throws(()=>validateProfile({...custom,name:'   '}));
 assert.throws(()=>validateProfile({...custom,name:'a'.repeat(121)}));
 assert.throws(()=>validateProfile({...custom,presetId:'custom:unknown:123'}));
 assert.throws(()=>validateProfile({...custom,type:'optical'}));
 const invalid=structuredClone(custom);invalid.parameters.capacity=1.5;assert.throws(()=>validateProfile(invalid));
});
