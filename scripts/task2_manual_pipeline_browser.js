import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const root=fileURLToPath(new URL('..',import.meta.url));
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const server=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;
try{
 await server.listen();
 const url=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker,requests=[];
  window.__task3PipelineRequests=requests;
  window.Worker=new Proxy(NativeWorker,{construct(Target,args){
   const worker=Reflect.construct(Target,args),postMessage=worker.postMessage.bind(worker);
   worker.postMessage=(message,...rest)=>{if(message?.type==='pipeline')requests.push(structuredClone(message));return postMessage(message,...rest);};
   return worker;
  }});
 });
 await page.goto(`${url}?intro=0&demo=0`,{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:120000});
 const readState=()=>page.evaluate(()=>({
  pipelineRequests:window.__task3PipelineRequests.length,requestId:window.task3Diagnostics.requestId,
  busy:window.task3Diagnostics.busy,staleResult:window.task3Diagnostics.staleResult,
  autoUpdatePending:window.task3Diagnostics.autoUpdatePending,pendingUpdateReasons:window.task3Diagnostics.pendingUpdateReasons,
 }));
 const assertNoImplicitRun=async(expected,label)=>{
  await page.waitForTimeout(300);
  const state=await readState();
  assert.equal(state.pipelineRequests,expected,`${label}：不得创建完整优化 Worker 请求`);
  assert.equal(state.requestId,expected,`${label}：不得推进完整优化请求号`);
  assert.equal(state.busy,false,`${label}：不得进入完整优化忙碌状态`);
  assert.equal(state.autoUpdatePending,false,`${label}：不得存在自动更新队列`);
  assert.deepEqual(state.pendingUpdateReasons,[],`${label}：不得保留自动排队原因`);
 };

 // 缺帧播放只给出明确引导，不能借“威胁推演”启动完整优化。
 await page.locator('#ac8-sim-start').evaluate(button=>button.click());
 await page.waitForFunction(()=>document.querySelector('#threat-live-state')?.textContent==='缺少威胁帧');
 assert.match(await page.locator('#task3-status-side').textContent(),/生成方案/);
 await assertNoImplicitRun(0,'缺帧播放');

 await page.locator('#toggle-deployment').click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isOpen(),null,{timeout:5000});
 await page.locator('#ac8-deployment-menu .ac8-hud-tabs button',{hasText:'推演输入'}).click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isDetail(),null,{timeout:5000});
 await page.locator('#task3-panel').waitFor({state:'visible',timeout:10000});
 await page.locator('#task3-run-side').evaluate(button=>button.click());
 await page.waitForFunction(()=>window.task3Diagnostics.busy,null,{timeout:10000});
 await page.waitForFunction(()=>window.task3Diagnostics.ready&&!window.task3Diagnostics.busy,null,{timeout:300000});
 assert.equal((await readState()).pipelineRequests,1,'生成方案应且只应启动一次完整优化');
 const snapshot=await page.evaluate(()=>window.__task3PipelineRequests[0]);
 for(const key of ['settings','weights','presetIds','equipmentSnapshot','environment','target','planTypes'])assert.ok(key in snapshot,`手动生成快照缺少 ${key}`);
 assert.deepEqual(snapshot.planTypes,['economy','balanced','enhanced']);
 if(await page.evaluate(()=>window.task3Diagnostics.threatPlaying))await page.locator('#ac8-sim-start').evaluate(button=>button.click());
 await page.waitForFunction(()=>!window.task3Diagnostics.threatPlaying);

 // 在同一个页面内同步填写并保存，避免 400ms 自动保存抢先使按钮失效。
 const equipment=await page.evaluate(()=>{
  const input=document.querySelector('#profile-parameters-maxRange'),before=Number(input.value),next=before+1;
  input.value=String(next);input.dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('#equipment-profile-save').click();
  return {before,next,message:document.querySelector('#equipment-profile-message').textContent};
 });
 assert.equal(equipment.message,'已保存');assert.equal(equipment.next,equipment.before+1);
 await assertNoImplicitRun(1,'装备参数保存');
 assert.equal((await readState()).staleResult,true,'装备保存后既有结果应标记过期');
 assert.equal(await page.locator('#task3-result-freshness').isVisible(),true);

 const environment=await page.evaluate(()=>{
  const input=document.querySelector('#city-environment-rainMmH'),next=Number(input.value)+1;
  input.value=String(next);input.dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('#city-environment-apply').click();
  return {next,message:document.querySelector('#city-environment-message').textContent};
 });
 assert.equal(environment.message,'已应用');
 await page.waitForFunction(value=>window.sceneConfigurationDiagnostics.environment.rainMmH===value,environment.next);
 await assertNoImplicitRun(1,'环境应用');

 const targetCount=await page.evaluate(()=>{
  const input=document.querySelector('#city-target-count'),next=Number(input.value)+1;
  input.value=String(next);input.dispatchEvent(new Event('input',{bubbles:true}));return next;
 });
 await page.waitForFunction(value=>window.sceneConfigurationDiagnostics.target.count===value,targetCount);
 await assertNoImplicitRun(1,'目标修改生效');

 await page.locator('#task3-threat-count').evaluate(input=>{input.value=String(Number(input.value)+1);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
 await assertNoImplicitRun(1,'威胁参数修改');
 await page.locator('#task3-threat-defaults').evaluate(button=>button.click());
 await assertNoImplicitRun(1,'当前威胁场景恢复默认');
 await page.locator('#task3-scope-width').evaluate(input=>{input.value='2600';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#task3-restore-defaults').evaluate(button=>button.click());
 assert.equal(await page.locator('#task3-scope-width').inputValue(),'2400');
 await assertNoImplicitRun(1,'恢复全部默认参数');

 const finalState=await readState();
 assert.equal(finalState.staleResult,true,'配置变化后不得把旧报告错标为最新');
 assert.equal(await page.locator('#task3-progress-side').getAttribute('value'),'1','非生成动作不得推进方案进度');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',pipelineRequests:finalState.pipelineRequests,requestId:finalState.requestId,staleResult:finalState.staleResult,autoUpdatePending:finalState.autoUpdatePending,verified:['缺帧播放仅引导','生成方案一次请求及完整快照','装备保存无优化','环境应用无优化','目标生效无优化','威胁修改与恢复默认无优化'],pageErrors:errors},null,2));
}finally{
 if(browser)await browser.close();
 await server.close();
}
