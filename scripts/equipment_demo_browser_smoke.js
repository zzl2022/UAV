import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/equipment-demo',{recursive:true});
 const page=await browser.newPage({viewport:{width:1515,height:980}}),errors=[],gpu=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/WebGL|Shader|INVALID/.test(message.text()))gpu.push(message.text());});
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173');
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:120000});
 const before=await page.evaluate(()=>structuredClone(window.sceneConfigurationDiagnostics));
 await page.locator('#toggle-sensors').click();
 await page.waitForFunction(()=>window.__ac8EquipmentMenu?.isOpen(),null,{timeout:5000});
 const selectType=async label=>{
  if(await page.evaluate(()=>window.__ac8EquipmentMenu?.isDetail())){
   await page.keyboard.press('Escape');
   await page.waitForFunction(()=>!window.__ac8EquipmentMenu?.isDetail(),null,{timeout:3000});
   await page.waitForTimeout(500);
  }
  await page.locator('#ac8-equipment-menu .ac8-hud-tabs button',{hasText:label}).click();
  await page.waitForFunction(()=>window.__ac8EquipmentMenu?.isDetail(),null,{timeout:5000});
  await page.waitForTimeout(500);
 };
 const openSim=async()=>{
  await page.locator('.equipment-group-nav').getByRole('button',{name:'设备仿真',exact:true}).click();
  await page.waitForTimeout(250);
 };
 for(const [type,radius,label] of [['radar',1000,'雷达'],['radio',600,'无线电'],['optical',300,'光电'],['acoustic',250,'声学'],['fivega',600,'5G-A'],['electrostatic',100,'静电']]){
  await selectType(label);
  await openSim();
  assert.ok(await page.locator('#demo-start').isVisible());
  await page.locator('#demo-radius').fill(String(radius));await page.locator('#demo-ceiling').fill('300');
  await page.getByRole('tab',{name:'可视化',exact:true}).click();
  const ids=await page.locator('#demo-metric option').evaluateAll(nodes=>nodes.map(node=>node.value));
  if(!['radar','radio'].includes(type))assert.ok(!ids.includes('pd'));
  await page.locator('#demo-density').fill('1.8');
  await page.screenshot({path:`artifacts/equipment-demo/${type}-settings.png`});
  await page.locator('#demo-start').click();
  await page.waitForFunction(t=>(window.equipmentDemoDiagnostics?.status==='ready'&&window.equipmentDemoDiagnostics.type===t)||window.equipmentDemoDiagnostics?.status==='error',type,{timeout:120000});
  const state=await page.evaluate(()=>window.equipmentDemoDiagnostics);
  assert.equal(state.status,'ready',JSON.stringify(state));assert.ok(state.counts.signal>0,`${type}: ${JSON.stringify(state.counts)}`);
  if(state.metric==='visibility')assert.deepEqual(state.range,[0,1]);
  // Updating the simulation must not pop the right-hand readout; it opens only via 仿真详情.
  assert.equal(await page.locator('#equipment-demo-hud').isVisible(),false,'更新仿真不得自动弹出信息栏');
  await page.locator('#equipment-demo-details').click();
  await page.waitForFunction(()=>document.querySelector('#ac8-equipment-menu')?.classList.contains('is-demo-details'),null,{timeout:4000});
  await page.waitForFunction(()=>{const hud=document.querySelector('#equipment-demo-hud');return hud&&!hud.hidden&&Number(getComputedStyle(hud).opacity)>.9;},null,{timeout:8000});
  const viewport=await page.locator('#viewport canvas').boundingBox();let probe;
  for(const [x,y] of [[.45,.55],[.5,.65],[.35,.7],[.6,.75]]){
   await page.mouse.move(viewport.x+viewport.width*x,viewport.y+viewport.height*y);await page.waitForTimeout(180);
   probe=await page.evaluate(()=>window.equipmentDemoDiagnostics.probe);if(probe)break;
  }
  assert.ok(probe,`${type}: hover returns a map or volume position`);
  assert.ok(await page.locator('#demo-hover-values dt').count()>=6);
  assert.ok(Number.isFinite(probe.distance));
  await page.screenshot({path:`artifacts/equipment-demo/${type}-details.png`});
  await page.locator('#equipment-demo-hud [data-demo-action=back]').click();
  await page.waitForFunction(()=>!document.querySelector('#ac8-equipment-menu')?.classList.contains('is-demo-details'),null,{timeout:4000});
  await page.locator('#demo-stop').click();
  assert.equal(await page.locator('#equipment-demo-hud').isVisible(),false);
  console.log(`PASS ${type}: city field, metric options, details readout without auto popup (${state.counts.signal} valid samples)`);
 }
 await page.getByRole('tab',{name:'范围与朝向',exact:true}).click();await page.locator('#demo-pick').click();
 const canvas=await page.locator('#viewport canvas').first().boundingBox();
 for(const [x,y] of [[.5,.5],[.55,.6],[.4,.5],[.65,.65]]){await page.mouse.click(canvas.x+canvas.width*x,canvas.y+canvas.height*y);if(await page.evaluate(()=>window.equipmentDemoDiagnostics.status==='located'))break;}
 assert.equal(await page.evaluate(()=>window.equipmentDemoDiagnostics.status),'located');
 assert.deepEqual(await page.evaluate(()=>window.sceneConfigurationDiagnostics),before);
 await page.locator('#demo-start').click();
 await page.waitForFunction(()=>['ready','error'].includes(window.equipmentDemoDiagnostics?.status),null,{timeout:120000});
 await page.locator('#equipment-demo-details').click();
 await page.waitForTimeout(500);
 await page.locator('#equipment-demo-hud [data-demo-action=back]').click();
 await page.locator('#demo-stop').click();
 assert.equal(await page.locator('#equipment-demo-hud').isVisible(),false);
 await page.setViewportSize({width:390,height:844});
 await page.locator('.equipment-group-nav').getByRole('button',{name:'设备仿真',exact:true}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#demo-start').scrollIntoViewIfNeeded();
 assert.ok(await page.locator('#demo-start').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
 await page.screenshot({path:'artifacts/equipment-demo/mobile.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(gpu,[]);
 console.log('PASS: simulation settings/details flow, no automatic info-bar popup, isolated map selection, mobile controls, no scene changes or browser/GPU errors');
}finally{await browser.close();}
