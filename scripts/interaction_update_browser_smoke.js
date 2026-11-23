import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {openSceneMenu,closeSceneMenu} from './city_menu_helper.js';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1515,height:980}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5178/?demo=0');
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.sceneConfigurationDiagnostics,null,{timeout:120000});
 await openSceneMenu(page,'target');
 assert.equal(await page.locator('#city-target-width_m').getAttribute('aria-label'),'成像水平尺寸');
 await page.locator('#city-target-speed').fill('13');
 await page.waitForFunction(()=>window.sceneConfigurationDiagnostics.target.speed===13);
 assert.match(await page.locator('#city-target-message').innerText(),/设置成功/);
 const initial=await page.evaluate(()=>JSON.stringify(window.sceneConfigurationDiagnostics.target.position));
 await page.locator('#city-target-pick').click();await page.waitForTimeout(700);
 assert.equal(await page.locator('#viewport canvas').evaluate(e=>e.style.cursor),'crosshair');
 const canvas=await page.locator('#viewport canvas').boundingBox();let selected=false;
 for(const [x,y] of [[.5,.5],[.55,.55],[.45,.55],[.6,.6],[.4,.6]]){
  await page.mouse.click(canvas.x+canvas.width*x,canvas.y+canvas.height*y);
  if(await page.evaluate(value=>JSON.stringify(window.sceneConfigurationDiagnostics.target.position)!==value,initial)){selected=true;break;}
 }
 assert.ok(selected,'a valid surface selects one point');
 const before=await page.evaluate(()=>window.sceneConfigurationDiagnostics.target.position);
 await closeSceneMenu(page);
 await page.mouse.click(canvas.x+canvas.width*.6,canvas.y+canvas.height*.65);
 assert.deepEqual(await page.evaluate(()=>window.sceneConfigurationDiagnostics.target.position),before,'second click must not move target');
 await openSceneMenu(page,'environment');await page.locator('#city-environment-rainMmH').fill('3');await page.locator('#city-environment-apply').click();
 assert.match(await page.locator('#city-environment-message').innerText(),/设置成功/);
 assert.equal(await page.evaluate(()=>window.sceneConfigurationDiagnostics.environment.rainMmH),3);
 await closeSceneMenu(page);await page.locator('#toggle-sensors').click();await page.waitForTimeout(600);
 await page.locator('#ac8-equipment-menu .ac8-hud-tabs button',{hasText:'雷达'}).click();await page.waitForTimeout(700);
 await page.locator('.equipment-group-nav').getByRole('button',{name:'检出判定',exact:true}).click();
 assert.equal(await page.locator('#profile-parameters-thresholdDb').count(),0);
 assert.ok(await page.locator('#profile-physics-pfa').isVisible());
 await page.locator('.equipment-group-nav').getByRole('button',{name:'设备仿真',exact:true}).click();
 await page.locator('#demo-pick').click();await page.waitForTimeout(700);
 for(const [x,y] of [[.5,.5],[.55,.55],[.45,.55],[.6,.6]]){await page.mouse.click(canvas.x+canvas.width*x,canvas.y+canvas.height*y);if(await page.evaluate(()=>window.equipmentDemoDiagnostics.status==='located'))break;}
 
 assert.equal(await page.evaluate(()=>window.equipmentDemoDiagnostics.status),'located');
 const located=await page.evaluate(()=>JSON.stringify(window.equipmentDemoDiagnostics.position));await page.mouse.click(canvas.x+canvas.width*.65,canvas.y+canvas.height*.7);
 assert.equal(await page.evaluate(()=>JSON.stringify(window.equipmentDemoDiagnostics.position)),located);
 assert.deepEqual(errors,[]);console.log('PASS: target naming, immediate feedback, target and device one-shot picking, environment apply, inactive controls, no page errors');
 await page.screenshot({path:'artifacts/interaction-update.png'});
}finally{await browser.close();}
