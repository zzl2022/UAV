import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';

const url=new URL(process.env.APP_URL||'http://127.0.0.1:5173');
url.searchParams.set('demo','0');
const defaultBrowser=process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||defaultBrowser,
  headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
  await mkdir('artifacts/equipment-library',{recursive:true});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const ready=()=>page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:180000});
  const inventory=page.locator('#equipment-inventory'),save=page.locator('#equipment-profile-save');
  const equipmentMenu=page.locator('#ac8-equipment-menu'),content=equipmentMenu.locator('.ac8-hud-content');
  const museum=page.locator('#museum-label');
  const currentRange=page.locator('#profile-parameters-maxRange');
  const summary=page.locator('#equipment-inventory-count'),rows=page.locator('#equipment-inventory-list li');
  const info=page.locator('[data-info="equipmentConfig"]');
  const entries=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('uav.equipment-library.v1')??'[]'));
  const selectedRadar=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('uav.equipment-selection.v1')).radar);
  const task3Equipment=page.locator('#task3-equipment');
  const toasts=page.locator('.ui-toast-stack');
  const notice=(text,tone)=>toasts.locator(`.ui-toast[data-tone="${tone}"]`).getByText(text,{exact:true});
  const modeledIds=()=>task3Equipment.locator('.task3-equip').evaluateAll(items=>items.map(item=>item.dataset.presetId));
  const rowFor=id=>page.locator(`#equipment-inventory-list li[data-preset-id="${id}"]`);
  const radarRow=rowFor('radar-03d');

  async function closeMenu(name){
    const isOpen=()=>page.evaluate(name=>Boolean(window[`__ac8${name}Menu`]?.isOpen()),name);
    for(let step=0;step<2&&await isOpen();step++)await page.keyboard.press('Escape');
    await page.waitForFunction(name=>!window[`__ac8${name}Menu`]?.isOpen(),name);
  }

  async function clickLauncher(id){
    await page.waitForFunction(id=>{
      const launcher=document.getElementById(id),rect=launcher.getBoundingClientRect();
      return rect.left>=0&&rect.right<=innerWidth&&getComputedStyle(launcher).pointerEvents!=='none';
    },id);
    await page.locator(`#${id}`).click();
  }

  async function enter(id){
    await closeMenu('Deployment');
    if(!await page.evaluate(()=>window.__ac8EquipmentMenu?.isOpen()))await clickLauncher('toggle-sensors');
    if(await page.evaluate(()=>window.__ac8EquipmentMenu?.isDetail())){
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!window.__ac8EquipmentMenu?.isDetail());
      assert.doesNotMatch(await equipmentMenu.getAttribute('class'),/\bis-inventory\b/);
    }
    await page.locator(`#ac8-equipment-menu .ac8-hud-tabs button[data-page="${id}"]`).click();
    await page.waitForFunction(id=>window.__ac8EquipmentMenu?.active()===id,id);
    const panel=id==='inventory'?inventory:page.locator('#equipment-profile-form');
    await panel.waitFor({state:'visible'});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#ac8-equipment-menu .ac8-hud-content')).transform==='none');
  }

  async function planningGenerate(){
    await closeMenu('Equipment');
    await clickLauncher('toggle-deployment');
    await page.locator('#ac8-deployment-menu .ac8-hud-tabs button[data-page="input"]').click();
    await page.locator('#task3-scope-width').fill('600');
    await page.locator('#task3-scope-depth').fill('600');
    await page.locator('#task3-spacing').fill('300');
    await page.locator('#task3-max-devices').fill('8');
    await page.locator('#task3-panel [data-sub="generate"]').click();
    await page.locator('#task3-plan-types [data-plan-type="economy"]').uncheck();
    await page.locator('#task3-plan-types [data-plan-type="enhanced"]').uncheck();
  }

  async function runPlan(){
    const previous=await page.evaluate(()=>window.task3Diagnostics.requestId);
    await page.locator('#task3-run-side').click();
    await page.waitForFunction(previous=>{
      const result=window.task3Diagnostics;
      return result.requestId>previous&&!result.busy&&(result.reportRequestId===result.requestId||result.lastError);
    },previous,{timeout:180000});
    return page.evaluate(()=>window.task3Diagnostics);
  }

  const observeInfo=()=>page.evaluate(()=>{
    window.libraryInfoEvents=[];
    document.querySelector('#app').addEventListener('equipment-library-change',()=>{
      window.libraryInfoEvents.push(document.querySelector('[data-info="equipmentConfig"]').textContent);
    });
  });

  await page.goto(url.href,{timeout:120000});await ready();await observeInfo();
  await museum.waitFor({state:'visible'});
  const overviewX=(await museum.boundingBox()).x;
  await enter('inventory');
  await page.waitForFunction(x=>document.querySelector('#museum-label').getBoundingClientRect().left>x+100,overviewX);
  assert.match(await equipmentMenu.getAttribute('class'),/\bis-inventory\b/);
  const inventoryRect=await content.boundingBox(),coreRect=await museum.boundingBox();
  assert.ok(inventoryRect.x>=0&&inventoryRect.x<=48&&inventoryRect.width>=380&&inventoryRect.width<=440);
  assert.ok(coreRect.x>inventoryRect.x+inventoryRect.width+20&&coreRect.x+coreRect.width<=1500);
  assert.equal(await inventory.isVisible(),true);
  assert.equal(await page.locator('#equipment-profile-form').isHidden(),true);
  const initialEntries=await entries(),initialModeled=await modeledIds();
  assert.equal(await page.evaluate(()=>localStorage.getItem('uav.equipment-library.seeded.v2')),'1');
  assert.equal(new Set(initialEntries.map(item=>item.type)).size,6);
  assert.equal(await rows.count(),6);
  assert.equal(initialModeled.length,4);
  assert.equal(await summary.textContent(),'已选 4 项装备（推演使用）');
  assert.equal(await inventory.getByText('暂无推演模型',{exact:true}).count(),2);
  assert.match(await info.textContent(),/^已选 /);
  assert.doesNotMatch(await info.textContent(),/装备库|5G-A|静电/);
  await planningGenerate();
  const initialPlan=await runPlan();
  assert.equal(initialPlan.lastError,null);
  assert.deepEqual(initialPlan.lastEquipmentSnapshot.selectedPresetIds,initialModeled);
  assert.equal(initialPlan.staleResult,false);

  await enter('radar');
  assert.equal(await inventory.isHidden(),true);
  assert.ok((await content.boundingBox()).width>500,'型号编辑页应恢复原宽度');
  const defaultId=await selectedRadar();
  await page.locator('.equipment-model-trigger[data-type="radar"]').click();
  await page.locator('#equipment-model-menu [data-preset-id="radar-03d"]').click();
  assert.notEqual(defaultId,'radar-03d','冒烟需覆盖切回不同的默认型号');
  assert.deepEqual(await modeledIds(),initialModeled,'切换编辑型号不应改变实际推演的装备');
  assert.equal(await page.evaluate(()=>window.task3Diagnostics.staleResult),false);
  const radarName=await page.locator('#equipment-model-name').textContent();
  const initial=Number(await currentRange.inputValue());
  const adjusted=initial-7;
  await currentRange.fill('0');
  await save.click();
  assert.match(await page.locator('#equipment-profile-message').textContent(),/距离|量程/);
  assert.equal(await toasts.locator('.ui-toast').count(),0);
  assert.deepEqual(await entries(),initialEntries);
  await currentRange.fill(String(adjusted));
  assert.equal(await save.textContent(),'加入装备库');
  await save.click();
  const addedText=`已加入装备库：雷达 · ${radarName}`,addedNotice=notice(addedText,'success');
  await addedNotice.waitFor({state:'visible'});
  const shownAt=Date.now();
  assert.equal(await page.locator('#equipment-profile-message').textContent(),addedText);
  assert.ok(await toasts.evaluate(stack=>{
    const card=stack.firstElementChild,rect=card.getBoundingClientRect();
    return getComputedStyle(stack).position==='fixed'&&getComputedStyle(stack).pointerEvents==='none'&&
      !document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('.ui-toast-stack');
  }));
  await page.screenshot({path:'artifacts/equipment-library/toast-desktop.png'});
  await addedNotice.waitFor({state:'detached',timeout:5000});
  assert.ok(Date.now()-shownAt>=2200,'加入提示应保留约 3 秒');
  assert.equal(await page.locator('#equipment-save-state').textContent(),'已保存');
  const saved=await entries();
  assert.equal(saved.length,initialEntries.length+1);
  const added=saved.find(item=>item.presetId==='radar-03d');
  assert.deepEqual(Object.keys(added).sort(),['addedAt','name','presetId','type']);
  assert.equal(added.name,radarName);
  assert.equal(await selectedRadar(),'radar-03d');
  const duplicateText=`该装备已在装备库中：雷达 · ${radarName}`,duplicateNotice=notice(duplicateText,'info');
  assert.equal(await save.isEnabled(),true);
  const beforeDuplicate=await page.evaluate(()=>window.libraryInfoEvents.length);
  await save.click();await duplicateNotice.waitFor({state:'visible'});
  await save.click();await duplicateNotice.waitFor({state:'visible'});
  assert.equal(await duplicateNotice.count(),1);
  assert.equal(await page.locator('#equipment-profile-message').textContent(),duplicateText);
  assert.equal(await page.evaluate(()=>window.libraryInfoEvents.length),beforeDuplicate);
  assert.deepEqual(await entries(),saved);
  const immediateInfo=await page.evaluate(()=>window.libraryInfoEvents.at(-1));
  assert.ok(immediateInfo.startsWith('已选 ')&&immediateInfo.includes(radarName));
  assert.doesNotMatch(await info.textContent(),/装备库/);
  assert.deepEqual(await modeledIds(),[...initialModeled,'radar-03d']);
  assert.equal(await page.evaluate(()=>window.task3Diagnostics.staleResult),true);
  assert.match(await page.locator('#task3-result-freshness').textContent(),/非最新参数结果/);
  await enter('inventory');
  assert.equal(await summary.textContent(),'已选 5 项装备（推演使用）');
  assert.equal(await rows.count(),7);
  assert.ok((await radarRow.textContent()).includes(String(adjusted)));
  assert.match(await radarRow.textContent(),/移除后不参与推演/);
  assert.equal(await radarRow.getByRole('button',{name:`移除 ${radarName}`}).isVisible(),true);
  await page.screenshot({path:'artifacts/equipment-library/desktop-1500x1000.png'});

  await page.reload({timeout:120000});await ready();await observeInfo();
  await enter('inventory');
  assert.equal(await summary.textContent(),'已选 5 项装备（推演使用）');
  assert.deepEqual(await entries(),saved);
  await enter('radar');
  assert.equal(await page.locator('#equipment-model-name').textContent(),radarName);
  assert.equal(await currentRange.inputValue(),String(adjusted));
  await currentRange.fill(String(adjusted-4));
  await save.click();
  await notice(`已更新装备库：雷达 · ${radarName}`,'success').waitFor({state:'visible'});
  const updated=await entries();
  assert.equal(updated.length,saved.length);
  assert.ok(updated.find(item=>item.presetId==='radar-03d').addedAt>added.addedAt);
  await planningGenerate();
  const updatedPlan=await runPlan();
  assert.equal(updatedPlan.lastError,null);
  assert.deepEqual(updatedPlan.lastEquipmentSnapshot.selectedPresetIds,[...initialModeled,'radar-03d']);
  assert.equal(updatedPlan.lastEquipmentSnapshot.profiles.find(item=>item.presetId==='radar-03d').parameters.maxRange,adjusted-4);

  await page.setViewportSize({width:390,height:844});
  await enter('inventory');
  const mobileContent=await content.boundingBox();
  assert.ok(mobileContent.x>=12&&mobileContent.x+mobileContent.width<=378);
  assert.ok(await inventory.evaluate(element=>element.scrollWidth<=element.clientWidth));
  const remove=radarRow.getByRole('button',{name:`移除 ${radarName}`});
  await remove.scrollIntoViewIfNeeded();
  const rect=await remove.boundingBox();
  assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=390&&rect.y+rect.height<=844);
  await page.screenshot({path:'artifacts/equipment-library/mobile-390x844.png'});
  await page.evaluate(()=>{
    const write=Storage.prototype.setItem;
    window.restoreInventoryStorage=()=>{Storage.prototype.setItem=write;};
    Storage.prototype.setItem=function(key,value){
      if(key==='uav.equipment-library.v1')throw Error('QA storage unavailable');
      return write.call(this,key,value);
    };
  });
  try{
    await remove.click();
    await notice('装备库保存失败，请检查浏览器存储空间。','error').waitFor({state:'visible'});
    assert.equal(await radarRow.count(),1);
    assert.deepEqual(await entries(),updated);
  }finally{await page.evaluate(()=>window.restoreInventoryStorage());}
  await remove.click();
  assert.equal(await summary.textContent(),'已选 4 项装备（推演使用）');
  const removalNotice=notice(`已从装备清单移除 ${radarName}`,'success');
  await removalNotice.waitFor({state:'visible'});
  const toastRect=await toasts.boundingBox(),chatRect=await page.locator('.project-chat__toggle').boundingBox();
  assert.ok(toastRect.x>=0&&toastRect.x+toastRect.width<=390&&toastRect.y+toastRect.height<chatRect.y);
  await page.screenshot({path:'artifacts/equipment-library/toast-mobile-390x844.png'});
  assert.ok(!(await page.evaluate(()=>window.libraryInfoEvents.at(-1))).includes(radarName));
  assert.deepEqual(await entries(),initialEntries);
  assert.deepEqual(await modeledIds(),initialModeled);
  assert.equal(await page.evaluate(()=>window.task3Diagnostics.staleResult),true);
  assert.equal(await selectedRadar(),defaultId);
  const retained=await page.evaluate(()=>JSON.parse(localStorage.getItem('uav.equipment-catalog.v1')).profiles.find(item=>item.presetId==='radar-03d'));
  assert.equal(retained.parameters.maxRange,adjusted-4);
  await page.setViewportSize({width:1500,height:1000});
  await planningGenerate();
  const planAfterRemoval=await runPlan();
  assert.equal(planAfterRemoval.lastError,null);
  assert.deepEqual(planAfterRemoval.lastEquipmentSnapshot.selectedPresetIds,initialModeled);
  assert.equal(planAfterRemoval.lastEquipmentSnapshot.profiles.some(item=>item.presetId==='radar-03d'),false);
  await page.setViewportSize({width:390,height:844});
  await enter('radar');
  assert.equal(await inventory.isHidden(),true);
  assert.equal(await page.locator('#equipment-profile-form').isVisible(),true);
  await enter('inventory');
  const defaultRadar=rowFor(defaultId);
  await defaultRadar.getByRole('button',{name:/移除/}).click();
  assert.ok(!(await info.textContent()).includes('雷达'));
  assert.deepEqual(await modeledIds(),initialModeled.filter(id=>id!==defaultId));
  while(await rows.count())await rows.first().getByRole('button',{name:/移除/}).click();
  assert.ok(await toasts.locator('.ui-toast').count()<=3);
  assert.deepEqual(await entries(),[]);
  assert.equal(await summary.textContent(),'已选 0 项装备（推演使用）');
  assert.match(await page.locator('#equipment-inventory-empty').textContent(),/装备库为空.*加入装备库/);
  assert.equal(await info.textContent(),'未配置装备');
  await page.reload({timeout:120000});await ready();await enter('inventory');
  assert.equal(await summary.textContent(),'已选 0 项装备（推演使用）');
  assert.deepEqual(await entries(),[]);
  assert.match(await task3Equipment.textContent(),/没有可用于优化推演的装备/);
  await page.setViewportSize({width:1500,height:1000});
  await planningGenerate();
  assert.match((await runPlan()).lastError,/没有可用于优化推演的装备/);

  // Populate the list with references to the real catalog profiles to exercise mobile scrolling.
  const expectedCount=await page.evaluate(()=>{
    const {profiles}=JSON.parse(localStorage.getItem('uav.equipment-catalog.v1'));
    const addedAt=new Date().toISOString();
    const references=profiles.map(({presetId,type,name})=>({presetId,type,name,addedAt}));
    localStorage.setItem('uav.equipment-library.v1',JSON.stringify(references));
    return references.length;
  });
  await page.setViewportSize({width:390,height:844});
  await page.reload({timeout:120000});await ready();await enter('inventory');
  assert.equal(await rows.count(),expectedCount);
  const list=page.locator('#equipment-inventory-list');
  assert.ok(await list.evaluate(element=>element.scrollHeight>element.clientHeight));
  const lastRemove=rows.last().getByRole('button',{name:/移除/});
  await lastRemove.scrollIntoViewIfNeeded();
  assert.ok(await list.evaluate(element=>element.scrollTop>0));
  const lastButton=await lastRemove.boundingBox(),chatButton=await page.locator('.project-chat__toggle').boundingBox();
  assert.ok(lastButton.y+lastButton.height<=chatButton.y,'滚动到底时移除按钮不应被项目问答浮标遮挡');
  await page.screenshot({path:'artifacts/equipment-library/mobile-scroll-390x844.png'});
  await lastRemove.click();
  assert.equal(await rows.count(),expectedCount-1);
  assert.deepEqual(errors,[]);
  console.log('装备清单浏览器冒烟通过，已覆盖迁移、任务三实际请求、空状态、小屏布局、重复加入提示、移除失败与提示消失。');
}finally{
  await browser.close();
}
