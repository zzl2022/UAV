// 任务三成果展示截图采集：对运行中的 dev server（默认 5173）逐面板真实操作并截屏。
// 输出 artifacts/task3/showcase/*.png，供 HTML 展示文档内嵌使用。全部为真实运行画面。
import {chromium} from 'playwright-core';
import {mkdir} from 'node:fs/promises';
const out='artifacts/task3/showcase';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir(out,{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5173',{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready,null,{timeout:120000});
 // 1 首页：城市三维建模（河南博物院片区）
 await page.waitForTimeout(1200);await page.screenshot({path:`${out}/home.png`});console.log('home.png');
 // 2 装备建模（子任务二）
 await page.locator('#toggle-sensors').click();await page.waitForTimeout(1500);
 await page.screenshot({path:`${out}/sensors.png`});await page.locator('#equipment-back').click();console.log('sensors.png');
 // 3 部署与飞行（既有模块）
 await page.locator('#toggle-planning').click();await page.waitForFunction(()=>window.planningDiagnostics?.ready,null,{timeout:120000});
 await page.waitForTimeout(800);await page.screenshot({path:`${out}/planning.png`});console.log('planning.png');
 // 4 任务三：推演完成态
 await page.locator('#toggle-task3').click();
 await page.locator('#task3-run').click();
 await page.waitForFunction(()=>window.task3Diagnostics?.ready&&!window.task3Diagnostics?.busy,null,{timeout:300000});
 await page.waitForTimeout(600);
 await page.locator('#task3-panel').evaluate(n=>n.scrollTop=0);await page.screenshot({path:`${out}/task3-run.png`});console.log('task3-run.png');
 // 5 方案对比 + 三维点位（全域视角）
 await page.locator('#task3-plans-table').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/task3-plans.png`});console.log('task3-plans.png');
 // 6 覆盖效果：推荐方案点位 + 核心圈 + 盲区（切换电磁干扰工况，盲区类别最全）
 await page.locator('#task3-condition').selectOption('interference');await page.waitForTimeout(600);
 await page.evaluate(()=>{const v=document.querySelector('#viewport');v.scrollIntoView();});
 await page.screenshot({path:`${out}/task3-coverage.png`});console.log('task3-coverage.png');
 // 7 四类盲区分布（图例+成因列表）
 await page.locator('#task3-blind-legend').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/task3-blindspots.png`});console.log('task3-blindspots.png');
 // 8 三类威胁推演播放中画面
 for(const [key,waitMs] of [['single',3500],['multi',3000],['swarm',3000]]){
  await page.locator('#task3-threat').selectOption(key);await page.waitForTimeout(400);
  await page.locator('#task3-threat-play').click();await page.waitForTimeout(waitMs);
  await page.screenshot({path:`${out}/task3-threat-${key}.png`});
  await page.locator('#task3-threat-play').click();console.log(`task3-threat-${key}.png`);
 }
 // 9 EMC 校核结论
 await page.locator('#task3-emc').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/task3-emc.png`});console.log('task3-emc.png');
 if(errors.length)throw new Error('页面报错：'+errors.join('; '));
 console.log('showcase screenshots done:',out);
}finally{await browser.close();}
