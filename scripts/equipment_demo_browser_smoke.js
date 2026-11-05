import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/equipment-demo',{recursive:true});
 const page=await browser.newPage({viewport:{width:1515,height:980}}),errors=[],gpu=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/WebGL|Shader|INVALID/.test(message.text()))gpu.push(message.text());});
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5196');await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:120000});
 const before=await page.evaluate(()=>structuredClone(window.sceneConfigurationDiagnostics));
 await page.locator('#toggle-sensors').click();
 for(const [type,radius] of [['radar',1000],['radio',600],['optical',300],['acoustic',250],['fivega',600],['electrostatic',100]]){
  await page.locator('#equipment-tab-'+type).click();await page.locator('.equipment-group-nav').getByRole('button',{name:'演示',exact:true}).click();
  assert.ok(await page.locator('#demo-start').isVisible());assert.equal(await page.locator('#equipment-window canvas').count(),0);
  await page.locator('#demo-radius').fill(String(radius));await page.locator('#demo-ceiling').fill('300');
  await page.getByRole('tab',{name:'可视化',exact:true}).click();
  const ids=await page.locator('#demo-metric option').evaluateAll(nodes=>nodes.map(node=>node.value));
  if(!['radar','radio'].includes(type))assert.ok(!ids.includes('pd'));
  await page.locator('#demo-density').fill('1.8');
  await page.screenshot({path:`artifacts/equipment-demo/${type}-settings.png`});
  await page.locator('#demo-start').click();assert.ok(await page.locator('#equipment-window').evaluate(node=>node.classList.contains('is-minimized')));
  assert.ok((await page.locator('#equipment-window').boundingBox()).width<=281,'minimized equipment window must not span the map');
  await page.waitForFunction(t=>window.equipmentDemoDiagnostics?.status==='ready'&&window.equipmentDemoDiagnostics.type===t||window.equipmentDemoDiagnostics?.status==='error',type,{timeout:120000});
  const state=await page.evaluate(()=>window.equipmentDemoDiagnostics);assert.equal(state.status,'ready',JSON.stringify(state));assert.ok(state.counts.signal>0,`${type}: ${JSON.stringify(state.counts)}`);
  if(state.metric==='visibility')assert.deepEqual(state.range,[0,1]);
  assert.ok(await page.locator('#equipment-demo-hud').isVisible());
  const viewport=await page.locator('#viewport canvas').boundingBox();let probe;
  for(const [x,y] of [[.45,.55],[.5,.65],[.35,.7],[.6,.75]]){
   await page.mouse.move(viewport.x+viewport.width*x,viewport.y+viewport.height*y);await page.waitForTimeout(180);
   probe=await page.evaluate(()=>window.equipmentDemoDiagnostics.probe);if(probe)break;
  }
  assert.ok(probe,`${type}: hover returns a map or volume position`);
  assert.ok(await page.locator('#demo-hover-values dt').count()>=6);
  assert.ok(Number.isFinite(probe.distance));
  const first=probe.position;
  await page.mouse.move(viewport.x+viewport.width*.25,viewport.y+viewport.height*.8);await page.waitForTimeout(180);
  const moved=await page.evaluate(()=>window.equipmentDemoDiagnostics.probe);
  if(moved)assert.notDeepEqual(moved.position,first,'mouse movement updates position');
  await page.mouse.move(5,5);await page.waitForTimeout(120);
  assert.equal(await page.locator('#demo-hover-values dd').count(),0,'leaving canvas clears stale values');
  await page.screenshot({path:`artifacts/equipment-demo/${type}-map.png`});
  await page.locator('#equipment-demo-hud [data-demo-action=settings]').click();
  assert.ok(await page.locator('#demo-start').isVisible());
  await page.getByRole('tab',{name:'可视化',exact:true}).click();await page.locator('#demo-style').selectOption('surface');await page.locator('#demo-clip').fill('0.5');
  assert.equal(await page.evaluate(()=>window.equipmentDemoDiagnostics.style),'surface');assert.equal(await page.evaluate(()=>window.equipmentDemoDiagnostics.clip),.5);
  await page.locator('#demo-stop').click();assert.equal(await page.locator('#equipment-demo-hud').isVisible(),false);
  console.log(`PASS ${type}: real city field, metric options, surface, clipping, stop (${state.counts.signal} valid samples)`);
 }
 assert.deepEqual(await page.evaluate(()=>window.sceneConfigurationDiagnostics),before);
 // Map picking modifies only the demonstration anchor.
 await page.getByRole('tab',{name:'范围与朝向',exact:true}).click();await page.locator('#demo-pick').click();
 const canvas=await page.locator('#viewport canvas').first().boundingBox();
 for(const [x,y] of [[.5,.5],[.55,.6],[.4,.5],[.65,.65]]){await page.mouse.click(canvas.x+canvas.width*x,canvas.y+canvas.height*y);if(await page.evaluate(()=>window.equipmentDemoDiagnostics.status==='located'))break;}
 assert.equal(await page.evaluate(()=>window.equipmentDemoDiagnostics.status),'located');assert.deepEqual(await page.evaluate(()=>window.sceneConfigurationDiagnostics),before);
 await page.locator('#demo-start').click();await page.locator('#equipment-demo-hud [data-demo-action=stop]').click();await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>window.equipmentDemoDiagnostics.status),'stopped');assert.equal(await page.locator('#equipment-demo-hud').isVisible(),false);
 await page.locator('#equipment-window-minimize').click();await page.locator('#demo-start').click();
 await page.locator('#equipment-back').click();await page.waitForTimeout(200);assert.equal(await page.locator('#equipment-demo-hud').isVisible(),false);
 if(await page.locator('#task3-window[open]').count())await page.keyboard.press('Escape');
 await page.locator('#toggle-sensors').click();await page.locator('#equipment-tab-optical').click();
 await page.setViewportSize({width:390,height:844});await page.locator('.equipment-group-nav').getByRole('button',{name:'演示',exact:true}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#demo-start').scrollIntoViewIfNeeded();
 assert.ok(await page.locator('#demo-start').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
 await page.screenshot({path:'artifacts/equipment-demo/mobile.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(gpu,[]);console.log('PASS: isolated map selection, cancellation, close cleanup, mobile controls, no scene changes or browser/GPU errors');
}finally{await browser.close();}
