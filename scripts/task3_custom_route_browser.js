import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const root=fileURLToPath(new URL('..',import.meta.url));
const executablePath=process.env.CHROMIUM_PATH||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
 '/usr/bin/chromium',
].find(path=>existsSync(path));
assert.ok(executablePath,'未找到 Chromium/Edge，请设置 CHROMIUM_PATH');
const server=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;
try{
 await server.listen();
 const url=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await mkdir('artifacts/task3',{recursive:true});
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__task3Requests=[];
  window.Worker=new Proxy(NativeWorker,{construct(Target,args){
   const worker=Reflect.construct(Target,args),postMessage=worker.postMessage.bind(worker);
   worker.postMessage=(message,...rest)=>{if(['pipeline','mobile-repair','custom-single-threat'].includes(message?.type))window.__task3Requests.push(structuredClone(message));return postMessage(message,...rest);};
   return worker;
  }});
 });
 await page.goto(`${url}?intro=0&demo=0`,{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:120000});

 const expandMainMenu=async()=>{
  if(await page.locator('#ac8-main-menu').evaluate(node=>node.classList.contains('is-main-collapsed')))await page.locator('#ac8-main-menu-toggle').click();
 };
 const openInput=async()=>{
  await expandMainMenu();
  if(!await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen())){
   await page.locator('#toggle-deployment').click();
   await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isOpen(),null,{timeout:5000});
  }
  if(!await page.evaluate(()=>window.__ac8DeploymentMenu?.isDetail()&&window.__ac8DeploymentMenu?.active()==='input')){
   await page.locator('#ac8-deployment-menu .ac8-hud-tabs button',{hasText:'推演输入'}).click();
   await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isDetail()&&window.__ac8DeploymentMenu?.active()==='input',null,{timeout:5000});
  }
  await page.locator('#task3-panel').waitFor({state:'visible',timeout:10000});
 };
 const openThreat=async()=>{await openInput();await page.locator('#task3-panel [data-sub="threat"]').click();};
 const closeDeployment=async()=>{
  if(await page.evaluate(()=>window.__ac8DeploymentMenu?.isDetail())){await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isDetail(),null,{timeout:5000});}
  if(await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen())){await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isOpen(),null,{timeout:5000});}
 };
 const customState=()=>page.evaluate(()=>window.task3Diagnostics.customEditor);

 await openInput();
 await page.locator('#task3-panel [data-sub="generate"]').click();
 await page.locator('#task3-run-side').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});
 await openThreat();
 await page.locator('#task3-threat').selectOption('single');
 const baseline=await page.evaluate(()=>{
  const report=window.__task3Report,planId=window.task3Diagnostics.planId,byPlan=report.threatsByPlan[planId];
  return {planId,recommendedId:report.recommendedId,singleSummary:structuredClone(byPlan.single.summary),singleRoutes:byPlan.single.routes.map(route=>route.id),multiSummary:structuredClone(byPlan.multi.summary),swarmSummary:structuredClone(byPlan.swarm.summary)};
 });
 assert.equal(baseline.singleSummary.targetCount,8);
 await page.locator('#task3-custom-route').click();
 await page.locator('#task3-custom-editor').waitFor({state:'visible'});
 assert.equal(await page.locator('#task3-custom-editor .task3-custom-hint').textContent(),'右键功能暂时无效，当前左键替代原右键功能');
 assert.equal(await page.locator('#ac8-main-menu').evaluate(node=>node.classList.contains('is-main-collapsed')),true,'进入编辑必须复用主菜单收起机制');
 assert.equal(await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen()),false,'编辑时部署浮层不得挡住地图');
 assert.equal((await customState()).scene,'recon');

 const used=new Set();
 const pickPoint=async expected=>{
  const point=await page.evaluate(()=>{
   const viewport=document.querySelector('#viewport'),canvas=viewport.querySelector('canvas'),rect=viewport.getBoundingClientRect(),width=viewport.clientWidth,height=viewport.clientHeight;
   return {markers:window.task3Diagnostics.deviceMarkers.filter(marker=>marker.visible&&marker.x>320&&marker.x<width-270&&marker.y>70&&marker.y<height-160&&document.elementFromPoint(rect.left+marker.x,rect.top+marker.y)===canvas),existing:window.task3Diagnostics.customEditor.markers};
  });
  const marker=point.markers.find(item=>!used.has(item.deviceId)&&point.existing.every(other=>Math.hypot(item.x-other.x,item.y-other.y)>16));
  assert.ok(marker,`需要可点击的第 ${expected} 个真实模型表面点`);
  used.add(marker.deviceId);const box=await page.locator('#viewport').boundingBox();
  const hitTarget=await page.evaluate(({x,y})=>{const element=document.elementFromPoint(x,y);return {tag:element?.tagName,id:element?.id,class:element?.className};},{x:box.x+marker.x,y:box.y+marker.y});
  await page.mouse.click(box.x+marker.x,box.y+marker.y);
  try{await page.waitForFunction(count=>window.task3Diagnostics.customEditor.waypointCount===count,expected,{timeout:10000});}
  catch(error){console.error('地图拾取失败诊断',JSON.stringify({expected,box,marker,hitTarget,state:await customState(),status:await page.locator('#task3-custom-status').textContent()}));await page.screenshot({path:'artifacts/task3/custom-route-pick-failure.png'});throw error;}
  return {box,marker};
 };
 const first=await pickPoint(1);
 await page.mouse.click(first.box.x+first.marker.x,first.box.y+first.marker.y,{button:'right'});
 assert.equal((await customState()).waypointCount,1,'右键不得加点');
 const drag=await page.evaluate(()=>{const viewport=document.querySelector('#viewport'),canvas=viewport.querySelector('canvas'),rect=viewport.getBoundingClientRect();return window.task3Diagnostics.deviceMarkers.find(marker=>marker.visible&&marker.x>340&&marker.x<1000&&marker.y>100&&marker.y<650&&document.elementFromPoint(rect.left+marker.x,rect.top+marker.y)===canvas);});
 assert.ok(drag);const dragBox=await page.locator('#viewport').boundingBox();
 await page.mouse.move(dragBox.x+drag.x,dragBox.y+drag.y);await page.mouse.down();await page.mouse.move(dragBox.x+drag.x+55,dragBox.y+drag.y+35,{steps:8});await page.mouse.up();
 assert.equal((await customState()).waypointCount,1,'拖动视角不得加点');
 await pickPoint(2);
 assert.equal((await customState()).lineCount,1);assert.equal((await customState()).markers.length,2);
 await page.screenshot({path:'artifacts/task3/custom-route-desktop.png'});
 await page.locator('#task3-custom-clear').click();await page.waitForFunction(()=>window.task3Diagnostics.customEditor.waypointCount===0);
 assert.equal((await customState()).lineCount,0);used.clear();
 await page.locator('#ac8-sim-scenario').selectOption('multi');await page.waitForFunction(()=>!window.task3Diagnostics.customEditor.active&&document.querySelector('#task3-custom-editor').hidden);
 assert.equal((await customState()).waypointCount,0,'主页面切换威胁类型必须清理编辑状态');
 await openThreat();await page.locator('#task3-threat').selectOption('single');await page.locator('#task3-custom-route').click();await page.locator('#task3-custom-editor').waitFor({state:'visible'});
 await pickPoint(1);await pickPoint(2);

 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.querySelector('#viewport').clientWidth===390,null,{timeout:5000});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px 视口不得横向溢出');
 const editorRect=await page.locator('#task3-custom-editor').boundingBox();
 assert.ok(editorRect.x>=0&&editorRect.x+editorRect.width<=390&&editorRect.y>=0&&editorRect.y+editorRect.height<=844,'小视口编辑窄列必须完整位于屏幕内');
 await page.locator('#task3-custom-complete').scrollIntoViewIfNeeded();
 await page.screenshot({path:'artifacts/task3/custom-route-390.png'});
 await page.locator('#task3-custom-complete').click();
 await page.waitForFunction(()=>window.task3Diagnostics.customEditor.appliedCustom&&!window.task3Diagnostics.customEditor.pending,null,{timeout:300000});

 const requests=await page.evaluate(()=>window.__task3Requests);
 assert.equal(requests.filter(request=>request.type==='pipeline').length,1,'自定义计算不得再次启动完整优化');
 assert.equal(requests.filter(request=>request.type==='mobile-repair').length,0,'自定义计算不得混入移动补盲');
 const customRequests=requests.filter(request=>request.type==='custom-single-threat');assert.equal(customRequests.length,1);
 const customRequest=customRequests[0],input=customRequest.input;
 for(const key of ['plan','waypoints','aglM','speedMps','target','environment','core','coreRadius','interval'])assert.ok(key in input,`自定义请求缺少 ${key}`);
 assert.equal(input.plan.id,baseline.planId);assert.equal(input.waypoints.length,2);assert.ok(input.waypoints.every(point=>point.length===3&&point.every(Number.isFinite)));
 const custom=await page.evaluate(planId=>{
  const report=window.__task3Report,single=report.threatsByPlan[planId].single;
  return {single:{custom:single.custom,config:single.config,routeIds:single.routes.map(route=>route.id),routeKind:single.routes[0].kind,frames:single.frames.length,summary:single.summary},recommendedSingleCustom:report.threats.single.custom,multiSummary:report.threatsByPlan[planId].multi.summary,swarmSummary:report.threatsByPlan[planId].swarm.summary};
 },baseline.planId);
 assert.equal(custom.single.custom,true);assert.equal(custom.single.routeKind,'custom');assert.deepEqual(custom.single.routeIds,['single-custom']);assert.ok(custom.single.frames>0);assert.equal(custom.single.summary.targetCount,1);
 assert.deepEqual(custom.single.config.waypoints,input.waypoints.map(point=>[point[0],point[2]]),'UI 三维路点只能以 x/z 参与路线，y 不得覆盖 AGL');
 if(baseline.planId===baseline.recommendedId)assert.equal(custom.recommendedSingleCustom,true,'推荐方案兼容字段必须同步');
 assert.deepEqual(custom.multiSummary,baseline.multiSummary);assert.deepEqual(custom.swarmSummary,baseline.swarmSummary);
 await page.setViewportSize({width:1500,height:1000});

 await page.locator('#ac8-sim-scenario').selectOption('single');await page.locator('#ac8-sim-speed').selectOption('1');
 await page.locator('#ac8-sim-start').click();
 await page.waitForFunction(()=>window.task3Diagnostics.threatPlaying&&window.task3Diagnostics.threatFrameIndex>0&&window.task3Diagnostics.threatTargets[0]?.id==='single-custom',null,{timeout:30000});
 await page.locator('#ac8-sim-start').click();await page.waitForFunction(()=>!window.task3Diagnostics.threatPlaying);
 const played=await page.evaluate(()=>{
  const diag=window.task3Diagnostics,single=window.__task3Report.threatsByPlan[diag.planId].single,frame=single.frames[diag.threatFrameIndex],id=frame.targets[0]?.id;
  const next=single.frames[Math.min(single.frames.length-1,diag.threatFrameIndex+1)],previous=single.frames[Math.max(0,diag.threatFrameIndex-1)];
  return {diag,frame,nextPosition:next.targets.find(target=>target.id===id)?.position??null,previousPosition:previous.targets.find(target=>target.id===id)?.position??null};
 });
 assert.equal(played.diag.threatRouteCount,1);assert.equal(played.diag.threatTargets.length,1);assert.equal(played.diag.threatTargets[0].id,'single-custom');
 assert.deepEqual(played.diag.threatTargets[0].position,played.frame.targets[0].position,'无人机位置必须来自当前自定义帧');
 const quaternion=played.diag.threatTargets[0].quaternion;assert.ok(quaternion.every(Number.isFinite),'机头方向四元数必须有效');
 const endpoint=played.nextPosition??played.previousPosition,direction=endpoint.map((value,index)=>value-played.frame.targets[0].position[index]),length=Math.hypot(...direction);
 if(length>1e-6){
  const [x,y,z,w]=quaternion,forward=[2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)],dot=forward.reduce((sum,value,index)=>sum+value*direction[index]/length,0);
  assert.ok(dot>0.999999,'机头方向必须与自定义航路当前飞行方向一致');
 }
 const expectedDetectionSegments=played.frame.targets.reduce((sum,target)=>sum+target.detectedBy.length,0);
 assert.equal(played.diag.threatDetectionSegments,expectedDetectionSegments,'检出连线必须与当前自定义帧逐目标检出设备一致');
 assert.equal(await page.locator('#threat-count').textContent(),String(played.frame.targets.length),'HUD 目标数必须来自同一自定义帧');
 assert.equal((await customState()).active,false,'播放时退出地图编辑，避免遮挡 HUD');
 const frozen=played.diag.threatFrameTime;await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.task3Diagnostics.threatFrameTime),frozen,'暂停后时间不得推进');
 await page.locator('#ac8-sim-speed').selectOption('30');await page.waitForFunction(()=>window.task3Diagnostics.threatSpeed===30);
 await page.locator('#ac8-sim-progress').evaluate(input=>{input.value='500';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>Math.abs(window.task3Diagnostics.threatFrameTime-window.task3Diagnostics.threatDuration*.5)<1e-6);
 assert.equal(await page.evaluate(()=>window.task3Diagnostics.threatPlaying),false,'拖动进度不得擅自恢复播放');
 await page.screenshot({path:'artifacts/task3/custom-route-playback.png'});

 await page.locator('#ac8-sim-scenario').selectOption('multi');
 await page.waitForFunction(()=>window.task3Diagnostics.threatRouteCount===4&&window.task3Diagnostics.threatTargets.length===0&&window.task3Diagnostics.threatDetectionSegments===0&&!window.task3Diagnostics.threatPlaying,null,{timeout:10000});
 assert.equal(await page.evaluate(()=>window.__task3Report.threatsByPlan[window.task3Diagnostics.planId].single.custom),true,'切换场景只清理旧视觉，不应误删可恢复的单机结果');
 await page.locator('#ac8-sim-scenario').selectOption('single');await page.waitForFunction(()=>window.task3Diagnostics.threatRouteCount===1&&window.task3Diagnostics.threatTargets.length===0);
 await openThreat();await page.locator('#task3-threat-defaults').click();
 await page.waitForFunction(()=>!window.__task3Report.threatsByPlan[window.task3Diagnostics.planId].single.custom);
 const restored=await page.evaluate(planId=>{const single=window.__task3Report.threatsByPlan[planId].single;return {summary:single.summary,routeIds:single.routes.map(route=>route.id),azimuths:single.config.azimuthsDeg};},baseline.planId);
 assert.deepEqual(restored.summary,baseline.singleSummary);assert.deepEqual(restored.routeIds,baseline.singleRoutes);assert.deepEqual(restored.azimuths,[0,45,90,135,180,225,270,315]);
 await closeDeployment();await page.locator('#ac8-sim-scenario').selectOption('single');await page.locator('#ac8-sim-speed').selectOption('1');await page.locator('#ac8-sim-start').click();
 await page.waitForFunction(routeId=>window.task3Diagnostics.threatPlaying&&window.task3Diagnostics.threatRouteCount===1&&window.task3Diagnostics.threatTargets[0]?.id===routeId,baseline.singleRoutes[0],{timeout:30000});
 await page.locator('#ac8-sim-start').click();await page.waitForFunction(()=>!window.task3Diagnostics.threatPlaying);
 await page.locator('#ac8-sim-scenario').selectOption('multi');await page.locator('#ac8-sim-start').click();
 await page.waitForFunction(()=>window.task3Diagnostics.threatPlaying&&window.task3Diagnostics.threatScenario==='multi'&&window.task3Diagnostics.threatRouteCount===4,null,{timeout:30000});
 await page.locator('#ac8-sim-start').click();await page.waitForFunction(()=>!window.task3Diagnostics.threatPlaying);
 assert.deepEqual(errors,[],'浏览器不得出现 pageerror');
 console.log(JSON.stringify({result:'PASS',realPipelineRequests:1,customRequests:customRequests.length,waypoints:input.waypoints,customFrames:custom.single.frames,playback:{frameIndex:played.diag.threatFrameIndex,position:played.diag.threatTargets[0].position,heading:'current route direction',detectionSegments:expectedDetectionSegments,pausedAt:frozen,seekTo:'50%',speed:30},scenarioCleanup:'multi switch removed custom visuals and preserved stored single',restored:{routes:restored.routeIds.length,azimuths:restored.azimuths},multi:'4 routes playable',viewports:['1500×1000','390×844'],pageErrors:errors,screenshots:['artifacts/task3/custom-route-desktop.png','artifacts/task3/custom-route-390.png','artifacts/task3/custom-route-playback.png']},null,2));
}finally{
 if(browser)await browser.close();
 await server.close();
}
