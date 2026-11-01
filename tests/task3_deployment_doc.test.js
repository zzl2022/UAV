import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeploymentDocument,renderDeploymentDocument} from '../src/task3/deployment-doc.js';

const rule={id:'R1',title:'真实统计规则',text:'夹缝阈值为 45 m。',evidence:{samples:8,runIds:'run-real-1、run-real-2',method:'两轮 nominal 夹缝宽度 P90'}};
function fixture(){
 const conditions=[{id:'nominal',name:'基线 · 发射'},{id:'silent',name:'无线电静默'}];
 const types=['radar','radio','acoustic','radar','radio','acoustic'];
 const devices=types.map((type,index)=>({id:`device-${index+1}`,presetId:type==='radar'?'radar-03d':type==='radio'?'radio-tdoa':'acoustic-cry',type,name:`型号-${index+1}`,position:[index*100-250,100+index*5,index*60-150],parameters:{pitch:-15,frequencyGHz:16}}));
 const sites=devices.map((device,index)=>({id:`site-${index+1}`,name:`真实建筑 ${index+1}`,position:[...device.position],installation:'屋顶上方 2 m；施工条件未实测'}));
 const metrics=conditions.map((condition,index)=>({condition:condition.id,name:condition.name,covered:10-index,total:12,coverageRate:(10-index)/12,blindRate:(2+index)/12,coreCoverageRate:0.9-index*0.1,coreRedundantRate:0.7-index*0.1}));
 const coverageContributions=Object.fromEntries(devices.map((device,index)=>[device.id,conditions.map(condition=>({condition:condition.id,coveredSamples:8-index,independentSamples:6-index}))]));
 const plan={id:'balanced',name:'均衡型 · 全类型',devices,sites,cost:88.5,typeCounts:{radar:2,radio:2,acoustic:2},metrics,coverageContributions};
 const report={createdAt:'2026-11-01T01:00:00.000Z',settings:{scope:'custom',scopeWidthM:2200,scopeDepthM:2100,spacing:500,siteSpacing:500,heights:[30,60,100],coreRadius:700,marginReserveDb:3},scope:{widthM:2200,depthM:2100,clipped:false,note:'仅使用真实 GIS/DEM。'},origin:[113.66,34.78,0],inputHashes:{'zheng_apart.shp':'abc123'},sampling:{bounds:{core:[0,80,0]},samples:Array.from({length:12},(_,index)=>({id:`sample-${index}`})),excluded:{outsideDem:0}},conditions,candidateCount:30,siteCount:10,plans:[plan],recommendedId:'balanced',scoring:{plans:[{id:'balanced',score:0.97,rank:1}]},emc:{balanced:{verdict:'pass',counts:{fail:0,warning:0}}},limitations:['覆盖率仅针对有效采样点。']};
 const run={runId:'run-current-real',createdAt:report.createdAt};
 return {report,run,plan};
}

test('deployment doc: 当前范围、指标、规则和 3–5 个真实代表点保持一致',()=>{
 const {report,run,plan}=fixture(),model=createDeploymentDocument({report,run,rules:[rule],documentKind:'standard',generatedAt:'2026-11-01T02:00:00.000Z'});
 assert.equal(model.source.runId,run.runId);assert.equal(model.scope.widthM,2200);assert.equal(model.grid.spacingM,500);assert.equal(model.cases.length,4);
 for(const item of model.cases){const device=plan.devices.find(row=>row.id===item.deviceId);assert.ok(device);assert.deepEqual(item.position,device.position);assert.ok(item.reasons[0].includes(`${item.coveredSamples}/${item.totalSamples}`));}
 assert.deepEqual(model.metrics.conditions,plan.metrics);assert.equal(model.rules[0].evidence.samples,8);assert.equal(model.mobileRepair.enabled,false);
 const html=renderDeploymentDocument(model);assert.match(html,/run-current-real/);assert.match(html,/未启用警车移动补盲/);assert.match(html,/两轮 nominal 夹缝宽度 P90/);
 assert.ok(!/(?:src|href)=["']https?:|url\(\s*["']?https?:/i.test(html));assert.ok(!/TBD|TODO|待补充|示例数据|lorem ipsum|\bundefined\b|\bNaN\b/i.test(html));
 const embedded=html.match(/<script type="application\/json" id="deployment-doc-data">([\s\S]*?)<\/script>/);assert.ok(embedded);assert.deepEqual(JSON.parse(embedded[1]).metrics.conditions,plan.metrics);
});

test('deployment doc: 当前选中而非推荐方案不会被替换成推荐指标',()=>{
 const {report,run,plan}=fixture(),other=structuredClone(plan);other.id='economy';other.name='经济型';other.devices=other.devices.slice(0,4);other.sites=other.sites.slice(0,4);other.cost=51.5;other.metrics=other.metrics.map(row=>({...row,covered:8,total:12,coverageRate:8/12,blindRate:4/12}));
 report.plans.push(other);report.emc.economy={verdict:'degraded',counts:{fail:0,warning:2}};report.scoring.plans.push({id:'economy',score:0.8,rank:2});
 const model=createDeploymentDocument({report,run,activePlanId:'economy',rules:[rule]});assert.equal(model.plan.id,'economy');assert.equal(model.plan.recommended,false);assert.equal(model.plan.deviceCount,4);assert.equal(model.metrics.conditions[0].covered,8);assert.equal(model.emc.verdict,'degraded');assert.match(renderDeploymentDocument(model),/当前选中方案，非推荐方案/);
});

test('deployment doc: 移动派生状态与新增案例如实标注，未重算内容明确排除',()=>{
 const {report,run,plan}=fixture(),device={id:'mobile-1',presetId:'radar-03d',type:'radar',name:'03D',position:[400,72,-200],parameters:{pitch:-30,frequencyGHz:16},mobileRepair:{platform:'police-car',roadReachabilityVerified:false}};
 plan.devices.push(device);plan.sites.push({id:'mobile-site',name:'开阔地表几何代理点（未验证道路可达）',position:[...device.position],installation:'警车移动部署'});plan.coverageContributions[device.id]=[{condition:'nominal',coveredSamples:10,independentSamples:9},{condition:'silent',coveredSamples:9,independentSamples:8}];
 plan.derivation={basePlanId:'balanced',conditionId:'nominal',status:'partial',addedDeviceCount:1,selected:[{deviceId:device.id,newlyCoveredSampleIds:['sample-1','sample-2']}],assumptions:['挂载高度 2 m 为模型假设。']};
 const model=createDeploymentDocument({report,run,rules:[rule]});assert.equal(model.mobileRepair.enabled,true);assert.ok(model.cases.some(item=>item.deviceId===device.id&&item.mobile));assert.ok(model.limitations.some(item=>item.includes('威胁推演未对派生方案重算')));
 const html=renderDeploymentDocument(model);assert.match(html,/移动补盲派生状态/);assert.match(html,/新增覆盖 2 个/);assert.match(html,/道路可达性未验证/);assert.doesNotMatch(html,/未启用警车移动补盲/);
});
