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
  const ready=()=>page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
  const inventory=page.locator('#equipment-inventory'),save=page.locator('#equipment-profile-save');
  const currentRange=page.locator('#profile-parameters-maxRange');
  const summary=page.locator('#equipment-inventory-count'),rows=page.locator('#equipment-inventory-list li');
  const info=page.locator('[data-info="equipmentConfig"]');
  const entries=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('uav.equipment-library.v1')??'[]'));
  const selectedRadar=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('uav.equipment-selection.v1')).radar);

  async function enter(id){
    if(!await page.evaluate(()=>window.__ac8EquipmentMenu?.isOpen()))await page.locator('#toggle-sensors').click();
    if(await page.evaluate(()=>window.__ac8EquipmentMenu?.isDetail())){
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!window.__ac8EquipmentMenu?.isDetail());
    }
    await page.locator(`#ac8-equipment-menu .ac8-hud-tabs button[data-page="${id}"]`).click();
    await page.waitForFunction(id=>window.__ac8EquipmentMenu?.active()===id,id);
    const panel=id==='inventory'?inventory:page.locator('#equipment-profile-form');
    await panel.waitFor({state:'visible'});
  }

  const observeInfo=()=>page.evaluate(()=>{
    window.libraryInfoEvents=[];
    document.querySelector('#app').addEventListener('equipment-library-change',()=>{
      window.libraryInfoEvents.push(document.querySelector('[data-info="equipmentConfig"]').textContent);
    });
  });

  await page.goto(url.href,{timeout:120000});await ready();await observeInfo();
  await enter('inventory');
  assert.equal(await inventory.isVisible(),true);
  assert.equal(await page.locator('#equipment-profile-form').isHidden(),true);
  assert.equal(await summary.textContent(),'已加入 0 项装备');
  assert.match(await page.locator('#equipment-inventory-empty').textContent(),/装备库为空.*加入装备库/);
  assert.match(await info.textContent(),/已选.+装备库为空/);

  await enter('radar');
  assert.equal(await inventory.isHidden(),true);
  const defaultId=await selectedRadar();
  await page.locator('.equipment-model-trigger[data-type="radar"]').click();
  await page.locator('#equipment-model-menu [data-preset-id="radar-03d"]').click();
  assert.notEqual(defaultId,'radar-03d','冒烟需覆盖切回不同的默认型号');
  const radarName=await page.locator('#equipment-model-name').textContent();
  const initial=Number(await currentRange.inputValue());
  const adjusted=initial-7;
  await currentRange.fill('0');
  await save.click();
  assert.match(await page.locator('#equipment-profile-message').textContent(),/距离|量程/);
  assert.deepEqual(await entries(),[]);
  await currentRange.fill(String(adjusted));
  assert.equal(await save.textContent(),'加入装备库');
  await save.click();
  assert.equal(await page.locator('#equipment-profile-message').textContent(),`已加入装备库：雷达 · ${radarName}`);
  assert.equal(await page.locator('#equipment-save-state').textContent(),'已保存');
  const saved=await entries();
  assert.equal(saved.length,1);
  assert.deepEqual(Object.keys(saved[0]).sort(),['addedAt','name','presetId','type']);
  assert.equal(saved[0].presetId,'radar-03d');
  assert.equal(await selectedRadar(),'radar-03d');
  assert.match(await page.evaluate(()=>window.libraryInfoEvents.at(-1)),/装备库 1 项/);
  assert.ok((await info.textContent()).includes(`装备库 1 项（雷达 ${radarName}）`));
  await enter('inventory');
  assert.equal(await summary.textContent(),'已加入 1 项装备');
  assert.equal(await rows.count(),1);
  assert.ok((await rows.first().textContent()).includes(String(adjusted)));
  assert.equal(await rows.first().getByRole('button',{name:`移除 ${radarName}`}).isVisible(),true);
  await page.screenshot({path:'artifacts/equipment-library/desktop-1500x1000.png'});

  await page.reload({timeout:120000});await ready();await observeInfo();
  await enter('inventory');
  assert.equal(await summary.textContent(),'已加入 1 项装备');
  assert.deepEqual(await entries(),saved);
  await enter('radar');
  assert.equal(await page.locator('#equipment-model-name').textContent(),radarName);
  assert.equal(await currentRange.inputValue(),String(adjusted));
  await currentRange.fill(String(adjusted-4));
  await save.click();
  const updated=await entries();
  assert.equal(updated.length,1);
  assert.ok(updated[0].addedAt>saved[0].addedAt);

  await page.setViewportSize({width:390,height:844});
  await enter('inventory');
  const remove=rows.first().getByRole('button',{name:`移除 ${radarName}`});
  await remove.scrollIntoViewIfNeeded();
  const rect=await remove.boundingBox();
  assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=390&&rect.y+rect.height<=844);
  await page.screenshot({path:'artifacts/equipment-library/mobile-390x844.png'});
  await remove.click();
  assert.equal(await summary.textContent(),'已加入 0 项装备');
  assert.match(await page.locator('#equipment-inventory-status').textContent(),/已从装备清单移除/);
  assert.match(await page.evaluate(()=>window.libraryInfoEvents.at(-1)),/装备库为空/);
  assert.deepEqual(await entries(),[]);
  assert.equal(await selectedRadar(),defaultId);
  const retained=await page.evaluate(()=>JSON.parse(localStorage.getItem('uav.equipment-catalog.v1')).profiles.find(item=>item.presetId==='radar-03d'));
  assert.equal(retained.parameters.maxRange,adjusted-4);
  await enter('radar');
  assert.equal(await inventory.isHidden(),true);
  assert.equal(await page.locator('#equipment-profile-form').isVisible(),true);
  await page.reload({timeout:120000});await ready();await enter('inventory');
  assert.equal(await summary.textContent(),'已加入 0 项装备');

  // Populate the list with references to the real catalog profiles to exercise mobile scrolling.
  const expectedCount=await page.evaluate(()=>{
    const {profiles}=JSON.parse(localStorage.getItem('uav.equipment-catalog.v1'));
    const addedAt=new Date().toISOString();
    const references=profiles.map(({presetId,type,name})=>({presetId,type,name,addedAt}));
    localStorage.setItem('uav.equipment-library.v1',JSON.stringify(references));
    return references.length;
  });
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
  console.log('装备清单浏览器冒烟通过，已覆盖空状态、校验、加入、去重、刷新、小屏滚动和移除、选择回退与参数保留。');
}finally{
  await browser.close();
}
