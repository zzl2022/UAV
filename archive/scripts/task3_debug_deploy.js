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
 // 直接点击 toggle-task3
 const r1=await page.evaluate(()=>{
  const b=document.querySelector('#toggle-task3');
  let err=null;try{b.click();}catch(e){err=e.message;}
  return {clicked:!!b,err,panelHidden:document.querySelector('#task3-panel')?.hidden,activeView:document.querySelector('#app').dataset.activeView};
 });
 console.log('CLICK1',JSON.stringify(r1));
 // 尝试 hud menu 路径
 await page.locator('#toggle-deployment').click().catch(e=>console.log('deploy click',e.message.slice(0,150)));
 await page.waitForTimeout(1000);
 const r2=await page.evaluate(()=>({
  hudOpen:!!document.querySelector('#ac8-hud-menu-deployment, .ac8-hud-menu.is-open'),
  entries:[...document.querySelectorAll('#deployment-panel button, .ac8-hud-menu button')].map(b=>({id:b.id,text:b.textContent.trim().slice(0,20),visible:!!b.offsetParent})).slice(0,10),
  panelHidden:document.querySelector('#task3-panel')?.hidden,
 }));
 console.log('HUD',JSON.stringify(r2,null,1));
 await page.screenshot({path:'artifacts/task3/debug-deploy.png'});
}finally{await browser.close();}
