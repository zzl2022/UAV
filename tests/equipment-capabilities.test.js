import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {availableMetrics,hasValue,displayValue,pathLabel,assessmentSummary,resultExplanation,
 ensureSettings,requestForScenario,parameterRows,reportHTML,comparisonRows} from '../src/sensors/capability-data.js';
import {createDevice,PRESETS,DEFAULT_TARGET,DEFAULT_ENV} from '../src/sensors/presets.js';
import {validateScenario,MODEL_VERSION} from '../src/sensors/engine.js';
const catalog={scene:{origin:[113,34,0],hash:'real-scene-hash'}};
const scenario=()=>ensureSettings({modelVersion:MODEL_VERSION,origin:[113,34,0],
 devices:[createDevice('optical-nvt','o',[10,20,-30]),createDevice('acoustic-cry','a',[20,30,-40])],
 target:structuredClone(DEFAULT_TARGET),environment:{...DEFAULT_ENV}});
const result=()=>({id:'o',type:'optical',device:'NVT-951',geometry:{state:'clear'},
 raw_result:{distance:{value:200},fov:{value:null},target_in_fov:{value:null}},
 metrics:[{label:'目标距离',value:200,unit:'m',status:'derived'},{label:'不能算的视场',value:null,status:'missing'},
  {label:'未标定识别率',value:null,status:'not_evaluated'},{label:'视场外',value:false,unit:'boolean',status:'derived'},
  {label:'零值',value:0,unit:'m',status:'derived'}],configuration:{},notes:['已复用原 Python field_of_view、Pose 和 Target 校验。']});

test('presentation omits unavailable metrics while preserving valid false and zero values',()=>{
 const r=result(),before=structuredClone(r);
 assert.deepEqual(availableMetrics(r).map(m=>m.value),[200,false,0]);assert.deepEqual(r,before);
 assert.equal(hasValue([20,null]),false);assert.equal(hasValue(NaN),false);assert.equal(hasValue(false),true);
 assert.equal(displayValue(false),'否');assert.equal(displayValue(0),'0');assert.equal(displayValue(null),'');
});
test('unconfirmed geometry is never relabeled clear and blocked sound is never declared undetectable',()=>{
 assert.equal(pathLabel({geometry:{state:'unknown'}}),'');
 const r={...result(),type:'acoustic',geometry:{state:'blocked'},raw_result:{within_nominal_range:{value:true}}};
 assert.equal(assessmentSummary(r),'位于标称距离内');assert.ok(resultExplanation(r).some(t=>t.includes('反射和绕射')));
 assert.ok(!assessmentSummary(r).includes('可感知'));
});
test('optical summary distinguishes mechanical orientation, obstruction and actual FOV decisions',()=>{
 const r=result();assert.equal(assessmentSummary(r),'基础几何评估');
 r.raw_result.target_in_fov.value=false;assert.equal(assessmentSummary(r),'目标在视场外');
 r.raw_result.target_in_fov.value=true;assert.equal(assessmentSummary(r),'目标在视场内');
 r.geometry.state='blocked';assert.equal(assessmentSummary(r),'直达路径受阻');
 r.raw_result.mechanical_orientation_valid={value:false};assert.equal(assessmentSummary(r),'请调整云台朝向');
});
test('request uses the actual equipment scene and per-device settings without importing assumed environment',()=>{
 const s=scenario();s.devices[0].capability={channel:'thermal',focal_mm:75,use_custom_fov:true,custom_fov_deg:[10,8]};
 s.devices[0].parameters.heading=90;s.target.capability.check_band=true;
 const before=structuredClone(s),calls=[];
 const req=requestForScenario(catalog,s,(a,b)=>{calls.push([a,b]);return {known:true,blocked:false};});
 assert.equal(req.devices[0].id,'o');assert.deepEqual(req.devices[0].position,s.devices[0].position);
 assert.equal(req.devices[0].channel,'thermal');assert.equal(req.devices[0].heading_deg,90);
 assert.deepEqual(req.devices[0].direct_fov_deg,[10,8]);assert.deepEqual(req.target.position,s.target.position);
 assert.deepEqual(req.target.band_hz,[500,2000]);assert.equal(req.scene_hash,catalog.scene.hash);
 assert.equal(req.mode,'dataset_only');assert.ok(!('environment'in req));assert.equal(calls.length,2);assert.deepEqual(s,before);
});
test('inactive custom optics do not silently enable the demonstration angles',()=>{
 const s=scenario(),before=structuredClone(s),ref=s.devices[0].capability;
 ensureSettings(s);assert.equal(s.devices[0].capability,ref);assert.deepEqual(s,before);
 const req=requestForScenario(catalog,s,()=>({known:true,blocked:false}));
 assert.ok(!('direct_fov_deg'in req.devices[0]));assert.equal(req.target.band_hz,null);
});
test('available parameter table excludes demo overrides and fields belonging to other array specifications',()=>{
 const r={...result(),type:'acoustic',configuration:{parameters:{array_diameter:{value:.3,unit:'m',status:'provided'},
  frequency_range:{value:[20,20000],unit:'Hz',status:'provided'},azimuth_error:{value:null,status:'missing'}},
  demo_overrides:{azimuth_error:{value:2,unit:'deg',status:'assumed'}}}};
 assert.deepEqual(parameterRows(r).map(m=>m.label),['当前阵列直径']);
});
test('HTML report includes all scenarios and valid metrics without internal notes or unavailable feature rows',()=>{
 const r=result();r.device='<img src=x onerror=alert(1)>';
 const scenes=[{name:'近处',payload:{results:[r]}},{name:'移动后',payload:{results:[{...r,raw_result:{distance:{value:350}}}]}}];
 const before=structuredClone(scenes),html=reportHTML(scenes);
 for(const text of ['近处','移动后','目标距离','200','350','零值'])assert.ok(html.includes(text));
 for(const text of ['未知','缺失','未提供','不能算的视场','未标定识别率','field_of_view','老师平台','<img'])assert.ok(!html.includes(text),text);
 assert.ok(html.includes('&lt;img'));assert.equal(comparisonRows(scenes).length,2);assert.deepEqual(scenes,before);
});
test('equipment import/export retains assessment settings and validates malicious or invalid additions',()=>{
 const s=scenario();s.assessmentMode='dataset';assert.deepEqual(validateScenario(s,s.origin),s);
 for(const edit of [s=>s.assessmentMode='bad',s=>s.devices[0].capability.custom_fov_deg=[null,10],
  s=>s.devices[0].capability.use_custom_fov='yes',s=>s.devices[1].capability.array_diameter_m=.5,
  s=>s.target.capability.band_hz=[5000,1000],s=>s.target.capability.width_m=-1]){
  const invalid=structuredClone(s);edit(invalid);assert.throws(()=>validateScenario(invalid,s.origin));
 }
});
test('application mounts one equipment workspace and retains task3 entry',()=>{
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.ok(!source.includes('mountStudentCapabilities'));assert.ok(source.includes('mountSensorUI'));
 assert.ok(source.includes('mountTask3UI'));
});
test('acoustic simulation does not treat the unconfirmed camera FOV as an acoustic beam',()=>{
 const p=PRESETS.find(p=>p.type==='acoustic');assert.equal(p.parameters.azimuthFov,360);
 assert.equal(p.parameters.elevationMin,-90);assert.equal(p.parameters.elevationMax,90);
 for(const key of ['azimuthFov','elevationMin','elevationMax'])assert.notEqual(p.provenance[key],'文档');
});
