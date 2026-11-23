import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {runTask3Pipeline} from '../src/task3/pipeline.js';
import {createDeviceExplanation} from '../src/task3/device-explanation.js';
const out='artifacts/device-explanation-review';await mkdir(out,{recursive:true});
const read=name=>readFile(`public/data/${name}.json`,'utf8').then(JSON.parse);
let report,run;
if(process.argv.includes('--reuse-data'))({report,run}=JSON.parse(await readFile(`${out}/source-report.json`,'utf8')));
else{
 const city=await read('city'),terrain=await read('terrain'),query=createSceneQuery(createModel(city,terrain));
 console.log('计算真实场景和三套方案，保存本轮候选比较证据。');
 ({report,run}=await runTask3Pipeline({city,query,presetIds:['radar-02c','radio-tdoa','optical-nvt','acoustic-cry'],withThreatFrames:false}));
}
const plan=report.plans.find(p=>p.id===report.recommendedId),types=new Set(),deviceIds=[];
for(const device of plan.devices)if(!types.has(device.type)&&deviceIds.length<2){types.add(device.type);deviceIds.push(device.id);}
const model=createDeviceExplanation({report,run,activePlanId:plan.id,conditionId:'nominal',deviceIds});
assert.deepEqual(model.devices.map(d=>d.id),deviceIds);
for(const device of model.devices){
 assert.equal(device.parameterRows.length,Object.keys(device.parameters).length+Object.keys(device.physics).length);
 const alternatives=device.evidence?.otherSites??[];assert.equal(new Set(alternatives.map(row=>row.siteId)).size,alternatives.length);
 for(const row of device.linkExamples)assert.equal(row.covered,row.status==='within-model'&&row.marginDb!==null&&row.marginDb>=report.settings.marginReserveDb);
 const event=device.evidence?.selection;if(event){const row=event.sameSiteAlternatives.find(r=>r.selectedAtThisStep);assert.ok(Math.abs(row.gain-event.event.gain)<1e-7);assert.ok(Math.abs(row.gainPerCost-event.event.gainPerCost)<1e-7);}
}
await writeFile(`${out}/source-report.json`,JSON.stringify({report,run}));await writeFile(`${out}/device-explanation.json`,JSON.stringify(model,null,2));
console.log(`运行 ${run.runId}，推荐 ${plan.id}，本明细选取 ${deviceIds.length} 台真实设备。`);
const server=await createServer({cacheDir:'node_modules/.vite-device-report',server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{name:'device-report-fixture',configureServer(vite){vite.middlewares.use('/__device_report__',(_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>设备部署解释明细</title></html>');});}}]});let browser;
try{
 await server.listen();const executablePath=process.env.CHROMIUM_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(p=>existsSync(p));browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({acceptDownloads:true});await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__device_report__`);
 const bytes=Buffer.from(await page.evaluate(async model=>{const {renderDeviceExplanationPdfBuffer}=await import('/src/task3/deployment-pdf.js');return Array.from(await renderDeviceExplanationPdfBuffer(model));},model));
 assert.equal(bytes.subarray(0,5).toString(),'%PDF-');await writeFile(`${out}/device-explanation.pdf`,bytes);
 const download=page.waitForEvent('download',{timeout:120000});await page.evaluate(async input=>{const {exportDeviceExplanationPdf}=await import('/src/task3/deployment-pdf.js');await exportDeviceExplanationPdf(input);},{report,run,activePlanId:plan.id,conditionId:'nominal',deviceIds});await (await download).saveAs(`${out}/downloaded-explanation.pdf`);
 console.log(`PDF 与实际下载完成：${bytes.length} 字节。`);
}finally{await browser?.close();await server.close();}
