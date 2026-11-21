import {chromium} from 'playwright-core';
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 page.on('console',m=>{if(m.type()!=='debug'&&!m.text().includes('vite'))console.log('CONSOLE',m.type(),m.text().slice(0,500));});
 page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,500)));
 page.on('requestfailed',r=>console.log('REQFAIL',r.url(),r.failure()?.errorText));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5193',{timeout:120000,waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
 for(let i=0;i<15;i++){
  const t3=await page.evaluate(()=>!!window.task3Diagnostics);
  if(t3)break;
  await page.waitForTimeout(2000);
 }
 const state=await page.evaluate(()=>({
  task3:!!window.task3Diagnostics,
  deploymentLoading:document.querySelector('#deployment-loading')?.textContent,
  task3Panel:!!document.querySelector('#task3-panel'),
  toggleDisabled:document.querySelector('#toggle-task3')?.disabled,
 }));
 console.log('FINAL',JSON.stringify(state));
}finally{await browser.close();}
