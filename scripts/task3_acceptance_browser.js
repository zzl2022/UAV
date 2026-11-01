import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';

const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const out='artifacts/task3';await mkdir(out,{recursive:true});
const distanceText=value=>value===0?'0（同点部署）':value<1?value.toFixed(2):value.toFixed(1);
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:60000});
 await page.locator('#toggle-task3').click();
 assert.equal(await page.locator('#task3-panel > details').evaluateAll(nodes=>nodes.every(node=>!node.open)),true,'侧边栏模块应默认折叠');
 assert.equal(await page.locator('.task3-floating-window:visible').count(),0,'四个浮窗应默认关闭');
 await page.screenshot({path:`${out}/acceptance-default-collapsed.png`});

 const assertInside=async id=>{
  const root=await page.locator(id).boundingBox(),layer=await page.locator('#task3-floating-layer').boundingBox();
  assert.ok(root.x>=layer.x-1&&root.y>=layer.y-1&&root.x+root.width<=layer.x+layer.width+1&&root.y+root.height<=layer.y+layer.height+1,`${id} 必须限制在地图视口内`);
 };
 const windows=[['input','task3-open-input','task3-window-input'],['pipeline','task3-open-pipeline','task3-window-pipeline'],['plans','task3-open-plans','task3-window-plans'],['emc','task3-open-emc','task3-window-emc']];
 for(const [key,trigger,id] of windows){
  await page.locator(`#${trigger}`).click();assert.equal(await page.locator(`#${id}`).isVisible(),true);assert.equal(await page.locator(`#${trigger}`).getAttribute('aria-expanded'),'true');
  const before=await page.locator(`#${id}`).boundingBox(),header=await page.locator(`#${id} .task3-floating-header`).boundingBox();
  await page.mouse.move(header.x+70,header.y+header.height/2);await page.mouse.down();await page.mouse.move(header.x-70,header.y+header.height/2-20,{steps:5});await page.mouse.up();
  const moved=await page.locator(`#${id}`).boundingBox();assert.ok(Math.abs(moved.x-before.x)>50&&Math.abs(moved.y-before.y)>5,`${key} 标题栏拖拽未生效`);await assertInside(`#${id}`);
  const handle=await page.locator(`#${id} [data-resize="se"]`).boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+45,handle.y+handle.height/2+30,{steps:5});await page.mouse.up();
  const resized=await page.locator(`#${id}`).boundingBox();assert.ok(resized.width>moved.width+20&&resized.height>moved.height+10,`${key} 角缩放未生效`);await assertInside(`#${id}`);
  await page.screenshot({path:`${out}/acceptance-${key}-window.png`});
  await page.locator(`#${id} .task3-floating-close`).click();assert.equal(await page.locator(`#${id}`).isHidden(),true);assert.equal(await page.locator(`#${trigger}`).getAttribute('aria-expanded'),'false');
 }
 await page.setViewportSize({width:390,height:844});
 for(const [key,trigger,id] of windows){await page.locator(`#${trigger}`).click();await assertInside(`#${id}`);if(key==='input')await page.screenshot({path:`${out}/acceptance-small-viewport.png`});await page.locator(`#${id} .task3-floating-close`).click();}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'小视口不得产生横向溢出');
 await page.setViewportSize({width:1500,height:1000});

 const exportReport=async path=>{const pending=page.waitForEvent('download');await page.locator('#task3-export').click();const download=await pending;await download.saveAs(path);return JSON.parse(await readFile(path,'utf8'));};
 const run=async()=>{await page.locator('#task3-run').click();await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});};
 await page.locator('#task3-open-input').click();
 assert.equal(await page.locator('#task3-scope-width').inputValue(),'2400');assert.equal(await page.locator('#task3-scope-depth').inputValue(),'2400');
 await run();await page.locator('#task3-window-input .task3-floating-close').click();await page.locator('#task3-panel .task3-io summary').click();
 const defaultExport=await exportReport(`${out}/acceptance-default-report.json`),defaultReport=defaultExport.report,defaultPlan=defaultReport.plans.find(item=>item.id===defaultExport.activePlanId);
 assert.equal(defaultReport.settings.scope,'core');assert.equal(defaultReport.scope.widthM,2400);assert.equal(defaultReport.scope.depthM,2400);assert.equal(defaultReport.scope.clipped,false);
 assert.match(await page.locator('#task3-scope-status').textContent(),/本次范围：东西 2400 m × 南北 2400 m/);
 await page.locator('#task3-open-plans').click();await page.locator('#task3-window-plans details summary').click();
 const names=await page.locator('#task3-device-list tbody tr td:first-child').allTextContents();
 assert.deepEqual(names,defaultPlan.devices.map((_,index)=>`设备-${index+1}`));assert.deepEqual(names,defaultExport.deviceDisplay.map(entry=>entry.displayName));
 await page.screenshot({path:`${out}/acceptance-chinese-numbering.png`});
 const emc=defaultReport.emc[defaultPlan.id];assert.equal(emc.counts.fail,0,'默认推荐方案必须 0 严重冲突');assert.ok(emc.conflicts.length>0,'需要真实冲突行核验距离显示');
 await page.locator('#task3-window-plans .task3-floating-close').click();await page.locator('#task3-open-emc').click();assert.match(await page.locator('#task3-emc .task3-emc-banner').textContent(),/严重 0/);
 const rows=page.locator('#task3-emc tbody tr');assert.equal(await rows.count(),Math.min(50,emc.conflicts.length));
 for(const [index,conflict] of emc.conflicts.slice(0,50).entries()){
  const cells=await rows.nth(index).locator('td').allTextContents(),displayA=defaultExport.deviceDisplay.find(entry=>entry.internalId===conflict.a).displayName,displayB=defaultExport.deviceDisplay.find(entry=>entry.internalId===conflict.b).displayName;
  assert.equal(cells[0],`${displayA} ↔ ${displayB}`);assert.equal(cells[3],distanceText(conflict.distanceM));
 }
 await page.screenshot({path:`${out}/acceptance-emc-distances.png`});
 await page.locator('#task3-window-emc .task3-floating-close').click();await page.locator('#task3-open-plans').click();await page.locator('#task3-plan').selectOption('economy');
 const economy=defaultReport.emc.economy,nonZero=economy.conflicts.filter(conflict=>!conflict.coLocated&&conflict.distanceM>0);assert.ok(nonZero.length>0,'需核验非共址距离未被错误显示为 0');
 await page.locator('#task3-window-plans .task3-floating-close').click();await page.locator('#task3-open-emc').click();
 const economyRows=page.locator('#task3-emc tbody tr');
 for(const [index,conflict] of economy.conflicts.entries())assert.equal((await economyRows.nth(index).locator('td').allTextContents())[3],distanceText(conflict.distanceM));
 await page.screenshot({path:`${out}/acceptance-emc-nonzero-distance.png`});
 await page.locator('#task3-window-emc .task3-floating-close').click();

 await page.locator('#task3-open-input').click();await page.locator('#task3-scope-width').fill('10000');await page.locator('#task3-scope-depth').fill('10000');await page.locator('#task3-spacing').selectOption('700');await run();await page.locator('#task3-window-input .task3-floating-close').click();
 const clippedExport=await exportReport(`${out}/acceptance-clipped-report.json`),clipped=clippedExport.report.scope;
 assert.equal(clippedExport.report.settings.scope,'custom');assert.equal(clippedExport.report.settings.scopeWidthM,10000);assert.equal(clippedExport.report.settings.scopeDepthM,10000);assert.equal(clipped.clipped,true);assert.match(clipped.note,/DEM 数据裁切/);
 const effectiveWidth=clipped.effectiveBounds.east-clipped.effectiveBounds.west,effectiveDepth=clipped.effectiveBounds.north-clipped.effectiveBounds.south;
 assert.ok(effectiveWidth<10000&&effectiveDepth<10000);assert.match(await page.locator('#task3-scope-status').textContent(),/已按有效区域裁切.*不外推覆盖/);
 await page.locator('#task3-open-input').click();await page.screenshot({path:`${out}/acceptance-scope-clipped.png`});
 assert.deepEqual(errors,[]);
 const distances=emc.conflicts.map(conflict=>conflict.distanceM);
 console.log(JSON.stringify({windows:'4/4 拖拽、东南角缩放、关闭通过；小视口 390×844 通过',default:{scope:'2400×2400 m',devices:defaultPlan.devices.length,chineseNames:`${names[0]}…${names.at(-1)}`,emc:emc.counts,distanceM:{min:Math.min(...distances),max:Math.max(...distances),rowsChecked:Math.min(50,emc.conflicts.length),coLocatedZeroes:distances.filter(value=>value===0).length,nonColocatedChecked:nonZero.map(value=>value.distanceM)}},clipped:{requested:'10000×10000 m',effective:`${effectiveWidth.toFixed(3)}×${effectiveDepth.toFixed(3)} m`,samples:clippedExport.report.sampling.samples.length,note:clipped.note},screenshots:['acceptance-default-collapsed.png','acceptance-input-window.png','acceptance-pipeline-window.png','acceptance-plans-window.png','acceptance-emc-window.png','acceptance-small-viewport.png','acceptance-chinese-numbering.png','acceptance-emc-distances.png','acceptance-emc-nonzero-distance.png','acceptance-scope-clipped.png'].map(name=>`${out}/${name}`)},null,2));
}finally{await browser.close();}
