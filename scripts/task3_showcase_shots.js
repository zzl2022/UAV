// 输出 artifacts/task3/showcase/*.png，供三个离线 HTML 内嵌。全部为当前页面真实运行画面。
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const out='artifacts/task3/showcase';
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir(out,{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:120000});
 const shot=async name=>{await page.screenshot({path:`${out}/${name}.png`});console.log(`${name}.png`);};
 await page.waitForTimeout(800);await shot('home');
 await page.locator('#toggle-sensors').click();await page.waitForFunction(()=>window.equipmentCapabilityDiagnostics?.results?.length===2);await shot('sensors');await page.locator('#equipment-back').click();
 await page.locator('#toggle-task3').click();await page.locator('#task3-open-input').click();await page.locator('#task3-run').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics.busy,null,{timeout:600000});await page.locator('#task3-window-input .task3-floating-close').click();await shot('task3-run');
 await page.locator('#task3-open-plans').click();await page.locator('#task3-plans-table').scrollIntoViewIfNeeded();await shot('task3-plans');await page.locator('#task3-window-plans .task3-floating-close').click();
 await page.locator('#task3-panel > details').filter({hasText:'盲区分布'}).locator(':scope > summary').click();await page.locator('#task3-condition').selectOption('interference');await shot('task3-coverage');
 await page.locator('#task3-blind-legend').scrollIntoViewIfNeeded();await shot('task3-blindspots');
 await page.locator('#task3-panel > details').filter({hasText:'威胁推演'}).locator(':scope > summary').click();
 for(const [key,waitMs] of [['single',2500],['multi',2500],['swarm',3000]]){
  await page.locator('#task3-threat').selectOption(key);await page.locator('#task3-threat-play').click();await page.waitForTimeout(waitMs);await shot(`task3-threat-${key}`);await page.locator('#task3-threat-play').click();
 }
 await page.locator('#task3-open-emc').click();await page.locator('#task3-emc').scrollIntoViewIfNeeded();await shot('task3-emc');await page.locator('#task3-window-emc .task3-floating-close').click();
 await page.locator('#task3-open-flight').click();await page.waitForFunction(()=>window.planningDiagnostics?.ready&&!window.planningDiagnostics.busy&&window.planningDiagnostics.droneShape==='Quadcopter_Drone',null,{timeout:240000});await shot('planning');
 await page.locator('#task3-window-simulation .task3-floating-close').click();await page.locator('#task3-window-minimize').click();await page.locator('#task3-open-alarms').click();await page.locator('#flight-events-section').scrollIntoViewIfNeeded();await shot('alarms');
 assert.deepEqual(errors,[]);console.log('showcase screenshots done:',out);
}finally{await browser.close();}
