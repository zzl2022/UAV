import {readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
 await page.goto((process.env.APP_URL??'http://127.0.0.1:4191')+'/?intro=0&demo=0');
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:60000});
 await page.locator('#toggle-deployment').click();
 const open=async id=>{
  if(await page.evaluate(()=>window.__ac8DeploymentMenu.isDetail()))await page.locator('#ac8-deployment-menu .ac8-hud-back').click();
  await page.locator('#ac8-deployment-menu [data-page="'+id+'"]').click();
  await page.waitForFunction(id=>window.task3Diagnostics.activeTab===id,id);
 };
 await open('rules');await page.locator('.task3-rule').first().waitFor();
 assert.equal(await page.locator('.task3-rule').count(),9);assert.equal(await page.locator('.task3-rule details').count(),0);
 await open('input');
 await page.locator('#task3-scope-width').fill('900');await page.locator('#task3-scope-depth').fill('900');await page.locator('#task3-spacing').fill('50');
 await page.locator('[data-sub="generate"]').click();await page.locator('#task3-run-side').click();
 await open('rules');
 const waitReport=()=>page.waitForFunction(()=>window.task3Diagnostics.ready&&!window.task3Diagnostics.busy&&!window.task3Diagnostics.staleResult,null,{timeout:240000});
 await waitReport();await page.locator('.task3-rule details').first().waitFor();
 assert.equal(await page.locator('.task3-rule details').count(),9);
 const first=await page.locator('.task3-rule').nth(7).locator('li').count();
 assert.equal(first,await page.evaluate(()=>{const {report,activePlanId}=window.__task3Export();return report.plans.find(p=>p.id===activePlanId).devices.length;}));
 const select=page.locator('.task3-pane:visible select');await select.selectOption('economy');
 await open('plans');
 const warningPlan=await page.evaluate(()=>{const {report}=window.__task3Export();return report.plans.find(p=>report.emc[p.id].counts.warning>0)?.id;});
 if(warningPlan)await page.locator('#task3-plan').selectOption(warningPlan);
 await open('emc');await page.locator('#task3-emc h4').first().waitFor();assert.match(await page.locator('#task3-emc').innerText(),/严重问题与处置/);
 if(warningPlan){await page.locator('#task3-repair-warnings').click();await waitReport();await page.getByRole('heading',{name:'提示修复前后对比'}).waitFor();assert.match(await page.locator('#task3-emc').innerText(),/提示修复前后对比/);}
 await open('blindspots');await page.locator('[data-sub="mobile"]').click();await page.locator('#task3-daily-toggle').click();
 const panel=page.locator('section').filter({has:page.locator('#task3-daily-toggle')});
 await panel.locator('input').fill('0');assert.match(await panel.locator('[role=status]').innerText(),/可用 0 辆/);
 await panel.locator('input').fill('-1');assert.match(await panel.locator('[role=status]').innerText(),/非负整数/);
 await panel.locator('input').fill('1');
 await page.waitForFunction(()=>{const s=document.querySelector('#task3-daily-toggle')?.parentElement?.querySelector('[role=status]')?.textContent??'';return s.includes('可用 1 辆')||s.includes('计算前后剩余');},null,{timeout:180000});
 const workerFile=readdirSync(new URL('../dist/assets/',import.meta.url)).find(n=>/^fleet-worker-.*\.js$/.test(n));
 const solved=await page.evaluate(file=>new Promise((resolve,reject)=>{
  const worker=new Worker('assets/'+file,{type:'module'});worker.onmessage=e=>{worker.terminate();resolve(e.data);};worker.onerror=e=>reject(Error(e.message));
  worker.postMessage({available:1,totalCars:2,groups:[{cars:[0],count:3},{cars:[0,1],count:5},{cars:[1],count:2}]});
 }),workerFile);
 assert.deepEqual(solved.result,{covered:8,total:10,used:1});
 await open('input');await page.locator('#task3-spacing').fill('49');await open('rules');
 assert.equal(await page.locator('.task3-rule details').count(),0);
 await page.setViewportSize({width:390,height:844});await page.locator('.task3-rule').first().waitFor({state:'visible',timeout:10000});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({rules:9,firstPlanDevices:first,warningRepairExercised:!!warningPlan,fleetZero:true,stale:true,pageErrors:errors}));
}finally{await browser.close();}
