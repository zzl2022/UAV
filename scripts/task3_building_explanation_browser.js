import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {openSceneMenu,closeSceneMenu} from './city_menu_helper.js';
const executablePath=process.env.CHROMIUM_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(p=>existsSync(p));
const out='artifacts/building-explanations';await mkdir(out,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser,page;
try{
 await server.listen();browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.log('PAGE ERROR',error.message);});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}?intro=0&demo=0`,{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:120000});console.log('1. 页面就绪');
 const openModule=async label=>{
  if(await page.evaluate(()=>window.__ac8DeploymentMenu?.isDetail())){await page.keyboard.press('Escape');await page.waitForTimeout(400);}
  if(!await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen())){await page.locator('#toggle-deployment').click();await page.waitForTimeout(600);}
  await page.locator('#ac8-deployment-menu .ac8-hud-tabs button',{hasText:label}).click();await page.waitForTimeout(500);
 };
 const run=async()=>{await page.locator('#task3-run-side').evaluate(b=>b.click());await page.waitForFunction(()=>window.task3Diagnostics.ready&&!window.task3Diagnostics.busy,null,{timeout:300000});assert.equal(await page.evaluate(()=>window.task3Diagnostics.constraintsInvalid),false);};
 const state=()=>page.evaluate(()=>window.task3Diagnostics);
 const openScene=async()=>{for(let i=0;i<2&&await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen());i++){await page.keyboard.press('Escape');await page.waitForTimeout(450);}if(await page.locator('#ac8-main-menu').evaluate(el=>el.classList.contains('is-main-collapsed')))await page.locator('#ac8-main-menu-toggle').click();await openSceneMenu(page,'scene');};
 await openModule('推演输入');
 await page.locator('#task3-spacing').fill('1000');await page.locator('#task3-max-devices').fill('8');
 await page.locator('#task3-plan-types input').evaluateAll(inputs=>inputs.forEach((input,i)=>{input.checked=i===0;input.dispatchEvent(new Event('input',{bubbles:true}));}));
 await run();console.log('2. 基线方案生成');
 await openModule('方案对比');await page.locator('#task3-device-list').locator('xpath=..').evaluate(el=>el.open=true);
 const boxes=page.locator('#task3-device-list input[type=checkbox]'),downloadButton=page.locator('#task3-device-explanation');
 assert.ok(await boxes.count());assert.equal(await downloadButton.isDisabled(),true);
 await boxes.first().check();assert.equal(await downloadButton.isEnabled(),true);await boxes.first().uncheck();assert.equal(await downloadButton.isDisabled(),true);
 await boxes.first().check();if(await boxes.count()>1)await boxes.nth(1).check();
 const ids=(await state()).selectedDeviceIds;
 const download=page.waitForEvent('download',{timeout:120000});await downloadButton.click();await (await download).saveAs(`${out}/device-explanation.pdf`);
 const exported=await page.evaluate(async ids=>{const {createDeviceExplanation}=await import('/src/task3/device-explanation.js');return createDeviceExplanation({report:window.__task3Report,run:window.__task3Run,activePlanId:window.task3Diagnostics.planId,deviceIds:ids,conditionId:'nominal'});},ids);
 assert.deepEqual(exported.devices.map(d=>d.id),ids);await writeFile(`${out}/device-explanation.json`,JSON.stringify(exported,null,2));await page.screenshot({path:`${out}/device-checkboxes.png`});console.log('3. 勾选、取消、按钮与 PDF 下载通过');
 await openModule('推演输入');await page.locator('[data-sub=weights]').click();await page.locator('#task3-building-select').click();await page.locator('#task3-building-editor').waitFor({state:'visible'});
 const canvas=page.locator('#viewport canvas').first(),rect=await canvas.boundingBox();
 const markers=(await state()).deviceMarkers.filter(m=>m.visible&&m.x>340&&m.x<1050&&m.y>100&&m.y<rect.height-100);
 assert.ok(markers.length,'需要真实屋顶上的可点击设备');const start=markers[0];
 await page.mouse.click(rect.x+start.x,rect.y+start.y);assert.ok((await state()).buildingSelection.count>0);assert.equal((await state()).constraintsInvalid,true);assert.equal((await state()).layerVisible,false);
 const selected=(await state()).buildingSelection.buildingIds;await page.screenshot({path:`${out}/selected-building.png`});
 await page.mouse.click(rect.x+start.x,rect.y+start.y);assert.equal((await state()).buildingSelection.count,0);
 await page.mouse.move(rect.x+start.x,rect.y+start.y);await page.mouse.down();await page.mouse.move(rect.x+start.x+240,rect.y+start.y+80,{steps:30});await page.mouse.up();
 assert.ok((await state()).buildingSelection.count>1,'涂选应追加多栋独立连通建筑');
 await page.screenshot({path:`${out}/painted-buildings.png`});const painted=(await state()).buildingSelection;
 const before=await page.evaluate(()=>window.task3Diagnostics.cameraPosition);await page.mouse.move(rect.x+650,rect.y+400);await page.mouse.down({button:'right'});await page.mouse.move(rect.x+720,rect.y+440,{steps:10});await page.mouse.up({button:'right'});await page.waitForTimeout(600);
 const after=await page.evaluate(()=>window.task3Diagnostics.cameraPosition);assert.notDeepEqual(after,before);assert.equal((await state()).buildingSelection.count,painted.count);
 await page.locator('#task3-building-editor button').click();await openModule('方案对比');assert.equal(await downloadButton.isDisabled(),true);console.log('4. 单选、取消、涂选、高亮、右键与失效拦截通过');
 await openModule('推演输入');await run();
 const result=await page.evaluate(async()=>{const {createDeploymentExclusion}=await import('/src/task3/building-constraints.js'),city=await fetch('/data/city.json').then(r=>r.json()),report=window.__task3Report;const guard=createDeploymentExclusion(city,report.settings);for(const p of report.plans)guard.assertDevices(p.devices,p.sites);return {settings:report.settings,devices:report.plans.flatMap(p=>p.devices.map(d=>d.id))};});
 assert.deepEqual(result.settings.buildingExclusions.buildingIds,painted.buildingIds);console.log('5. 重算全部设备排除所选区域');
 await openScene();await page.locator('#model-select').selectOption('beijing');await page.waitForFunction(()=>window.cityDiagnostics.modelMode==='beijing',null,{timeout:120000});await closeSceneMenu(page);
 assert.equal((await state()).buildingSelection.count,0);await openModule('推演输入');await page.locator('[data-sub=weights]').click();await page.locator('#task3-building-select').click();assert.equal((await state()).buildingSelection.sceneKey,'./data/beijing/beijing-gba');
 // The Beijing GLB batches buildings; click several model locations until a component is hit.
 for(const [x,y] of [[700,450],[650,500],[800,500],[700,600]]){await page.mouse.click(rect.x+x,rect.y+y);if((await state()).buildingSelection.count)break;}
 assert.ok((await state()).buildingSelection.count);await page.screenshot({path:`${out}/beijing-selection.png`});await page.locator('#task3-building-editor button').click();
 await openScene();await page.locator('#model-select').selectOption('recon');await page.waitForFunction(()=>window.cityDiagnostics.modelMode==='recon');await closeSceneMenu(page);
 assert.deepEqual((await state()).buildingSelection.buildingIds,painted.buildingIds);await openModule('推演输入');await page.locator('[data-sub=weights]').click();await page.locator('#task3-building-clear').click();assert.equal((await state()).buildingSelection.count,0);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${out}/mobile.png`});
 assert.deepEqual(errors,[]);console.log('6. 合并网格建筑、地图隔离保存、清空与窄屏通过');
}catch(error){if(page){await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});console.log(await page.evaluate(()=>({status:document.querySelector('#task3-status-side')?.textContent,diag:window.task3Diagnostics})).catch(()=>null));}throw error;}
finally{await browser?.close();await server.close();}
