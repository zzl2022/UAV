import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox','--disable-gpu-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts',{recursive:true});
 const page=await browser.newPage({viewport:{width:1550,height:1050}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173');
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:120000});
 await page.locator('#toggle-student').click();
 await page.waitForFunction(()=>window.studentDiagnostics?.results?.length===2,null,{timeout:30000});
 let results=await page.evaluate(()=>window.studentDiagnostics.results);
 assert.equal(results[0].raw_result.fov.value,null);
 assert.equal(results[1].raw_result.detection_probability.value,null);
 assert.equal(results[1].raw_result.distance.value>0,true);
 assert.equal(await page.locator('#student-panel').isVisible(),true);
 assert.equal(await page.locator('#equipment-panel').isVisible(),false);
 await page.locator('#student-save').click();
 assert.equal(await page.evaluate(()=>window.studentDiagnostics.snapshots),1);
 await page.locator('#student-panel').evaluate(node=>node.scrollTop=0);
 await page.screenshot({path:'artifacts/student-optical-desktop.png'});
 // User-supplied fixed optics are explicitly assumed and feed the original FOV function.
 await page.locator('#student-panel summary').filter({hasText:'补充光学视场'}).click();
 await page.getByLabel('补充水平视场 / °',{exact:true}).fill('20');
 await page.getByLabel('补充垂直视场 / °',{exact:true}).fill('15');
 await page.waitForFunction(()=>window.studentDiagnostics.results?.[0].raw_result.fov.value?.[0]===20);
 assert.equal(await page.evaluate(()=>window.studentDiagnostics.results[0].raw_result.fov.status),'assumed');
 await page.locator('#student-aim').click();
 await page.waitForFunction(()=>window.studentDiagnostics.results?.[0].raw_result.target_in_fov.value===true);
 // Invalid request must clear current results and prevent saving stale answers.
 await page.getByLabel('焦距 / mm',{exact:true}).fill('1000');
 await page.waitForFunction(()=>document.querySelector('#student-message').textContent.includes('无法计算'));
 assert.equal(await page.locator('#student-save').isDisabled(),true);
 await page.getByLabel('焦距 / mm',{exact:true}).fill('50');
 await page.waitForFunction(()=>window.studentDiagnostics.results?.[0].raw_result.fov.focal_mm===50);
 // Real map marker dragging changes the target position while preserving relative support height.
 await page.locator('#student-focus').click();
 const before=await page.evaluate(()=>window.studentDiagnostics.targetPosition);
 const marker=await page.evaluate(()=>window.studentDiagnostics.markers.find(m=>m.id==='target'));
 assert.ok(marker.visible);
 await page.mouse.move(marker.x,marker.y);await page.mouse.down();
 await page.mouse.move(marker.x+55,marker.y+25,{steps:6});await page.mouse.up();
 await page.waitForFunction(p=>window.studentDiagnostics.results?.length===2&&JSON.stringify(window.studentDiagnostics.targetPosition)!==JSON.stringify(p),before);
 assert.equal(await page.evaluate(()=>window.studentDiagnostics.cameraControlsEnabled),true);
 // A second saved scene gives an actual input/geometry comparison, not a fake probability ranking.
 await page.locator('#student-snapshot-name').fill('移动目标后');await page.locator('#student-save').click();
 assert.equal(await page.evaluate(()=>window.studentDiagnostics.snapshots),2);
 await page.locator('#student-device').selectOption('student-acoustic');
 assert.equal(await page.locator('#student-acoustic-settings').isVisible(),true);
 await page.locator('#student-array').selectOption('0.3');
 await page.waitForFunction(()=>window.studentDiagnostics.results?.[1].configuration.parameters.array_diameter.value===.3);
 assert.equal(await page.evaluate(()=>window.studentDiagnostics.results[1].raw_result.frequency_supported.value),null);
 await page.locator('#student-panel').evaluate(node=>node.scrollTop=0);
 await page.screenshot({path:'artifacts/student-acoustic-desktop.png'});
 // Exercise map surface picking on actual city geometry.
 await page.locator('#student-pick-target').click();const box=await page.locator('#viewport').boundingBox();
 await page.mouse.click(box.x+box.width*.6,box.y+box.height*.55);
 await page.waitForFunction(()=>window.studentDiagnostics.results?.length===2&&!document.querySelector('#student-message').textContent.includes('请点击'));
 const jsonWait=page.waitForEvent('download');await page.locator('#student-export-json').click();
 await (await jsonWait).saveAs('artifacts/student-platform-scenarios.json');
 const saved=JSON.parse(await readFile('artifacts/student-platform-scenarios.json','utf8'));
 assert.equal(saved.scenarios.length,2);assert.ok(saved.scenarios.every(s=>s.payload.results.length===2));
 const htmlWait=page.waitForEvent('download');await page.locator('#student-export-html').click();
 await (await htmlWait).saveAs('artifacts/student-platform-report.html');
 const report=await readFile('artifacts/student-platform-report.html','utf8');assert.ok(report.includes('移动目标后')&&report.includes('资料基础模型'));
 // Downloaded HTML opens offline, retaining saved scenario names and Chinese values.
 const offline=await browser.newPage();await offline.setContent(report);assert.ok((await offline.locator('body').innerText()).includes('未知／未提供'));await offline.screenshot({path:'artifacts/student-report-preview.png'});await offline.close();
 await page.locator('#student-clear').click();assert.equal(await page.locator('#student-export-html').isDisabled(),true);
 // Existing teacher panels remain operational and do not overlay the new markers.
 await page.locator('#toggle-sensors').click();await page.waitForFunction(()=>window.sensorDiagnostics?.results?.length===4);
 assert.equal(await page.locator('#student-panel').isVisible(),false);
 await page.locator('#toggle-student').click();await page.waitForFunction(()=>window.studentDiagnostics?.results?.length===2);
 await page.setViewportSize({width:390,height:844});
 await page.locator('#student-panel').evaluate(node=>node.scrollTop=0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'artifacts/student-mobile.png',fullPage:true});
 await page.locator('#student-back').click();assert.equal(await page.locator('#student-panel').isVisible(),false);
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/student-browser-validation.json',JSON.stringify({passed:true,checks:['real-city render','Python evaluation','missing values','assumed optics','invalid-input stale-result gate','target drag','map picking','array change','two-scene JSON/HTML downloads','offline report','teacher-panel coexistence','mobile width'],pageErrors:errors},null,2));
 console.log('Student integration browser smoke passed: Python models, live scene edits, unknown values, reports, teacher-panel coexistence and mobile.');
}finally{await browser.close();}
