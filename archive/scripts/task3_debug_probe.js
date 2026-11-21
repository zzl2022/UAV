import {chromium} from 'playwright-core';
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 page.on('console',m=>console.log('CONSOLE',m.type(),m.text().slice(0,200)));
 page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,300)));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5193',{timeout:120000,waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
 const s1=await page.evaluate(()=>({
  revealed:document.body.classList.contains('app-revealed'),
  sceneMenu:!!document.querySelector('#ac8-scene-menu'),
  launcherVisible:(()=>{const b=document.querySelector('#open-city-model');const r=b.getBoundingClientRect();return {rect:[r.x,r.y,r.width,r.height],display:getComputedStyle(b).display,visibility:getComputedStyle(b).visibility,disabled:b.disabled,expanded:b.getAttribute('aria-expanded')};})(),
  cityWindow:(()=>{const w=document.querySelector('#city-window');return w?{open:w.open,hidden:w.hidden,cls:w.className,tag:w.tagName}:null;})(),
  task3:!!window.task3Diagnostics,
 }));
 console.log('STATE',JSON.stringify(s1,null,1));
 await page.locator('#open-city-model').click({timeout:5000}).catch(e=>console.log('click fail',e.message.slice(0,200)));
 await page.waitForTimeout(1500);
 const s2=await page.evaluate(()=>({
  expanded:document.querySelector('#open-city-model')?.getAttribute('aria-expanded'),
  cityWindow:(()=>{const w=document.querySelector('#city-window');return w?{open:w.open,cls:w.className,rect:w.getBoundingClientRect().toJSON?.()}:null;})(),
  selectVisible:(()=>{const s=document.querySelector('#model-select');const r=s.getBoundingClientRect();return {display:getComputedStyle(s).display,rect:[r.x,r.y,r.width,r.height]};})(),
  sceneMenuOpen:document.querySelector('#ac8-scene-menu')?.className,
 }));
 console.log('AFTER',JSON.stringify(s2,null,1));
 await page.screenshot({path:'artifacts/task3/debug-open.png'});
}finally{await browser.close();}
