import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.testSpeech=[];window.testSpeechCancels=0;Object.defineProperty(window,'speechSynthesis',{value:{cancel(){window.testSpeechCancels++;},getVoices:()=>[{lang:'zh-CN',localService:true}],speak:u=>window.testSpeech.push({text:u.text,lang:u.lang})}});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};});
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 await page.locator('#toggle-planning').click();await page.waitForFunction(()=>window.planningDiagnostics?.ready,null,{timeout:120000});
 const initial=await page.evaluate(()=>window.planningDiagnostics);assert.ok(initial.deviceCount>0);assert.ok(initial.sampleCount>300);assert.equal(initial.coverageRate,1);
 assert.equal(await page.locator('#flight-label').isVisible(),true);
 assert.equal(await page.locator('#flight-hud').isVisible(),true);
 const telemetry=await page.evaluate(()=>window.planningDiagnostics.telemetry);assert.ok(telemetry.agl>0);assert.ok(telemetry.longitude>113&&telemetry.longitude<115);assert.ok(telemetry.latitude>34&&telemetry.latitude<36);
 assert.ok((await page.locator('#flight-label').innerText()).includes('离地'));
 assert.equal(await page.evaluate(()=>window.testSpeech.length),0);
 // Every visible candidate marker offers actual type/model information.
 const markers=await page.evaluate(()=>window.planningDiagnostics.markers.filter(m=>m.visible&&m.x>25&&m.x<innerWidth-430&&m.y>260));assert.ok(markers.length>0);
 const marker=markers.find(m=>m.alarming)||markers[0],canvas=await page.locator('canvas').boundingBox();
 await page.mouse.move(canvas.x+marker.x,canvas.y+marker.y);
 await page.waitForFunction(()=>!document.querySelector('#planning-device-tooltip').hidden);
 const tip=await page.locator('#planning-device-tooltip').innerText();assert.ok(/雷达|无线电|声学|光电/.test(tip));assert.ok(tip.includes('plan-'));
 const pulseA=await page.evaluate(id=>window.planningDiagnostics.markers.find(m=>m.id===id)?.scale,marker.id);
 if(marker.alarming)await page.waitForFunction(({id,scale})=>Math.abs(window.planningDiagnostics.markers.find(m=>m.id===id).scale-scale)>.05,{id:marker.id,scale:pulseA});
 await page.locator('#flight-voice').click();assert.equal(await page.locator('#flight-voice').getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>window.testSpeech.length),1);assert.equal(await page.evaluate(()=>window.testSpeech[0].lang),'zh-CN');assert.ok((await page.evaluate(()=>window.testSpeech[0].text)).includes('离地高度'));
 await page.locator('#flight-voice').click();assert.equal(await page.locator('#flight-voice').getAttribute('aria-pressed'),'false');

 await page.locator('#flight-speed').selectOption('60');await page.locator('#flight-play').click();
 await page.waitForFunction(()=>window.planningDiagnostics.time>4,null,{timeout:30000});
 await page.locator('#flight-play').click();assert.equal(await page.evaluate(()=>window.planningDiagnostics.playing),false);
 const firstTime=await page.evaluate(()=>window.planningDiagnostics.time);assert.ok(firstTime>0);assert.notDeepEqual(await page.evaluate(()=>window.planningDiagnostics.telemetry.position),telemetry.position);assert.ok(await page.locator('#flight-alarm').innerText());
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
 assert.deepEqual(errors,[]);console.log('Hover type/model, alarm marker pulses, live geographic/height HUD, opt-in Chinese speech dispatch passed. Planning browser passed: real plan, playback/pause/seek/reset, alarm export, Worker simulation, cancellation, invalid settings, mobile and equipment handoff.');
}finally{await browser.close();}
