import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {openSceneMenu, closeSceneMenu} from './city_menu_helper.js';

async function openEquipmentMenu(page, type = 'radar') {
  if (!await page.evaluate(() => window.__ac8EquipmentMenu?.isOpen())) {
    await page.locator('#toggle-sensors').click();
    await page.waitForFunction(() => window.__ac8EquipmentMenu?.isOpen(), null, {timeout: 5000});
    await page.waitForTimeout(1300);
  }
  if (!type) return;
  if (await page.evaluate(() => window.__ac8EquipmentMenu?.isDetail())) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__ac8EquipmentMenu?.isDetail(), null, {timeout: 3000});
    await page.waitForTimeout(500);
  }
  await page.locator(`#ac8-equipment-menu .ac8-hud-tabs button[data-page="${type}"]`).click();
  await page.waitForFunction(() => window.__ac8EquipmentMenu?.isDetail(), null, {timeout: 3000});
  await page.waitForTimeout(1100);
}

async function selectEquipmentType(page, type) {
  await page.evaluate(kind => document.querySelector(`#equipment-tab-${kind}`)?.click(), type);
  await page.waitForTimeout(300);
}

async function closeEquipmentMenu(page) {
  for (let i = 0; i < 3 && await page.evaluate(() => window.__ac8EquipmentMenu?.isOpen()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(420);
  }
  await page.waitForFunction(() => !window.__ac8EquipmentMenu?.isOpen(), null, {timeout: 5000});
  await page.waitForTimeout(700);
}

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium'),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/equipment-manager',{recursive:true});
 const page=await browser.newPage({viewport:{width:1515,height:980}}),errors=[],api=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/capabilities'))api.push(request.url());});
 const url=process.env.APP_URL||'http://127.0.0.1:5196';
 await page.goto(`${url}${url.includes('?')?'&':'?'}demo=0`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:120000});
 const sideBefore=await page.locator('#app').getAttribute('data-active-view');
 await openEquipmentMenu(page,'radar');
 assert.equal(await page.locator('#app').getAttribute('data-active-view'),sideBefore);
 assert.equal(await page.locator('.equipment-type-tabs [role=tab]').count(),6);
 assert.equal(await page.locator('.equipment-model-trigger').count(),6);
 assert.equal(await page.locator('#equipment-scene-controls').isVisible(),false);
 const visible=await page.locator('#equipment-manager').innerText();for(const word of ['位置与姿态','单目标能力比较','评估结果','目标与工作模式','光电／声学场景对比'])assert.ok(!visible.includes(word));
 await page.screenshot({path:'artifacts/equipment-manager/radar.png'});
 // The active type exposes a compact model picker beside the profile heading.
 await page.getByRole('button',{name:'选择雷达型号',exact:true}).click();
 const arrow=await page.locator('.equipment-model-trigger[data-type=radar]').boundingBox(),menu=await page.locator('#equipment-model-menu').boundingBox();
 assert.ok(menu.width>arrow.width*4);assert.ok(menu.x>=0&&menu.x+menu.width<=1516);
 await page.screenshot({path:'artifacts/equipment-manager/model-menu.png'});
 await page.keyboard.press('Escape');assert.equal(await page.locator('#equipment-manager').isVisible(),true);assert.equal(await page.locator('#equipment-model-menu').isVisible(),false);
 await selectEquipmentType(page,'radio');
 await page.getByRole('button',{name:'选择无线电型号',exact:true}).click();
 await page.locator('#equipment-model-menu [data-preset-id=radio-x1c]').click();
 assert.equal(await page.locator('#equipment-tab-radio').getAttribute('aria-selected'),'true');
 assert.match(await page.locator('#equipment-model-name').innerText(),/X1C/);
 await page.locator('.equipment-group-nav').getByRole('button',{name:'基础参数',exact:true}).click();
 await page.locator('#profile-parameters-maxRange').fill('5000');
 await selectEquipmentType(page,'optical');await selectEquipmentType(page,'radio');
 await page.locator('.equipment-group-nav').getByRole('button',{name:'基础参数',exact:true}).click();
 assert.equal(await page.locator('#profile-parameters-maxRange').inputValue(),'5000');
 await page.waitForFunction(()=>document.querySelector('#equipment-save-state').innerText==='已保存',null,{timeout:5000});
 await page.locator('#profile-parameters-maxRange').fill('0');await page.locator('.equipment-group-nav').getByRole('button',{name:'接收频段',exact:true}).click();await page.locator('#equipment-profile-save').click();
 assert.equal(await page.locator('#profile-parameters-maxRange').inputValue(),'0');assert.ok((await page.locator('#equipment-profile-message').innerText()).includes('标称距离上限'));await page.locator('#profile-parameters-maxRange').fill('5000');
 const download=page.waitForEvent('download');await page.locator('#equipment-profile-export').click();await (await download).saveAs('artifacts/equipment-manager/profile.json');
 const exported=JSON.parse(await readFile('artifacts/equipment-manager/profile.json','utf8'));assert.equal(exported.schema,'equipment-catalog/1');assert.equal(exported.profiles[0].parameters.maxRange,5000);assert.ok(!('position'in exported.profiles[0]));assert.ok(!('environment'in exported));
 await page.locator('#profile-parameters-maxRange').fill('4444');await page.locator('#equipment-profile-file').setInputFiles('artifacts/equipment-manager/profile.json');
 await page.waitForFunction(()=>/已新增|已导入/.test(document.querySelector('#equipment-profile-message').textContent));
 await page.locator('.equipment-group-nav').getByRole('button',{name:'基础参数',exact:true}).click();assert.equal(await page.locator('#profile-parameters-maxRange').inputValue(),'5000');
 await page.locator('#equipment-profile-file').setInputFiles({name:'scene.json',mimeType:'application/json',buffer:Buffer.from('{"devices":[]}')});
 await page.waitForFunction(()=>document.querySelector('#equipment-profile-message').textContent.includes('导入失败'));assert.equal(await page.locator('#profile-parameters-maxRange').inputValue(),'5000');
 await selectEquipmentType(page,'optical');
 await page.locator('.equipment-group-nav').getByRole('button',{name:'基础参数',exact:true}).click();assert.equal(await page.locator('#profile-parameters-maxRange').inputValue(),'');
 await page.locator('.equipment-group-nav').getByRole('button',{name:'通道焦距',exact:true}).click();await page.locator('#profile-working-channel').selectOption('thermal');assert.equal(await page.locator('#profile-working-focalMm').inputValue(),'75');
 await selectEquipmentType(page,'acoustic');await page.locator('.equipment-group-nav').getByRole('button',{name:'阵列频带',exact:true}).click();await page.locator('#profile-working-arrayDiameter').selectOption('0.3');assert.equal(await page.locator('#profile-working-frequencyMin').inputValue(),'');
 await closeEquipmentMenu(page);await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:120000});
 await openEquipmentMenu(page,'radio');await page.getByRole('button',{name:'选择无线电型号',exact:true}).click();await page.locator('#equipment-model-menu [data-preset-id^="custom:radio-x1c:"]').first().click();await page.locator('.equipment-group-nav').getByRole('button',{name:'基础参数',exact:true}).click();assert.equal(await page.locator('#profile-parameters-maxRange').inputValue(),'5000');
 await closeEquipmentMenu(page);
 await openSceneMenu(page,'environment');
 const stations=await page.evaluate(()=>window.sceneConfigurationDiagnostics.environment.rfStations);
 await page.locator('#city-environment-rainMmH').fill('12');
 await page.locator('#city-environment-page .city-settings-nav').getByRole('button',{name:'噪声环境',exact:true}).click();await page.locator('#city-environment-trafficDb').fill('52');
 await page.locator('#city-environment-apply').click();
 const environment=await page.evaluate(()=>window.sceneConfigurationDiagnostics.environment);assert.equal(environment.rainMmH,12);assert.equal(environment.trafficDb,52);assert.equal(environment.rfStations,stations);
 assert.equal(await page.locator('#city-environment-rfStations').count(),0);
 await page.screenshot({path:'artifacts/equipment-manager/environment.png'});
 await openSceneMenu(page,'target');
 await page.locator('#city-target-count').fill('3');
 await page.locator('#city-target-page .city-settings-nav').getByRole('button',{name:'无线电',exact:true}).click();await page.locator('#city-target-emitting').uncheck();await page.locator('#city-target-fhss').check();
 const target=await page.evaluate(()=>window.sceneConfigurationDiagnostics.target);assert.equal(target.count,3);assert.equal(target.emitting,false);assert.equal(target.fhss,true);
 await page.screenshot({path:'artifacts/equipment-manager/target.png'});
 // Target map picking edits the draft, then Apply updates the shared target.
 await openSceneMenu(page,'scene');await page.locator('#museum-focus').click();await openSceneMenu(page,'target');await page.locator('#city-target-page .city-settings-nav').getByRole('button',{name:'位置',exact:true}).click();
 await page.locator('#city-target-pick').click();const viewport=await page.locator('#viewport').boundingBox();
 for(const [x,y] of [[.5,.5],[.6,.55],[.45,.6],[.65,.65]]){
  await page.mouse.click(viewport.x+viewport.width*x,viewport.y+viewport.height*y);
  if(!await page.locator('#ac8-scene-menu').evaluate(node=>node.classList.contains('is-minimized')))break;
 }
 assert.equal(await page.locator('#ac8-scene-menu').evaluate(node=>node.classList.contains('is-minimized')),false);
 const x=Number(await page.locator('#city-target-east').inputValue());await page.locator('#city-target-apply').click();assert.equal(await page.evaluate(()=>window.sceneConfigurationDiagnostics.target.position[0]),x);
 await closeSceneMenu(page);await page.setViewportSize({width:390,height:844});await openEquipmentMenu(page,'radar');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/equipment-manager/mobile.png'});
 assert.ok(await page.locator('#equipment-profile-save').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'mobile save button remains reachable');
 await page.getByRole('button',{name:'选择雷达型号',exact:true}).click();const mobileMenu=await page.locator('#equipment-model-menu').boundingBox();assert.ok(mobileMenu.x>=0&&mobileMenu.x+mobileMenu.width<=391);await page.screenshot({path:'artifacts/equipment-manager/mobile-menu.png'});await page.keyboard.press('Escape');
 await closeEquipmentMenu(page);await openSceneMenu(page,'environment');await page.screenshot({path:'artifacts/equipment-manager/mobile-environment.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.ok(await page.locator('#city-environment-apply').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'mobile Apply button remains reachable');
 assert.deepEqual(api,[]);assert.deepEqual(errors,[]);
 console.log('PASS: six equipment tabs, independent model menus, model drafts/save/import/export/reload, missing specifications, city environment and target settings, map picking, mobile width; no assessment API requests or page errors.');
}finally{await browser.close();}
