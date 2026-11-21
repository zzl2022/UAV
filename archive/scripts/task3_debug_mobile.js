import {chromium} from 'playwright-core';
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5193',{timeout:120000,waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:90000});
 await page.locator('#task3-run-side').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics.busy,null,{timeout:600000});
 await page.locator('#toggle-deployment').click({force:true});
 await page.waitForFunction(()=>document.querySelector('#ac8-deployment-menu')?.classList.contains('is-open'),null,{timeout:30000});
 await page.waitForTimeout(1000);
 await page.evaluate(()=>{document.querySelector('#ac8-deployment-menu .ac8-hud-tabs button[data-page="input"]')?.click();});
 await page.waitForTimeout(800);
 const state=await page.evaluate(()=>({
  subnavBtns:[...document.querySelectorAll('.task3-subnav-btn')].map(b=>({sub:b.dataset.sub,text:b.textContent})),
  panelHidden:document.querySelector('#task3-panel')?.hidden,
  mobileCb:!!document.querySelector('#task3-mobile-repair'),
  panes:[...document.querySelectorAll('.task3-pane')].map(p=>({hidden:p.hidden,hasMobile:!!p.querySelector('#task3-mobile-repair')})),
 }));
 console.log(JSON.stringify(state,null,1));
}finally{await browser.close();}
