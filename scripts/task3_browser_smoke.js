// 任务三面板端到端冒烟：真实数据下一键推演 → 方案择优 → 盲区分类 → 威胁回放 → EMC 结论 → 导出。
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium'),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/task3',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker,workers=new Map(),posts=[],held=new Map(),heldRequestIds=new Set();window.__task3BrowserPipeline={workers,posts,held,heldRequestIds};
  window.Worker=class extends NativeWorker{
   postMessage(message){
    if(message?.type==='pipeline'){
     const control=window.__task3BrowserPipeline;control.posts.push({requestId:message.requestId,settings:structuredClone(message.settings),weights:structuredClone(message.weights),presetIds:[...message.presetIds],equipmentSnapshot:structuredClone(message.equipmentSnapshot),environment:structuredClone(message.environment),target:structuredClone(message.target)});control.workers.set(message.requestId,this);
     if(control.heldRequestIds.has(message.requestId)){control.held.set(message.requestId,{worker:this,message:structuredClone(message)});return;}
    }
    return super.postMessage(message);
   }
  };
  window.__task3InjectPipeline=(requestId,data)=>{const worker=window.__task3BrowserPipeline.workers.get(requestId);if(!worker)return false;worker.dispatchEvent(new MessageEvent('message',{data}));return true;};
  window.__task3ReleasePipeline=requestId=>{const control=window.__task3BrowserPipeline,pending=control.held.get(requestId);if(!pending)return false;control.held.delete(requestId);control.heldRequestIds.delete(requestId);NativeWorker.prototype.postMessage.call(pending.worker,pending.message);return true;};
 });
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:60000});
 const openModule=async selector=>{
  for(const id of ['#task3-window-close','#city-window-close','#equipment-back']){const close=page.locator(id);if(await close.isVisible())await close.click();}
  await page.locator(selector).click();
 };
 // 唯一窗口入口初始关闭；自定义数值间距进入首轮完整推演。
 assert.equal(await page.locator('#task3-window').isVisible(),false);
 await openModule('#toggle-task3');
 assert.equal(await page.locator('#task3-panel').isVisible(),true);
 await page.locator('#task3-open-input').click();
 assert.equal(await page.locator('#task3-equipment input[type=checkbox]').count(),0);assert.equal(await page.locator('#task3-equipment .task3-equip').count(),4);
 assert.equal(await page.locator('#task3-spacing').getAttribute('type'),'number');
 assert.equal(await page.locator('#task3-spacing').inputValue(),'500');
 assert.equal(await page.locator('#task3-spacing option').count(),0);
 await page.locator('#task3-spacing').fill('425');
 await page.locator('#task3-run').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});
 const diag=await page.evaluate(()=>window.task3Diagnostics),initialSettings=structuredClone(diag.inputSummary.settings);
 assert.equal(diag.inputSummary.settings.spacing,425);assert.equal(diag.reportRequestId,diag.requestId);assert.deepEqual(diag.inputSummary.presetIds,['radar-02c','optical-nvt','radio-tdoa','acoustic-cry']);
 // ≥3 套差异化方案并自动择优
 assert.equal(diag.plans.length,3);
 assert.ok(new Set(diag.plans.map(p=>p.devices)).size>=2,'方案设备数应有差异');
 assert.ok(diag.recommendedId&&diag.plans.some(p=>p.id===diag.recommendedId));
 // 四类盲区排查结果
 assert.ok(diag.blindStats&&typeof diag.blindStats.byCategory.gap==='number'&&typeof diag.blindStats.byCategory.shadow==='number');
 // 三威胁场景均有推演结果
 await page.locator('#task3-panel > details').filter({hasText:'威胁推演'}).locator(':scope > summary').click();
 for(const key of ['single','multi','swarm']){await page.locator('#task3-threat').selectOption(key);const s=await page.evaluate(()=>window.task3Diagnostics.threatSummary);assert.ok(s&&s.targetCount>0,`${key} 应有推演结果`);}
 await page.locator('#task3-threat').selectOption('swarm');
 const swarm=await page.evaluate(()=>window.task3Diagnostics.threatSummary);assert.equal(swarm.targetCount,42);assert.ok(swarm.overflowEvents>0,'蜂群应如实产生容量溢出');
 // EMC 结论
 assert.ok(['pass','degraded','fail'].includes(diag.emcVerdict));
 // 威胁推演播放/暂停/拖动
 await page.locator('#task3-threat-play').click();
 await page.waitForFunction(()=>window.task3Diagnostics.playing&&window.task3Diagnostics.frameIndex>2,null,{timeout:30000});
 await page.locator('#task3-threat-play').click();assert.equal(await page.evaluate(()=>window.task3Diagnostics.playing),false);
 await page.locator('#task3-threat-seek').evaluate(input=>{input.value='500';input.dispatchEvent(new Event('input',{bubbles:true}));});
 // 盲区类别筛选开关
 await page.locator('#task3-panel details').filter({hasText:'盲区分布'}).locator('summary').click();
 await page.locator('#task3-blind-legend input[data-category="gap"]').uncheck();
 await page.locator('#task3-blind-legend input[data-category="gap"]').check();
 // 方案切换
 await page.locator('#task3-window-input .task3-floating-close').click();await page.locator('#task3-open-plans').click();
 const other=diag.plans.find(p=>p.id!==diag.recommendedId).id;
 await page.locator('#task3-plan').selectOption(other);
 assert.equal(await page.evaluate(()=>window.task3Diagnostics.planId),other);
 // 导出报告与过程数据
 await page.locator('#task3-panel .task3-io summary').click();
 let dl=page.waitForEvent('download');await page.locator('#task3-export').click();await (await dl).saveAs('artifacts/task3/browser-report.json');
 const exported=JSON.parse(await readFile('artifacts/task3/browser-report.json','utf8'));
 assert.equal(exported.report.plans.length,3);assert.ok(exported.report.threats.swarm.frames.length>0);
 assert.equal(exported.report.settings.spacing,425);assert.equal(exported.report.requestId,diag.reportRequestId);
 dl=page.waitForEvent('download');await page.locator('#task3-export-run').click();await (await dl).saveAs('artifacts/task3/browser-run.json');
 const run=JSON.parse(await readFile('artifacts/task3/browser-run.json','utf8'));assert.equal(run.schema,'task3-run/1.0');assert.ok(run.rulesInput.candidateStats.length>0);assert.equal(run.settings.spacing,425);assert.equal(run.requestId,diag.reportRequestId);
 // 截图存档（用户验证用）
 await page.locator('#task3-plan').selectOption(diag.recommendedId);
 await page.locator('#task3-panel').evaluate(n=>n.scrollTop=0);await page.screenshot({path:'artifacts/task3/panel-plans.png'});
 await page.locator('#task3-blind-legend').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/task3/blindspots.png'});
 await page.locator('#task3-window-plans .task3-floating-close').click();
 await page.locator('#task3-open-emc').click();await page.locator('#task3-emc').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/task3/emc.png'});
 await page.locator('#task3-window-emc .task3-floating-close').click();
 // 取消进行中推演
 await page.locator('#task3-open-input').click();await page.locator('#task3-run').click();await page.waitForFunction(()=>window.task3Diagnostics.busy);await page.locator('#task3-cancel').click();assert.equal(await page.evaluate(()=>window.task3Diagnostics.busy),false);
 const diagnostics=()=>page.evaluate(()=>window.task3Diagnostics),posts=()=>page.evaluate(()=>window.__task3BrowserPipeline.posts),profile=(snapshot,id)=>snapshot.profiles.find(item=>item.presetId===id);
 const closeFloating=async()=>{for(const id of ['input','pipeline','plans','emc']){const close=page.locator(`#task3-window-${id} .task3-floating-close`);if(await close.isVisible())await close.click();}};
 const waitAuto=async(before,reason)=>{
  await page.waitForFunction(({before,reason})=>{const d=window.task3Diagnostics;return d.requestId>before&&d.reportRequestId===d.requestId&&d.lastSuccessfulRequestId===d.requestId&&!d.busy&&!d.autoUpdatePending&&!d.staleResult&&!d.lastError&&d.updateReason===reason;},{before,reason},{timeout:300000});
  return diagnostics();
 };
 await closeFloating();
 // 装备型号选择无需保存即发布完整快照，优化推演只读同步并自动计算。
 await openModule('#toggle-sensors');const beforeSelection=(await diagnostics()).requestId;
 await page.getByRole('button',{name:'选择无线电型号',exact:true}).click();await page.locator('#equipment-model-menu [data-preset-id=radio-x1c]').click();
 const selectionDiag=await waitAuto(beforeSelection,'装备选型/参数自动更新');assert.ok(selectionDiag.inputSummary.presetIds.includes('radio-x1c'));assert.ok(!selectionDiag.inputSummary.presetIds.includes('radio-tdoa'));assert.ok(selectionDiag.lastEquipmentSnapshot.selectedPresetIds.includes('radio-x1c'));
 await page.locator('#equipment-tab-radar').click();
 // 未保存草稿和非法保存不发布；有效保存自动完成整套推演，导出设备确实采用新参数。
 const beforeSave=await diagnostics(),beforeSavePosts=(await posts()).length,rangeInput=page.locator('#profile-parameters-maxRange');
 await rangeInput.fill('8123');await page.waitForTimeout(200);assert.equal((await diagnostics()).requestId,beforeSave.requestId);assert.equal((await posts()).length,beforeSavePosts);
 await rangeInput.fill('-1');await page.locator('#equipment-profile-save').click();assert.match(await page.locator('#equipment-profile-message').innerText(),/标称距离上限/);await page.waitForTimeout(200);assert.equal((await diagnostics()).requestId,beforeSave.requestId);assert.equal((await posts()).length,beforeSavePosts);
 await rangeInput.fill('8123');await page.locator('#equipment-profile-save').click();const saveDiag=await waitAuto(beforeSave.requestId,'装备选型/参数自动更新');
 assert.equal(saveDiag.requestId,beforeSave.requestId+1);assert.equal((await posts()).length,beforeSavePosts+1);assert.equal(profile(saveDiag.lastEquipmentSnapshot,'radar-02c').parameters.maxRange,8123);assert.equal(saveDiag.inputSummary.settings.spacing,425);
 await openModule('#toggle-task3');let saveDownload=page.waitForEvent('download');await page.locator('#task3-export').click();await (await saveDownload).saveAs('artifacts/task3/browser-equipment-report.json');
 const equipmentReport=JSON.parse(await readFile('artifacts/task3/browser-equipment-report.json','utf8')),savedRadars=equipmentReport.report.plans.flatMap(item=>item.devices).filter(device=>device.presetId==='radar-02c');
 assert.equal(equipmentReport.report.requestId,saveDiag.requestId);assert.equal(profile(equipmentReport.report.equipmentSnapshot,'radar-02c').parameters.maxRange,8123);assert.ok(savedRadars.length>0);assert.ok(savedRadars.every(device=>device.parameters.maxRange===8123));
 // 一次批量导入两个型号只产生一个合并请求。
 const batch={schema:'equipment-catalog/1',profiles:['radar-02c','optical-nvt'].map(id=>structuredClone(profile(saveDiag.lastEquipmentSnapshot,id)))};batch.profiles[0].parameters.maxRange=8234;batch.profiles[1].parameters.maxRange=2345;
 await openModule('#toggle-sensors');const beforeImport=(await posts()).length;
 await page.locator('#equipment-profile-file').setInputFiles({name:'task3-batch.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(batch))});await page.waitForFunction(()=>document.querySelector('#equipment-profile-message').textContent==='已导入');
 const importDiag=await waitAuto(saveDiag.requestId,'装备选型/参数自动更新');assert.equal(importDiag.requestId,saveDiag.requestId+1);assert.equal((await posts()).length,beforeImport+1);assert.equal(profile(importDiag.lastEquipmentSnapshot,'radar-02c').parameters.maxRange,8234);assert.equal(profile(importDiag.lastEquipmentSnapshot,'optical-nvt').parameters.maxRange,2345);
 // 城市草稿和非法应用不发布；成功应用环境后自动完整更新。
 await openModule('#open-city-model');await page.locator('#city-tab-environment').click();const rainInput=page.locator('#city-environment-rainMmH'),beforeEnvironment=importDiag.requestId,beforeEnvironmentPosts=(await posts()).length;
 await rainInput.fill('7');await page.waitForTimeout(200);assert.equal((await diagnostics()).requestId,beforeEnvironment);assert.equal((await posts()).length,beforeEnvironmentPosts);
 await rainInput.fill('-1');await page.locator('#city-environment-apply').click();assert.match(await page.locator('#city-environment-message').innerText(),/降雨强度/);await page.waitForTimeout(200);assert.equal((await diagnostics()).requestId,beforeEnvironment);assert.equal((await posts()).length,beforeEnvironmentPosts);
 await rainInput.fill('7');await page.locator('#city-environment-apply').click();const environmentDiag=await waitAuto(beforeEnvironment,'城市目标/环境应用自动更新');assert.equal(environmentDiag.requestId,beforeEnvironment+1);assert.equal(environmentDiag.inputSummary.environment.rainMmH,7);assert.equal(environmentDiag.inputSummary.target.speed,10);
 // 暂停连续两个请求，向最新 Worker 注入旧进度/报告/错误；只有最新真实结果可以生效。
 const oldId=environmentDiag.requestId+1,latestId=oldId+1;await page.evaluate(ids=>{for(const id of ids)window.__task3BrowserPipeline.heldRequestIds.add(id);},[oldId,latestId]);
 await page.locator('#city-window-close').click();await openModule('#toggle-sensors');await rangeInput.fill('8345');await page.locator('#equipment-profile-save').click();await page.waitForFunction(id=>window.task3Diagnostics.requestId===id&&window.task3Diagnostics.busy&&window.__task3BrowserPipeline.held.has(id),oldId);
 await openModule('#open-city-model');await page.locator('#city-tab-target').click();await page.locator('#city-target-speed').fill('17');await page.locator('#city-target-apply').click();await page.waitForFunction(id=>window.task3Diagnostics.requestId===id&&window.task3Diagnostics.busy&&window.__task3BrowserPipeline.held.has(id),latestId);
 const race=await page.evaluate(({oldId,latestId})=>{
  const read=()=>({requestId:window.task3Diagnostics.requestId,reportRequestId:window.task3Diagnostics.reportRequestId,busy:window.task3Diagnostics.busy,staleResult:window.task3Diagnostics.staleResult,lastError:window.task3Diagnostics.lastError,status:document.querySelector('#task3-status').textContent,progress:document.querySelector('#task3-progress').value}),before=read();
  const injected=[
   window.__task3InjectPipeline(latestId,{type:'progress',requestId:oldId,value:{stage:'coverage',completed:999,total:999}}),
   window.__task3InjectPipeline(latestId,{type:'report',requestId:oldId,report:{requestId:oldId},run:{}}),
   window.__task3InjectPipeline(latestId,{type:'error',operation:'pipeline',requestId:oldId,message:'旧请求错误不得覆盖'}),
  ];return {before,after:read(),injected};
 },{oldId,latestId});
 assert.ok(race.injected.every(Boolean));assert.deepEqual(race.after,race.before);assert.equal(race.after.reportRequestId,environmentDiag.requestId);
 assert.equal(await page.evaluate(id=>window.__task3ReleasePipeline(id),latestId),true);const latestDiag=await waitAuto(oldId,'城市目标/环境应用自动更新');assert.equal(latestDiag.requestId,latestId);assert.equal(latestDiag.reportRequestId,latestId);assert.equal(latestDiag.inputSummary.target.speed,17);assert.equal(latestDiag.inputSummary.environment.rainMmH,7);assert.equal(profile(latestDiag.lastEquipmentSnapshot,'radar-02c').parameters.maxRange,8345);
 // 当前自动请求失败会保留旧报告并明确标 stale；旧成功 requestId 不会被伪造推进。
 const failureId=latestId+1;await page.evaluate(id=>window.__task3BrowserPipeline.heldRequestIds.add(id),failureId);await page.locator('#city-window-close').click();await openModule('#toggle-sensors');await rangeInput.fill('8456');await page.locator('#equipment-profile-save').click();await page.waitForFunction(id=>window.task3Diagnostics.requestId===id&&window.task3Diagnostics.busy&&window.__task3BrowserPipeline.held.has(id),failureId);
 assert.equal(await page.evaluate(id=>window.__task3InjectPipeline(id,{type:'error',operation:'pipeline',requestId:id,message:'浏览器注入的自动更新失败'}),failureId),true);await page.waitForFunction(()=>!window.task3Diagnostics.busy&&window.task3Diagnostics.lastError==='浏览器注入的自动更新失败');
 const failureDiag=await diagnostics();assert.equal(failureDiag.reportRequestId,latestId);assert.equal(failureDiag.lastSuccessfulRequestId,latestId);assert.equal(failureDiag.staleResult,true);assert.equal(failureDiag.updateReason,'装备选型/参数自动更新');
 await openModule('#toggle-task3');if(!await page.locator('#task3-window-input').isVisible())await page.locator('#task3-open-input').click();assert.equal(await page.locator('#task3-result-freshness').isVisible(),true);assert.match(await page.locator('#task3-status').innerText(),/装备选型\/参数自动更新失败：浏览器注入的自动更新失败.*已保留上一轮成功结果/);assert.equal(await page.locator('#task3-status').getAttribute('data-tone'),'error');await page.screenshot({path:'artifacts/task3/live-optimization-stale.png'});
 // 空值、非数值及越界间距均同步阻止，不发 Worker，且继续保留并标记上一轮结果。
 const invalid=[];
 for(const [label,action] of [
  ['149',()=>page.locator('#task3-spacing').fill('149')],
  ['空值',()=>page.locator('#task3-spacing').fill('')],
  ['1001',()=>page.locator('#task3-spacing').fill('1001')],
  ['非数值',async()=>{const input=page.locator('#task3-spacing');await input.focus();await page.keyboard.press('Control+A');await page.keyboard.type('1e');assert.equal(await input.evaluate(element=>element.validity.badInput),true);}],
 ]){
  const before=await diagnostics(),beforePosts=(await posts()).length;await action();await page.locator('#task3-run').click();await page.waitForFunction(id=>window.task3Diagnostics.requestId===id&&!window.task3Diagnostics.busy&&/网格间距/.test(window.task3Diagnostics.lastError??''),before.requestId+1);
  const current=await diagnostics();assert.equal(current.reportRequestId,latestId);assert.equal(current.lastSuccessfulRequestId,latestId);assert.equal(current.staleResult,true);assert.equal((await posts()).length,beforePosts);assert.equal(await page.locator('#task3-spacing').getAttribute('aria-invalid'),'true');assert.equal(await page.locator('#task3-result-freshness').isVisible(),true);assert.equal(await page.locator('#task3-status').getAttribute('data-tone'),'error');invalid.push({label,requestId:current.requestId,lastError:current.lastError});
 }
 const allPosts=await posts();for(const post of allPosts)assert.deepEqual(post.settings,initialSettings,'自动与手动推演必须保留同一组范围、间距、预算和设备上限设置');
 const evidence={initialRequestId:diag.requestId,equipmentSaveRequestId:saveDiag.requestId,batchImportRequestId:importDiag.requestId,environmentRequestId:environmentDiag.requestId,supersededRequestId:oldId,latestRequestId:latestId,failedRequestId:failureId,invalid,race,posts:allPosts.map(post=>({requestId:post.requestId,spacing:post.settings.spacing,radarRange:profile(post.equipmentSnapshot,'radar-02c').parameters.maxRange,opticalRange:profile(post.equipmentSnapshot,'optical-nvt').parameters.maxRange,rainMmH:post.environment.rainMmH,targetSpeed:post.target.speed,presetIds:post.presetIds,weights:post.weights}))};
 await writeFile('artifacts/task3/live-optimization-evidence.json',JSON.stringify(evidence,null,2));await closeFloating();
 // 小规模自定义蜂群：配置进入最新任务三快照，地图与航迹共用四旋翼。
 await page.locator('#task3-open-input').click();await page.locator('#task3-spacing').fill('425');await page.locator('#task3-window-input .task3-floating-close').click();
 const beforeThreat=(await diagnostics()).requestId;
 await page.evaluate(()=>{
  const values={'task3-threat-count':'6','task3-threat-azimuths':'0,120,240','task3-threat-agl':'35,55','task3-threat-speed':'18'};
  for(const [id,value] of Object.entries(values)){const input=document.querySelector('#'+id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
  document.querySelector('#task3-threat-speed').dispatchEvent(new Event('change',{bubbles:true}));
 });
 const threatDiag=await waitAuto(beforeThreat,'威胁场景配置自动更新');
 assert.equal(threatDiag.threatSummary.targetCount,6);assert.deepEqual(threatDiag.inputSummary.settings.threatConfigs.swarm,{count:6,directions:3,azimuthsDeg:[0,120,240],aglM:[35,55],speedMps:18,simultaneous:true});
 assert.ok(threatDiag.threatDroneShapes.length>0);assert.ok(threatDiag.threatDroneShapes.every(drone=>drone.name==='Quadcopter_Drone'&&drone.rotors===4));
 let alarming=[];
 for(const value of ['250','500','750','1000']){
  await page.locator('#task3-threat-seek').evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},value);
  alarming=await page.evaluate(()=>window.task3Diagnostics.alarmingDeviceIds);if(alarming.length)break;
 }
 assert.ok(alarming.length>0,'自定义蜂群应产生真实报警设备');
 const alarmingId=alarming[0],scale=await page.evaluate(id=>window.task3Diagnostics.deviceMarkers.find(marker=>marker.deviceId===id).scale,alarmingId);
 await page.waitForFunction(({id,scale})=>Math.abs(window.task3Diagnostics.deviceMarkers.find(marker=>marker.deviceId===id).scale-scale)>.05,{id:alarmingId,scale});
 dl=page.waitForEvent('download');await page.locator('#task3-export').click();await (await dl).saveAs('artifacts/task3/browser-custom-swarm-report.json');
 const swarmReport=JSON.parse(await readFile('artifacts/task3/browser-custom-swarm-report.json','utf8'));assert.equal(swarmReport.report.threats.swarm.summary.targetCount,6);assert.deepEqual(swarmReport.report.threats.swarm.config,threatDiag.inputSummary.settings.threatConfigs.swarm);
 await page.screenshot({path:'artifacts/task3/custom-swarm-alarm.png'});
 // 回归：示例航迹与报警记录统一入口仍在且可切换。
 await page.locator('#task3-back').click();assert.equal(await page.locator('#task3-panel').isVisible(),false);
 await openModule('#toggle-task3');await page.locator('#task3-open-flight').click();await page.waitForFunction(()=>window.planningDiagnostics?.ready&&!window.planningDiagnostics.busy,null,{timeout:240000});
 assert.deepEqual(errors,[]);
 console.log(`Task3 browser passed: full pipeline/exports/cancel; equipment/city auto updates; stale race and invalid inputs; persistent task3 data; custom 6-drone swarm, shared quadcopter and alarm pulse; planning entry regression.`);
}finally{await browser.close();}
