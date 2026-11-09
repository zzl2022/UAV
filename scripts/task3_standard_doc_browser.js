// 部署方案 PDF 导出端到端验证：推演 → 导出 PDF → 校验文件头/字体嵌入，并核对文档数据模型与 report/run 一致。
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';

const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/chromium');
const out='artifacts/task3';await mkdir(out,{recursive:true});

function verifyModel(model,report,activePlanId){
 assert.equal(model.schema,'task3-deployment-doc/1.0');assert.equal(model.documentKind,'current');assert.equal(model.source.activePlanId,activePlanId);
 const plan=report.plans.find(item=>item.id===activePlanId);assert.ok(plan);assert.equal(model.plan.deviceCount,plan.devices.length);assert.equal(model.plan.cost,plan.cost);assert.deepEqual(model.metrics.conditions,plan.metrics);assert.deepEqual(model.emc.counts,report.emc[plan.id].counts);
 assert.equal(model.scope.widthM,report.scope.widthM);assert.equal(model.scope.depthM,report.scope.depthM);assert.equal(model.grid.spacingM,report.settings.spacing);assert.equal(model.grid.sampleCount,report.sampling.samples.length);
 assert.ok(model.cases.length>=3&&model.cases.length<=5,`代表点应为 3–5 个，实际 ${model.cases.length}`);
 for(const item of model.cases){const device=plan.devices.find(row=>row.id===item.deviceId);assert.ok(device,`案例 ${item.deviceId} 必须来自当前方案`);assert.deepEqual(item.position,device.position);const contribution=plan.coverageContributions[device.id].find(row=>row.condition===item.conditionId);assert.equal(item.coveredSamples,contribution.coveredSamples);assert.equal(item.independentSamples,contribution.independentSamples);assert.ok(item.reasons.length>=2);}
 assert.ok(model.rules.length>0);for(const rule of model.rules){assert.ok(rule.evidence.samples>0);assert.ok(rule.evidence.runIds);assert.ok(rule.evidence.method);}
 assert.equal(model.mobileRepair.enabled,Boolean(plan.derivation));
 const serialized=JSON.stringify(model);assert.ok(!/TBD|TODO|待补充|示例数据|lorem ipsum|\bundefined\b|\bNaN\b/i.test(serialized),'不得含占位值');
}

const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:60000});
 await page.locator('#toggle-deployment').click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isOpen(),null,{timeout:5000});
 await page.locator('#ac8-deployment-menu .ac8-hud-tabs button',{hasText:'推演输入'}).click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isDetail(),null,{timeout:3000});
 assert.equal(await page.locator('#task3-export-pdf').isDisabled(),true,'未推演时 PDF 不可伪造');
 // 自定义矩形范围推演
 await page.locator('#task3-scope-width').fill('2200');await page.locator('#task3-scope-depth').fill('2100');await page.locator('#task3-run-side').evaluate(button=>button.click());
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});
 const event=page.waitForEvent('download');await page.locator('#task3-export-pdf').click();const download=await event;const pdfPath=`${out}/deployment-doc.pdf`;await download.saveAs(pdfPath);
 const pdf=await readFile(pdfPath);assert.match(pdf.toString('latin1',0,8),/^%PDF-/,'PDF 文件头');assert.ok(pdf.length>50000,'PDF 应包含中文字体与完整内容');assert.match(pdf.toString('latin1'),/FontFile|CIDFontType/,'PDF 应嵌入字体');
 const exported=await page.evaluate(()=>window.__task3Export()),model=await page.evaluate(()=>window.__task3DeploymentModel);
 assert.equal(exported.report.settings.scope,'custom');assert.equal(exported.report.scope.widthM,2200);assert.equal(exported.report.scope.depthM,2100);assert.equal(exported.report.settings.spacing,500);
 verifyModel(model,exported.report,exported.activePlanId);
 assert.equal(model.source.runId,(await page.evaluate(()=>window.__task3Run)).runId);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pdf:{path:pdfPath,bytes:pdf.length},scope:`${model.scope.widthM}×${model.scope.depthM} m`,spacingM:model.grid.spacingM,planId:model.plan.id,cases:model.cases.length,rules:model.rules.length,coverage:model.metrics.conditions.map(row=>({condition:row.condition,covered:row.covered,total:row.total})),verified:'PDF 文件头 + 字体嵌入 + 文档数据模型与 report/run 一致'},null,2));
}finally{await browser.close();}
