import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const base=(process.env.APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');
 await page.goto(`${base}/beijing.html`,{timeout:120000});
 await page.locator('[data-view="model"]').click();
 await page.waitForFunction(()=>window.beijingDiagnostics?.modelLoaded===true,null,{timeout:240000});
 await page.waitForTimeout(2000);
 await page.screenshot({path:'artifacts/beijing-gba-model.png'});
 await page.screenshot({path:'artifacts/beijing-model.png'});
 assert.equal(await page.evaluate(()=>window.beijingDiagnostics.variant),'gba');
 assert.equal(await page.evaluate(()=>window.beijingDiagnostics.imagery),true);
 assert.ok(await page.evaluate(()=>window.beijingDiagnostics.blocks)>1000);
 for(const variant of ['osm','cnbh']){
  await page.selectOption('#bj-variant',variant);
  await page.waitForFunction(expected=>window.beijingDiagnostics?.variant===expected,variant,{timeout:240000});
  await page.waitForTimeout(800);
  await page.screenshot({path:`artifacts/beijing-${variant}-model.png`});
  assert.ok(await page.evaluate(()=>window.beijingDiagnostics.blocks)>1000);
 }
 if((await page.locator('#tdt-tk').inputValue()).length>10){
  await page.locator('[data-view="map"]').click();
  await page.locator('#tdt-load').click();
  await page.waitForFunction(()=>window.beijingDiagnostics?.mapLoaded===true,null,{timeout:60000});
  await page.waitForTimeout(2000);
  await page.screenshot({path:'artifacts/beijing-map.png'});
 }
 assert.deepEqual(errors,[]);
 console.log('Beijing 5 km GBA/OSM/CNBH/天地图 page smoke passed:',await page.evaluate(()=>window.beijingDiagnostics));
}finally{await browser.close();}
