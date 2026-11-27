import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {assertDetectionSpeech,mockBrowserSpeech} from './voice_browser_helper.js';

// 主界面使用任务三播放条。仅在冒烟测试内挂载原部署飞行组件，
// 使用真实场景、渲染循环和装备交接，保留原组件的端到端覆盖。
async function exposePlanningFixture(page){
 await page.route(/\/src\/main\.js(?:\?.*)?$/,async route=>{
  const response=await route.fetch(),source=await response.text();
  const anchor="document.documentElement.dataset.ready='true';";
  assert.ok(source.includes(anchor),'部署飞行组件测试需要 Vite 开发服务');
  const fixture=`
  window.mountPlanningFixture=async()=>{
   const {mountPlanningUI}=await import('/src/planning/ui.js');
   const planning=mountPlanningUI({app,city,scene,camera,controls,renderer,sensors,model,workspace,getSite:activeSiteDescriptor,embedded:true});
   const host=document.createElement('aside');host.id='planning-test-controls';
   host.style.cssText='position:fixed;top:130px;left:18px;width:min(420px,calc(100vw - 36px));max-height:65vh;overflow:auto;z-index:55;background:#091722';
   host.append(planning.panel);app.append(host);
   function frame(stamp){planning.update(stamp);requestAnimationFrame(frame);}
   planning.setActive(true);requestAnimationFrame(frame);
  };
  `;
  await route.fulfill({response,body:source.replace(anchor,fixture+anchor)});
 });
}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await mockBrowserSpeech(page);
 await exposePlanningFixture(page);
 const appUrl=process.env.APP_URL||'http://127.0.0.1:5173';
 await page.goto(`${appUrl}${appUrl.includes('?')?'&':'?'}demo=0`,{timeout:120000});await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:120000});
 // Simulation controls live on the main view and tuck away with the HUD menus.
 await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#ac8-simulation-bar')).opacity)>.5,null,{timeout:5000});
 await page.locator('#toggle-deployment').click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isOpen(),null,{timeout:5000});
 await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#ac8-simulation-bar')).opacity)<.05,null,{timeout:5000});
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isOpen(),null,{timeout:5000});
 await page.evaluate(()=>window.mountPlanningFixture());
 await page.waitForFunction(()=>window.planningDiagnostics?.ready,null,{timeout:120000});
 const initial=await page.evaluate(()=>window.planningDiagnostics);assert.ok(initial.deviceCount>0);assert.ok(initial.sampleCount>300);
 // Playback controls moved to the bottom simulation bar; the panel keeps only the readouts.
 assert.equal(await page.locator('#planning-panel #flight-play').count(),0);
 assert.equal(await page.locator('#planning-panel #flight-reset').count(),0);
 assert.equal(await page.locator('#planning-panel #flight-speed').count(),0);
 assert.equal(await page.locator('#planning-panel #flight-seek').count(),0);
 assert.equal(await page.locator('#ac8-simulation-bar #ac8-sim-start').count(),1);
 assert.equal(await page.locator('#ac8-sim-speed option').count(),8);
 const example=JSON.parse(await readFile('public/deployment-example.json','utf8'));
 assert.equal(initial.planId,example.selectedId);
 assert.equal(initial.coverageRate,example.plans.find(p=>p.id===example.selectedId).metrics[example.conditions.findIndex(c=>c.id===initial.condition)].coverageRate);
 await page.locator('#flight-label').waitFor({state:'visible'});
 await page.locator('#flight-hud').waitFor({state:'visible'});
 const telemetry=await page.evaluate(()=>window.planningDiagnostics.telemetry);assert.ok(telemetry.agl>0);assert.ok(telemetry.longitude>113&&telemetry.longitude<115);assert.ok(telemetry.latitude>34&&telemetry.latitude<36);
 assert.ok((await page.locator('#flight-label').innerText()).includes('离地'));
 assert.equal(await page.evaluate(()=>window.testSpeech.length),0);
 // Every visible candidate marker offers actual type/model information.
 const markers=await page.evaluate(()=>window.planningDiagnostics.markers.filter(m=>m.visible&&m.x>450&&m.x<innerWidth-365&&m.y>260));assert.ok(markers.length>0);
 const marker=markers.find(m=>m.alarming)||markers[0],canvas=await page.locator('canvas').boundingBox();
 // 保留地图上的飞行图层，验证真实设备标记的悬浮说明。
 await page.mouse.move(canvas.x+marker.x,canvas.y+marker.y);
 await page.waitForFunction(()=>!document.querySelector('#planning-device-tooltip').hidden);
 const tip=await page.locator('#planning-device-tooltip').innerText();assert.ok(/雷达|无线电|声学|光电/.test(tip));assert.ok(tip.includes('plan-'));
 const pulseA=await page.evaluate(id=>window.planningDiagnostics.markers.find(m=>m.id===id)?.scale,marker.id);
 if(marker.alarming)await page.waitForFunction(({id,scale})=>Math.abs(window.planningDiagnostics.markers.find(m=>m.id===id).scale-scale)>.05,{id:marker.id,scale:pulseA});
 await page.locator('#flight-voice').click();
 assert.equal(await page.locator('#flight-voice').getAttribute('aria-pressed'),'true');
 const firstSpeech=await page.evaluate(()=>window.testSpeech);
 assert.equal(firstSpeech.length,1);
 assertDetectionSpeech(firstSpeech[0]);
 assert.equal(firstSpeech[0].text,`检出无人机，高度 ${Math.round(telemetry.agl)} 米，东经 ${telemetry.longitude.toFixed(4)} 度，北纬 ${telemetry.latitude.toFixed(4)} 度。`);
 await page.locator('#flight-voice').click();assert.equal(await page.locator('#flight-voice').getAttribute('aria-pressed'),'false');
 await page.locator('#flight-voice-preview').click();
 assert.equal((await page.evaluate(()=>window.testSpeech.at(-1))).text,firstSpeech[0].text);

 await page.locator('#planning-speed').selectOption('10');
 await page.locator('#planning-play').click();
 await page.waitForFunction(()=>window.planningDiagnostics.time>4,null,{timeout:30000});
 await page.locator('#planning-play').click();assert.equal(await page.evaluate(()=>window.planningDiagnostics.playing),false);
 const firstTime=await page.evaluate(()=>window.planningDiagnostics.time);assert.ok(firstTime>0);assert.notDeepEqual(await page.evaluate(()=>window.planningDiagnostics.telemetry.position),telemetry.position);assert.ok(await page.locator('#flight-alarm').innerText());
 assert.ok(firstTime>0);
 const download=page.waitForEvent('download');await page.locator('#planning-export').click();const file=await download;await file.saveAs('artifacts/planning-browser-report.json');
 const report=JSON.parse(await readFile('artifacts/planning-browser-report.json','utf8'));assert.ok(report.plans.length===3);assert.ok(report.activeFlight.frames.length>100);assert.ok(report.playback.time>=0);
 // Re-evaluate the route for a different actual plan in the background Worker.
 await page.locator('#planning-plan').selectOption('economy');
 await page.waitForFunction(()=>window.planningDiagnostics.busy,null,{timeout:30000});
 await page.waitForFunction(()=>!window.planningDiagnostics.busy,null,{timeout:240000});
 assert.equal(await page.locator('#planning-play').isDisabled(),false);
 assert.equal(await page.evaluate(()=>window.planningDiagnostics.planId),'economy');
 assert.equal(await page.evaluate(()=>window.planningDiagnostics.time),0);
 // Explicit cancellation keeps the completed plan and remains usable.
 await page.locator('#planning-optimize').click();await page.waitForFunction(()=>window.planningDiagnostics.busy);
 await page.locator('#planning-cancel').click();assert.equal(await page.evaluate(()=>window.planningDiagnostics.busy),false);
 assert.equal(await page.evaluate(()=>window.planningDiagnostics.planId),'economy');
 assert.equal(await page.locator('#planning-play').isDisabled(),false);
 // Invalid settings fail without replacing the current plan.
 await page.locator('#planning-spacing').fill('0');await page.locator('#planning-optimize').click();
 assert.ok((await page.locator('#planning-status').innerText()).includes('无效'));assert.equal(await page.evaluate(()=>window.planningDiagnostics.planId),'economy');
 await page.locator('#planning-spacing').fill('500');
 await page.locator('#planning-plan').selectOption(initial.planId);await page.waitForFunction(()=>!window.planningDiagnostics.busy,null,{timeout:240000});
 await page.locator('#planning-seek').evaluate(input=>{input.value='500';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#planning-test-controls').evaluate(node=>node.scrollTop=0);await page.screenshot({path:'artifacts/deployment-overview.png'});
 await page.locator('#flight-alarm').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/flight-alarm.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/planning-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:1500,height:1000});
 await page.locator('#planning-apply').click();await page.waitForFunction(()=>window.__ac8EquipmentMenu?.isDetail(),null,{timeout:5000});
 await page.waitForFunction(()=>{const c=document.querySelector('#ac8-equipment-menu .ac8-hud-content');return c&&getComputedStyle(c).visibility==='visible';},null,{timeout:4000});
 assert.equal(await page.evaluate(()=>window.sensorDiagnostics.deviceCount),initial.deviceCount);
 assert.equal(await page.locator('#equipment-manager').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.querySelector('#app').dataset.activeView),'sensors');
 assert.deepEqual(errors,[]);console.log('部署飞行浏览器冒烟通过，已覆盖真实方案、回放和暂停、遥测与语音试听、导出、后台重算、取消、小屏和装备交接。');
}finally{await browser.close();}
