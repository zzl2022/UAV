// Task 6.4：从真实页面下载默认/当前 HTML，再以 file:// 离线打开并核对 report/run、案例和截图。
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/chromium');
const out='artifacts/task3/downloads';await mkdir(out,{recursive:true});
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const source=await readJson('artifacts/task3/standard-deployment-source.json'),defaultReport=await readJson(source.reportPath),staticHtml=await readFile(source.htmlPath,'utf8');
assert.equal(createHash('sha256').update(staticHtml).digest('hex'),source.htmlSha256,'默认 HTML 必须来自真实脚本产物');
assert.equal(source.settings.scopeWidthM,2400);assert.equal(source.settings.scopeDepthM,2400);assert.equal(source.settings.spacing,500);assert.equal(source.mobileRepairEnabled,false);

function modelFromHtml(html){const match=html.match(/<script type="application\/json" id="deployment-doc-data">([\s\S]*?)<\/script>/);assert.ok(match,'HTML 缺少内联结构化数据');return JSON.parse(match[1]);}
function verifyModel(model,report,runId,activePlanId,kind){
 assert.equal(model.schema,'task3-deployment-doc/1.0');assert.equal(model.documentKind,kind);assert.equal(model.source.runId,runId);assert.equal(model.source.activePlanId,activePlanId);
 const plan=report.plans.find(item=>item.id===activePlanId);assert.ok(plan);assert.equal(model.plan.deviceCount,plan.devices.length);assert.equal(model.plan.cost,plan.cost);assert.deepEqual(model.metrics.conditions,plan.metrics);assert.deepEqual(model.emc.counts,report.emc[plan.id].counts);
 assert.equal(model.scope.widthM,report.scope.widthM);assert.equal(model.scope.depthM,report.scope.depthM);assert.equal(model.grid.spacingM,report.settings.spacing);assert.equal(model.grid.sampleCount,report.sampling.samples.length);
 assert.ok(model.cases.length>=3&&model.cases.length<=5,`代表点应为 3–5 个，实际 ${model.cases.length}`);
 for(const item of model.cases){const device=plan.devices.find(row=>row.id===item.deviceId);assert.ok(device,`案例 ${item.deviceId} 必须来自当前方案`);assert.deepEqual(item.position,device.position);const contribution=plan.coverageContributions[device.id].find(row=>row.condition===item.conditionId);assert.equal(item.coveredSamples,contribution.coveredSamples);assert.equal(item.independentSamples,contribution.independentSamples);assert.ok(item.reasons.length>=2);}
 assert.ok(model.rules.length>0);for(const rule of model.rules){assert.ok(rule.evidence.samples>0);assert.ok(rule.evidence.runIds);assert.ok(rule.evidence.method);}
 assert.equal(model.mobileRepair.enabled,Boolean(plan.derivation));if(!plan.derivation)assert.ok(model.limitations.some(item=>item.includes('未启用警车移动补盲')));
 const serialized=JSON.stringify(model);assert.ok(!/TBD|TODO|待补充|示例数据|lorem ipsum|\bundefined\b|\bNaN\b/i.test(serialized),'不得含占位值');
}
const defaultModel=modelFromHtml(staticHtml);verifyModel(defaultModel,defaultReport,source.runId,source.activePlanId,'standard');

const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const results={default:{runId:source.runId,cases:defaultModel.cases.length,rules:defaultModel.rules.length},custom:{}};
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:60000});
 await page.locator('#toggle-task3').click();await page.locator('#task3-panel .task3-io summary').click();
 assert.equal(await page.locator('#task3-export-default-doc').isEnabled(),true,'默认文档未推演也可下载');assert.equal(await page.locator('#task3-export-current-doc').isDisabled(),true,'未推演时当前文档不可伪造');
 let event=page.waitForEvent('download');await page.locator('#task3-export-default-doc').click();let download=await event;const defaultPath=`${out}/任务三标准布设方案.html`;await download.saveAs(defaultPath);
 assert.equal(await readFile(defaultPath,'utf8'),staticHtml,'页面默认下载必须逐字等于真实脚本产物');await page.screenshot({path:'artifacts/task3/doc-download-entry.png'});
 // 自定义矩形范围，其他设置保持标准网格；下载时以页面当前 report/run 为准。
 await page.locator('#task3-open-input').click();await page.locator('#task3-scope-width').fill('2200');await page.locator('#task3-scope-depth').fill('2100');await page.locator('#task3-run').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});
 const downloadJson=async(id,path)=>{const pending=page.waitForEvent('download');await page.locator(id).click();const item=await pending;await item.saveAs(path);return readJson(path);};
 const customExport=await downloadJson('#task3-export',`${out}/custom-report.json`),customRun=await downloadJson('#task3-export-run',`${out}/custom-run.json`);
 event=page.waitForEvent('download');await page.locator('#task3-export-current-doc').click();download=await event;const customPath=`${out}/任务三当前布设方案.html`;await download.saveAs(customPath);
 assert.equal(customExport.report.settings.scope,'custom');assert.equal(customExport.report.scope.widthM,2200);assert.equal(customExport.report.scope.depthM,2100);assert.equal(customExport.report.settings.spacing,500);
 const customHtml=await readFile(customPath,'utf8'),customModel=modelFromHtml(customHtml);verifyModel(customModel,customExport.report,customRun.runId,customExport.activePlanId,'current');
 assert.equal(customModel.source.runId,customRun.runId);assert.notEqual(customModel.source.runId,defaultModel.source.runId);assert.equal(customModel.mobileRepair.enabled,false);
 results.custom={runId:customRun.runId,scope:`${customModel.scope.widthM}×${customModel.scope.depthM} m`,spacingM:customModel.grid.spacingM,planId:customModel.plan.id,cases:customModel.cases.length,rules:customModel.rules.length,coverage:customModel.metrics.conditions.map(row=>({condition:row.condition,covered:row.covered,total:row.total}))};
 assert.deepEqual(errors,[]);
 // 两个真实下载文件都离线打开；除 file:// 主文档外不允许任何网络依赖。
 for(const [name,path,expected] of [['default',defaultPath,defaultModel],['custom',customPath,customModel]]){
  const offline=await browser.newPage({viewport:{width:1400,height:1000}}),requests=[],pageErrors=[];offline.on('request',request=>requests.push(request.url()));offline.on('pageerror',error=>pageErrors.push(error.message));
  await offline.goto(pathToFileURL(path).href,{waitUntil:'load'});assert.deepEqual(requests.filter(url=>/^https?:/i.test(url)),[],`${name} 不得请求外部资源`);assert.deepEqual(pageErrors,[]);
  for(const id of ['overview','scope','rules','cases','limitations'])assert.equal(await offline.locator(`#${id}`).count(),1,`${name} 缺 ${id}`);
  const offlineModel=JSON.parse(await offline.locator('#deployment-doc-data').textContent());assert.deepEqual(offlineModel,expected);assert.equal(await offline.locator('.case').count(),expected.cases.length);assert.equal(await offline.locator('body').getAttribute('data-run-id'),expected.source.runId);
  const visible=await offline.locator('body').innerText();assert.ok(!/TBD|TODO|待补充|示例数据|lorem ipsum|\bundefined\b|\bNaN\b/i.test(visible));if(!expected.mobileRepair.enabled)assert.match(visible,/未启用警车移动补盲/);
  await offline.screenshot({path:`artifacts/task3/${name}-deployment-doc.png`,fullPage:true});await offline.close();
 }
 results.screenshots=['artifacts/task3/doc-download-entry.png','artifacts/task3/default-deployment-doc.png','artifacts/task3/custom-deployment-doc.png'];results.downloads=[defaultPath,customPath];results.verified='默认与自定义均实际下载、file:// 离线打开，无外部请求，指标/案例/runId 与 report/run 一致';
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
