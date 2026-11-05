import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium'),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 let context=await browser.newContext(),page=await context.newPage();const errors=[];
 const ready=async()=>{
  await page.goto(process.env.APP_URL||'http://127.0.0.1:5196');
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.equipmentManagerDiagnostics,null,{timeout:120000});
  await page.locator('#toggle-sensors').click();
 };
 const group=name=>page.locator('.equipment-group-nav').getByRole('button',{name,exact:true}).click();
 page.on('pageerror',error=>errors.push(error.message));
 await ready();
 await page.getByRole('button',{name:'选择雷达型号',exact:true}).click();
 await page.locator('#equipment-model-menu [data-preset-id="radar-03d"]').click();
 await group('基础参数');await page.locator('#profile-parameters-maxRange').fill('6300');
 await page.waitForFunction(()=>window.equipmentManagerDiagnostics.dirty===false);
 await group('演示');assert.equal(await page.locator('#demo-mountHeight').inputValue(),'30');
 await page.locator('#demo-mountHeight').fill('45');await page.locator('#demo-radius').fill('900');
 await page.reload();
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.equipmentManagerDiagnostics,null,{timeout:120000});
 await page.locator('#toggle-sensors').click();
 assert.equal(await page.evaluate(()=>window.equipmentManagerDiagnostics.presetId),'radar-03d');
 assert.equal(await page.locator('#profile-parameters-maxRange').inputValue(),'6300');
 await group('演示');assert.equal(await page.locator('#demo-mountHeight').inputValue(),'45');assert.equal(await page.locator('#demo-radius').inputValue(),'900');
 // Flush a valid edit on immediate navigation, before the debounce timer fires.
 await group('基础参数');await page.locator('#profile-parameters-maxRange').fill('6100');
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.equipmentManagerDiagnostics,null,{timeout:120000});await page.locator('#toggle-sensors').click();
 assert.equal(await page.locator('#profile-parameters-maxRange').inputValue(),'6100');
 // Invalid edits must not overwrite the last valid saved profile.
 await page.locator('#profile-parameters-maxRange').fill('-1');await page.waitForTimeout(600);
 const saved=await context.storageState();await context.close();context=await browser.newContext({storageState:saved});page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await ready();assert.equal(await page.locator('#profile-parameters-maxRange').inputValue(),'6100');
 await group('演示');assert.equal(await page.locator('#demo-mountHeight').inputValue(),'45');assert.equal(await page.locator('#demo-radius').inputValue(),'900');
 await page.getByRole('button',{name:'选择雷达型号',exact:true}).click();await page.locator('.equipment-model-create').click();
 const customId=await page.evaluate(()=>window.equipmentManagerDiagnostics.presetId);
 await page.locator('#profile-name').fill('持久保存测试雷达');await page.locator('#profile-parameters-maxRange').fill('5800');
 await page.waitForFunction(()=>window.equipmentManagerDiagnostics.dirty===false);
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.equipmentManagerDiagnostics,null,{timeout:120000});await page.locator('#toggle-sensors').click();
 assert.equal(await page.evaluate(()=>window.equipmentManagerDiagnostics.presetId),customId);
 assert.equal(await page.locator('#profile-name').inputValue(),'持久保存测试雷达');assert.equal(await page.locator('#profile-parameters-maxRange').inputValue(),'5800');
 assert.deepEqual(errors,[]);
 console.log('PASS: 30 m default; automatic profile save; selected model, demo settings and valid edits survive reload and a new browser context; invalid edits preserve saved data.');
}finally{await browser.close();}
