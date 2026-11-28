import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {closeSceneMenu,openSceneMenu} from './city_menu_helper.js';

const source=resolve(process.env.UAV_SITE_SOURCE||'创意二文件/创意二数据集/区域数据');
const artifacts=resolve('artifacts/custom-sites');
await mkdir(artifacts,{recursive:true});
const fixtures=await mkdtemp(join(artifacts,'fixtures-'));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',
  headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  const errors=[],geometryRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/data/custom-sites/'))geometryRequests.push(request.url());});
  const base=process.env.APP_URL||'http://127.0.0.1:5173';
  const timestamps=Date.now().toString(36);
  const name=`区域数据 ${timestamps}`,plain=`无影像 ${timestamps}`;
  await page.goto(base,{timeout:120000});
  const ready=()=>page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
  await ready();
  await openSceneMenu(page,'scene');
  const panel=page.locator('#custom-site-panel');
  const feedback=page.locator('#custom-site-feedback');
  const folder=page.locator('#custom-site-folder');
  const submit=panel.getByRole('button',{name:'开始生成'});
  const input=page.locator('#custom-site-name');
  const select=page.locator('#model-select');
  const remove=page.getByRole('button',{name:'删除当前自定义模型'});
  assert.equal(await remove.isHidden(),true);
  const chooseCore=page.locator('#select-core-buildings');
  assert.equal(await chooseCore.isDisabled(),true);
  const open=async()=>{
    await page.locator('#add-custom-site').click();
    await panel.waitFor({state:'visible'});
    assert.equal(await page.locator('#add-custom-site').evaluate(button=>button.previousElementSibling.className),'stats');
  };
  async function create(modelName,selected){
    await open();
    await input.fill(` ${modelName} `);
    await folder.setInputFiles(selected);
    await page.waitForFunction(()=>!document.querySelector('#custom-site-panel [type=submit]').disabled,null,{timeout:20000});
    assert.match(await feedback.innerText(),/检查通过/);
    await submit.click();
    await page.waitForFunction(()=>{
      const panel=document.querySelector('#custom-site-panel');
      return panel.hidden||document.querySelector('#custom-site-feedback').dataset.error==='true';
    },null,{timeout:600000});
    assert.equal(await panel.isHidden(),true,await feedback.textContent());
    const slug=await select.inputValue();
    assert.match(slug,/^custom-[a-f0-9]{32}$/);
    assert.equal(await select.locator('option:checked').textContent(),modelName);
    assert.equal(await select.locator('option:checked').evaluate(option=>option.parentElement.id),'model-select');
    assert.equal(await select.locator('optgroup').count(),0);
    assert.equal(await remove.isVisible(),true);
    assert.equal(await chooseCore.isEnabled(),true);
    assert.equal(await page.locator('#core-focus').isHidden(),true);
    assert.equal(await page.evaluate(()=>window.cityDiagnostics.coreCount),0);
    const model=await page.evaluate(id=>window.cityDiagnostics.models[id],slug);
    assert.ok(model.loaded&&model.buildingCount>15000);
    assert.equal(model.maxHeight,136);
    assert.equal(await page.locator('#height').textContent(),'136');
    assert.equal(await page.locator('#count').textContent(),model.buildingCount.toLocaleString('zh-CN'));
    assert.ok(geometryRequests.some(url=>url.includes(slug)&&url.endsWith('-terrain.json')));
    return slug;
  }
  const slug=await create(name,source);
  assert.ok(geometryRequests.some(url=>url.includes(slug)&&url.endsWith('-imagery.jpg')));
  await page.screenshot({path:join(artifacts,'imported.png')});

  const noImagery=join(fixtures,'无影像');
  for(const directory of ['building','dem'])await mkdir(join(noImagery,directory),{recursive:true});
  for(const path of ['building/zheng_apart.shp','building/zheng_apart.dbf','building/zheng_apart.prj','dem/dem.tif']){
    await copyFile(join(source,path),join(noImagery,path));
  }
  const plainSlug=await create(plain,noImagery);
  assert.match(await page.locator('#status').textContent(),/该模型未提供影像底图/);
  assert.equal(await page.locator('#imagery').isDisabled(),true);
  assert.equal(await select.isDisabled(),false);

  await page.reload({timeout:120000});
  await ready();
  await openSceneMenu(page,'scene');
  for(const label of [name,plain])await select.locator('option',{hasText:label}).waitFor({state:'attached'});
  await select.selectOption(plainSlug);
  await page.waitForFunction(id=>window.cityDiagnostics?.modelMode===id&&!document.querySelector('#model-select').disabled,plainSlug,{timeout:120000});

  await open();
  await input.fill('错误数据检查');
  await panel.locator('#custom-site-files').setInputFiles([
    join(source,'building/zheng_apart.shp'),join(source,'building/zheng_apart.dbf'),join(source,'dem/dem.tif'),
  ]);
  await page.waitForFunction(()=>document.querySelector('#custom-site-feedback').textContent.includes('同目录同名的 .prj'));
  assert.equal(await submit.isDisabled(),true);
  const badProjection=join(fixtures,'zheng_apart.prj');
  await writeFile(badProjection,'GEOGCS["待替换的无效坐标系"]','utf8');
  await panel.locator('#custom-site-files').setInputFiles(badProjection);
  await page.waitForFunction(()=>!document.querySelector('#custom-site-panel [type=submit]').disabled);
  await submit.click();
  await page.waitForFunction(()=>document.querySelector('#custom-site-feedback').textContent.includes('坐标系无效'),null,{timeout:90000});
  assert.equal(await input.inputValue(),'错误数据检查');
  assert.match(await page.locator('#custom-site-summary').textContent(),/已选 4 个文件/);
  assert.equal(await select.inputValue(),plainSlug);
  await panel.getByRole('button',{name:'取消'}).click();
  await closeSceneMenu(page);

  await page.waitForFunction(()=>window.task3Diagnostics?.sceneKey?.includes('/custom-'));
  await page.locator('#toggle-deployment').click();
  await page.locator('#ac8-deployment-menu .ac8-hud-tabs button',{hasText:'推演输入'}).click();
  await page.locator('#task3-panel .task3-subnav-btn[data-sub="weights"]').click();
  await page.locator('#task3-building-select').click();
  await page.waitForFunction(()=>window.task3Diagnostics.buildingSelection?.active,null,{timeout:60000});
  assert.match(await page.evaluate(()=>window.task3Diagnostics.buildingSelection.sceneKey),new RegExp(plainSlug));
  await page.locator('#task3-building-editor button').click();
  await page.locator('#task3-panel .task3-subnav-btn[data-sub="scope"]').click();
  await page.locator('#task3-scope-width').fill('1200');
  await page.locator('#task3-scope-depth').fill('1200');
  await page.locator('#task3-panel .task3-subnav-btn[data-sub="generate"]').click();
  for(const type of ['balanced','enhanced'])await page.locator(`[data-plan-type="${type}"]`).uncheck();
  await page.locator('#task3-run-side').evaluate(button=>button.click());
  await page.waitForFunction(()=>window.task3Diagnostics?.requestId>0&&!window.task3Diagnostics.busy,null,{timeout:300000});
  const task3=await page.evaluate(()=>{
    const diagnostics=window.task3Diagnostics,report=window.__task3Report;
    return {ready:diagnostics.ready,error:diagnostics.lastError,plans:diagnostics.plans?.length,samples:report?.sampling.samples.length,
      playback:diagnostics.playbackStatus,duration:diagnostics.threatDuration,routeCount:diagnostics.threatRouteCount,
      activeFrames:Object.values(report?.threatsByPlan?.[diagnostics.planId]??{}).some(record=>record?.frames?.length)};
  });
  assert.equal(task3.ready,true,JSON.stringify(task3));
  assert.equal(task3.plans,1);
  assert.ok(task3.samples>0);
  assert.ok(!geometryRequests.some(url=>url.endsWith('.glb')));
  assert.equal(task3.playback,'ready');
  assert.ok(task3.duration>0,JSON.stringify(task3));
  assert.equal(task3.activeFrames,true);

  for(let i=0;i<2&&await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen());i++){
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  assert.equal(await page.locator('#ac8-sim-start').isDisabled(),false);
  assert.equal(await page.locator('#ac8-sim-scenario').isDisabled(),false);
  assert.equal(await page.locator('#ac8-sim-status').isHidden(),true);
  await page.locator('#ac8-sim-start').click();
  await page.waitForFunction(()=>window.task3Diagnostics.threatPlaying&&window.task3Diagnostics.threatFrameIndex>0&&window.task3Diagnostics.threatTargets.length>0,null,{timeout:60000});
  const customPlayback=await page.evaluate(()=>({routes:window.task3Diagnostics.threatRouteCount,duration:window.task3Diagnostics.threatDuration,index:window.task3Diagnostics.threatFrameIndex,targets:window.task3Diagnostics.threatTargets.length}));
  assert.ok(customPlayback.routes>0,JSON.stringify(customPlayback));
  assert.ok(customPlayback.targets>0,JSON.stringify(customPlayback));
  await page.locator('#ac8-sim-start').click();
  await page.waitForFunction(()=>!window.task3Diagnostics.threatPlaying,null,{timeout:30000});
  await page.evaluate(()=>document.querySelector('#toggle-task3').click());
  const devices=await page.evaluate(()=>{
    const diagnostics=window.task3Diagnostics,plan=window.__task3Report.plans.find(item=>item.id===diagnostics.planId);
    const canvas=document.querySelector('#viewport canvas'),rect=canvas.getBoundingClientRect();
    return diagnostics.deviceMarkers.flatMap(marker=>{
      const device=plan.devices.find(item=>item.id===marker.deviceId),x=rect.left+marker.x,y=rect.top+marker.y;
      return device.type==='radar'&&marker.visible&&document.elementFromPoint(x,y)===canvas?[{id:device.id,position:device.position,x,y}]:[];
    });
  });
  let selected=null;
  for(const device of devices){
    await page.mouse.move(device.x,device.y);
    try{await page.waitForFunction(id=>document.querySelector('#task3-device-hover').dataset.deviceId===id,device.id,{timeout:2000});}
    catch{continue;}
    await page.mouse.click(device.x,device.y);selected=device;break;
  }
  assert.ok(selected,'自定义地图应有可点选的已部署雷达');
  const pinned=page.locator('#task3-device-info'),demo=page.locator('#task3-device-demo');
  await pinned.getByRole('button',{name:'设备仿真'}).click();
  await page.waitForFunction(()=>['ready','empty'].includes(window.task3Diagnostics.deviceDemo.status),null,{timeout:120000});
  const customDemo=await page.evaluate(()=>window.task3Diagnostics.deviceDemo);
  assert.equal(customDemo.deviceId,selected.id);assert.deepEqual(customDemo.position,selected.position);assert.ok(customDemo.samples>0);
  await page.screenshot({path:join(artifacts,'device-demo.png')});
  await demo.getByRole('button',{name:'停止仿真'}).click();
  assert.equal(await demo.isHidden(),true);
  assert.equal(await page.evaluate(()=>window.task3Diagnostics.deviceDemo.listening),false);
  await openSceneMenu(page,'scene');
  const cancelled=page.waitForEvent('dialog').then(dialog=>{
    assert.equal(dialog.message(),`删除自定义模型“${plain}”？该操作会删除服务器上的模型文件，且无法恢复。`);
    return dialog.dismiss();
  });
  await remove.click();
  await cancelled;
  assert.equal(await select.inputValue(),plainSlug);

  const deletionPattern=`**/api/sites/${plainSlug}`;
  const failedDelete=route=>{
    assert.equal(route.request().method(),'DELETE');
    return route.fulfill({status:500,json:{error:'删除失败，请稍后重试'}});
  };
  await page.route(deletionPattern,failedDelete);
  page.once('dialog',dialog=>dialog.accept());
  await remove.click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('删除失败，请稍后重试'),null,{timeout:90000});
  assert.equal(await select.inputValue(),plainSlug);
  assert.equal(await page.evaluate(()=>window.cityDiagnostics.modelMode),plainSlug);
  assert.equal(await select.locator(`option[value="${plainSlug}"]`).count(),1);
  await page.unroute(deletionPattern,failedDelete);

  // 后端删除另一个测试模型时，页面上的当前场景继续显示。
  assert.equal((await page.request.delete(new URL(`api/sites/${slug}`,base.endsWith('/')?base:base+'/').href)).status(),200);
  assert.equal(await page.evaluate(()=>window.cityDiagnostics.modelMode),plainSlug);
  page.once('dialog',dialog=>dialog.accept());
  await remove.click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已删除自定义模型'),null,{timeout:90000});
  assert.equal(await select.inputValue(),'recon');
  assert.equal(await remove.isHidden(),true);
  for(const id of [slug,plainSlug])assert.equal(await select.locator(`option[value="${id}"]`).count(),0);
  const refreshed=page.waitForResponse(response=>response.url().endsWith('/api/sites')&&response.request().method()==='GET');
  await page.reload({timeout:120000});await ready();await refreshed;
  await openSceneMenu(page,'scene');
  for(const id of [slug,plainSlug])assert.equal(await select.locator(`option[value="${id}"]`).count(),0);
  assert.deepEqual(errors,[]);
  console.log(`自定义模型浏览器冒烟通过，已覆盖导入、刷新、任务三方案、自定义地图实际播放、实际地图设备仿真（${customDemo.samples} 个采样，${customDemo.status}）和删除流程。`);
}finally{
  await browser.close();
  if(fixtures.startsWith(join(artifacts,'fixtures-')))await rm(fixtures,{recursive:true,force:true});
}
