import {chromium} from 'playwright-core';
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,500)));
 page.on('console',m=>{if(!['debug','log'].includes(m.type()))console.log('CONSOLE',m.type(),m.text().slice(0,300));});
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5193',{timeout:120000,waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:90000});
 // 场景切换：深圳
 await page.locator('#open-city-model').click();
 await page.waitForFunction(()=>document.querySelector('#ac8-scene-menu')?.classList.contains('is-open'));
 await page.locator('#city-tab-scene').click();
 await page.locator('#model-select').waitFor({state:'visible',timeout:30000});
 await page.locator('#model-select').selectOption('shenzhen');
 await page.waitForFunction(()=>!document.querySelector('#model-select').disabled,null,{timeout:240000});
 const afterSwitch=await page.evaluate(()=>({mode:window.cityDiagnostics?.modelMode,status:document.querySelector('#status')?.textContent,task3:!!window.task3Diagnostics,ready:window.task3Diagnostics?.ready}));
 console.log('SWITCHED',JSON.stringify(afterSwitch));
 // Esc 关闭场景菜单
 for(let i=0;i<3;i++){await page.keyboard.press('Escape');if(!await page.evaluate(()=>document.querySelector('#ac8-scene-menu')?.classList.contains('is-open')))break;}
 // 点击推演
 const r=await page.evaluate(()=>{
  const b=document.querySelector('#toggle-task3');let err=null;
  try{b.click();}catch(e){err=e.message;}
  return {err,panelHidden:document.querySelector('#task3-panel')?.hidden,activeView:document.querySelector('#app').dataset.activeView,diag:window.task3Diagnostics?{ready:window.task3Diagnostics.ready,busy:window.task3Diagnostics.busy}:null};
 });
 console.log('CLICK',JSON.stringify(r));
 await page.waitForTimeout(1000);
 const r2=await page.evaluate(()=>({panelHidden:document.querySelector('#task3-panel')?.hidden,runDisabled:document.querySelector('#task3-run')?.disabled,status:document.querySelector('#task3-status')?.textContent}));
 console.log('AFTER',JSON.stringify(r2));
 await page.screenshot({path:'artifacts/task3/debug-switch-deploy.png'});
}finally{await browser.close();}
