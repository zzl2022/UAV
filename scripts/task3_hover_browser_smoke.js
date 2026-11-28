import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/task3',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:60000});
 await page.locator('#toggle-deployment').click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isOpen(),null,{timeout:5000});
 await page.locator('#ac8-deployment-menu .ac8-hud-tabs button',{hasText:'推演输入'}).click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isDetail(),null,{timeout:3000});
 await page.locator('#task3-run-side').evaluate(button=>button.click());
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});
 const exported=await page.evaluate(()=>window.__task3Export()),report=exported.report,plan=report.plans.find(item=>item.id===exported.activePlanId);
 const diag=await page.evaluate(()=>window.task3Diagnostics),viewport=await page.locator('#viewport').boundingBox();
 assert.equal(diag.deviceMarkers.length,plan.devices.length);assert.ok(diag.deviceMarkers.every(marker=>marker.visible),'全部固定设备应位于当前地图视口');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isDetail(),null,{timeout:3000});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isOpen(),null,{timeout:3000});
 await page.evaluate(()=>document.querySelector('#app').dispatchEvent(new CustomEvent('view-change',{detail:'task3'})));
 const displayById=new Map(exported.deviceDisplay.map(entry=>[entry.internalId,entry]));
 const hover=page.locator('#task3-device-hover');
 const show=async marker=>{
  await page.mouse.move(viewport.x+marker.x,viewport.y+marker.y);
  try{await page.waitForFunction(id=>{const card=document.querySelector('#task3-device-hover');return card&&!card.hidden&&card.dataset.deviceId===id;},marker.deviceId,{timeout:5000});}
  catch(error){const state=await page.evaluate(({x,y})=>({card:document.querySelector('#task3-device-hover')?.outerHTML,hit:document.elementFromPoint(x,y)?.outerHTML?.slice(0,500),canvas:document.querySelector('#viewport canvas')?.getBoundingClientRect().toJSON()}),{x:viewport.x+marker.x,y:viewport.y+marker.y});throw Error(`无法悬停 ${JSON.stringify(marker)}；命中元素 ${state.hit}；画布 ${JSON.stringify(state.canvas)}；实际卡片 ${state.card}`,{cause:error});}
 };
 for(const [index,marker] of diag.deviceMarkers.entries()){
  await show(marker);
  const deviceIndex=plan.devices.findIndex(device=>device.id===marker.deviceId),device=plan.devices[deviceIndex],display=displayById.get(device.id),site=plan.sites[deviceIndex];
  const contribution=plan.coverageContributions[device.id].find(row=>row.condition===diag.condition),total=plan.metrics.find(row=>row.condition===diag.condition).total;
  const text=await hover.textContent();
  for(const expected of [display.displayName,display.typeName,display.modelName,device.position[0].toFixed(1),(-device.position[2]).toFixed(1),device.position[1].toFixed(1),site.name,site.installation,`覆盖 ${contribution.coveredSamples}/${total} 个采样；独立覆盖 ${contribution.independentSamples} 个`])assert.ok(text.includes(expected),`${device.id} 卡片缺少真实字段：${expected}`);
  if(Number.isFinite(device.parameters?.frequencyGHz))assert.ok(text.includes(`当前模型频点 ${device.parameters.frequencyGHz} GHz`));
  const deviceConflicts=report.emc[plan.id].conflicts.filter(conflict=>conflict.a===device.id||conflict.b===device.id),fail=deviceConflicts.filter(conflict=>conflict.severity==='fail').length,warning=deviceConflicts.filter(conflict=>conflict.severity==='warning').length;
  const emcExpected=fail?`不通过（严重 ${fail} · 提示 ${warning}）`:warning?`降额（提示 ${warning}）`:'通过（未发现涉及该设备的冲突）';
  assert.ok(text.includes(emcExpected),`${device.id} 的 EMC 状态应与当前报告一致`);
  const box=await hover.boundingBox();assert.ok(box.x>=viewport.x&&box.y>=viewport.y&&box.x+box.width<=viewport.x+viewport.width+1&&box.y+box.height<=viewport.y+viewport.height+1,'卡片必须限制在地图视口内');
  assert.equal(await hover.evaluate(card=>getComputedStyle(card).pointerEvents),'none');
  if(index===0)await page.screenshot({path:'artifacts/task3/device-hover.png'});
 }
 await page.mouse.move(viewport.x+2,viewport.y+2);await page.waitForFunction(()=>document.querySelector('#task3-device-hover').hidden);
 await show(diag.deviceMarkers[0]);
 const nextCondition=report.conditions.find(condition=>condition.id!==diag.condition).id;
 await page.locator('#task3-condition').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},nextCondition);
 await page.waitForFunction(()=>document.querySelector('#task3-device-hover').hidden);
 const current=await page.evaluate(()=>window.task3Diagnostics);await show(current.deviceMarkers[0]);
 const other=report.plans.find(item=>item.id!==plan.id).id;
 await page.locator('#task3-plan').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},other);
 await page.waitForFunction(()=>document.querySelector('#task3-device-hover').hidden);
 const switched=await page.evaluate(()=>window.task3Diagnostics);await show(switched.deviceMarkers[0]);
 await page.evaluate(()=>document.querySelector('#app').dispatchEvent(new CustomEvent('view-change',{detail:'scene'})));
 await page.waitForFunction(()=>document.querySelector('#task3-device-hover').hidden);
 await page.locator('#toggle-task3').evaluate(button=>button.click());const reopened=await page.evaluate(()=>window.task3Diagnostics);await show(reopened.deviceMarkers[0]);
 await page.locator('#task3-run-side').evaluate(button=>button.click());await page.waitForFunction(()=>window.task3Diagnostics.busy&&document.querySelector('#task3-device-hover').hidden);
 await page.locator('#task3-cancel-side').evaluate(button=>button.click());await page.waitForFunction(()=>!window.task3Diagnostics.busy);

 const pin=page.locator('#task3-device-info');
 const pointerPosition=marker=>({x:viewport.x+marker.x,y:viewport.y+marker.y});
 const pickable=await page.evaluate(()=>window.task3Diagnostics.deviceMarkers.filter(marker=>marker.visible));
 assert.ok(pickable.length>=2);
 const first=pickable[0],firstPoint=pointerPosition(first);
 const waitPinned=id=>page.waitForFunction(id=>window.task3Diagnostics.pinnedDeviceId===id,id,{timeout:9000});
 await show(first);
 const sharedDetails=await hover.locator('dl').textContent();
 await page.mouse.click(firstPoint.x,firstPoint.y);await waitPinned(first.deviceId);
 assert.equal(await pin.locator('dl').textContent(),sharedDetails);
 assert.equal(await pin.evaluate(element=>getComputedStyle(element).pointerEvents),'auto');
 const pinnedRect=await pin.boundingBox();
 assert.ok(firstPoint.x<pinnedRect.x||firstPoint.x>pinnedRect.x+pinnedRect.width||firstPoint.y<pinnedRect.y||firstPoint.y>pinnedRect.y+pinnedRect.height,'固定卡片需让开设备标记');
 await page.mouse.move(viewport.x+5,viewport.y+5);await waitPinned(first.deviceId);
 const second=await page.evaluate(first=>{
  const canvas=document.querySelector('#viewport canvas'),bounds=canvas.getBoundingClientRect();
  const distance=item=>Math.hypot(item.x-first.x,item.y-first.y);
  return window.task3Diagnostics.deviceMarkers.filter(item=>item.visible&&item.deviceId!==first.deviceId&&
   document.elementFromPoint(bounds.left+item.x,bounds.top+item.y)===canvas).sort((a,b)=>distance(b)-distance(a))[0];
 },first);
 assert.ok(second,'至少有一个可点击的其它设备');
 const secondPoint=pointerPosition(second);
 await page.mouse.click(secondPoint.x,secondPoint.y);await waitPinned(second.deviceId);
 const blank=await page.evaluate(()=>{
  const canvas=document.querySelector('#viewport canvas'),box=canvas.getBoundingClientRect();
  for(const y of [.14,.27,.5,.71])for(const x of [.2,.36,.57,.79]){
   const point={x:box.left+x*box.width,y:box.top+y*box.height};
   if(document.elementFromPoint(point.x,point.y)===canvas&&window.task3Diagnostics.deviceMarkers.every(marker=>Math.hypot(marker.x-x*box.width,marker.y-y*box.height)>55))return point;
  }
  return null;
 });
 assert.ok(blank);
 await page.mouse.click(blank.x,blank.y);await waitPinned(null);
 await page.mouse.click(firstPoint.x,firstPoint.y);await waitPinned(first.deviceId);
 await page.keyboard.press('Escape');await waitPinned(null);
 await page.evaluate(()=>{window.qaPointerReleases=0;document.addEventListener('pointerup',()=>window.qaPointerReleases++);});
 await page.mouse.move(firstPoint.x,firstPoint.y);await page.mouse.down();
 await page.mouse.move(firstPoint.x+36,firstPoint.y+4,{steps:6});await page.mouse.up();
 await waitPinned(null);assert.ok(await page.evaluate(()=>window.qaPointerReleases>0));
 const afterDrag=await page.evaluate(()=>window.task3Diagnostics.deviceMarkers.find(marker=>marker.visible));
 const moved=pointerPosition(afterDrag);
 await show(afterDrag);await page.mouse.click(moved.x,moved.y);await waitPinned(afterDrag.deviceId);
 const viewBefore=await page.evaluate(()=>window.task3Diagnostics.cameraPosition);
 await pin.getByRole('button',{name:'定位设备'}).click();
 await page.waitForFunction(previous=>JSON.stringify(window.task3Diagnostics.cameraPosition)!==JSON.stringify(previous),viewBefore);
 await waitPinned(afterDrag.deviceId);
 await page.screenshot({path:'artifacts/task3/device-pinned-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>{const card=document.querySelector('#task3-device-info').getBoundingClientRect();return card.right<=innerWidth&&card.bottom<=innerHeight&&card.left>=0&&card.top>=0;});
 assert.equal(await pin.locator('dl').evaluate(element=>getComputedStyle(element).overflowY),'auto');
 const cardBody=await pin.locator('dl').boundingBox();
 await page.mouse.move(cardBody.x+20,cardBody.y+20);await page.mouse.wheel(0,140);
 await waitPinned(afterDrag.deviceId);
 await page.screenshot({path:'artifacts/task3/device-pinned-390x844.png'});
 await pin.getByRole('button',{name:'关闭设备信息'}).click();await waitPinned(null);
 assert.deepEqual(errors,[]);
 console.log(`任务三设备卡通过：${diag.deviceMarkers.length} 台设备对照报告核验了字段，并验证悬停、固定切换、拖动、定位和小屏关闭。`);
}finally{await browser.close();}
