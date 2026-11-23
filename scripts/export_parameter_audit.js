import {writeFileSync} from 'node:fs';
import {CATALOG_MODELS} from '../src/sensors/equipment-models.js';
import {catalogFields,defaultProfile,profileGroups,INACTIVE_EDITOR_FIELDS} from '../src/sensors/equipment-catalog.js';
import {demoDefaults} from '../src/sensors/equipment-demo-model.js';
import {PRESETS,DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';
const data={baseline:'27ea7fd2ba190d1bff2b838a8996764e1b0f764b',date:'2026-11-18',environment:DEFAULT_ENV,target:DEFAULT_TARGET,models:CATALOG_MODELS.map(m=>({id:m.id,name:m.name,type:m.type,catalogOnly:m.catalogOnly??false,profile:defaultProfile(m.id),fields:catalogFields(m.id),editorGroups:profileGroups(m.id),hiddenCompatibilityFields:INACTIVE_EDITOR_FIELDS[m.type]??[],demoDefaults:demoDefaults(defaultProfile(m.id)),legacyEnginePreset:PRESETS.find(p=>p.id===m.id)??null}))};
writeFileSync('docs/review-2026-11-18/default-parameters.json',JSON.stringify(data,null,2));
