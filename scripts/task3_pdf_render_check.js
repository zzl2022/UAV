// PDF 渲染验证：不依赖访问密钥，直接在浏览器上下文构建三套方案的文档模型并生成 PDF。
// 覆盖：多方案合并、每方案威胁数据、中文字体嵌入、文件头与页数。
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDeploymentDocumentAll} from '../src/task3/deployment-doc.js';

const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/chromium');
const out='artifacts/task3';await mkdir(out,{recursive:true});

const conditions=[{id:'nominal',name:'基线 · 发射'},{id:'silent',name:'无线电静默'},{id:'weather',name:'雨雾及街道噪声'},{id:'interference',name:'电磁干扰'}];
const deviceSets={
 economy:[
  {id:'task3-economy-1',presetId:'radar-03d',type:'radar',name:'雷达1',position:[0,120,0]},
  {id:'task3-economy-2',presetId:'radio-tdoa',type:'radio',name:'无线电1',position:[200,100,-100]},
 ],
 balanced:[
  {id:'task3-balanced-1',presetId:'radar-03d',type:'radar',name:'雷达1',position:[0,120,0]},
  {id:'task3-balanced-2',presetId:'radio-tdoa',type:'radio',name:'无线电1',position:[200,100,-100]},
  {id:'task3-balanced-3',presetId:'optical-nvt',type:'optical',name:'光电1',position:[-150,90,120]},
  {id:'task3-balanced-4',presetId:'acoustic-cry',type:'acoustic',name:'声学1',position:[80,70,-160]},
 ],
 enhanced:[
  {id:'task3-enhanced-1',presetId:'radar-03d',type:'radar',name:'雷达1',position:[0,120,0]},
  {id:'task3-enhanced-2',presetId:'radio-tdoa',type:'radio',name:'无线电1',position:[200,100,-100]},
  {id:'task3-enhanced-3',presetId:'optical-nvt',type:'optical',name:'光电1',position:[-150,90,120]},
  {id:'task3-enhanced-4',presetId:'acoustic-cry',type:'acoustic',name:'声学1',position:[80,70,-160]},
  {id:'task3-enhanced-5',presetId:'radar-03d',type:'radar',name:'雷达2',position:[300,110,80]},
 ],
};
const metricsFor=offset=>conditions.map((condition,index)=>({condition:condition.id,name:condition.name,total:100,covered:92-offset-index,coverageRate:(92-offset-index)/100,blindRate:1-(92-offset-index)/100,redundant:20-offset,coreCoverageRate:0.99-offset*0.01,coreRedundantRate:0.85-offset*0.02}));
const typeCountsFor=devices=>devices.reduce((counts,device)=>(counts[device.type]=(counts[device.type]??0)+1,counts),{});
const plans=Object.entries(deviceSets).map(([id,devices],index)=>({
 id,name:id==='economy'?'经济型 · 雷达+无线电':id==='balanced'?'均衡型 · 全类型':'增强型 · 全类型+核心双覆盖',
 devices,sites:devices.map((device,slot)=>({id:`${id}-site-${slot+1}`,name:`${id} 点位${slot+1}`,position:device.position,installation:'屋顶固定安装，施工条件未实测'})),
 cost:[60,90,120][index],typeCounts:typeCountsFor(devices),metrics:metricsFor(index),
 coverageContributions:Object.fromEntries(devices.map((device,slot)=>[device.id,conditions.map((condition,cindex)=>({condition:condition.id,coveredSamples:Math.max(1,30-slot-cindex),independentSamples:Math.max(1,18-slot-cindex)}))])),
 areaEstimates:Object.fromEntries(conditions.map(condition=>[condition.id,[30,60,100].map((height,hindex)=>({height,validGridCells:100+hindex*20,blindGridCells:10+hindex*3,approximateBlindAreaMeters2:(10+hindex*3)*250000}))])),
 derivation:null,
}));
const threatKeys=['single','multi','swarm'],scenarioTarget={single:8,multi:4,swarm:42};
const threatsFor=(plan,index)=>Object.fromEntries(threatKeys.map((key,kindex)=>[key,{
 summary:{targetCount:scenarioTarget[key],meanFirstDetectionTime:5+index+kindex,meanDetectedFraction:0.82-index*0.05,minDetectedFraction:0.42-index*0.05,overflowEvents:key==='swarm'?3:0,overflowedTargets:key==='swarm'?3:0},
 perTarget:Array.from({length:Math.min(6,scenarioTarget[key])},(_,slot)=>({id:`${plan.id}-${key}-t${slot+1}`,firstDetectionTime:slot%3===2?null:2+slot,detectedFraction:1-slot*0.08,lossEvents:slot%3===2?1:0})),
 config:{count:scenarioTarget[key],directions:key==='single'?8:key==='multi'?4:3,azimuthsDeg:[0,90,180],aglM:[30,60],speedMps:15,simultaneous:key!=='single'},
 text:`${key} 场景逐帧实判汇总`,
}]));
const emcFor=(plan,index)=>{
 const fail=index===2?1:0,warning=index;
 const conflicts=fail||warning?[{a:plan.devices[0].id,b:plan.devices[1].id,kind:warning?'adjacent-channel':'co-channel',severity:fail?'fail':'warning',distanceM:120,recommendation:'换频或拉距至 ≥300 m'}]:[];
 return {verdict:fail?'degraded':'pass',counts:{fail,warning},conflicts,notes:['光电/声学设备无射频发射与接收，射频兼容天然通过'],text:fail?'发现需处置的射频冲突。':'未发现严重射频冲突。',source:'EMC_RULES',remediation:{status:fail?'resolved':'not-required',deployable:!fail,actions:fail?[{step:1,action:'retune',deviceId:plan.devices[0].id,reason:'在既有模型频道内换频'}]:[],unresolved:[]}};
};
const emc=Object.fromEntries(plans.map((plan,index)=>[plan.id,emcFor(plan,index)]));
const report={
 createdAt:new Date().toISOString(),plans,conditions,recommendedId:'balanced',
 settings:{spacing:500,siteSpacing:500,heights:[30,60,100],coreRadius:700,marginReserveDb:3,scopeWidthM:2400,scopeDepthM:2400},
 sampling:{samples:Array.from({length:100},(_,index)=>({core:index<20})),bounds:{core:[0,80,0]},excluded:{outsideDem:0,insideBuildings:0}},
 scope:{widthM:2400,depthM:2400,clipped:false,note:'采样仅使用实际 GIS/DEM 数据，不外推无数据区域覆盖。'},
 candidateCount:60,siteCount:12,
 blindspots:Object.fromEntries(plans.map(plan=>[plan.id,conditions.map(condition=>({conditionId:condition.id,stats:{total:10,byCategory:{gap:2,shadow:3,lowFacade:2,corner:1,other:2}}}))])),
 scoring:{plans:plans.map((plan,index)=>({id:plan.id,score:0.9-index*0.03,rank:index+1,emcVerdict:emc[plan.id].verdict})),method:'覆盖完整性、盲区占比、成本、施工可行性四指标跨方案 min-max 归一化后加权。',recommendationStatus:'deployable'},
 comparison:{rows:plans.map((plan,index)=>({rank:index+1,id:plan.id,name:plan.name,deviceCount:plan.devices.length,coverage:0.9-index*0.02,blindRatio:0.1+index*0.02,cost:plan.cost,feasibility:0.8-index*0.02,score:0.9-index*0.03})),weights:{coverage:0.4,blind:0.25,cost:0.2,feasibility:0.15}},
 weights:{coverage:0.4,blind:0.25,cost:0.2,feasibility:0.15},
 threats:threatsFor(plans[1],1),
 threatsByPlan:Object.fromEntries(plans.map((plan,index)=>[plan.id,threatsFor(plan,index)])),
 emc,deploymentStatus:'deployable',
 equipment:plans[1].devices.map(device=>({id:device.presetId,name:device.name,type:device.type})),
 limitations:['覆盖率仅针对所列有效空域采样点，不是连续空间无盲区证明。'],
};
const run={runId:'pdf-render-check',createdAt:new Date().toISOString()};

const documentModel=createDeploymentDocumentAll({report,run,activePlanId:'balanced'});
assert.equal(documentModel.plans.length,3,'文档模型应包含三套方案');
assert.deepEqual(documentModel.plans.map(plan=>plan.threats.scenarios.length),[3,3,3],'每套方案都应含三类威胁场景');

const server=await createServer({server:{host:'127.0.0.1',port:5174,strictPort:true},logLevel:'error'});
await server.listen();
console.log('[1/4] Vite 已启动');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({acceptDownloads:true});
 page.on('pageerror',error=>console.log('[pageerror]',error.message));
 page.on('console',message=>{if(message.type()==='error')console.log('[page console]',message.text());});
 // 只验证 PDF 模块，不初始化三维主应用，避免 WebGL/访问门干扰。
 await page.route('**/src/main.js',route=>route.abort());
 await page.goto('http://127.0.0.1:5174/',{waitUntil:'domcontentloaded',timeout:120000});
 console.log('[2/4] 页面已就绪');
 const diag=await Promise.race([
  page.evaluate(async()=>{
   const response=await fetch('/fonts/NotoSansSC-Regular.otf');
   const bytes=(await response.arrayBuffer()).byteLength;
   const module=await import('/src/task3/deployment-pdf.js');
   return {fontOk:response.ok,fontBytes:bytes,exports:Object.keys(module)};
  }),
  new Promise((_,reject)=>setTimeout(()=>reject(new Error('诊断超时（60 秒）')),60000)),
 ]);
 console.log('[diag]',JSON.stringify(diag));
 const result=await Promise.race([
  page.evaluate(async models=>{
   const {renderDeploymentPdfBuffer,validateDeploymentDocument}=await import('/src/task3/deployment-pdf.js');
   validateDeploymentDocument(models);
   const buffer=await renderDeploymentPdfBuffer(models);
   const bytes=new Uint8Array(buffer);let binary='';const chunk=0x8000;
   for(let index=0;index<bytes.length;index+=chunk)binary+=String.fromCharCode(...bytes.subarray(index,Math.min(index+chunk,bytes.length)));
   return {base64:btoa(binary)};
  },documentModel.plans),
  new Promise((_,reject)=>setTimeout(()=>reject(new Error('PDF 渲染超时（180 秒）')),180000)),
 ]);
 const downloadEvent=page.waitForEvent('download',{timeout:120000});
 await page.evaluate(async ({report,run})=>{
  const {exportDeploymentPdf}=await import('/src/task3/deployment-pdf.js');
  await exportDeploymentPdf({report,run,planIds:'all',activePlanId:'balanced'});
 },{report,run});
 const download=await downloadEvent;
 assert.match(download.suggestedFilename(),/已生成方案\.pdf$/,'导出文件名应包含已生成方案');
 console.log('[download]',download.suggestedFilename());
 console.log('[3/4] PDF 已渲染');
 const pdf=Buffer.from(result.base64,'base64');
 assert.match(pdf.toString('latin1',0,8),/^%PDF-/,'PDF 文件头');
 assert.ok(pdf.length>50000,`PDF 体积过小：${pdf.length}`);
 assert.match(pdf.toString('latin1'),/FontFile|CIDFontType/,'PDF 应嵌入中文字体');
 const pageCount=(pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)||[]).length;
 const pdfPath=`${out}/pdf-render-check.pdf`;await writeFile(pdfPath,pdf);
 console.log(JSON.stringify({pdf:{path:pdfPath,bytes:pdf.length,pages:pageCount||'未解析'},plans:documentModel.plans.map(plan=>({id:plan.plan.id,devices:plan.devices.length,threats:plan.threats.scenarios.length,coverage:plan.metrics.conditions.map(row=>({condition:row.condition,covered:row.covered,total:row.total}))})),verified:'三套方案合并 + 中文字体嵌入 + PDF 文件头'},null,2));
}finally{
 await browser.close();
 await server.close();
}
