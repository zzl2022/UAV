// 边缘场景：A 菜单打开时切图后再推演；B 切图后直接威胁推演（自动补算+自动播放）；C 推演中切图的旧结果污染检查。
import {chromium} from 'playwright-core';
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,300)));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5193',{timeout:120000,waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:180000});
 await page.waitForFunction(()=>window.task3Diagnostics,null,{timeout:90000});
 const switchScene=async scene=>{
  await page.locator('#open-city-model').click({force:true});
  await page.waitForFunction(()=>document.querySelector('#ac8-scene-menu')?.classList.contains('is-open'),null,{timeout:30000});
  await page.waitForTimeout(1300);
  await page.evaluate(()=>document.querySelector('#city-tab-scene').click());
  await page.locator('#model-select').waitFor({state:'visible',timeout:30000});
  await page.locator('#model-select').selectOption(scene);
  await page.waitForFunction(()=>!document.querySelector('#model-select').disabled,null,{timeout:240000});
  for(let i=0;i<3;i++){await page.keyboard.press('Escape');if(!await page.evaluate(()=>document.querySelector('#ac8-scene-menu')?.classList.contains('is-open')))break;}
  await page.waitForFunction(s=>window.cityDiagnostics?.modelMode===s,scene,{timeout:30000});
 };
 // C: 推演中切图 —— 检查旧地图结果是否被错误应用到新地图
 await page.locator('#task3-run-side').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.busy,null,{timeout:30000});
 await switchScene('shenzhen');
 await page.waitForTimeout(8000); // 等旧 worker 的迟到结果
 const c=await page.evaluate(()=>({ready:window.task3Diagnostics.ready,devices:window.task3Diagnostics.plans?.map(p=>p.devices)??null,status:document.querySelector('#task3-status-side')?.textContent}));
 console.log('C-LATE-RESULT',JSON.stringify(c));
 const staleApplied=c.ready===true;
 console.log(staleApplied?'C-FAIL: 旧地图结果被应用到新场景':'C-PASS: 切图后旧结果被正确丢弃');
 // A: 打开部署菜单详情后切图，再推演
 await page.locator('#toggle-deployment').click({force:true});
 await page.waitForFunction(()=>document.querySelector('#ac8-deployment-menu')?.classList.contains('is-open'),null,{timeout:30000});
 await page.locator('#ac8-deployment-menu .ac8-hud-tabs button[data-page="plans"]').click({force:true});
 await page.waitForTimeout(800);
 // 切图前先关闭推演菜单（真实操作：菜单互斥）
 for(let i=0;i<3;i++){await page.keyboard.press('Escape');if(!await page.evaluate(()=>document.querySelector('#ac8-deployment-menu')?.classList.contains('is-open')))break;}
 await switchScene('daxing');
 await page.locator('#task3-run-side').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics.busy,null,{timeout:600000});
 const a=await page.evaluate(()=>({devices:window.task3Diagnostics.plans?.map(p=>p.devices),status:document.querySelector('#task3-status-side')?.textContent}));
 console.log('A-RERUN',JSON.stringify(a));
 // B: 切图后直接威胁推演（无报告时应自动补算并播放）
 await switchScene('hangzhou');
 await page.evaluate(()=>{const s=document.querySelector('#ac8-sim-scenario');s.value='swarm';s.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.locator('#ac8-sim-start').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.playing||window.task3Diagnostics?.ready,null,{timeout:600000});
 const b=await page.evaluate(()=>({playing:window.task3Diagnostics.playing,ready:window.task3Diagnostics.ready,devices:window.task3Diagnostics.plans?.map(p=>p.devices)}));
 console.log('B-THREAT',JSON.stringify(b));
 console.log('EDGE-DONE');
}finally{await browser.close();}
