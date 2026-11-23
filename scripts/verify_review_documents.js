import {chromium} from 'playwright-core';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1100,height:1000},deviceScaleFactor:1});
 for(const name of ['设备建模核查与组会说明','默认参数逐项对照表']){
  await page.goto(pathToFileURL(process.cwd()+'/docs/review-2026-11-18/'+name+'.html').href);
  assert.ok(await page.locator('h1').count());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'artifacts/'+name+'-start.png'});
  const headings=await page.locator('h2').count();
  for(let i=0;i<headings;i++){await page.locator('h2').nth(i).scrollIntoViewIfNeeded();assert.ok(await page.locator('h2').nth(i).isVisible());}
  await page.screenshot({path:'artifacts/'+name+'-end.png'});
 }
 console.log('PASS: HTML documents render, all sections reachable, no horizontal overflow');
}finally{await browser.close();}
