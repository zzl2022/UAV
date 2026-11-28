import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {openSceneMenu} from './city_menu_helper.js';

const base=process.env.APP_URL||'http://127.0.0.1:5173';
const source=resolve(process.env.UAV_SITE_SOURCE||'创意二文件/创意二数据集/区域数据');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',
  headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1000}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const api=path=>new URL(`/api/sites${path}`,base).href;
let slug=null;

// 只在测试页面投影真实屋顶并用同一网格确认选点可见，点击仍交给页面处理。
async function exposeRoofPoints(){
  await page.route(/\/src\/main\.js(?:\?.*)?$/,async route=>{
    const response=await route.fetch(),source=await response.text();
    const ready="document.documentElement.dataset.ready='true';";
    assert.ok(source.includes(ready),'核心建筑冒烟需要 Vite 开发服务');
    const fixture=`
    window.coreTest={
      releases:0,
      targets({limit=4,exclude=[],include=[]}={}){
        const parts=siteParts[mode],canvas=renderer.domElement;
        const rect=canvas.getBoundingClientRect(),found=[];
        const ray=new THREE.Raycaster();ray.firstHitOnly=true;
        camera.updateMatrixWorld();
        for(const range of parts.ranges){
          const b=range.building;
          if(exclude.includes(b.id)||(include.length&&!include.includes(b.id)))continue;
          const bounds=coreFootprintBounds([b]);
          const p=new THREE.Vector3(bounds.x,bounds.top,bounds.z).project(camera);
          if(Math.abs(p.x)>.92||Math.abs(p.y)>.86||Math.abs(p.z)>1)continue;
          const x=Math.round(rect.left+(p.x+1)/2*rect.width);
          const y=Math.round(rect.top+(1-p.y)/2*rect.height);
          if(document.elementFromPoint(x,y)!==canvas||found.some(other=>Math.hypot(other.x-x,other.y-y)<28))continue;
          ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),camera);
          const hit=ray.intersectObject(parts.buildings)[0];
          if(hit?.faceIndex<range.start||hit?.faceIndex>=range.end||!hit)continue;
          found.push({x,y,id:b.id});
          if(found.length===limit)break;
        }
        return found;
      },
      allSavedInView(){
        const cores=siteCoreBuildings(siteMeta[mode]);
        camera.updateMatrixWorld();
        return cores.length===3&&cores.every(b=>b.rings[0].every(([x,y,z])=>{
          const p=new THREE.Vector3(x,y+b.height,z).project(camera);
          return Math.abs(p.x)<1&&Math.abs(p.y)<1&&Math.abs(p.z)<1;
        }));
      },
      highlight(){
        return {
          draft:draftCoreHighlight.userData.buildingCount,
          saved:coreHighlight.userData.buildingCount,
          neighborMeshes:neighborHighlight.children.length,
          draftColor:draftCoreHighlight.children[0]?.material.color.getHex(),
          savedColor:coreHighlight.children[0]?.material.color.getHex(),
        };
      },
      settledCamera(){
        for(let i=0;i<500;i++)controls.update();
        return camera.position.toArray();
      },
    };
    document.addEventListener('pointerup',event=>{
      if(event.target===renderer.domElement)window.coreTest.releases++;
    });
    `;
    await route.fulfill({response,body:source.replace(ready,fixture+ready)});
  });
}

try{
  await mkdir('artifacts/custom-sites',{recursive:true});
  await exposeRoofPoints();
  const ready=()=>page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
  const select=page.locator('#model-select'),edit=page.locator('#select-core-buildings'),panel=page.locator('#custom-core-panel');
  const name=page.locator('#custom-core-name'),count=page.locator('#custom-core-count'),focus=page.locator('#core-focus');
  const coreStatus=page.locator('#custom-core-status'),toasts=page.locator('.ui-toast-stack');
  const targets=options=>page.evaluate(options=>window.coreTest.targets(options),options??{});
  const details=async()=> (await page.request.get(new URL(`/data/custom-sites/${slug}/${slug}-gba-meta.json`,base).href)).json();
  const assertSaved=async count=>{
    const observed=await page.evaluate(()=>({
      count:window.cityDiagnostics.coreCount,
      neighbors:window.cityDiagnostics.coreNeighbors,
      highlight:window.coreTest.highlight(),
    }));
    assert.equal(observed.count,count);
    assert.equal(observed.highlight.saved,count);
    assert.equal(observed.neighbors,0);
    assert.equal(observed.highlight.neighborMeshes,0);
  };
  const enter=async()=>{
    await edit.click();await panel.waitFor({state:'visible'});
    assert.match(await coreStatus.textContent(),/^点击建筑加入核心区/);
    await page.waitForFunction(()=>window.__ac8SceneMenu.isMinimized());
    await page.waitForTimeout(650);
  };
  const save=async (label,buildingCount)=>{
    await name.fill(label);
    await panel.getByRole('button',{name:'保存',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#custom-core-panel').hidden||
      document.querySelector('#custom-core-status').dataset.error==='true',null,{timeout:90000,polling:200});
    assert.equal(await panel.isHidden(),true,await page.locator('#custom-core-status').textContent());
    const message=toasts.getByText(`核心建筑已保存（${buildingCount} 栋）：${label}`,{exact:true});
    await message.waitFor({state:'visible'});
    assert.equal(await coreStatus.textContent(),'');
    assert.doesNotMatch(await page.locator('#status').textContent(),/核心建筑已保存/);
    return message;
  };
  const reloadSite=async()=>{
    await page.reload({timeout:120000});await ready();await openSceneMenu(page);
    await select.selectOption(slug);
    await page.waitForFunction(id=>window.cityDiagnostics?.modelMode===id&&!document.querySelector('#model-select').disabled,slug,{timeout:90000});
  };
  await page.goto(base,{timeout:120000});await ready();await openSceneMenu(page);
  assert.equal(await edit.isDisabled(),true);
  assert.match(await edit.getAttribute('title'),/内置模型的核心建筑由模型元数据固定/);
  await page.locator('#add-custom-site').click();
  await page.locator('#custom-site-name').fill('核心建筑测试 '+Date.now().toString(36));
  await page.locator('#custom-site-folder').setInputFiles(source);
  await page.locator('#custom-site-panel button[type=submit]').click({timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#custom-site-panel').hidden||
    document.querySelector('#custom-site-feedback').dataset.error==='true',null,{timeout:360000,polling:200});
  assert.equal(await page.locator('#custom-site-panel').isHidden(),true,await page.locator('#custom-site-feedback').textContent());
  slug=await select.inputValue();
  assert.match(slug,/^custom-[a-f0-9]{32}$/);
  assert.equal(await focus.isHidden(),true);
  assert.equal(await page.locator('#core-label').isHidden(),true);
  assert.equal((await details()).coreBuildings.length,0);

  await enter();
  assert.equal(await name.inputValue(),'核心建筑');
  const [start]=await targets();
  assert.ok(start,'地图上应至少有一个可见屋顶');
  const releases=await page.evaluate(()=>window.coreTest.releases);
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(start.x+38,start.y+11,{steps:8});await page.mouse.up();
  assert.match(await count.textContent(),/已选 0 栋/);
  assert.equal(await page.evaluate(()=>window.coreTest.releases),releases+1,'松手事件须到达 OrbitControls 所在的文档');
  const afterDrag=await page.evaluate(()=>window.coreTest.settledCamera());
  await page.mouse.move(start.x+113,start.y+30);
  const afterHover=await page.evaluate(()=>window.coreTest.settledCamera());
  assert.ok(Math.hypot(...afterDrag.map((value,index)=>value-afterHover[index]))<.1,'松手后鼠标移动应停止旋转地图');

  const [one]=await targets();
  assert.ok(one);
  await page.mouse.click(one.x,one.y);
  assert.match(await count.textContent(),/已选 1 栋/);
  const draft=await page.evaluate(()=>window.coreTest.highlight());
  assert.equal(draft.draft,1);
  assert.equal(draft.draftColor,0x69eaff);
  assert.equal(draft.saved,0);
  assert.equal(draft.neighborMeshes,0);
  assert.equal((await details()).coreBuildings.length,0);
  const patchUrl=api(`/${slug}/core`);
  await page.route(patchUrl,route=>route.fulfill({status:503,json:{error:'暂时无法保存核心建筑，请重试。'}}),{times:1});
  await name.fill('单栋核心');
  await panel.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#custom-core-status').dataset.error==='true');
  assert.equal(await coreStatus.textContent(),'暂时无法保存核心建筑，请重试。');
  assert.equal(await panel.isVisible(),true);
  assert.equal(await toasts.locator('.ui-toast').count(),0);
  await page.waitForTimeout(3100);
  assert.equal(await coreStatus.textContent(),'暂时无法保存核心建筑，请重试。');
  const savedToast=await save('单栋核心',1);
  assert.equal(await toasts.getAttribute('role'),'status');
  assert.equal(await toasts.getAttribute('aria-live'),'polite');
  const shownAt=Date.now();
  await page.screenshot({path:'artifacts/custom-sites/core-toast-desktop.png'});
  await savedToast.waitFor({state:'detached',timeout:5000});
  assert.ok(Date.now()-shownAt>=2200,'核心保存提示应保留约 3 秒');
  await focus.waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.coreTest.highlight().savedColor),0xffd166);
  assert.equal((await details()).coreBuilding.id,one.id);
  await assertSaved(1);
  await reloadSite();
  assert.equal(await edit.textContent(),'修改核心建筑');
  await assertSaved(1);

  await enter();
  const extra=await targets({limit:2,exclude:[one.id]});
  assert.equal(extra.length,2);
  for(const point of extra)await page.mouse.click(point.x,point.y);
  assert.match(await count.textContent(),/已选 3 栋/);
  const threeDraft=await page.evaluate(()=>window.coreTest.highlight());
  assert.equal(threeDraft.draft,3);
  assert.equal(threeDraft.neighborMeshes,0);
  await page.screenshot({path:'artifacts/custom-sites/core-draft-desktop.png'});
  await save('三栋联合核心',3);
  await assertSaved(3);
  assert.equal(await page.locator('#core-label').textContent(),'⌖ 三栋联合核心');
  assert.equal((await details()).coreBuilding,null);
  assert.deepEqual((await details()).coreBuildings.map(b=>b.id),[one.id,...extra.map(p=>p.id)]);
  await focus.click();await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(()=>window.coreTest.allSavedInView()),true);
  await page.locator('#core-label').waitFor({state:'visible'});
  await page.screenshot({path:'artifacts/custom-sites/core-saved-desktop.png'});
  await reloadSite();
  await assertSaved(3);
  await select.selectOption('recon');
  await page.waitForFunction(()=>window.cityDiagnostics?.modelMode==='recon'&&!document.querySelector('#model-select').disabled,null,{timeout:90000});
  await select.selectOption(slug);
  await page.waitForFunction(id=>window.cityDiagnostics?.modelMode===id&&!document.querySelector('#model-select').disabled,slug,{timeout:90000});
  await assertSaved(3);

  await enter();
  const [toggle]=await targets({limit:1,include:extra.map(point=>point.id)});
  assert.ok(toggle);
  await page.mouse.click(toggle.x,toggle.y);
  assert.match(await count.textContent(),/已选 2 栋/);
  await panel.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await coreStatus.textContent(),'');
  assert.equal((await details()).coreBuildings.length,3);
  assert.equal(await page.evaluate(()=>window.coreTest.highlight().saved),3);

  await page.setViewportSize({width:390,height:844});
  await enter();
  const bounds=await panel.boundingBox();
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=390&&bounds.y+bounds.height<=844);
  assert.equal(await name.inputValue(),'三栋联合核心');
  await page.screenshot({path:'artifacts/custom-sites/core-editor-390x844.png'});
  page.once('dialog',dialog=>dialog.accept());
  await panel.getByRole('button',{name:'清除核心建筑'}).click();
  await panel.waitFor({state:'hidden',timeout:90000});
  await toasts.getByText('已清除核心建筑',{exact:true}).waitFor({state:'visible'});
  await page.screenshot({path:'artifacts/custom-sites/core-toast-390x844.png',animations:'disabled'});
  assert.equal(await coreStatus.textContent(),'');
  assert.doesNotMatch(await page.locator('#status').textContent(),/已清除核心建筑/);
  assert.equal(await focus.isHidden(),true);
  assert.equal(await page.locator('#core-label').isHidden(),true);
  const cleared=await details();
  assert.deepEqual(cleared.coreBuildings,[]);
  assert.equal(cleared.coreName,null);
  await assertSaved(0);
  await reloadSite();
  assert.equal(await edit.textContent(),'选择核心建筑');
  assert.equal(await focus.isHidden(),true);
  assert.deepEqual(errors,[]);
  console.log('核心建筑浏览器冒烟通过，已覆盖单栋和三栋保存、定位、取消、清除、无邻域高亮、成功提示消失和失败保留。');
}catch(error){
  const progress=await page.locator('#custom-site-feedback').textContent({timeout:2000}).catch(()=>null);
  const core=await page.locator('#custom-core-status').textContent({timeout:2000}).catch(()=>null);
  const status=await page.locator('#status').textContent({timeout:2000}).catch(()=>null);
  console.error('核心建筑冒烟停止时的页面提示', {progress,core,status,errors});
  throw error;
}finally{
  if(slug&&/^custom-[a-z0-9]{32}$/.test(slug))await page.request.delete(api(`/${slug}`)).catch(()=>{});
  await browser.close();
}
