// 真实用户路径：场景设定切图 → 部署仿真推演菜单 → 推演输入 → 开始推演 → 等待完成。
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/task3',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5193',{timeout:120000,waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:90000});
 const switchScene=async scene=>{
  await page.locator('#open-city-model').click({force:true});
  await page.waitForFunction(()=>document.querySelector('#ac8-scene-menu')?.classList.contains('is-open'),null,{timeout:30000});
  await page.waitForTimeout(1300); // 等待菜单线条动画结束，避免遮挡页签点击
  await page.evaluate(()=>document.querySelector('#city-tab-scene').click());
  await page.locator('#model-select').waitFor({state:'visible',timeout:30000});
  await page.locator('#model-select').selectOption(scene);
  await page.waitForFunction(()=>!document.querySelector('#model-select').disabled,null,{timeout:240000});
  for(let i=0;i<3;i++){await page.keyboard.press('Escape');if(!await page.evaluate(()=>document.querySelector('#ac8-scene-menu')?.classList.contains('is-open')))break;}
  await page.waitForFunction(s=>window.cityDiagnostics?.modelMode===s,scene,{timeout:30000});
 };
 const runTask3=async scene=>{
  // 推演按钮位于主界面左侧信息栏（菜单打开时会被遮挡，故先运行再查看面板）
  await page.locator('#task3-run-side').click();
  await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics.busy,null,{timeout:600000});
  const diag=await page.evaluate(()=>({devices:window.task3Diagnostics.plans?.map(p=>p.devices),recommendedId:window.task3Diagnostics.recommendedId,layerVisible:window.task3Diagnostics.layerVisible,blind:window.task3Diagnostics.blindStats?.total,status:document.querySelector('#task3-status-side')?.textContent}));
  // 打开推演面板验证结果展示正常（截图存档，不做严格可见性断言）
  await page.locator('#toggle-deployment').click({force:true});
  await page.waitForFunction(()=>document.querySelector('#ac8-deployment-menu')?.classList.contains('is-open'),null,{timeout:30000});
  await page.locator('#ac8-deployment-menu .ac8-hud-tabs button[data-page="plans"]').click({force:true});
  await page.waitForTimeout(1200);
  await page.screenshot({path:`artifacts/task3/site-${scene}-plans.png`});
  return diag;
 };
 const closeDeploy=async()=>{
  for(let i=0;i<3;i++){await page.keyboard.press('Escape');if(!await page.evaluate(()=>document.querySelector('#ac8-deployment-menu')?.classList.contains('is-open')))break;}
 };
 const scenes=['recon','shenzhen','beijing','daxing','hangzhou','nuclear','changjiang','railway'];
 const results=[];
 for(const scene of scenes){
  const t0=Date.now();
  try{
   await switchScene(scene);
   const diag=await runTask3(scene);
   results.push({scene,ok:true,ms:Date.now()-t0,...diag});
   console.log('PASS',scene,JSON.stringify(diag));
   await closeDeploy();
  }catch(error){
   const diag=await page.evaluate(()=>window.task3Diagnostics?{ready:window.task3Diagnostics.ready,busy:window.task3Diagnostics.busy,status:document.querySelector('#task3-status')?.textContent}:null).catch(()=>null);
   results.push({scene,ok:false,ms:Date.now()-t0,error:error.message.slice(0,300),diag});
   console.log('FAIL',scene,error.message.slice(0,300));
   await page.screenshot({path:`artifacts/task3/switch-fail-${scene}.png`}).catch(()=>{});
  }
 }
 await writeFile('artifacts/task3/site-switch-pipeline.json',JSON.stringify({results,errors},null,2));
 console.log('SUMMARY',JSON.stringify(results.map(r=>({scene:r.scene,ok:r.ok,devices:r.devices})),null,2));
 console.log('PAGEERRORS',JSON.stringify(errors.slice(0,10)));
}finally{await browser.close();}
