import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';

const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/task3',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:60000});
 await page.locator('#toggle-task3').click();await page.locator('#task3-open-input').click();await page.locator('#task3-run').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});
 await page.locator('#task3-window-input .task3-floating-close').click();
 const downloadEvent=page.waitForEvent('download');await page.locator('#task3-export').evaluate(button=>button.click());const download=await downloadEvent;
 const exported=JSON.parse(await readFile(await download.path(),'utf8')),report=exported.report,plan=report.plans.find(item=>item.id===exported.activePlanId);
 const diag=await page.evaluate(()=>window.task3Diagnostics),viewport=await page.locator('#viewport').boundingBox();
 assert.equal(diag.deviceMarkers.length,plan.devices.length);assert.ok(diag.deviceMarkers.every(marker=>marker.visible),'全部固定设备应位于当前地图视口');
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
 await page.locator('#task3-back').evaluate(button=>button.click());await page.waitForFunction(()=>document.querySelector('#task3-device-hover').hidden);
 await page.locator('#toggle-task3').click();const reopened=await page.evaluate(()=>window.task3Diagnostics);await show(reopened.deviceMarkers[0]);
 await page.locator('#task3-run').evaluate(button=>button.click());await page.waitForFunction(()=>window.task3Diagnostics.busy&&document.querySelector('#task3-device-hover').hidden);
 await page.locator('#task3-cancel').evaluate(button=>button.click());await page.waitForFunction(()=>!window.task3Diagnostics.busy);
 assert.deepEqual(errors,[]);
 console.log(`Task3 hover browser passed: ${diag.deviceMarkers.length} fixed devices picked and checked against real report; viewport clamp, pointer-events, condition/plan/return/rerun cleanup verified.`);
}finally{await browser.close();}
