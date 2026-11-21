import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const out='artifacts/building-explanations',model=JSON.parse(await readFile(`${out}/device-explanation.json`,'utf8'));
const server=await createServer({cacheDir:'node_modules/.vite-pdf-fixture',server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{name:'pdf-fixture',configureServer(vite){vite.middlewares.use('/__pdf_test__',(_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>PDF 验证</title></html>');});}}]});let browser;
try{
 await server.listen();const executablePath=process.env.CHROMIUM_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>existsSync(p));browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();await page.route('**/fonts/*.otf',route=>route.abort());
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__pdf_test__`);
 const failed=await page.evaluate(async model=>{try{const pdf=await import('/src/task3/deployment-pdf.js');await pdf.renderDeviceExplanationPdfBuffer(model);return false;}catch{return true;}},model);assert.equal(failed,true,'字体加载失败必须给出错误');
 await page.unroute('**/fonts/*.otf');
 const data=await page.evaluate(async model=>{const pdf=await import('/src/task3/deployment-pdf.js'),buffer=await pdf.renderDeviceExplanationPdfBuffer(model);return Array.from(buffer);},model);
 const bytes=Buffer.from(data);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');await writeFile(`${out}/device-explanation.pdf`,bytes);
 console.log(`中文 PDF 字体加载失败后重试成功；${model.devices.length} 台设备，${bytes.length} 字节。`);
}finally{await browser?.close();await server.close();}
