import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const base=(process.env.APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');
 await page.goto(`${base}/index.html`,{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
 await page.locator('#open-city-model').click();
 await page.waitForSelector('#city-window[open]',{timeout:30000});
 const sites=[
  ['beijing','太和殿'],
  ['daxing','大兴机场航站楼'],
  ['nuclear','核设施核心建筑（推测）'],
  ['railway','北京站'],
 ];
 for(const [site,coreName] of sites){
  await page.selectOption('#model-select',site);
  await page.waitForFunction(id=>window.cityDiagnostics?.modelMode===id&&window.cityDiagnostics.models?.[id]?.loaded===true,site,{timeout:600000});
  const model=await page.evaluate(id=>window.cityDiagnostics.models[id],site);
  assert.ok(model.buildingCount>0,`${site} has no buildings`);
  assert.ok(Number.isFinite(model.maxHeight)&&model.maxHeight>0);
  const core=await page.locator('#core-label').innerText();
  assert.ok(core.includes(coreName),`${site} core label ${core}`);
  await page.locator('#core-focus').click();
  await page.locator('#city-window-minimize').click();
  await page.waitForTimeout(900);
  await page.screenshot({path:`artifacts/site-${site}-model.png`});
  await page.locator('#city-window-minimize').click();
  console.log(`${site}:`,model,'core:',core);
 }
 assert.deepEqual(errors,[]);
 console.log('GBA site browser smoke passed:',await page.evaluate(()=>window.cityDiagnostics));
}finally{await browser.close();}
