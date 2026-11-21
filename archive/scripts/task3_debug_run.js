import {chromium} from 'playwright-core';
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,300)));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5193',{timeout:120000,waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:90000});
 const probe=async tag=>console.log(tag,await page.evaluate(()=>{
  const b=document.querySelector('#task3-run-side');if(!b)return 'no button';
  const r=b.getBoundingClientRect();const cs=getComputedStyle(b);
  const elAt=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
  return JSON.stringify({rect:[r.x|0,r.y|0,r.width|0,r.height|0],display:cs.display,visibility:cs.visibility,opacity:cs.opacity,disabled:b.disabled,atPoint:elAt?elAt.tagName+'#'+(elAt.id||elAt.className):'none',sidebarCls:document.querySelector('#workspace-sidebar')?.className,launchersCls:document.querySelector('.workspace-launchers')?.className});
 }));
 await probe('BEFORE');
 await page.locator('#toggle-deployment').click();
 await page.waitForFunction(()=>document.querySelector('#ac8-deployment-menu')?.classList.contains('is-open'));
 await page.locator('#ac8-deployment-menu .ac8-hud-tabs button[data-page="input"]').click();
 await page.waitForTimeout(800);
 await probe('AFTER-OPEN');
}finally{await browser.close();}
