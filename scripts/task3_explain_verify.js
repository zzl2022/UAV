// 验证《任务三模型可解释性.html》：file:// 打开、章节齐全、无外部资源、无 JS 报错、SVG 渲染，存整页截图。
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],failed=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));
 await page.goto('file:///c:/Users/17311/Desktop/项目/创意二文件/UAV/任务三模型可解释性.html');
 await page.waitForLoadState('load');
 for(const id of ['s0','s1','s2','s3','s4','s5','s6','s7','s8'])assert.ok(await page.locator(`#${id}`).count(),`缺章节 ${id}`);
 const html=await readFile('任务三模型可解释性.html','utf8');
 assert.ok(!/src="https?:|href="https?:|url\(https?:/.test(html),'不应引用外部资源');
 assert.ok((await page.locator('svg').count())>=4,'至少 4 幅 SVG 图');
 assert.ok((await page.locator('.model-card').count())>=8,'模型卡片数量');
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/task3/showcase/explain-top.png'});
 await page.locator('#s3').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/task3/showcase/explain-greedy.png'});
 console.log('verify passed: 9 sections, SVG diagrams, model cards, no external refs, no JS errors');
}finally{await browser.close();}
