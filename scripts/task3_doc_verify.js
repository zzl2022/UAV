// 三份任务三独立 HTML：数据一致性、file:// 离线、图表图片、桌面/移动端验收。
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const definitions=[
 {file:'任务三盲区消除与效果验证.html',stem:'blind',dataId:'blind-doc-data',schema:'task3-blind-doc/1.0',sections:['scope','logic','results','samples','validation','limits'],key:'results',minImages:3,minSvg:4},
 {file:'任务三电磁兼容优化与验证.html',stem:'emc',dataId:'emc-doc-data',schema:'task3-emc-doc/1.0',sections:['spectrum','dimensions','strategy','results','detection','validation','limits'],key:'detection',minImages:1,minSvg:3},
 {file:'任务三成果展示.html',stem:'showcase',dataId:'showcase-doc-data',schema:'task3-showcase-doc/1.0',sections:['guide','logic','comparison','best','rules','validation','limits'],key:'comparison',minImages:6,minSvg:5},
];
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const latest=await readJson('artifacts/task3/latest-report.json');
await mkdir('artifacts/task3/docs',{recursive:true});
const parsed=new Map();
for(const definition of definitions){
 const html=await readFile(definition.file,'utf8');
 assert.ok(!/(?:src|href)=["']https?:|url\(\s*["']?https?:/i.test(html),`${definition.file} 含外部资源`);
 const markupWithoutImages=html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g,'');
 assert.ok(!/TBD|TODO|待补充|示例数据|lorem ipsum|\bundefined\b|\bNaN\b/i.test(markupWithoutImages),`${definition.file} 含占位或无效值`);
 const match=html.match(new RegExp(`<script type="application/json" id="${definition.dataId}">([\\s\\S]*?)<\\/script>`));assert.ok(match,`${definition.file} 缺内嵌数据`);
 const data=JSON.parse(match[1]);assert.equal(data.schema,definition.schema);parsed.set(definition.stem,data);
 const imageSources=[...html.matchAll(/<img src="([^"]+)"/g)].map(item=>item[1]);assert.ok(imageSources.length>=definition.minImages);assert.ok(imageSources.every(src=>src.startsWith('data:image/png;base64,')));
}
{
 const data=parsed.get('blind'),E=data.evidence.elimination;
 assert.equal(E.before-E.after,E.count);assert.equal(E.before?E.count/E.before:null,E.ratio);
 assert.equal(data.analysis.sampleRows.filter(row=>row.state==='已消除').length,E.count);assert.equal(data.analysis.sampleRows.filter(row=>row.state==='仍保留').length,E.after);
 assert.equal(data.evidence.validation.newEmcFail,0);assert.ok(data.evidence.repair.summary.addedDeviceCount>0);
}
{
 const data=parsed.get('emc');assert.ok(data.plans.length>0);
 for(const plan of data.plans)for(const action of plan.actions)assert.ok(action.after.emcCounts.fail<action.before.emcCounts.fail,'每一步 EMC 动作必须减少 fail');
 assert.equal(data.actionRows.length,data.plans.reduce((sum,plan)=>sum+plan.actions.length,0));assert.ok(data.sampleReview,'有处置动作时必须有点级复核');
}
{
 const data=parsed.get('showcase');assert.equal(data.plans.length,latest.plans.length);assert.equal(data.summary.recommendedId,latest.recommendedId);
 assert.equal(data.recommendedDevices.length,latest.plans.find(plan=>plan.id===latest.recommendedId).devices.length);
 for(const plan of data.plans){const source=latest.plans.find(item=>item.id===plan.id);assert.equal(plan.trace.length,source.optimizationTrace.events.length);assert.deepEqual(plan.trace.map(event=>event.step),source.optimizationTrace.events.map(event=>event.step));}
 assert.ok(data.rules.every(rule=>rule.evidence.samples>0&&rule.evidence.runIds&&rule.evidence.method));assert.ok(data.limitationRows.length>=8);
}

const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const results=[];
try{
 for(const definition of definitions){
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  await page.goto(pathToFileURL(definition.file).href,{waitUntil:'load'});
  for(const id of definition.sections)assert.equal(await page.locator(`#${id}`).count(),1,`${definition.file} 缺章节 ${id}`);
  assert.ok(await page.locator('svg.chart').count()>=definition.minSvg,`${definition.file} SVG 图数量不足`);
  assert.ok(await page.locator('img').count()>=definition.minImages);
  await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
  assert.ok(await page.evaluate(()=>[...document.images].every(image=>image.src.startsWith('data:image/png;base64,'))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${definition.file} 桌面横向溢出`);
  await page.screenshot({path:`artifacts/task3/docs/${definition.stem}-top.png`});
  await page.locator(`#${definition.key}`).scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/task3/docs/${definition.stem}-key.png`});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${definition.file} 移动端横向溢出`);
  await page.screenshot({path:`artifacts/task3/docs/${definition.stem}-mobile.png`});
  assert.deepEqual(errors,[]);assert.deepEqual(requests.filter(url=>/^https?:/i.test(url)),[]);
  results.push({file:definition.file,sections:definition.sections.length,svg:await page.locator('svg.chart').count(),images:await page.locator('img').count(),offline:true,mobile:true});await page.close();
 }
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
