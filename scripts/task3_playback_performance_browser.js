import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

const url=new URL(process.env.APP_URL||'http://127.0.0.1:5173');
url.searchParams.set('demo','0');
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const hardware=process.env.UAV_REPLAY_BENCH_GPU==='hardware';
const gpuArgs=hardware?['--enable-gpu','--ignore-gpu-blocklist',...(process.platform==='win32'?['--use-angle=d3d11']:[])]
 :['--enable-unsafe-swiftshader','--use-angle=swiftshader'];
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox',...gpuArgs]});
const duration=Number(process.env.UAV_REPLAY_BENCH_MS)||4800;
const scenario=process.env.UAV_REPLAY_BENCH_SCENARIO==='multi'?'multi':'single';
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route(/\/src\/task3\/ui\.js(?:\?.*)?$/,async route=>{
  const response=await route.fetch();
  let source=await response.text();
  const anchor='rebuildThreatGround();applyTab();renderThreatConfig();renderEquipmentSelection();controlsEnabled();updateDiagnostics();';
  assert.ok(source.includes(anchor),'需要提供 Vite 开发页面');
  const diagnosticFunction=source.includes('function publishPlaybackDiagnostics')?"publishPlaybackDiagnostics":"updateDiagnostics";
  source=source.replace(new RegExp('function '+diagnosticFunction+'\\([^)]*\\)\\s*\\{'),signature=>signature+' window.__uavReplayFixture?.diagnosticCall();');
  const fixture=`
 window.__uavReplayFixture=(()=>{
  let diagnosticCalls=0,gpu;
  return {
   diagnosticCall(){diagnosticCalls++;},
   prepare(scenario){
    // 仅为此测试页面注入渲染样例，应用、部署报告和后台计算不会读取这些数据。
    const devices=Array.from({length:16},(_,i)=>({id:'demo-'+i,type:'radar',presetId:'radar-02c',position:[(i%4-1.5)*88,110,(Math.floor(i/4)-1.5)*88]}));
    const frames=Array.from({length:661},(_,i)=>({time:i/10,targets:Array.from({length:3},(_,j)=>({
      id:'sample-'+j,position:[180*Math.sin(i/170+j),160+40*j,180*Math.cos(i/170+j)],
      detectedBy:devices.map(({id})=>({id})),
    }))}));
    const coverage={covered:1,total:1,coverageRate:1,blindRate:0,coreCoverageRate:1,coreRedundantRate:0};
    plan={id:'ui-fixture',name:'界面测试样例',devices,sites:[],metrics:[{...coverage,condition:'nominal'},{...coverage,condition:'other'}]};
    report={plans:[plan],recommendedId:plan.id,conditions:[{id:'nominal',name:'界面测试'},{id:'other',name:'备用测试工况'}],
      sampling:{bounds:{core:[0,85,0]}},settings:{coreRadius:180},comparison:{rows:[]},scoring:{plans:[{id:plan.id,indicators:{feasibility:1}}]},
      blindspots:{[plan.id]:[]},emc:{[plan.id]:{verdict:'pass',counts:{fail:0,warning:0}}},threatsByPlan:{[plan.id]:{[scenario]:{frames}}}};
    deviceDisplay=createDeviceDisplayMap(devices);
    $('task3-condition').replaceChildren(...report.conditions.map(({id,name})=>new Option(name,id)));
    $('task3-threat').value=scenario;
    mapActive=true;drawCommon();focus([0,100,0],950);setThreatSpeed(1);
    return beginThreatPlayback();
   },
   read(){
    if(!gpu){const gl=renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');gpu=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}
    return {diagnosticCalls,playing:threatPlaying,frame:threatFrameIndex,
      targets:[...(typeof playbackVisuals==='undefined'?threatDrones:playbackVisuals.drones).values()].map(mesh=>mesh.id),
      line:(typeof playbackVisuals==='undefined'?threatDetectLines:playbackVisuals.lines)?.geometry.id??null,
      geometries:renderer.info.memory.geometries,
      gpu};
   },
  };
 })();
 `;
  await route.fulfill({response,body:source.replace(anchor,fixture+anchor)});
 });
 await page.goto(url.href,{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.__uavReplayFixture&&window.task3Diagnostics,null,{timeout:180000});
 assert.equal(await page.evaluate(scenario=>window.__uavReplayFixture.prepare(scenario),scenario),true);
 await page.waitForFunction(()=>window.__uavReplayFixture.read().frame>=3,{},{timeout:15000});
 const metrics=await page.evaluate(async duration=>{
  const fixture=window.__uavReplayFixture,initial=fixture.read();
  const targetIds=new Set(initial.targets),lineIds=new Set([initial.line]),intervals=[];
  let final,peakTargets=initial.targets.length,minGeometries=initial.geometries,maxGeometries=initial.geometries;
  const elapsed=await new Promise(resolve=>{
   let start=null,last=null;
   function tick(stamp){
    start??=stamp;if(last!==null)intervals.push(stamp-last);last=stamp;
    final=fixture.read();
    for(const id of final.targets)targetIds.add(id);
    lineIds.add(final.line);
    minGeometries=Math.min(minGeometries,final.geometries);maxGeometries=Math.max(maxGeometries,final.geometries);
    peakTargets=Math.max(peakTargets,final.targets.length);
    if(stamp-start>=duration)resolve(stamp-start);else requestAnimationFrame(tick);
   }
   requestAnimationFrame(tick);
  });
  const fps=intervals.length*1000/elapsed,longFrames=intervals.filter(ms=>ms>100).length;
  return {durationMs:elapsed,fps,longFrames,maxFrameMs:Math.max(...intervals),diagnosticsHz:(final.diagnosticCalls-initial.diagnosticCalls)*1000/elapsed,
    distinctTargets:targetIds.size,distinctLineGeometries:lineIds.size,peakTargets,minGeometries,maxGeometries,frameAdvances:final.frame-initial.frame,
    gpu:final.gpu,perf:window.task3Diagnostics.perf??null};
 },duration);
 assert.deepEqual(errors,[]);
 assert.ok(metrics.frameAdvances>0);
 await mkdir('artifacts/uav-ux',{recursive:true});
 await writeFile(process.env.UAV_REPLAY_BENCH_PATH||'artifacts/uav-ux/replay-after.json',JSON.stringify(metrics,null,2)+'\n');
 if(!process.env.UAV_REPLAY_BENCH_BASELINE){
  assert.equal(metrics.distinctTargets,3);assert.equal(metrics.distinctLineGeometries,1);assert.equal(metrics.peakTargets,3);
  assert.ok(metrics.diagnosticsHz<=6);
  assert.ok(metrics.perf.diagnosticsUpdatesPerSecond<=6);
  assert.ok(metrics.perf&&metrics.perf.hudUpdatesPerSecond<=10&&metrics.perf.playbackGeometryCreations===0&&metrics.perf.playbackMaterialCreations===0);
  assert.equal(metrics.perf.targetMeshCount,3);assert.equal(metrics.perf.detectionLineGeometryCount,1);
  assert.ok(metrics.perf.frameAdvances>0&&metrics.perf.frameAdvanceMs>=0);
  if(hardware){assert.doesNotMatch(metrics.gpu,/SwiftShader|software|llvmpipe/i);assert.ok(metrics.fps>=45);assert.equal(metrics.longFrames,0);}
  if(duration>=60000)assert.equal(metrics.minGeometries,metrics.maxGeometries);
  const screenshot=duration>=60000?(hardware?'replay-hardware-60s.png':'replay-60s.png'):(hardware?'replay-hardware.png':'replay-after.png');
  await page.screenshot({path:`artifacts/uav-ux/${screenshot}`});
  const beforeCondition=await page.evaluate(()=>window.__uavReplayFixture.read());
  await page.locator('#task3-condition').evaluate(select=>{select.value='other';select.dispatchEvent(new Event('change',{bubbles:true}));});
  const afterCondition=await page.evaluate(()=>window.__uavReplayFixture.read());
  assert.equal(await page.evaluate(()=>window.task3Diagnostics.condition),'other');
  assert.equal(afterCondition.playing,true);
  assert.deepEqual(afterCondition.targets,beforeCondition.targets);assert.equal(afterCondition.line,beforeCondition.line);
  const playback=page.locator('#ac8-sim-start'),progress=page.locator('#ac8-sim-progress');
  await playback.click();
  assert.equal(await page.evaluate(()=>window.task3Diagnostics.threatPlaying),false);
  const beforeSeek=await page.evaluate(()=>window.__uavReplayFixture.read());
  for(const [progressValue,frame] of [[500,330],[0,0]]){
   await progress.evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},progressValue);
   const state=await page.evaluate(()=>window.__uavReplayFixture.read());
   assert.equal(state.frame,frame);assert.deepEqual(state.targets,beforeSeek.targets);assert.equal(state.line,beforeSeek.line);
  }
  await page.locator('#ac8-sim-scenario').selectOption(scenario==='multi'?'single':'multi');
  assert.deepEqual((await page.evaluate(()=>window.__uavReplayFixture.read())).targets,[]);
  assert.equal(await page.evaluate(()=>window.task3Diagnostics.playbackStatus),'no-recording');
  assert.deepEqual(errors,[]);
 }
 console.log(JSON.stringify(metrics));
}finally{await browser.close();}
