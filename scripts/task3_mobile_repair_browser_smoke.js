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
 const exportJson=async id=>{const event=page.waitForEvent('download');await page.locator(id).click();const download=await event;return JSON.parse(await readFile(await download.path(),'utf8'));};
 await page.locator('#task3-panel .task3-io summary').click();
 const baselineExport=await exportJson('#task3-export'),baselineReport=baselineExport.report,baselinePlan=baselineReport.plans.find(p=>p.id===baselineExport.activePlanId);
 let before=await page.evaluate(()=>window.task3Diagnostics);
 if(!before.blindStats.total){
  const ci=baselineReport.conditions.findIndex((condition,index)=>baselineReport.blindspots[before.planId][index].stats.total>0);assert.ok(ci>=0,'至少一个工况应有盲点供浏览器验证');
  await page.locator('#task3-condition').selectOption(baselineReport.conditions[ci].id);before=await page.evaluate(()=>window.task3Diagnostics);
 }
 await page.locator('#task3-panel details').filter({hasText:'盲区分布'}).locator('summary').click();
 await page.locator('#task3-mobile-repair').scrollIntoViewIfNeeded();await page.locator('#task3-mobile-repair').check();
 await page.waitForFunction(()=>window.task3Diagnostics?.mobileRepair||document.querySelector('#task3-mobile-status')?.dataset.tone==='error',null,{timeout:300000});
 const after=await page.evaluate(()=>window.task3Diagnostics),status=await page.locator('#task3-mobile-status').textContent();assert.ok(after.mobileRepair,status);
 const summary=after.mobileRepair;assert.ok(summary.addedDeviceCount>0,JSON.stringify({status,summary}));assert.ok(after.blindStats.total<before.blindStats.total,`盲点未减少：${before.blindStats.total} -> ${after.blindStats.total}`);
 assert.equal(after.deviceMarkers.length,before.deviceMarkers.length+summary.addedDeviceCount);assert.equal(after.deviceMarkers.filter(marker=>marker.isMobile).length,summary.addedDeviceCount);assert.ok(after.deviceMarkers.filter(marker=>marker.isMobile).every(marker=>marker.deployment==='police-car'));
 assert.equal(summary.emc.newFailCount,0);assert.equal(after.emcCounts.fail,before.emcCounts.fail);
 const derivedExport=await exportJson('#task3-export'),derivedReport=derivedExport.report,derivedPlan=derivedReport.plans.find(p=>p.id===derivedExport.activePlanId),ci=derivedReport.conditions.findIndex(condition=>condition.id===after.condition);
 const beforePoints=baselineReport.blindspots[before.planId][ci].points,beforeIds=new Set(beforePoints.map(point=>point.sampleId)),afterIds=new Set(derivedReport.blindspots[after.planId][ci].points.map(point=>point.sampleId)),removed=[...beforeIds].filter(id=>!afterIds.has(id));
 assert.deepEqual(new Set(removed),new Set(summary.coveredSampleIds));assert.deepEqual(new Set([...beforeIds].filter(id=>afterIds.has(id))),new Set(summary.remainingSampleIds));
 for(const id of removed){const index=derivedReport.sampling.samples.findIndex(sample=>sample.id===id);assert.ok(derivedPlan.coverage[ci][index]>0,`${id} 必须由新增覆盖真实移除`);}
 for(const id of afterIds){const index=derivedReport.sampling.samples.findIndex(sample=>sample.id===id);assert.equal(derivedPlan.coverage[ci][index],0,`${id} 仍是真实盲点，不得隐藏`);}
 assert.equal(derivedPlan.devices.length,baselinePlan.devices.length+summary.addedDeviceCount);assert.equal(derivedPlan.cost,baselinePlan.cost+summary.addedCost);assert.equal(derivedExport.deviceDisplay.length,derivedPlan.devices.length);assert.deepEqual(derivedExport.deviceDisplay.map(entry=>entry.displayName),derivedPlan.devices.map((device,index)=>`设备-${index+1}`));
 const addedIds=new Set(summary.addedDeviceIds);assert.equal(derivedReport.emc[derivedPlan.id].conflicts.filter(conflict=>conflict.severity==='fail'&&(addedIds.has(conflict.a)||addedIds.has(conflict.b))).length,0);
 for(const device of derivedPlan.devices.filter(device=>addedIds.has(device.id))){assert.ok(device.mobileRepair);assert.equal(device.mobileRepair.mountHeightM,2);assert.equal(device.mobileRepair.mountHeightSource,'模型假设');assert.equal(device.mobileRepair.roadReachabilityVerified,false);}
 for(const [conditionIndex,condition] of derivedReport.conditions.entries()){
  const row=derivedPlan.coverage[conditionIndex],metric=derivedPlan.metrics[conditionIndex];assert.equal(metric.covered,row.filter(count=>count>0).length);assert.equal(metric.condition,condition.id);
  for(const device of derivedPlan.devices){const contribution=derivedPlan.coverageContributions[device.id][conditionIndex];assert.equal(contribution.condition,condition.id);assert.ok(contribution.coveredSamples>=contribution.independentSamples);}
  assert.equal(derivedPlan.devices.reduce((sum,device)=>sum+derivedPlan.coverageContributions[device.id][conditionIndex].independentSamples,0),row.filter(count=>count===1).length);
 }
 const derivedRun=await exportJson('#task3-export-run');assert.equal(derivedRun.mobileRepair.summary.addedDeviceCount,summary.addedDeviceCount);assert.equal(derivedRun.mobileRepair.plan.devices.length,derivedPlan.devices.length);
 const deployActions=derivedRun.mobileRepair.summary.actions.filter(action=>action.action==='deploy-mobile-radar');assert.equal(deployActions.length,summary.addedDeviceCount);assert.deepEqual(new Set(deployActions.flatMap(action=>action.newlyCoveredSampleIds)),new Set(summary.coveredSampleIds));assert.ok(deployActions.every(action=>addedIds.has(action.deviceId)&&action.presetId===summary.radarPresetId));
 assert.match(await page.locator('#task3-threat-summary').textContent(),/威胁结果仍采用原推荐方案，未对移动派生方案重新计算/);
 await page.locator('#task3-open-emc').click();assert.match(await page.locator('#task3-emc').textContent(),/新增 fail 0/);await page.locator('#task3-window-emc .task3-floating-close').click();
 const otherIndex=(ci+1)%derivedReport.conditions.length,otherCondition=derivedReport.conditions[otherIndex];await page.locator('#task3-condition').selectOption(otherCondition.id);
 const switched=await page.evaluate(()=>window.task3Diagnostics);assert.deepEqual(switched.blindStats,derivedReport.blindspots[after.planId][otherIndex].stats);assert.deepEqual(switched.mobileRepair,summary);assert.equal(switched.deviceMarkers.length,after.deviceMarkers.length);assert.equal(switched.emcVerdict,after.emcVerdict);await page.screenshot({path:'artifacts/task3/mobile-repair-condition.png'});
 await page.locator('#task3-condition').selectOption(after.condition);const backToOriginalCondition=await page.evaluate(()=>window.task3Diagnostics);assert.deepEqual(backToOriginalCondition.blindStats,after.blindStats);await page.locator('#task3-mobile-repair').check();assert.equal((await page.evaluate(()=>window.task3Diagnostics)).deviceMarkers.length,after.deviceMarkers.length,'重复勾选不得叠加设备');
 const marker=backToOriginalCondition.deviceMarkers.find(item=>item.isMobile&&item.visible&&item.x>310)??backToOriginalCondition.deviceMarkers.find(item=>item.isMobile&&item.visible);assert.ok(marker,'至少一个移动设备应在当前视口可悬停');
 const viewport=await page.locator('#viewport').boundingBox();await page.mouse.move(viewport.x+marker.x,viewport.y+marker.y);
 await page.waitForFunction(id=>{const card=document.querySelector('#task3-device-hover');return card&&!card.hidden&&card.dataset.deviceId===id;},marker.deviceId,{timeout:10000});
 const hoverText=await page.locator('#task3-device-hover').textContent(),deviceIndex=derivedPlan.devices.findIndex(device=>device.id===marker.deviceId),device=derivedPlan.devices[deviceIndex];
 for(const expected of [`设备-${deviceIndex+1}`,'警车移动部署','挂载高度 2 m','模型假设','未验证道路可达',`当前模型频点 ${device.parameters.frequencyGHz} GHz`,'覆盖贡献','EMC 状态'])assert.ok(hoverText.includes(expected),`悬停缺少 ${expected}`);
 await page.screenshot({path:'artifacts/task3/mobile-repair.png'});
 await page.mouse.move(viewport.x+2,viewport.y+2);await page.locator('#task3-mobile-repair').uncheck();
 await page.waitForFunction(()=>!window.task3Diagnostics.mobileRepair&&!window.task3Diagnostics.busy,null,{timeout:30000});
 const restored=await page.evaluate(()=>window.task3Diagnostics);assert.equal(restored.blindStats.total,before.blindStats.total);assert.deepEqual(restored.blindStats,before.blindStats);assert.equal(restored.deviceMarkers.length,before.deviceMarkers.length);assert.equal(restored.deviceMarkers.filter(marker=>marker.isMobile).length,0);assert.deepEqual(restored.emcCounts,before.emcCounts);
 const restoredExport=await exportJson('#task3-export'),restoredPlan=restoredExport.report.plans.find(p=>p.id===before.planId);assert.deepEqual(restoredPlan,baselinePlan);assert.deepEqual(restoredExport.report.blindspots[before.planId],baselineReport.blindspots[before.planId]);assert.deepEqual(restoredExport.report.emc[before.planId],baselineReport.emc[before.planId]);
 const restoredRun=await exportJson('#task3-export-run');assert.equal(restoredRun.mobileRepair,undefined);assert.doesNotMatch(await page.locator('#task3-threat-summary').textContent(),/未对移动派生方案重新计算/);assert.deepEqual(errors,[]);await page.screenshot({path:'artifacts/task3/mobile-repair-restored.png'});
 console.log(JSON.stringify({before:{blindspots:before.blindStats.total,devices:before.deviceMarkers.length,emc:before.emcCounts},after:{blindspots:after.blindStats.total,devices:after.deviceMarkers.length,added:summary.addedDeviceCount,covered:summary.coveredSampleIds.length,remaining:summary.remainingSampleIds.length,emc:after.emcCounts,status:summary.status},conditionSwitch:{condition:otherCondition.id,blindspots:switched.blindStats.total,devices:switched.deviceMarkers.length},restored:{blindspots:restored.blindStats.total,devices:restored.deviceMarkers.length,emc:restored.emcCounts},screenshots:['artifacts/task3/mobile-repair.png','artifacts/task3/mobile-repair-condition.png','artifacts/task3/mobile-repair-restored.png']},null,2));
}finally{await browser.close();}
