// 验证单文件 HTML：file:// 直接打开，章节齐全、图片全部内嵌、无外部资源、无 JS 报错，并存整页截图。
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],failed=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));
 await page.goto('file:///c:/Users/17311/Desktop/项目/创意二文件/UAV/任务三成果展示.html');
 await page.waitForLoadState('load');
 for(const id of ['guide','model','results','limits'])assert.ok(await page.locator(`#${id}`).count(),`缺章节 ${id}`);
 const imgs=await page.evaluate(()=>[...document.images].map(i=>i.src));
 assert.equal(imgs.length,11,'应有 11 张截图');for(const src of imgs)assert.ok(src.startsWith('data:image/png;base64,'),'图片须为内嵌 data URI');
 const html=await readFile('任务三成果展示.html','utf8');
 assert.ok(!/src="https?:|href="https?:|url\(https?:/.test(html),'不应引用外部资源');
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/task3/showcase/final-doc.png'});
 console.log('verify passed: 4 chapters, 11 embedded images, no external refs, no JS errors');
}finally{await browser.close();}
