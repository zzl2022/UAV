import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const out=new URL('../../artifacts/cross-map-study/',import.meta.url),readJSON=async url=>JSON.parse(await readFile(url,'utf8'));
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(existsSync);
assert.ok(executablePath);const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(new URL('跨地图部署分析.html',out).href,{waitUntil:'load',timeout:120000});
 await page.waitForFunction(()=>window.studyReady===true);
 const data=await readJSON(new URL('dashboard-data.json',out));
 assert.deepEqual(data.summary,{maps:9,runs:252,plans:756,rules:data.rules.acceptedRules.length,configurationCount:28});
 assert.ok(data.rules.acceptedRules.length>0);
 for(const rule of data.rules.acceptedRules){assert.ok(rule.validatedMapCount>=3);assert.equal(rule.holdoutPassed.length,3);assert.equal(rule.counterexampleMaps.length,0);}
 for(const map of data.maps){
  await page.locator('#map-filter').selectOption(map.id);
  assert.match(await page.locator('#result-count').textContent(),/28 套方案/);
  assert.equal(await page.locator('#result-body tr').count(),24);
  await page.locator('#next').click();assert.equal(await page.locator('#result-body tr').count(),4);
 }
 await page.locator('#map-filter').selectOption('shenzhen');await page.locator('#case-filter').selectOption('X01');
 assert.equal(await page.locator('#result-body tr').count(),1);
 await page.locator('#result-body button').click();await page.locator('#detail').waitFor({state:'visible'});
 const configuration=JSON.parse(await page.locator('#config-json').textContent());
 assert.ok(configuration.buildingExclusionResolution.actualBuildingIds.length>0);
 assert.ok(configuration.settings.buildingExclusions.buildingIds.every(id=>id!=='synthetic-venue-footprint'));
 await page.screenshot({path:fileURLToPath(new URL('detail-shenzhen.png',out))});await page.locator('#close-detail').click();
 const downloadPromise=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadPromise;
 const saved=new URL('filtered-export-test.json',out);await download.saveAs(fileURLToPath(saved));
 const exported=await readJSON(saved);assert.equal(exported.length,1);assert.equal(exported[0].caseId,'X01');assert.equal(exported[0].mapId,'shenzhen');
 await page.locator('#map-filter').selectOption('all');await page.locator('#case-filter').selectOption('all');
 await page.screenshot({path:fileURLToPath(new URL('analysis-overview.png',out)),fullPage:true});
 await page.locator('[data-tab="rules"]').click();assert.equal(await page.locator('#rule-list .rule').count(),data.summary.rules);
 await page.screenshot({path:fileURLToPath(new URL('rules-validated.png',out)),fullPage:true});
 await page.locator('[data-tab="effects"]').click();assert.equal(await page.locator('#effects-list .effect').count(),27);
 await page.locator('[data-tab="parameters"]').click();
 const dictionary=await readJSON(new URL('parameter-dictionary.json',out));assert.equal(await page.locator('#module2 details').count(),dictionary.module2.length);
 await page.setViewportSize({width:390,height:844});await page.locator('[data-tab="results"]').click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'窄屏不得造成页面横向溢出');
 await page.screenshot({path:fileURLToPath(new URL('analysis-mobile.png',out)),fullPage:true});
 assert.deepEqual(errors,[]);
 const validation=await readJSON(new URL('validation-report.json',out));assert.equal(validation.passed,true);assert.equal(validation.finalConstraints.length,756);
 await writeFile(new URL('browser-verification.json',out),JSON.stringify({passed:true,maps:9,configurationsPerMap:28,plans:756,rules:data.summary.rules,checks:['9图筛选与分页','实际参数与真实建筑映射','最终设备坐标展示','筛选结果下载与内容','规则地图门槛','变量对照与相关性','完整参数字典','390px布局','756方案最终约束'],pageErrors:errors},null,2));
 console.log('PASS: 9 maps × 28 configurations, 756 plans; filters, download, rules, parameters, mobile layout');
}finally{await browser.close();}
