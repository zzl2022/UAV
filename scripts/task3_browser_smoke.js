// 任务三面板端到端冒烟：真实数据下一键推演 → 方案择优 → 盲区分类 → 威胁回放 → EMC 结论 → 导出。
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {assertDetectionSpeech,mockBrowserSpeech} from './voice_browser_helper.js';
import {closeSceneMenu,openSceneMenu} from './city_menu_helper.js';

async function enterDeployment(page,label){
 if(!await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen()))await page.locator('#toggle-deployment').click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isOpen());
 if(await page.evaluate(()=>window.__ac8DeploymentMenu?.isDetail())){
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isDetail());
 }
 await page.locator('#ac8-deployment-menu .ac8-hud-tabs button',{hasText:label}).click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isDetail());
}

async function closeDeployment(page){
 for(let i=0;i<2&&await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen());i++){
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
 }
 await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isOpen());
}

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/task3',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await mockBrowserSpeech(page,{withChinese:false});
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:120000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:60000});
 // 打开推演部署窗口并运行默认推演
 await enterDeployment(page,'推演输入');
 await page.locator('#task3-panel').waitFor({state:'visible',timeout:10000});
 const generate=page.locator('#task3-panel .task3-subnav-btn[data-sub="generate"]');
 const runButton=page.locator('#task3-run-side');
 await generate.click();
 assert.equal(await runButton.isVisible(),true,'生成页应提供开始推演按钮');
 assert.equal(await page.locator('#task3-progress-side').isVisible(),true,'生成页应提供推演进度条');
 await runButton.click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});
 const diag=await page.evaluate(()=>window.task3Diagnostics);
 assert.match(await page.locator('#task3-status-side').innerText(),/推演完成/,'生成页状态应同步');
 assert.equal(await page.locator('#task3-progress-side').getAttribute('value'),'1','生成页进度应同步');
 // ≥3 套差异化方案并自动择优
 assert.equal(diag.plans.length,3);
 assert.ok(new Set(diag.plans.map(p=>p.devices)).size>=2,'方案设备数应有差异');
 assert.ok(diag.recommendedId&&diag.plans.some(p=>p.id===diag.recommendedId));
 // 四类盲区排查结果
 assert.ok(diag.blindStats&&typeof diag.blindStats.byCategory.gap==='number'&&typeof diag.blindStats.byCategory.shadow==='number');
 // 三威胁场景均有推演结果
 await page.locator('#task3-panel .task3-subnav-btn',{hasText:'威胁场景'}).click();
 const summary=key=>page.evaluate(key=>window.__task3Report.threatsByPlan[window.task3Diagnostics.planId][key]?.summary,key);
 for(const key of ['single','multi','swarm']){await page.locator('#task3-threat').selectOption(key);const s=await summary(key);assert.ok(s&&s.targetCount>0,`${key} 应有推演结果`);}
 await page.locator('#task3-threat').selectOption('swarm');
 const swarm=await summary('swarm');assert.equal(swarm.targetCount,42);assert.ok(swarm.overflowEvents>0,'蜂群应如实产生容量溢出');
 // EMC 结论
 assert.ok(['pass','degraded','fail'].includes(diag.emcVerdict));
 // 威胁推演播放/暂停/拖动
 await closeDeployment(page);
 const start=page.locator('#ac8-sim-start'),progress=page.locator('#ac8-sim-progress');
 await page.locator('#ac8-sim-scenario').selectOption('swarm');
 await start.click();
 await page.waitForFunction(()=>window.task3Diagnostics.threatPlaying&&window.task3Diagnostics.threatFrameIndex>2,null,{timeout:30000});
 await start.click();assert.equal(await page.evaluate(()=>window.task3Diagnostics.threatPlaying),false);
 const seek=value=>progress.evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);
 await seek(500);
 const detectedAt=await page.evaluate(()=>{
  const frames=window.__task3Report.threatsByPlan[window.task3Diagnostics.planId].swarm.frames;
  const index=frames.findIndex(frame=>frame.targets.some(target=>target.detectedBy.length));
  return index<0?null:Math.round(((frames[index-1]?.time??0)+frames[index].time)/2/frames.at(-1).time*1000);
 });
 assert.notEqual(detectedAt,null,'应有实际检出帧');
 await seek(detectedAt);
 await page.waitForFunction(()=>Number(document.querySelector('#threat-detected').textContent)>0);
 const voice=page.locator('#threat-voice'),preview=page.locator('#threat-voice-preview');
 assert.equal(await voice.isDisabled(),true);
 assert.equal(await page.locator('#threat-voice-status').textContent(),'当前浏览器没有可用的中文语音');
 assert.equal(await page.evaluate(()=>window.testSpeech.length),0);
 await page.evaluate(()=>window.loadTestChineseVoices());
 await voice.click();
 assert.equal(await voice.getAttribute('aria-pressed'),'true');
 const utterances=await page.evaluate(()=>window.testSpeech);
 const telemetry=await page.evaluate(()=>window.task3Diagnostics.threatTelemetry);
 assert.equal(utterances.length,1);
 assertDetectionSpeech(utterances[0]);
 assert.equal(utterances[0].text,`检出无人机，高度 ${Math.round(telemetry.agl)} 米，东经 ${telemetry.longitude.toFixed(4)} 度，北纬 ${telemetry.latitude.toFixed(4)} 度。`);
 await preview.click();
 assert.equal(await page.evaluate(()=>window.testSpeech.at(-1).text),utterances[0].text);
 const beforeDisable=await page.evaluate(()=>window.testSpeechCancels);
 await voice.click();
 assert.ok(await page.evaluate(count=>window.testSpeechCancels>count,beforeDisable));
 // 盲区类别筛选开关
 await enterDeployment(page,'盲区分析');
 await page.locator('#task3-blind-legend input[data-category="gap"]').uncheck();
 await page.locator('#task3-blind-legend input[data-category="gap"]').check();
 // 方案切换
 await enterDeployment(page,'方案对比');
 const other=diag.plans.find(p=>p.id!==diag.recommendedId).id;
 await page.locator('#task3-plan').selectOption(other);
 assert.equal(await page.evaluate(()=>window.task3Diagnostics.planId),other);
 // 导出部署方案 PDF 并验证文件头
 let dl=page.waitForEvent('download');await page.locator('#task3-export-pdf').click();await (await dl).saveAs('artifacts/task3/browser-deployment.pdf');
 const pdf=await readFile('artifacts/task3/browser-deployment.pdf');assert.match(pdf.toString('latin1',0,8),/^%PDF-/,'PDF 文件头');
 // 内部数据断言（替代 JSON 导出）
 const exported=await page.evaluate(()=>window.__task3Export());
 assert.equal(exported.report.plans.length,3);assert.ok(exported.report.threats.swarm.frames.length>0);
 const run=await page.evaluate(()=>window.__task3Run);assert.equal(run.schema,'task3-run/1.0');assert.ok(run.rulesInput.candidateStats.length>0);
 // 截图存档（用户验证用）
 await page.locator('#task3-plan').selectOption(diag.recommendedId);
 await page.locator('#deployment-panels').evaluate(n=>n.scrollTop=0);await page.screenshot({path:'artifacts/task3/panel-plans.png'});
 await enterDeployment(page,'盲区分析');
 await page.locator('#task3-blind-legend').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/task3/blindspots.png'});
 await enterDeployment(page,'电磁兼容');
 await page.locator('#task3-emc').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/task3/emc.png'});
 // 取消进行中推演
 await enterDeployment(page,'推演输入');
 await generate.click();
 await runButton.click();
 await page.waitForFunction(()=>window.task3Diagnostics.busy);
 await page.locator('#task3-cancel-side').click();
 assert.equal(await page.evaluate(()=>window.task3Diagnostics.busy),false);
 // 回归：区域菜单仍能使用，主控制条仍可切换播放。
 assert.equal(await page.locator('#task3-back').count(),0);
 await closeDeployment(page);
 await openSceneMenu(page);
 assert.equal(await page.locator('#model-select').inputValue(),'recon');
 await closeSceneMenu(page);
 assert.equal(await start.isEnabled(),true);
 assert.deepEqual(errors,[]);
 console.log('任务三浏览器冒烟通过，已覆盖三套方案择优、盲区、三类威胁、EMC、回放与语音、导出、取消和区域切换入口。');
}finally{await browser.close();}
