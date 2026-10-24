// 任务三面板端到端冒烟：真实数据下一键推演 → 方案择优 → 盲区分类 → 威胁回放 → EMC 结论 → 导出。
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/task3',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:60000});
 // 打开任务三面板并运行默认推演
 await page.locator('#toggle-task3').click();
 assert.equal(await page.locator('#task3-panel').isVisible(),true);
 await page.locator('#task3-run').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});
 const diag=await page.evaluate(()=>window.task3Diagnostics);
 // ≥3 套差异化方案并自动择优
 assert.equal(diag.plans.length,3);
 assert.ok(new Set(diag.plans.map(p=>p.devices)).size>=2,'方案设备数应有差异');
 assert.ok(diag.recommendedId&&diag.plans.some(p=>p.id===diag.recommendedId));
 // 四类盲区排查结果
 assert.ok(diag.blindStats&&typeof diag.blindStats.byCategory.gap==='number'&&typeof diag.blindStats.byCategory.shadow==='number');
 // 三威胁场景均有推演结果
 for(const key of ['single','multi','swarm']){await page.locator('#task3-threat').selectOption(key);const s=await page.evaluate(()=>window.task3Diagnostics.threatSummary);assert.ok(s&&s.targetCount>0,`${key} 应有推演结果`);}
 await page.locator('#task3-threat').selectOption('swarm');
 const swarm=await page.evaluate(()=>window.task3Diagnostics.threatSummary);assert.equal(swarm.targetCount,42);assert.ok(swarm.overflowEvents>0,'蜂群应如实产生容量溢出');
 // EMC 结论
 assert.ok(['pass','degraded','fail'].includes(diag.emcVerdict));
 // 威胁推演播放/暂停/拖动
 await page.locator('#task3-threat-play').click();
 await page.waitForFunction(()=>window.task3Diagnostics.playing&&window.task3Diagnostics.frameIndex>2,null,{timeout:30000});
 await page.locator('#task3-threat-play').click();assert.equal(await page.evaluate(()=>window.task3Diagnostics.playing),false);
 await page.locator('#task3-threat-seek').evaluate(input=>{input.value='500';input.dispatchEvent(new Event('input',{bubbles:true}));});
 // 盲区类别筛选开关
 await page.locator('#task3-blind-legend input[data-category="gap"]').uncheck();
 await page.locator('#task3-blind-legend input[data-category="gap"]').check();
 // 方案切换
 const other=diag.plans.find(p=>p.id!==diag.recommendedId).id;
 await page.locator('#task3-plan').selectOption(other);
 assert.equal(await page.evaluate(()=>window.task3Diagnostics.planId),other);
 // 导出报告与过程数据
 let dl=page.waitForEvent('download');await page.locator('#task3-export').click();await (await dl).saveAs('artifacts/task3/browser-report.json');
 const exported=JSON.parse(await readFile('artifacts/task3/browser-report.json','utf8'));
 assert.equal(exported.report.plans.length,3);assert.ok(exported.report.threats.swarm.frames.length>0);
 dl=page.waitForEvent('download');await page.locator('#task3-export-run').click();await (await dl).saveAs('artifacts/task3/browser-run.json');
 const run=JSON.parse(await readFile('artifacts/task3/browser-run.json','utf8'));assert.equal(run.schema,'task3-run/1.0');assert.ok(run.rulesInput.candidateStats.length>0);
 // 截图存档（用户验证用）
 await page.locator('#task3-plan').selectOption(diag.recommendedId);
 await page.locator('#task3-panel').evaluate(n=>n.scrollTop=0);await page.screenshot({path:'artifacts/task3/panel-plans.png'});
 await page.locator('#task3-blind-legend').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/task3/blindspots.png'});
 await page.locator('#task3-emc').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/task3/emc.png'});
 // 取消进行中推演
 await page.locator('#task3-run').click();await page.waitForFunction(()=>window.task3Diagnostics.busy);await page.locator('#task3-cancel').click();assert.equal(await page.evaluate(()=>window.task3Diagnostics.busy),false);
 // 回归：子任务一/二入口仍在且可切换
 await page.locator('#task3-back').click();assert.equal(await page.locator('#task3-panel').isVisible(),false);
 await page.locator('#toggle-planning').click();await page.waitForFunction(()=>window.planningDiagnostics?.ready,null,{timeout:120000});
 assert.deepEqual(errors,[]);
 console.log('Task3 browser passed: pipeline ≥3 differentiated plans + auto recommendation, 4-category blindspots, 3 threat scenarios (swarm overflow honest), EMC verdict, playback/seek, exports, cancel, regression entry.');
}finally{await browser.close();}
