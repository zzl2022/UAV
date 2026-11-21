import {chromium} from 'playwright-core';
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,300)));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5193',{timeout:120000,waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:90000});
 const openAndProbe=async tag=>{
  await page.locator('#open-city-model').click();
  await page.waitForFunction(()=>document.querySelector('#ac8-scene-menu')?.classList.contains('is-open'),null,{timeout:30000});
  await page.waitForTimeout(1500);
  const info=await page.evaluate(()=>{
   const b=document.querySelector('#city-tab-scene');const r=b.getBoundingClientRect();
   const el=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {rect:[r.x|0,r.y|0,r.width|0,r.height|0],at:el?el.tagName+'#'+(el.id||'')+'.'+(el.className?.baseVal??el.className):'none',menuCls:document.querySelector('#ac8-scene-menu').className,inert:b.closest('[inert]')!==null||b.inert};
  });
  console.log(tag,JSON.stringify(info));
 };
 await openAndProbe('FIRST');
 // Esc 关闭
 for(let i=0;i<3;i++){await page.keyboard.press('Escape');if(!await page.evaluate(()=>document.querySelector('#ac8-scene-menu')?.classList.contains('is-open')))break;}
 await page.waitForTimeout(800);
 await openAndProbe('SECOND');
}finally{await browser.close();}
