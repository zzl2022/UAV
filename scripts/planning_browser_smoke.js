import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173');await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 await page.locator('#toggle-planning').click();await page.waitForFunction(()=>window.planningDiagnostics?.ready,null,{timeout:120000});
 const initial=await page.evaluate(()=>window.planningDiagnostics);assert.ok(initial.deviceCount>0);assert.ok(initial.sampleCount>300);assert.equal(initial.coverageRate,1);
 assert.equal(await page.locator('#flight-label').isVisible(),true);
 await page.locator('#flight-speed').selectOption('60');await page.locator('#flight-play').click();
 await page.waitForFunction(()=>window.planningDiagnostics.time>4,null,{timeout:30000});
 await page.locator('#flight-play').click();assert.equal(await page.evaluate(()=>window.planningDiagnostics.playing),false);
 const firstTime=await page.evaluate(()=>window.planningDiagnostics.time);assert.ok(firstTime>0);assert.ok(await page.locator('#flight-alarm').innerText());
 await page.locator('#flight-seek').evaluate(input=>{input.value='700';input.dispatchEvent(new Event('input',{bubbles:true}));});
 const ahead=await page.evaluate(()=>window.planningDiagnostics);assert.ok(ahead.time>firstTime);assert.ok(ahead.eventCount>0);
 await page.locator('#flight-seek').evaluate(input=>{input.value='100';input.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.ok((await page.evaluate(()=>window.planningDiagnostics.time))<ahead.time);
 await page.locator('#flight-reset').click();assert.equal(await page.evaluate(()=>window.planningDiagnostics.time),0);
 const download=page.waitForEvent('download');await page.locator('#planning-export').click();const file=await download;await file.saveAs('artifacts/planning-browser-report.json');
 const report=JSON.parse(await readFile('artifacts/planning-browser-report.json','utf8'));assert.ok(report.plans.length===3);assert.ok(report.activeFlight.frames.length>100);assert.equal(report.playback.time,0);
 // Re-evaluate the route for a different actual plan in the background Worker.
 await page.locator('#planning-plan').selectOption('economy');
 await page.waitForFunction(()=>window.planningDiagnostics.busy,null,{timeout:30000});
 await page.waitForFunction(()=>!window.planningDiagnostics.busy,null,{timeout:240000});
 assert.equal(await page.locator('#flight-play').isDisabled(),false);
 assert.equal(await page.evaluate(()=>window.planningDiagnostics.planId),'economy');
 assert.equal(await page.evaluate(()=>window.planningDiagnostics.time),0);
 // Explicit cancellation keeps the completed plan and remains usable.
 await page.locator('#planning-optimize').click();await page.waitForFunction(()=>window.planningDiagnostics.busy);
 await page.locator('#planning-cancel').click();assert.equal(await page.evaluate(()=>window.planningDiagnostics.busy),false);
 assert.equal(await page.evaluate(()=>window.planningDiagnostics.planId),'economy');
 assert.equal(await page.locator('#flight-play').isDisabled(),false);
 // Invalid settings fail without replacing the current plan.
 await page.locator('#planning-spacing').fill('0');await page.locator('#planning-optimize').click();
 assert.ok((await page.locator('#planning-status').innerText()).includes('无效'));assert.equal(await page.evaluate(()=>window.planningDiagnostics.planId),'economy');
 await page.locator('#planning-spacing').fill('500');
 await page.locator('#planning-plan').selectOption(initial.planId);await page.waitForFunction(()=>!window.planningDiagnostics.busy,null,{timeout:240000});
 await page.locator('#flight-seek').evaluate(input=>{input.value='500';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#planning-panel').evaluate(node=>node.scrollTop=0);await page.screenshot({path:'artifacts/deployment-overview.png'});
 await page.locator('#flight-alarm').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/flight-alarm.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/planning-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:1500,height:1000});
 await page.locator('#planning-apply').click();await page.waitForFunction(()=>!document.querySelector('#equipment-panel').hidden);
 assert.equal(await page.evaluate(()=>window.sensorDiagnostics.deviceCount),initial.deviceCount);
 assert.equal(await page.locator('#planning-panel').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('Planning browser passed: real plan, playback/pause/seek/reset, alarm export, Worker simulation, cancellation, invalid settings, mobile and equipment handoff.');
}finally{await browser.close();}
