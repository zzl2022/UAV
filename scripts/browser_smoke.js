import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('crash',()=>console.error('City page crashed'));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173');
 await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 assert.equal(await page.locator('html').getAttribute('data-ready'),'true',await page.locator('#status').innerText());
 const diagnostics=await page.evaluate(()=>window.cityDiagnostics);
 assert.equal(diagnostics.features,15889);assert.equal(diagnostics.imagery,true);
 await page.locator('#imagery').uncheck();await page.locator('#imagery').check();assert.ok(diagnostics.buildingTriangles>100000);
 await page.locator('#top').click();await page.locator('#wire').check();await page.locator('#wire').uncheck();
 await page.locator('#terrain').uncheck();await page.locator('#terrain').check();await page.locator('#reset').click();
 await page.locator('#original').check();await page.waitForFunction(()=>!document.querySelector('#original').disabled,null,{timeout:120000});
 assert.equal(await page.locator('#original').isChecked(),true,await page.locator('#status').innerText());
 await page.locator('#original').uncheck();
 console.log('Validating city GLB download…');
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:180000}),page.locator('#export').click({timeout:180000})]);
 await mkdir('artifacts',{recursive:true});await download.saveAs('artifacts/browser-export.glb');
 assert.equal(download.suggestedFilename(),'zhengzhou-city-enu.glb');
 await page.screenshot({path:'artifacts/city-desktop.png'});
 await page.screenshot({path:'artifacts/city-imagery.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/city-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Browser smoke passed:',diagnostics);
}finally{await browser.close();}
