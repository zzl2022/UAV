import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';

const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/task3',{recursive:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.APP_URL||'http://127.0.0.1:5173'}?intro=0&demo=0`,{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.task3Diagnostics,null,{timeout:120000});
 const info=key=>page.locator(`.ac8-scene-info [data-info="${key}"]`);
 const waitInfo=(key,fragment)=>page.waitForFunction(({key,fragment})=>document.querySelector(`.ac8-scene-info [data-info="${key}"]`)?.textContent.includes(fragment),{key,fragment},{timeout:15000});
 assert.deepEqual(await page.locator('.ac8-scene-info .ac8-info-label').allTextContents(),['[当前场景]','[装备建模]','[推演输入]','[方案对比]','[盲区分析]','[电磁兼容]']);
 const equipment='雷达：02C 三坐标雷达｜无线电：TDOA-X1B｜光电：NVT-951 双光谱光电｜声学：CRY8500 声学相机｜5G-A：A9650 S49 大张角通感设备｜静电：CRSC-ER-1 静电探测设备';
 await waitInfo('equipmentConfig',equipment);
 assert.equal((await info('equipmentConfig').textContent()).trim(),equipment);
 assert.doesNotMatch(await info('equipmentConfig').textContent(),/(^|\s)\d+\s*台|[/·]/);
 for(const fragment of ['范围 2400 × 2400 m','网格 500 m','预算 600','设备上限 64','威胁 单机单点入侵','1 架','速度 15 m/s'])await waitInfo('deploymentInput',fragment);
 for(const key of ['planComparison','blindAnalysis','emc'])await waitInfo(key,'尚未生成');

 await page.locator('#toggle-deployment').click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isOpen(),null,{timeout:5000});
 await page.locator('#ac8-deployment-menu .ac8-hud-tabs button',{hasText:'推演输入'}).click();
 await page.waitForFunction(()=>window.__ac8DeploymentMenu?.isDetail(),null,{timeout:5000});
 await page.locator('#task3-panel').waitFor({state:'visible',timeout:10000});
 const selectView=async(tab,sub=null)=>{
  await page.evaluate(({tab,sub})=>{
   document.querySelector(`#task3-panel [data-tab="${tab}"]`).click();
   if(sub)document.querySelector(`#task3-panel [data-sub="${sub}"]`).click();
  },{tab,sub});
 };
 const assertPdf=async(visible,enabled)=>{
  const state=await page.evaluate(()=>{const button=document.querySelector('#task3-export-pdf');return {hidden:button.hidden,disabled:button.disabled,tabIndex:button.tabIndex,rendered:button.getClientRects().length>0};});
  assert.deepEqual(state,{hidden:!visible,disabled:!enabled,tabIndex:enabled?0:-1,rendered:visible});
  const focused=await page.evaluate(()=>{const button=document.querySelector('#task3-export-pdf');document.querySelector('#task3-restore-defaults').focus();button.focus();return document.activeElement===button;});
  assert.equal(focused,enabled,'PDF 按钮的键盘可达性必须与启用状态一致');
 };
 await assertPdf(false,false);
 await selectView('input','generate');
 await assertPdf(true,false);
 await page.locator('#task3-run-side').evaluate(button=>button.click());
 await page.waitForFunction(()=>window.task3Diagnostics.busy,null,{timeout:10000});
 await assertPdf(true,false);
 await page.waitForFunction(()=>window.task3Diagnostics.ready&&!window.task3Diagnostics.busy,null,{timeout:300000});
 assert.equal(await page.evaluate(()=>window.task3Diagnostics.staleResult),false,'最新成功结果不得误标为已过期');
 await assertPdf(true,true);

 const data=await page.evaluate(()=>{
  const report=window.__task3Report,diag=window.task3Diagnostics,plan=report.plans.find(item=>item.id===diag.planId),metric=plan.metrics.find(item=>item.condition===diag.condition)??plan.metrics[0];
  const conditionIndex=Math.max(0,report.conditions.findIndex(item=>item.id===diag.condition)),threat=report.threatsByPlan[plan.id].swarm;
  return {planCount:report.plans.length,recommended:report.plans.find(item=>item.id===report.recommendedId).name.split(' · ')[0],plan:plan.name.split(' · ')[0],devices:plan.devices.length,cost:plan.cost,score:report.scoring.plans.find(item=>item.id===plan.id).score,coverage:metric.coverageRate,weakest:Math.min(...plan.metrics.map(item=>item.coverageRate)),blind:metric.blindRate,points:report.blindspots[plan.id][conditionIndex].stats.total,core:metric.coreCoverageRate,redundant:metric.coreRedundantRate,averageBlind:plan.metrics.reduce((sum,item)=>sum+item.blindRate,0)/plan.metrics.length,swarm:threat.summary.targetCount,detected:threat.perTarget.filter(item=>item.firstDetectionTime!==null).length,emc:report.emc[plan.id],deployable:plan.deployable};
 });
 await waitInfo('planComparison',`${data.planCount} 套`);
 const planText=await info('planComparison').textContent();
 for(const fragment of [`推荐方案${data.recommended}`,`当前方案${data.plan}`,`设备 ${data.devices} 台`,`相对成本 ${data.cost.toFixed(1)}`,`综合分 ${data.score.toFixed(3)}`,`蜂群验证 ${data.swarm} 架`,`检出 ${data.detected} 架`])assert.ok(planText.includes(fragment),`方案对比缺少：${fragment}`);
 await waitInfo('blindAnalysis','移动补盲 未启用');
 const blindText=await info('blindAnalysis').textContent();
 for(const fragment of [`当前工况覆盖率 ${(data.coverage*100).toFixed(1)}%`,`最弱工况覆盖 ${(data.weakest*100).toFixed(1)}%`,`盲点数 ${data.points} / 盲区占比 ${(data.blind*100).toFixed(1)}%`,`核心覆盖 ${(data.core*100).toFixed(1)}% / 二重覆盖 ${(data.redundant*100).toFixed(1)}%`,`平均盲区 ${(data.averageBlind*100).toFixed(1)}%`])assert.ok(blindText.includes(fragment),`盲区分析缺少：${fragment}`);
 const verdict={pass:'通过',degraded:'降额',fail:'不通过'}[data.emc.verdict];
 await waitInfo('emc','部署状态');
 const emcText=await info('emc').textContent();
 for(const fragment of [verdict,`严重 ${data.emc.counts.fail} / 提示 ${data.emc.counts.warning}`,`部署状态 ${data.deployable?'可部署':'不可部署，存在未解决严重冲突'}`])assert.ok(emcText.includes(fragment),`电磁兼容缺少：${fragment}`);

 assert.ok(data.points>0,'默认工况应有盲点以验证移动补盲派生摘要');
 await selectView('blindspots','mobile');
 await page.locator('#task3-mobile-repair').check();
 await page.waitForFunction(()=>window.task3Diagnostics.mobileRepair&&!window.task3Diagnostics.busy,null,{timeout:300000});
 const derivedAdded=await page.evaluate(()=>window.task3Diagnostics.mobileRepair.addedDeviceCount);
 assert.ok(derivedAdded>0,'移动补盲应生成真实派生设备');
 await waitInfo('planComparison',`移动补盲派生（新增 ${derivedAdded} 台）`);
 await waitInfo('planComparison','蜂群验证（原方案，派生未重算）');
 await waitInfo('blindAnalysis',`移动补盲 派生新增 ${derivedAdded} 台，全工况覆盖、盲区与 EMC 已重算`);
 await waitInfo('emc',`移动补盲派生（新增 ${derivedAdded} 台）`);
 await page.locator('#task3-mobile-repair').uncheck();
 await page.waitForFunction(()=>!window.task3Diagnostics.mobileRepair&&!window.task3Diagnostics.busy,null,{timeout:10000});
 await waitInfo('blindAnalysis','移动补盲 未启用');
 assert.doesNotMatch(await info('planComparison').textContent(),/移动补盲派生/);

 const pdfDownloads=[];
 for(const [tab,subs] of Object.entries({input:['scope','weights','threat','generate'],plans:[null],blindspots:['blind','mobile'],emc:[null]})){
  for(const sub of subs){
   await selectView(tab,sub);
   const visible=tab==='plans'||(tab==='input'&&sub==='generate');
   await assertPdf(visible,visible);
   if(visible){
    const label=tab==='plans'?'plans':'generate',runId=await page.evaluate(()=>window.__task3Run.runId),event=page.waitForEvent('download',{timeout:120000});
    await page.locator('#task3-export-pdf').click();const download=await event,path=`artifacts/task3/summary-${label}.pdf`;await download.saveAs(path);
    const bytes=await readFile(path);assert.match(bytes.toString('latin1',0,8),/^%PDF-/);assert.ok(bytes.length>50000);assert.ok(download.suggestedFilename().includes(runId),'PDF 文件名必须对应本次已生成方案 runId');
    await page.waitForFunction(id=>document.querySelector('#task3-status-side')?.textContent.includes(`已按 ${id} 生成`),runId,{timeout:30000});
    pdfDownloads.push({view:label,path,bytes:bytes.length,filename:download.suggestedFilename()});
   }
  }
 }

 await selectView('input','generate');
 await page.locator('#task3-run-side').evaluate(button=>button.click());
 await page.waitForFunction(()=>window.task3Diagnostics.busy,null,{timeout:10000});
 await assertPdf(true,false);
 await waitInfo('planComparison','方案计算中，以下为上一轮结果');
 await page.locator('#task3-cancel-side').evaluate(button=>button.click());
 await page.waitForFunction(()=>!window.task3Diagnostics.busy&&window.task3Diagnostics.updateReason==='用户取消',null,{timeout:10000});
 for(const key of ['planComparison','blindAnalysis','emc'])await waitInfo(key,'结果已过期，以下为上一轮结果');
 await waitInfo('deploymentInput','结果已过期，待重新生成');
 await assertPdf(true,true);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',equipment,infoRows:['推演输入','方案对比','盲区分析','电磁兼容'],metrics:{plans:data.planCount,devices:data.devices,blindPoints:data.points,swarm:data.swarm,emc:data.emc.verdict,derivedAdded},pdfViews:{visible:['input/generate','plans'],hidden:['input/scope','input/weights','input/threat','blindspots/blind','blindspots/mobile','emc']},pdfDownloads,freshLatestResult:true,states:['未生成','计算中','取消后结果已过期','移动补盲派生及恢复'],pageErrors:errors},null,2));
}finally{await browser.close();}
