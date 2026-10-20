import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173');await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 assert.equal(await page.locator('html').getAttribute('data-ready'),'true');
 await page.locator('#toggle-sensors').click();await page.waitForFunction(()=>window.sensorDiagnostics?.results?.length===4,null,{timeout:120000});
 assert.deepEqual((await page.evaluate(()=>window.sensorDiagnostics.types)).sort(),['acoustic','optical','radar','radio']);
 await page.locator('#equipment-device').selectOption('sensor-3');
 await page.locator('#equipment-panel summary').filter({hasText:'目标与工作模式'}).click();
 await page.locator('#equipment-emitting').uncheck();
 await page.waitForFunction(()=>window.sensorDiagnostics.results.find(r=>r.type==='radio').reasons.includes('目标无线电静默'));
 await page.locator('#equipment-emitting').check();
 await page.locator('#equipment-panel summary').filter({hasText:'当前型号参数'}).click();
 const range=page.locator('#equipment-panel').getByLabel('标称距离上限',{exact:true});await range.fill('100');await range.press('Tab');
 await page.waitForFunction(()=>window.sensorDiagnostics.results.find(r=>r.type==='radio').reasons.includes('超出标称距离'));
 await range.fill('4000');await range.press('Tab');
 await page.locator('#equipment-panel summary').filter({hasText:'环境与站网参数'}).click();
 const stations=page.getByLabel('参与 TDOA 的站数',{exact:true});await stations.fill('1');await stations.press('Tab');
 await page.waitForFunction(()=>window.sensorDiagnostics.results.find(r=>r.type==='radio').errors.networkLocalizationMeters===null);
 const downloadPromise=page.waitForEvent('download');await page.locator('#equipment-export').click();const download=await downloadPromise;
 await mkdir('artifacts',{recursive:true});await download.saveAs('artifacts/sensor-browser-scenario.json');
 const json=JSON.parse(await readFile('artifacts/sensor-browser-scenario.json','utf8'));assert.equal(json.devices.length,4);assert.equal(json.results.length,4);assert.ok(json.ecefTransform.length===16);
 await page.locator('#equipment-import').setInputFiles('artifacts/sensor-browser-scenario.json');await page.waitForFunction(()=>document.querySelector('#equipment-message').textContent.includes('方案导入成功'));
 // Invalid import must preserve the current valid four-device scheme.
 await page.locator('#equipment-import').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
 await page.waitForFunction(()=>document.querySelector('#equipment-message').textContent.includes('导入失败'));
 assert.equal(await page.evaluate(()=>window.sensorDiagnostics.deviceCount),4);
 await page.locator('#equipment-preset').selectOption('radar-03d');await page.locator('#equipment-add').click();
 assert.equal(await page.evaluate(()=>window.sensorDiagnostics.deviceCount),5);
 await page.locator('#equipment-remove').click();assert.equal(await page.evaluate(()=>window.sensorDiagnostics.deviceCount),4);
 await page.locator('#equipment-reset').click();
 await page.locator('#equipment-panel details').evaluateAll(nodes=>nodes.forEach(node=>node.open=false));
 await page.locator('#equipment-panel').evaluate(node=>node.scrollTop=0);
 await page.screenshot({path:'artifacts/sensors-desktop.png'});
 // Exercise real scene picking on the building/terrain under the camera target.
 await page.locator('#equipment-pick-target').click();const box=await page.locator('#viewport').boundingBox();
 await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 await page.waitForFunction(()=>!document.querySelector('#equipment-message').textContent.includes('请点击'));
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/sensors-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#equipment-back').click();assert.equal(await page.locator('#equipment-panel').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('Sensor browser smoke passed: four models, edits, RF silence, TDOA gate, JSON round trip, invalid import, add/remove, scene picking and mobile layout.');
}finally{await browser.close();}
