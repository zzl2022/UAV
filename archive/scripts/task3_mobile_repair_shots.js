// 移动补盲实测截图：mobile-repair.png（补盲后）与 mobile-repair-restored.png（取消恢复）。
import {chromium} from 'playwright-core';
import {mkdir} from 'node:fs/promises';
const out='artifacts/task3';
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir(out,{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000,waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:120000});
 await page.locator('#toggle-task3').click();await page.locator('#task3-panel').waitFor({state:'visible',timeout:30000});
 await page.locator('#task3-run').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics.busy,null,{timeout:600000});
 await page.locator('.task3-subnav-btn[data-sub="mobile"]').click();
 await page.locator('#task3-mobile-repair').check();
 await page.waitForFunction(()=>!window.task3Diagnostics.mobilePending&&!window.task3Diagnostics.busy&&window.task3Diagnostics.mobileRepair,null,{timeout:600000});
 await page.locator('.task3-tabs button[data-tab="blindspots"]').click();await page.waitForTimeout(800);
 await page.screenshot({path:`${out}/mobile-repair.png`});console.log('mobile-repair.png');
 await page.locator('.task3-tabs button[data-tab="input"]').click();await page.locator('.task3-subnav-btn[data-sub="mobile"]').click();
 await page.locator('#task3-mobile-repair').uncheck();
 await page.waitForFunction(()=>!window.task3Diagnostics.mobilePending&&!window.task3Diagnostics.busy,null,{timeout:120000});
 await page.locator('.task3-tabs button[data-tab="blindspots"]').click();await page.waitForTimeout(800);
 await page.screenshot({path:`${out}/mobile-repair-restored.png`});console.log('mobile-repair-restored.png');
}finally{await browser.close();}
