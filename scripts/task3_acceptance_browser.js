import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';

const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const out='artifacts/task3';await mkdir(out,{recursive:true});
const distanceText=value=>value===0?'0（同点部署）':value<1?value.toFixed(2):value.toFixed(1);
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:60000});
 const openModule=async label=>{
  if(await page.evaluate(()=>window.__ac8DeploymentMenu?.isDetail())){
   await page.keyboard.press('Escape');
   await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isDetail(),null,{timeout:3000});
   await page.waitForTimeout(500);
  }
  await page.locator('#ac8-deployment-menu .ac8-hud-tabs button',{hasText:label}).click();
  await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isDetail(),null,{timeout:3000});
  await page.waitForTimeout(400);
 };
 await page.locator('#toggle-deployment').click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isOpen(),null,{timeout:5000});
 await page.waitForTimeout(1200);
 assert.deepEqual(await page.locator('#ac8-deployment-menu .ac8-hud-tabs button').allInnerTexts(),['推演输入','方案对比','盲区分布','电磁兼容','飞行演示']);
 await openModule('推演输入');
 await page.locator('#task3-panel').waitFor({state:'visible',timeout:10000});
 await page.screenshot({path:`${out}/acceptance-default-collapsed.png`});
 await page.setViewportSize({width:390,height:844});
 for(const label of ['推演输入','方案对比','盲区分布','电磁兼容','飞行演示']){
  await openModule(label);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} 小视口不得横向溢出`);
 }
 await page.screenshot({path:`${out}/acceptance-small-viewport.png`});
 await page.setViewportSize({width:1500,height:1000});
 await openModule('推演输入');

 const exportReport=async path=>{const pending=page.waitForEvent('download');await page.locator('#task3-export').click();const download=await pending;await download.saveAs(path);return JSON.parse(await readFile(path,'utf8'));};
 const run=async()=>{await page.locator('#task3-run').click();await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});};
 await openModule('推演输入');
 assert.equal(await page.locator('#task3-scope-width').inputValue(),'2400');assert.equal(await page.locator('#task3-scope-depth').inputValue(),'2400');
 await run();
 const defaultExport=await exportReport(`${out}/acceptance-default-report.json`),defaultReport=defaultExport.report,defaultPlan=defaultReport.plans.find(item=>item.id===defaultExport.activePlanId);
 assert.equal(defaultReport.settings.scope,'core');assert.equal(defaultReport.scope.widthM,2400);assert.equal(defaultReport.scope.depthM,2400);assert.equal(defaultReport.scope.clipped,false);
 assert.match(await page.locator('#task3-scope-status').textContent(),/本次范围：东西 2400 m × 南北 2400 m/);
 await openModule('方案对比');
 const names=await page.locator('#task3-device-list tbody tr td:first-child').allTextContents();
 assert.deepEqual(names,defaultPlan.devices.map((_,index)=>`设备-${index+1}`));assert.deepEqual(names,defaultExport.deviceDisplay.map(entry=>entry.displayName));
 await page.screenshot({path:`${out}/acceptance-chinese-numbering.png`});
 const emc=defaultReport.emc[defaultPlan.id];assert.equal(emc.counts.fail,0,'默认推荐方案必须 0 严重冲突');assert.ok(emc.conflicts.length>0,'需要真实冲突行核验距离显示');
 await openModule('电磁兼容');assert.match(await page.locator('#task3-emc .task3-emc-banner').textContent(),/严重 0/);
 const rows=page.locator('#task3-emc tbody tr');assert.equal(await rows.count(),Math.min(50,emc.conflicts.length));
 for(const [index,conflict] of emc.conflicts.slice(0,50).entries()){
  const cells=await rows.nth(index).locator('td').allTextContents(),displayA=defaultExport.deviceDisplay.find(entry=>entry.internalId===conflict.a).displayName,displayB=defaultExport.deviceDisplay.find(entry=>entry.internalId===conflict.b).displayName;
  assert.equal(cells[0],`${displayA} ↔ ${displayB}`);assert.equal(cells[3],distanceText(conflict.distanceM));
 }
 await page.screenshot({path:`${out}/acceptance-emc-distances.png`});
 await openModule('方案对比');await page.locator('#task3-plan').selectOption('economy');
 const economy=defaultReport.emc.economy,nonZero=economy.conflicts.filter(conflict=>!conflict.coLocated&&conflict.distanceM>0);assert.ok(nonZero.length>0,'需核验非共址距离未被错误显示为 0');
 await openModule('电磁兼容');
 const economyRows=page.locator('#task3-emc tbody tr');
 for(const [index,conflict] of economy.conflicts.entries())assert.equal((await economyRows.nth(index).locator('td').allTextContents())[3],distanceText(conflict.distanceM));
 await page.screenshot({path:`${out}/acceptance-emc-nonzero-distance.png`});
 

 await openModule('推演输入');await page.locator('#task3-scope-width').fill('10000');await page.locator('#task3-scope-depth').fill('10000');await page.locator('#task3-spacing').fill('700');await run();
 const clippedExport=await exportReport(`${out}/acceptance-clipped-report.json`),clipped=clippedExport.report.scope;
 assert.equal(clippedExport.report.settings.scope,'custom');assert.equal(clippedExport.report.settings.scopeWidthM,10000);assert.equal(clippedExport.report.settings.scopeDepthM,10000);assert.equal(clipped.clipped,true);assert.match(clipped.note,/DEM 数据裁切/);
 const effectiveWidth=clipped.effectiveBounds.east-clipped.effectiveBounds.west,effectiveDepth=clipped.effectiveBounds.north-clipped.effectiveBounds.south;
 assert.ok(effectiveWidth<10000&&effectiveDepth<10000);assert.match(await page.locator('#task3-scope-status').textContent(),/已按有效区域裁切.*不外推覆盖/);
 await openModule('推演输入');await page.screenshot({path:`${out}/acceptance-scope-clipped.png`});
 assert.deepEqual(errors,[]);
 const distances=emc.conflicts.map(conflict=>conflict.distanceM);
 console.log(JSON.stringify({tabs:'5/5 子模块切换；小视口 390×844 通过',default:{scope:'2400×2400 m',devices:defaultPlan.devices.length,chineseNames:`${names[0]}…${names.at(-1)}`,emc:emc.counts,distanceM:{min:Math.min(...distances),max:Math.max(...distances),rowsChecked:Math.min(50,emc.conflicts.length),coLocatedZeroes:distances.filter(value=>value===0).length,nonColocatedChecked:nonZero.map(value=>value.distanceM)}},clipped:{requested:'10000×10000 m',effective:`${effectiveWidth.toFixed(3)}×${effectiveDepth.toFixed(3)} m`,samples:clippedExport.report.sampling.samples.length,note:clipped.note},screenshots:['acceptance-default-collapsed.png','acceptance-input-window.png','acceptance-pipeline-window.png','acceptance-plans-window.png','acceptance-emc-window.png','acceptance-small-viewport.png','acceptance-chinese-numbering.png','acceptance-emc-distances.png','acceptance-emc-nonzero-distance.png','acceptance-scope-clipped.png'].map(name=>`${out}/${name}`)},null,2));
}finally{await browser.close();}
