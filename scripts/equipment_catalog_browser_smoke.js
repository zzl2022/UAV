import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

// Mount the production catalog and window controller without requiring generated city data.
const fixture=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>反无设备参数管理</title></head>
<body><div id="app"><aside id="workspace-sidebar" hidden><button id="open-city-model"></button><button id="toggle-sensors"></button><div class="deployment-tabs"><button id="toggle-task3"></button><button id="toggle-planning"></button></div><div id="deployment-panels"></div></aside></div>
<script type="module">
import '/src/style.css';import '/src/sensors/ui.css';import '/src/workspace.css';
import {createWorkspace} from '/src/workspace.js';import {mountEquipmentManager} from '/src/sensors/equipment-manager.js';
const app=document.querySelector('#app'),workspace=createWorkspace(app),panel=document.createElement('div');panel.id='equipment-panel';
workspace.mountWindow('equipment','反无设备',panel,{closeId:'equipment-back'});
const manager=mountEquipmentManager(panel);document.querySelector('#toggle-sensors').onclick=()=>{workspace.showWindow('equipment');manager.refresh();};
workspace.showWindow('equipment');document.documentElement.dataset.ready='true';
</script></body></html>`;
const root=fileURLToPath(new URL('..',import.meta.url)),out=path.resolve(root,process.env.EQUIPMENT_ARTIFACT_DIR||'artifacts/equipment-catalog-new');
await mkdir(out,{recursive:true});
const server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},plugins:[{
 name:'equipment-catalog-fixture',configureServer(vite){vite.middlewares.use('/__equipment_catalog_test__',(_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);});},
}]});
let browser;
try{
 await server.listen();const url=`http://127.0.0.1:${server.httpServer.address().port}/__equipment_catalog_test__`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium'),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1515,height:980}}),errors=[],assessmentRequests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))assessmentRequests.push(r.url());});
 await page.goto(url);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 const nav=page.locator('.equipment-group-nav'),input=key=>page.locator(`#profile-parameters-${key}`);
 const group=name=>nav.getByRole('button',{name,exact:true}).click();
 const tab=type=>page.locator(`#equipment-tab-${type}`).click();
 const shot=name=>page.locator('#equipment-window').screenshot({path:path.join(out,name+'.png')});
 const assertBase=async()=>{assert.equal(await nav.locator('button').first().innerText(),'基础参数');assert.equal(await nav.locator('[aria-current=true]').innerText(),'基础参数');};
 const assertFits=async()=>{
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'document width');
  for(const selector of ['#equipment-profile-form','.equipment-type-tabs','.equipment-profile-heading'])assert.ok(await page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${selector} width`);
  assert.ok(await page.locator('#equipment-profile-save').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'save button reachable');
 };
 assert.equal(await page.locator('.equipment-type-tabs [role=tab]').count(),6);
 assert.equal(await page.locator('.equipment-model-trigger').count(),2);
 await page.locator('#equipment-tab-radar').focus();await page.keyboard.press('End');
 assert.equal(await page.locator('#equipment-tab-electrostatic').getAttribute('aria-selected'),'true');
 await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#equipment-tab-radar').getAttribute('aria-selected'),'true');
 await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#equipment-tab-electrostatic').getAttribute('aria-selected'),'true');
 await page.keyboard.press('Home');assert.equal(await page.locator('#equipment-tab-radar').getAttribute('aria-selected'),'true');
 const seen=new Set();
 for(const type of ['radar','optical','radio','acoustic','fivega','electrostatic']){
  await tab(type);await assertBase();
  assert.ok((await nav.locator('button').allTextContents()).every(name=>[...name].length===4));
  for(const name of ['设备功能','资料来源','资源来源'])assert.equal(await nav.getByRole('button',{name,exact:true}).count(),0);
  assert.equal(await page.locator('.profile-field-evidence').count(),0);
  seen.add(await page.evaluate(()=>window.equipmentManagerDiagnostics.presetId));
  const trigger=page.locator(`.equipment-model-trigger[data-type=${type}]`);
  if(await trigger.count()){
   await trigger.click();const ids=await page.locator('#equipment-model-menu [data-preset-id]').evaluateAll(items=>items.map(el=>el.dataset.presetId));await page.keyboard.press('Escape');
   for(const id of ids){await trigger.click();await page.locator(`#equipment-model-menu [data-preset-id=${id}]`).click();await assertBase();seen.add(id);}
  }
 }
 assert.equal(seen.size,9);
 await tab('fivega');await assertBase();assert.equal(await input('coverageDistance').inputValue(),'1500');
 for(const key of ['minRange','capacity','updateSeconds']){assert.equal(await input(key).inputValue(),'');assert.equal(await input(key).getAttribute('placeholder'),'');assert.equal(await input(key).isEditable(),true);}
 assert.equal(await page.locator('.profile-value-qualifier').innerText(),'以上');
 await shot('5GA-basic');
 await group('覆盖参数');assert.equal(await input('verticalBeamAngle').inputValue(),'65');assert.equal(await input('coverageHeight').inputValue(),'600');await shot('5GA-coverage');
 await group('通感配置');assert.equal(await input('channelCount').inputValue(),'128');assert.equal(await input('frequencyGHz').inputValue(),'');
 await group('通信性能');assert.equal(await input('uplinkStreams').inputValue(),'12');assert.equal(await input('downlinkStreams').inputValue(),'32');assert.equal(await input('cellPeakGbps').inputValue(),'10');await shot('5GA-communications');
 await group('基础参数');await input('capacity').fill('4');await input('coverageDistance').fill('1700');
 assert.doesNotMatch(await page.locator('#equipment-manager').innerText(),/未公开|待标定|厂商标称|用户调整|用户填写|公开部署报道/);
 assert.equal(await page.locator('.profile-value-qualifier').isVisible(),false);
 await tab('radar');await tab('fivega');assert.equal(await input('coverageDistance').inputValue(),'1700');
 await page.locator('#equipment-profile-save').click();assert.equal(await page.locator('#equipment-save-state').innerText(),'已保存');
 const download=page.waitForEvent('download');await page.locator('#equipment-profile-export').click();const savedFile=path.join(out,'fivega-profile.json');await (await download).saveAs(savedFile);
 const exported=JSON.parse(await readFile(savedFile,'utf8'));assert.equal(exported.profiles[0].parameters.capacity,4);assert.equal(exported.profiles[0].parameters.updateSeconds,null);assert.ok(!('sources'in exported.profiles[0]));
 await page.locator('#equipment-profile-reset').click();assert.equal(await input('coverageDistance').inputValue(),'1500');assert.equal(await input('capacity').inputValue(),'');assert.equal(await page.locator('#equipment-save-state').innerText(),'未保存');
 await page.locator('#equipment-profile-file').setInputFiles(savedFile);await page.waitForFunction(()=>document.querySelector('#equipment-profile-message').textContent==='已导入');assert.equal(await input('coverageDistance').inputValue(),'1700');
 const forged=structuredClone(exported);forged.profiles[0].sources=[];
 await page.locator('#equipment-profile-file').setInputFiles({name:'forged.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(forged))});
 await page.waitForFunction(()=>document.querySelector('#equipment-profile-message').textContent.includes('导入失败'));assert.equal(await input('coverageDistance').inputValue(),'1700');
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');await tab('fivega');assert.equal(await input('coverageDistance').inputValue(),'1700');
 await page.locator('#equipment-profile-reset').click();await page.locator('#equipment-profile-save').click();
 await tab('electrostatic');await assertBase();assert.equal(await input('detectionDistance').inputValue(),'100');assert.equal(await input('responseTimeMs').inputValue(),'80');
 assert.deepEqual(await page.locator('.profile-value-qualifier').allTextContents(),['≥','≤']);assert.equal(await input('updateSeconds').inputValue(),'');await shot('electrostatic-basic');
 await input('capacity').fill('1.5');await group('环境功耗');await page.locator('#equipment-profile-save').click();
 assert.equal(await nav.locator('[aria-current=true]').innerText(),'基础参数');assert.match(await page.locator('#equipment-profile-message').innerText(),/并发目标数/);await input('capacity').fill('3');await page.locator('#equipment-profile-save').click();
 const staticDownload=page.waitForEvent('download');await page.locator('#equipment-profile-export').click();const staticFile=path.join(out,'electrostatic-profile.json');await (await staticDownload).saveAs(staticFile);
 await page.locator('#equipment-profile-reset').click();assert.equal(await input('capacity').inputValue(),'');
 await page.locator('#equipment-profile-file').setInputFiles(staticFile);await page.waitForFunction(()=>document.querySelector('#equipment-profile-message').textContent==='已导入');assert.equal(await input('capacity').inputValue(),'3');
 await page.locator('#equipment-profile-reset').click();await page.locator('#equipment-profile-save').click();
 await group('环境功耗');assert.equal(await input('staticPowerMw').inputValue(),'50');assert.equal(await input('operatingPowerW').inputValue(),'');assert.equal(await input('temperatureMin').inputValue(),'-25');await shot('electrostatic-power');
 assert.equal(await input('operatingPowerW').getAttribute('placeholder'),'');await input('operatingPowerW').fill('2.5');await page.locator('#equipment-profile-save').click();assert.equal(await page.locator('#equipment-save-state').innerText(),'已保存');
 await page.locator('#equipment-profile-reset').click();assert.equal(await input('operatingPowerW').inputValue(),'');await page.locator('#equipment-profile-save').click();
 await tab('optical');await group('通道焦距');await page.locator('#profile-working-channel').selectOption('thermal');assert.equal(await page.locator('#profile-working-focalMm').inputValue(),'75');
 await tab('acoustic');await group('阵列频带');await page.locator('#profile-working-arrayDiameter').selectOption('0.3');assert.equal(await page.locator('#profile-working-frequencyMin').inputValue(),'');
 for(const width of [1000,780,581,390]){
  await page.setViewportSize({width,height:844});await tab('electrostatic');await assertFits();await group('环境功耗');await assertFits();
  if(width===390){await group('基础参数');await shot('electrostatic-mobile');}
  await tab('fivega');await assertFits();if(width===390)await shot('5GA-mobile');
 }
 await page.locator('#equipment-window-minimize').click();assert.ok(await page.locator('#equipment-window').evaluate(el=>el.classList.contains('is-minimized')));
 await page.locator('#equipment-window-minimize').click();await page.locator('#equipment-back').click();assert.equal(await page.locator('#equipment-window').isVisible(),false);
 assert.deepEqual(errors,[]);assert.deepEqual(assessmentRequests,[]);
 console.log('PASS: six categories, nine models, keyboard navigation, original controls, published qualifiers, blank editable inputs without annotations, parameter groups only, validation, save/reset/import/export/reload, 1000/780/581/390px layouts; no page errors or assessment API requests.');
 console.log(`Screenshots: ${out}`);
}finally{await browser?.close();await server.close();}
