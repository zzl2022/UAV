import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {openSceneMenu, closeSceneMenu} from './city_menu_helper.js';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const base=(process.env.APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');
 await page.goto(`${base}/index.html`,{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
 await openSceneMenu(page,'scene');
 const sites=[
  ['beijing','太和殿'],
  ['shenzhen','深圳国际交流中心'],
  ['daxing','大兴机场航站楼'],
  ['hangzhou','杭州萧山机场航站楼'],
  ['nuclear','房山核设施'],
  ['changjiang','昌江核电厂'],
  ['railway','北京站'],
 ];
 for(const [site,coreName] of sites){
  await page.selectOption('#model-select',site);
  await page.waitForFunction(id=>window.cityDiagnostics?.modelMode===id&&window.cityDiagnostics.models?.[id]?.loaded===true,site,{timeout:600000});
  const model=await page.evaluate(id=>window.cityDiagnostics.models[id],site);
  assert.ok(model.buildingCount>0,`${site} has no buildings`);
  assert.ok(Number.isFinite(model.maxHeight)&&model.maxHeight>0);
  const neighbors=await page.evaluate(()=>window.cityDiagnostics.coreNeighbors??0);
  if(site==='nuclear'||site==='changjiang')assert.ok(neighbors>0,`${site} core neighbors should be highlighted`);
  else assert.equal(neighbors,0,`${site} should not highlight core neighbors`);
  const core=await page.locator('#core-label').innerText();
  assert.ok(core.includes(coreName),`${site} core label ${core}`);
  await page.locator('#core-focus').click();
  await closeSceneMenu(page);
  await page.waitForTimeout(900);
  await page.screenshot({path:`artifacts/site-${site}-model.png`});
  await openSceneMenu(page,'scene');
  console.log(`${site}:`,model,'core:',core);
 }
 assert.deepEqual(errors,[]);
 console.log('GBA site browser smoke passed:',await page.evaluate(()=>window.cityDiagnostics));
}finally{await browser.close();}
