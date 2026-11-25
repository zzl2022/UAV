import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {openSceneMenu,closeSceneMenu} from './city_menu_helper.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const executablePath=process.env.CHROMIUM_PATH||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
 '/usr/bin/chromium',
].find(path=>existsSync(path));
assert.ok(executablePath,'未找到 Chromium/Edge，请设置 CHROMIUM_PATH');
const readJson=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const recon=await readJson('../public/data/city.json');
const daxing=await readJson('../public/data/sites/daxing/daxing-gba-meta.json');
const nuclear=await readJson('../public/data/sites/nuclear/nuclear-gba-meta.json');
const allCases=[
 {id:'recon',base:null,center:recon.metadata.origin.slice(0,2)},
 {id:'daxing',base:'./data/sites/daxing/daxing-gba',center:daxing.center},
 {id:'nuclear',base:'./data/sites/nuclear/nuclear-gba',center:nuclear.center},
];
for(const id of ['wuxi','hangzhou']){
 const meta=await readJson(`../public/data/sites/${id}/${id}-gba-meta.json`);
 allCases.push({id,base:`./data/sites/${id}/${id}-gba`,center:meta.center});
}
const requested=(process.env.TASK3_MAP_IDS||'recon,daxing,nuclear').split(',');
assert.ok(requested.every(id=>allCases.some(item=>item.id===id)),'未知验收地图');
const cases=requested.map(id=>allCases.find(item=>item.id===id));
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
  const NativeWorker=window.Worker;window.__task3PipelineRequests=[];
  window.Worker=new Proxy(NativeWorker,{construct(Target,args){
   const worker=Reflect.construct(Target,args),postMessage=worker.postMessage.bind(worker);
   worker.postMessage=(message,...rest)=>{if(message?.type==='pipeline')window.__task3PipelineRequests.push(structuredClone(message));return postMessage(message,...rest);};
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
 const closeDeployment=async()=>{
  if(await page.evaluate(()=>window.__ac8DeploymentMenu?.isDetail())){await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isDetail(),null,{timeout:5000});}
  if(await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen())){await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isOpen(),null,{timeout:5000});}
 };
 const configureSmallRealPipeline=async()=>{
  await openInput();
  await page.locator('#task3-panel [data-sub="threat"]').click();
  for(const key of ['single','multi','swarm']){
   await page.locator('#task3-threat').selectOption(key);
   await page.evaluate(()=>{
    const values={'task3-threat-count':'1','task3-threat-azimuths':'0','task3-threat-agl':'30','task3-threat-speed':'15'};
    for(const [id,value] of Object.entries(values)){const input=document.querySelector(`#${id}`);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
   });
  }
  await page.locator('#task3-threat').selectOption('single');
  await page.locator('#task3-panel [data-sub="generate"]').click();
  await page.locator('#task3-spacing').evaluate(input=>{input.value='1000';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#task3-plan-types input').evaluateAll(inputs=>{for(const input of inputs){input.checked=input.dataset.planType==='balanced';input.dispatchEvent(new Event('input',{bubbles:true}));}});
  await page.locator('#task3-run-side').click();
  await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});
 };
 const switchMap=async item=>{
  await openSceneMenu(page,'scene');
  await page.selectOption('#model-select',item.id);
  await page.waitForFunction(id=>window.cityDiagnostics?.modelMode===id&&!document.querySelector('#model-select').disabled,item.id,{timeout:180000});
  await closeSceneMenu(page);
  const cleared=await page.evaluate(()=>({
   ready:window.task3Diagnostics.ready,report:window.__task3Report,targets:window.task3Diagnostics.threatTargets.length,
   routes:window.task3Diagnostics.threatRouteCount,detected:window.task3Diagnostics.detectedDeviceIds,
   markers:window.task3Diagnostics.deviceMarkers.length,time:window.task3Diagnostics.threatFrameTime,
   sceneKey:window.task3Diagnostics.sceneKey,ground:window.task3Diagnostics.threatGroundAvailable,
  }));
  assert.equal(cleared.ready,false,`${item.id} 切图后不得保留旧报告`);
  assert.equal(cleared.report,null);assert.equal(cleared.targets,0);assert.equal(cleared.routes,0);
  assert.deepEqual(cleared.detected,[]);assert.equal(cleared.markers,0);assert.equal(cleared.time,0);
  assert.equal(cleared.sceneKey,item.base??'recon');assert.equal(cleared.ground,true);
 };
 const seekToFrame=async(index)=>{
  await page.locator('#ac8-sim-progress').evaluate((input,frameIndex)=>{
   const diag=window.task3Diagnostics,report=window.__task3Report,single=report.threatsByPlan[diag.planId].single,frames=single.frames;
   // findIndex 取第一个 time>=t 的帧，故落在帧起点之前极小处；解锁 step 避免 1/1000 量化把时间抬进下一帧。
   const start=frames[frameIndex].time,before=start-(frames[frameIndex-1]?.time??0),time=frameIndex===0?0:start-before*1e-9;
   input.step='any';
   input.value=String(time/frames.at(-1).time*1000);input.dispatchEvent(new Event('input',{bubbles:true}));
  },index);
  try{await page.waitForFunction(frameIndex=>window.task3Diagnostics.threatFrameIndex===frameIndex,index,{timeout:10000});}
  catch(error){console.error('SEEK诊断',JSON.stringify(await page.evaluate(frameIndex=>{const diag=window.task3Diagnostics,report=window.__task3Report,input=document.querySelector('#ac8-sim-progress'),single=report?.threatsByPlan?.[diag.planId]?.single;return {want:frameIndex,index:diag.threatFrameIndex,time:diag.threatFrameTime,inputDisabled:input.disabled,inputValue:input.value,frames:single?.frames?.length??0,frameTime:single?.frames?.[frameIndex]?.time??null,duration:single?.frames?.at(-1)?.time??null,playing:diag.threatPlaying,mapActive:diag.mapActive??null,sceneKey:diag.sceneKey};},index)));throw error;}
 };
 const verifyTelemetry=async(item,label)=>{
  const state=await page.evaluate(()=>{
   const diag=window.task3Diagnostics,frame=window.__task3Report.threatsByPlan[diag.planId].single.frames[diag.threatFrameIndex];
   return {telemetry:diag.threatTelemetry,position:frame.targets[0].position,hudAgL:document.querySelector('#threat-agl').textContent,coordinates:document.querySelector('#threat-coordinates').textContent};
  });
  const telemetry=state.telemetry;assert.ok(telemetry,`${item.id} ${label} 缺少遥测`);
  assert.ok(Number.isFinite(telemetry.agl)&&telemetry.agl>=0,`${item.id} ${label} AGL 必须有限非负`);
  assert.ok(Number.isFinite(telemetry.ground),`${item.id} ${label} 必须有当前地图地面`);
  assert.ok(Math.abs(telemetry.agl-(state.position[1]-telemetry.ground))<1e-6,'AGL 必须按 up-ground 计算');
  assert.ok(Math.abs(Number(state.hudAgL)-telemetry.agl)<=0.051,'HUD 与遥测 AGL 必须一致');
  if(item.id!=='recon')assert.equal(telemetry.ground,0,'GBA 站点地面必须与 loadSiteCity 一样为 y=0');
  assert.ok(Math.abs(telemetry.longitude-item.center[0])<0.06&&Math.abs(telemetry.latitude-item.center[1])<0.06,`${item.id} 坐标不得沿用上一地图：${state.coordinates}`);
  return {agl:telemetry.agl,ground:telemetry.ground,longitude:telemetry.longitude,latitude:telemetry.latitude};
 };
 const results=[];
 for(const [caseIndex,item] of cases.entries()){
  if(caseIndex||item.id!=='recon')await switchMap(item);
  await configureSmallRealPipeline();
  const generated=await page.evaluate(()=>{
   const diag=window.task3Diagnostics,report=window.__task3Report,single=report.threatsByPlan[diag.planId].single,request=window.__task3PipelineRequests.at(-1);
   const detected=[],clear=[];
   single.frames.forEach((frame,index)=>(frame.targets.some(target=>target.detectedBy.length)?detected:clear).push(index));
   return {planId:diag.planId,requestSite:request.site?.base??null,planTypes:request.planTypes,targets:diag.threatTargets.length,routes:diag.threatRouteCount,detected:diag.detectedDeviceIds,detectedFrames:detected,clearFrames:clear,duration:single.frames.at(-1).time,frameCount:single.frames.length};
  });
  assert.equal(generated.requestSite,item.base,`${item.id} Worker 必须使用当前站点`);
  assert.deepEqual(generated.planTypes,['balanced']);assert.equal(generated.targets,0);assert.equal(generated.routes,0);assert.deepEqual(generated.detected,[]);
  assert.ok(generated.detectedFrames.length,`${item.id} 真实 single 帧必须包含检出`);

  await closeDeployment();
  await page.locator('#ac8-sim-scenario').selectOption('single');
  // 先定位到确定性检出帧，再低速启动/暂停播放，避免 30× 下整段（约 1.4 s）在暂停点击前已播完。
  await seekToFrame(generated.detectedFrames[0]);
  await page.waitForFunction(()=>window.task3Diagnostics.detectedDeviceIds.length>0,null,{timeout:10000});
  await page.locator('#ac8-sim-speed').selectOption('1');
  await page.locator('#ac8-sim-start').click();
  await page.waitForFunction(()=>window.task3Diagnostics.threatPlaying,null,{timeout:10000});
  const detectedFrameIndex=await page.evaluate(()=>window.task3Diagnostics.threatFrameIndex);
  assert.ok(detectedFrameIndex>=generated.detectedFrames[0],`${item.id} 必须真实推进播放帧`);
  await page.locator('#ac8-sim-start').click();
  await page.waitForFunction(()=>!window.task3Diagnostics.threatPlaying,null,{timeout:10000});

  const detectedState=await page.evaluate(()=>{
   const diag=window.task3Diagnostics,frame=window.__task3Report.threatsByPlan[diag.planId].single.frames[diag.threatFrameIndex],expected=[...new Set(frame.targets.flatMap(target=>target.detectedBy.map(device=>device.id)))].sort();
   return {expected,detected:diag.detectedDeviceIds,markers:diag.deviceMarkers.map(marker=>({deviceId:marker.deviceId,detected:marker.detected,haloVisible:marker.haloVisible,haloOpacity:marker.haloOpacity,haloScale:marker.haloScale}))};
  });
  assert.deepEqual(detectedState.detected,detectedState.expected,'halo 集合必须等于当前帧检出设备');
  for(const marker of detectedState.markers){
   assert.equal(marker.detected,detectedState.expected.includes(marker.deviceId));
   assert.equal(marker.haloVisible,marker.detected,'未检出设备必须熄灭');
   if(marker.detected)assert.ok(marker.haloOpacity>0&&marker.haloScale>=1);
   else assert.equal(marker.haloOpacity,0);
  }
  const pulse=await page.evaluate(async()=>{
   const samples=[];
   for(let index=0;index<8;index++){
    await new Promise(resolve=>setTimeout(resolve,70));
    const diag=window.task3Diagnostics,marker=diag.deviceMarkers.find(item=>item.detected);
    samples.push({opacity:marker?.haloOpacity??null,scale:marker?.haloScale??null,visible:marker?.haloVisible??false,detected:[...diag.detectedDeviceIds]});
   }
   return samples;
  });
  if(!pulse.every(sample=>sample.visible&&sample.opacity>0&&sample.scale>=1))console.error('HALO诊断',JSON.stringify({scene:item.id,detectedFrameIndex,samples:pulse.map(sample=>({o:sample.opacity,s:sample.scale,v:sample.visible,d:sample.detected.length})),diag:await page.evaluate(()=>({playing:window.task3Diagnostics.threatPlaying,frameIndex:window.task3Diagnostics.threatFrameIndex,frameTime:window.task3Diagnostics.threatFrameTime,detected:[...window.task3Diagnostics.detectedDeviceIds],view:window.task3Diagnostics.view??null,sceneKey:window.task3Diagnostics.sceneKey}))}));
  assert.ok(pulse.every(sample=>sample.visible&&sample.opacity>0&&sample.scale>=1),'检出期间 halo 必须持续可见');
  assert.ok(new Set(pulse.map(sample=>sample.opacity.toFixed(4))).size>1,'透明度必须随时间脉冲变化');
  assert.ok(new Set(pulse.map(sample=>sample.scale.toFixed(4))).size>1,'缩放必须随时间脉冲变化');
  const detectedTelemetry=await verifyTelemetry(item,'检出帧');
  await page.screenshot({path:`artifacts/task3/task6-${item.id}-halo.png`});

  const clearIndex=generated.clearFrames[0]??null,verificationIndex=clearIndex??generated.detectedFrames.find(index=>index!==detectedFrameIndex)??0;
  await seekToFrame(verificationIndex);
  const subsequent=await page.evaluate(()=>{
   const diag=window.task3Diagnostics,frame=window.__task3Report.threatsByPlan[diag.planId].single.frames[diag.threatFrameIndex],expected=[...new Set(frame.targets.flatMap(target=>target.detectedBy.map(device=>device.id)))].sort();
   return {expected,detected:diag.detectedDeviceIds,markers:diag.deviceMarkers.map(marker=>({deviceId:marker.deviceId,visible:marker.haloVisible,opacity:marker.haloOpacity,detected:marker.detected}))};
  });
  assert.deepEqual(subsequent.detected,subsequent.expected,`${item.id} 后续帧不得残留旧检出集合`);
  for(const marker of subsequent.markers){
   const expected=subsequent.expected.includes(marker.deviceId);assert.equal(marker.detected,expected);assert.equal(marker.visible,expected,'后续帧未检出设备必须熄灭');
   if(!expected)assert.equal(marker.opacity,0);
  }
  if(clearIndex!==null){assert.deepEqual(subsequent.detected,[]);assert.ok(subsequent.markers.every(marker=>!marker.visible&&!marker.detected&&marker.opacity===0),'全未检出帧所有 halo 必须熄灭');}
  const subsequentTelemetry=await verifyTelemetry(item,clearIndex===null?'后续检出帧':'未检出帧');
  results.push({scene:item.id,planId:generated.planId,frames:generated.frameCount,playedToFrame:detectedFrameIndex,detectedDevices:detectedState.expected,pulse:{opacity:[...new Set(pulse.map(sample=>sample.opacity.toFixed(4)))],scale:[...new Set(pulse.map(sample=>sample.scale.toFixed(4)))]},clearFrame:clearIndex,verificationFrame:verificationIndex,undetectedDevices:subsequent.markers.filter(marker=>!marker.detected).map(marker=>marker.deviceId),detectedTelemetry,subsequentTelemetry});
  console.log(JSON.stringify({scene:item.id,result:'PASS',...results.at(-1)}));
 }
 assert.deepEqual(errors,[],'浏览器不得出现 pageerror');
 console.log(JSON.stringify({result:'PASS',maps:results,pipelineRequests:await page.evaluate(()=>window.__task3PipelineRequests.length),pageErrors:errors,screenshots:cases.map(item=>`artifacts/task3/task6-${item.id}-halo.png`)},null,2));
}finally{
 if(browser)await browser.close();
 await server.close();
}
