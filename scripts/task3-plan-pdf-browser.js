import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
import {openSceneMenu,closeSceneMenu} from './city_menu_helper.js';

const server=await preview({preview:{host:'127.0.0.1',port:0}});
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const errors=[],page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 const dir='artifacts/task3/plan-pdf-review';await mkdir(dir,{recursive:true});
 for(const [scene,spacing] of [['recon',500],['wuxi',400]]){
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?intro=0&demo=0`);
  await page.waitForFunction(()=>window.task3Diagnostics);
  if(scene!=='recon'){
   await openSceneMenu(page,'scene');await page.selectOption('#model-select',scene);
   await page.waitForFunction(id=>window.cityDiagnostics?.modelMode===id&&!document.querySelector('#model-select').disabled,scene,{timeout:120000});
   await closeSceneMenu(page);
  }
  await page.locator('#toggle-deployment').click();await page.locator('#ac8-deployment-menu [data-page=input]').click();
  await page.locator('#task3-spacing').fill(String(spacing));await page.locator('[data-sub=generate]').click();
  const brief=page.locator('#task3-export-brief');assert.ok(await brief.isDisabled());
  await page.locator('#task3-run-side').click();
  await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics.busy,null,{timeout:180000});
  for(const [id,kind] of [['task3-export-brief','brief'],['task3-export-pdf','full']]){
   const [file]=await Promise.all([page.waitForEvent('download',{timeout:120000}),page.locator('#'+id).click()]);
   await file.saveAs(dir+'/'+scene+'-'+kind+'.pdf');
   const summary=await page.evaluate(()=>window.__task3DeploymentPlans.map(m=>({scene:m.sceneName,spacing:m.grid.spacingM,examples:m.examples.length,rules:m.matchedRules.length,consistent:m.examples.every(e=>{const i=m.metrics.conditions.findIndex(c=>c.condition===e.conditionId);return e.bands.hits[i].reduce((a,b)=>a+b,0)===e.coveredSamples;})})));
   assert.equal(summary.length,kind==='brief'?1:3);
   assert.ok(summary.every(m=>m.spacing===spacing&&m.examples===2&&m.rules===9&&m.consistent));
   assert.match(summary[0].scene,scene==='recon'?/河南博物院/:/无锡/);
   console.log(scene,kind,summary[0].scene,summary.length);
  }
  if(scene==='recon'){
   const tab=async id=>{
    await page.locator('#ac8-deployment-menu .ac8-hud-back').click();
    await page.locator('#ac8-deployment-menu [data-page="'+id+'"]').click();
   };
   await tab('plans');
   const warningId=await page.evaluate(()=>{const r=window.__task3Report;return r.plans.find(p=>r.emc[p.id].counts.warning)?.id;});
   assert.ok(warningId);await page.locator('#task3-plan').selectOption(warningId);
   await tab('emc');await page.locator('#task3-repair-warnings').click();
   await page.waitForFunction(()=>!window.task3Diagnostics.busy&&window.__task3Report.plans.some(p=>p.emcRemediation.warningReview),null,{timeout:180000});
   await tab('blindspots');await page.locator('[data-sub=mobile]').click();
   await page.locator('#task3-mobile-repair').check();await page.waitForFunction(()=>!window.task3Diagnostics.busy&&!!window.__task3Report.mobileRepair,null,{timeout:180000});
   await page.locator('#task3-daily-toggle').click();await page.locator('#task3-daily-toggle + div input').fill('0');
   await tab('plans');
   const [file]=await Promise.all([page.waitForEvent('download',{timeout:120000}),page.locator('#task3-export-pdf').click()]);
   await file.saveAs(dir+'/reviewed-full.pdf');
   const applied=await page.evaluate(pid=>{const p=window.__task3DeploymentPlans.find(p=>p.plan.id===pid);return {mobile:p.mobileRepair.enabled,daily:p.daily?.available,review:!!p.emc.remediation.warningReview};},warningId);
   assert.deepEqual(applied,{mobile:true,daily:0,review:true});console.log('mobile, warning repair, zero-vehicle estimate verified');
   await tab('input');
  }
  await page.locator('[data-sub=scope]').click();await page.locator('#task3-spacing').fill('700');await page.locator('[data-sub=generate]').click();assert.ok(await brief.isDisabled());
 }
 assert.deepEqual(errors,[]);
}finally{await browser?.close();await server.close();}
