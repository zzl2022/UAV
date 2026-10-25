import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const base=(process.env.APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');
 await page.goto(`${base}/sat3dgen.html`,{timeout:120000});
 await page.waitForFunction(()=>window.sat3dgenDiagnostics,null,{timeout:120000});
 const diagnostics=await page.evaluate(()=>window.sat3dgenDiagnostics);
 assert.ok(diagnostics.manifest);
 assert.equal(await page.locator('#map-hint').isVisible(),true);
 await page.locator('[data-view="model"]').click();
 await page.waitForFunction(()=>{
  const text=document.querySelector('#model-status').textContent;
  return text.includes('网格已加载')||text.includes('GBA 白模')||text.includes('CNBH-10m 全域重建已加载');
 },null,{timeout:180000});
 await page.waitForTimeout(2500);
 assert.equal(await page.locator('#view-model').isVisible(),true);
 await page.screenshot({path:'artifacts/sat3dgen-landing.png'});
 assert.deepEqual(errors,[]);
 console.log('Sat3DGen/TianDiTu page smoke passed:',diagnostics.manifest.status);
}finally{await browser.close();}
