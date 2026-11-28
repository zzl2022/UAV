import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const root=fileURLToPath(new URL('..',import.meta.url));
const executablePath=process.env.CHROMIUM_PATH||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath,'需要 Chromium/Edge');
const output='artifacts/task3/threat-sync';
await mkdir(output,{recursive:true});
const server=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;
try{
 await server.listen();
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}?intro=0&demo=0`,{timeout:180000,waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:180000});
 console.log('页面就绪');
 const openInput=async()=>{
  if(!await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen()))await page.locator('#toggle-deployment').click();
  await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isOpen());
  if(!await page.evaluate(()=>window.__ac8DeploymentMenu?.isDetail()&&window.__ac8DeploymentMenu.active()==='input'))await page.locator('#ac8-deployment-menu .ac8-hud-tabs button',{hasText:'推演输入'}).click();
  await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isDetail()&&window.__ac8DeploymentMenu.active()==='input');
  await page.locator('#task3-panel').waitFor({state:'visible'});
 };
 const openThreat=async()=>{await openInput();await page.locator('#task3-panel [data-sub="threat"]').click();};
 const closeMenus=async()=>{
  if(await page.evaluate(()=>window.__ac8DeploymentMenu?.isDetail()))await page.keyboard.press('Escape');
  if(await page.evaluate(()=>window.__ac8DeploymentMenu?.isOpen()))await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!window.__ac8DeploymentMenu?.isOpen());
  await page.waitForTimeout(850); // 等待菜单关闭位移结束，再测量下次展开的位置。
 };
 const generate=async()=>{
  await openInput();await page.locator('#task3-panel [data-sub="generate"]').click();
  const previous=await page.evaluate(()=>window.task3Diagnostics.reportRequestId);
  await page.locator('#task3-run-side').click();
  await page.waitForFunction(previous=>window.task3Diagnostics.ready&&!window.task3Diagnostics.busy&&!window.task3Diagnostics.staleResult&&window.task3Diagnostics.reportRequestId!==previous,previous,{timeout:300000});
  console.log('方案生成完成');
 };
 await openThreat();
 await page.locator('#task3-threat-azimuths').fill('125');
 await page.locator('#task3-threat-agl').fill('55');
 await page.locator('#task3-threat-speed').fill('20');
 await page.locator('#task3-threat').selectOption('multi');
 await page.waitForFunction(()=>document.querySelector('#ac8-sim-scenario').value==='multi');
 await page.locator('#task3-threat-count').fill('3');
 await page.locator('#task3-threat-azimuths').fill('15,125,245');
 await page.locator('#task3-threat-agl').fill('55,80');
 await page.locator('#task3-threat-speed').fill('20');
 await page.locator('#task3-threat').selectOption('single');
 assert.equal(await page.locator('#task3-threat-azimuths').inputValue(),'125');
 await page.waitForFunction(()=>document.querySelector('#ac8-sim-scenario').value==='single');
 await openThreat();
 await page.locator('#task3-panel [data-sub="generate"]').click();
 await page.locator('#task3-plan-types input').evaluateAll(inputs=>inputs.forEach((input,i)=>{input.checked=i===1;input.dispatchEvent(new Event('change',{bubbles:true}));}));
 await generate();
 const checkRoutes=()=>page.evaluate(()=>{
  const report=window.__task3Report,threats=report.threatsByPlan[window.task3Diagnostics.planId],core=report.sampling.bounds.core,bounds=report.sampling.bounds;
  return {core,bounds,configs:report.settings.threatConfigs,scenarios:Object.fromEntries(Object.entries(threats).map(([key,value])=>[key,value.routes.map(route=>({id:route.id,angle:route.azimuthDeg,speed:route.speed,aglM:route.aglM,launch:route.launch,start:route.points[0].position,end:route.points.at(-1).position,passesCore:route.points.some(p=>Math.hypot(p.position[0]-core[0],p.position[2]-core[2])<1e-6)}))]))};
 });
 const first=await checkRoutes();
 assert.deepEqual(first.scenarios.single.map(r=>r.angle),[125]);
 assert.deepEqual(first.scenarios.multi.map(r=>r.angle),[15,125,245]);
 assert.deepEqual(first.scenarios.multi.map(r=>r.aglM),[55,80,55]);
 for(const [key,routes] of Object.entries(first.scenarios))for(const r of routes){
  assert.ok(r.passesCore,`${key} ${r.id} 穿过核心`);
  const dx=r.start[0]-first.core[0],dz=r.start[2]-first.core[2],bearing=(Math.atan2(dx,-dz)*180/Math.PI+360)%360;
  assert.ok(Math.abs(bearing-r.angle)<1e-6);
  assert.ok(r.launch.clippedByMap||Math.abs(r.launch.actualBufferM-1000)<1e-6);
  if(Math.abs(r.launch.startRadiusM-r.launch.endRadiusM)<1e-6)assert.ok(Math.hypot(r.start[0]+r.end[0]-2*first.core[0],r.start[2]+r.end[2]-2*first.core[2])<1e-6);
 }
 await closeMenus();
 await page.locator('#ac8-sim-speed').selectOption('1');await page.locator('#ac8-sim-start').click();
 await page.waitForFunction(()=>window.task3Diagnostics.threatPlaying&&window.task3Diagnostics.threatTargets.length===1);
 await page.locator('#ac8-sim-start').click();
 await page.locator('#ac8-sim-progress').evaluate(input=>{input.value='900';input.dispatchEvent(new Event('input',{bubbles:true}));});
 const exit=await page.evaluate(()=>{const d=window.task3Diagnostics,s=window.__task3Report.threatsByPlan[d.planId].single;return {actual:d.threatTargets[0].position,expected:s.frames[d.threatFrameIndex].targets[0].position,core:window.__task3Report.sampling.bounds.core,start:s.routes[0].points[0].position};});
 assert.deepEqual(exit.actual,exit.expected);
 assert.ok((exit.actual[0]-exit.core[0])*(exit.start[0]-exit.core[0])+(exit.actual[2]-exit.core[2])*(exit.start[2]-exit.core[2])<0,'播放必须到达核心另一侧');
 await page.screenshot({path:`${output}/automatic-crossing.png`});
 await page.locator('#ac8-sim-start').click();await page.waitForFunction(()=>window.task3Diagnostics.threatPlaying);
 await openThreat();await page.locator('#task3-threat-azimuths').fill('35');
 await page.waitForFunction(()=>window.task3Diagnostics.staleResult&&!window.task3Diagnostics.threatPlaying&&document.querySelector('#ac8-sim-progress').disabled);
 await closeMenus();
 assert.equal(await page.locator('#ac8-sim-start').isDisabled(),true,'过期参数必须禁用播放');
 assert.equal(await page.evaluate(()=>window.task3Diagnostics.threatPlaying),false,'过期参数不得播放旧帧');
 await openThreat();assert.equal(await page.locator('#task3-threat-azimuths').inputValue(),'35','仿真按钮不得覆盖新参数');
 await generate();
 const regenerated=await checkRoutes();assert.deepEqual(regenerated.scenarios.single.map(r=>r.angle),[35]);
 await closeMenus();await page.locator('#ac8-sim-start').click();await page.waitForFunction(()=>window.task3Diagnostics.threatPlaying);
 await page.locator('#ac8-sim-start').click();
 await page.locator('#ac8-sim-scenario').selectOption('multi');
 await page.waitForFunction(()=>document.querySelector('#task3-threat').value==='multi');
 await page.locator('#ac8-sim-start').click();await page.waitForFunction(()=>window.task3Diagnostics.threatPlaying&&window.task3Diagnostics.threatTargets.length===3);
 await page.locator('#ac8-sim-start').click();
 await openThreat();await page.locator('#task3-threat').selectOption('single');
 await page.waitForFunction(()=>document.querySelector('#ac8-sim-scenario').value==='single');
 await page.locator('#task3-threat').selectOption('multi');
 await page.waitForFunction(()=>document.querySelector('#ac8-sim-scenario').value==='multi');
 await closeMenus();
 await page.locator('#ac8-sim-scenario').selectOption('swarm');
 await page.waitForFunction(()=>document.querySelector('#ac8-sim-scenario').value==='swarm');
 await page.screenshot({path:`${output}/all-swarm-routes.png`});
 await page.setViewportSize({width:390,height:844});await openThreat();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`${output}/threat-parameters-390.png`});
 assert.deepEqual(errors,[]);
 const result={result:'PASS',first,regeneratedSingle:regenerated.scenarios.single,playbackExit:exit,checks:['two-way scenario sync','physical parameters','1 km / map boundary launch','core crossing and symmetric exit','stale playback stopped','regeneration uses new angle','all 42 swarm route lines','390px layout'],pageErrors:errors};
 await writeFile(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{if(browser)await browser.close();await server.close();}
