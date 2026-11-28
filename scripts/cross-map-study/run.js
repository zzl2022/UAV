import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {readFile,writeFile,mkdir,rename,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {join,resolve,relative} from 'node:path';
import {createModel} from '../../src/model.js';
import {createSceneQuery} from '../../src/sensors/scene.js';
import {siteAnalysisMetadata} from '../../src/site-analysis.js';
import {museumLandmark} from '../../src/landmarks.js';
import {runTask3Pipeline} from '../../src/task3/pipeline.js';
import {validateRun} from '../../src/task3/runs.js';
import {boundsFor,scenarios} from '../../src/planning/optimizer.js';
import {MAPS,CONFIGURATIONS,BASE_SETTINGS,STUDY_SCHEMA,resolveConfiguration,parameterDictionary} from './design.js';
import {makeAuditSamples,makeAuditEvaluator,makePairedProbes,geography,validateFinalPlan} from './measure.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const saveJSON=async(path,data)=>{const temp=path+'.tmp';await writeFile(temp,JSON.stringify(data,null,2));await rename(temp,path);};
export function resolveResearchCoreExclusions(city,landmark){
 if(landmark.buildingIds.length&&landmark.buildingIds.every(id=>city.buildings.some(b=>b.id===id)))return {buildingIds:landmark.buildingIds};
 const footprint=city.metadata?.coreBuilding;if(!footprint?.rings?.[0]?.length)throw Error('核心缺少可核验的定位包络');
 const envelope=ring=>({west:Math.min(...ring.map(p=>p[0])),east:Math.max(...ring.map(p=>p[0])),south:Math.min(...ring.map(p=>p[2])),north:Math.max(...ring.map(p=>p[2]))});
 const coreBox=envelope(footprint.rings[0]);
 const actual=city.buildings.filter(b=>{const box=envelope(b.rings[0]);return box.west<=coreBox.east&&box.east>=coreBox.west&&box.south<=coreBox.north&&box.north>=coreBox.south;}).map(b=>b.id);
 if(!actual.length)throw Error('核心示意范围没有可映射的真实建筑，不能假造禁部署清单');
 return {buildingIds:actual,resolution:{originalCoreIds:landmark.buildingIds,actualBuildingIds:actual,coreBox,method:'核心元数据为示意定位框，以其外包框与真实建筑外包框相交作保守研究禁部署映射；未修改几何，亦不认定真实用途或许可'}};
}
async function filesUnder(path){const result=[];for(const entry of await readdir(path,{withFileTypes:true})){const next=join(path,entry.name);if(entry.isDirectory())result.push(...await filesUnder(next));else result.push(next);}return result;}
async function fingerprint(){
 const files=[...(await filesUnder(join(root,'src'))).filter(p=>p.endsWith('.js')),join(root,'scripts/cross-map-study/design.js'),join(root,'scripts/cross-map-study/measure.js'),join(root,'scripts/cross-map-study/run.js')].sort();
 const sources=[];for(const path of files)sources.push({path:relative(root,path).replaceAll('\\','/'),sha256:sha(await readFile(path))});
 return {hash:sha(JSON.stringify(sources)),calculationHash:sha(JSON.stringify(sources.filter(s=>s.path!=='scripts/cross-map-study/run.js'))),files:sources};
}
async function loadMap(map){
 const paths=map.base?[`public/${map.base}.json`,`public/${map.base}-meta.json`]:['public/data/city.json','public/data/terrain.json'];
 const inputs=[];for(const path of paths){const data=await readFile(join(root,path));inputs.push({path,sha256:sha(data),bytes:data.length});}
 if(!map.base)return {city:await readJSON(join(root,paths[0])),terrain:await readJSON(join(root,paths[1])),inputs};
 const data=await readJSON(join(root,paths[0])),meta=await readJSON(join(root,paths[1])),[x0,x1,z0,z1]=meta.localBounds;
 const terrain={positions:[x0,0,z0,x1,0,z0,x1,0,z1,x0,0,z1],indices:[0,2,1,0,3,2],uvs:[0,1,1,1,1,0,0,0],rows:1,cols:1,min:0,max:0,resolution:null,bounds:meta.localBounds};
 return {city:{metadata:siteAnalysisMetadata(meta,{...map,label:map.name}),buildings:data.buildings},terrain,inputs,meta};
}
async function runMap({map,caseIds,out,engineFingerprint,compatibleRevisions}){
 const dir=join(out,'runs',map.id);await mkdir(dir,{recursive:true});
 parentPort?.postMessage({type:'loading',map:map.id});
 const loaded=await loadMap(map),{city,terrain,inputs}=loaded,model=createModel(city,terrain),query=createSceneQuery(model),landmark=museumLandmark(city);
 if(!landmark)throw Error(`地图 ${map.id} 无核心定位`);
 const audit=makeAuditSamples(query,boundsFor(city,BASE_SETTINGS)),evaluateAudit=makeAuditEvaluator(query,audit);
 if(!audit.points.length)throw Error(`地图 ${map.id} 无独立验证采样点`);
 const mapRecord={...map,inputs,origin:city.metadata.origin,core:landmark,coreMetadata:loaded.meta?.coreBuilding??null,geography:geography(city,query,audit.bounds),dataBounds:query.getDataBounds(),audit};
 await saveJSON(join(out,`map-${map.id}.json`),mapRecord);
 const completed=[];
 for(const definition of CONFIGURATIONS.filter(c=>caseIds.includes(c.id))){
  const configuration=resolveConfiguration(definition,landmark.buildingIds);
  if(definition.excludeCore){
   const resolved=resolveResearchCoreExclusions(city,landmark);configuration.settings.buildingExclusions.buildingIds=resolved.buildingIds;
   if(resolved.resolution)configuration.buildingExclusionResolution=resolved.resolution;
  }
  const inputDigest=sha(JSON.stringify({engineFingerprint,configuration,inputs})),path=join(dir,`${definition.id}.json.gz`);
  try{const saved=JSON.parse(gunzipSync(await readFile(path)));const compatible=compatibleRevisions.includes(saved.engineFingerprint)&&JSON.stringify(saved.configuration)===JSON.stringify(configuration)&&JSON.stringify(saved.inputFiles)===JSON.stringify(inputs);if(saved.inputDigest===inputDigest||compatible){completed.push(saved.summary);parentPort?.postMessage({type:'skipped',map:map.id,caseId:definition.id,summary:saved.summary});continue;}}catch{}
  const started=Date.now();parentPort?.postMessage({type:'start',map:map.id,caseId:definition.id});
  try{
   const {report,run}=await runTask3Pipeline({city,query,...configuration,withThreatFrames:true,yieldTask:async()=>{},progress:()=>{}});validateRun(run);
   const audits={},validation={};
   for(const plan of report.plans){audits[plan.id]=evaluateAudit(plan.devices,configuration.environment,configuration.target,configuration.settings.marginReserveDb);validation[plan.id]=validateFinalPlan(city,query,report,plan);}
   const recommended=report.plans.find(p=>p.id===report.recommendedId),selectedAudit=audits[recommended.id],metric=selectedAudit.metrics.find(m=>m.condition==='nominal');
   const summary={mapId:map.id,mapName:map.name,caseId:definition.id,label:definition.label,group:definition.group,runId:run.runId,inputDigest,planId:recommended.id,deviceCount:recommended.devices.length,typeCounts:validation[recommended.id].actualTypeCounts,cost:recommended.cost,trainCoverage:recommended.metrics[0].coverageRate,trainWorstCoverage:Math.min(...recommended.metrics.map(m=>m.coverageRate)),auditCoverage:metric.coverageRate,auditWorstCoverage:selectedAudit.robustCoverage,auditWorstCoreCoverage:selectedAudit.worstCoreCoverage,auditLowCoverage:metric.lowCoverageRate,auditRedundancy:metric.redundancyRate,validationPointCount:audit.points.length,scopeClipped:report.scope.clipped,emcFail:report.emc[recommended.id].counts.fail,emcWarning:report.emc[recommended.id].counts.warning,sampleCount:report.sampling.samples.length,candidateCount:report.candidateCount,siteCount:report.siteCount,threats:Object.fromEntries(Object.entries(report.threats).map(([key,r])=>[key,r.summary])),configuration,elapsedMs:Date.now()-started};
   const record={schema:STUDY_SCHEMA,mapId:map.id,inputDigest,engineFingerprint,inputFiles:inputs,configuration,actualConditions:scenarios(configuration.environment),mapGeography:mapRecord.geography,auditDescriptor:{...audit,points:undefined},audits,finalValidation:validation,summary,report,run};
   const zipped=gzipSync(JSON.stringify(record));await writeFile(path+'.tmp',zipped);await rename(path+'.tmp',path);
   if(definition.id==='B00'){
    const probes=makePairedProbes(city,query,audit,report.plans.flatMap(p=>p.sites).filter((s,i,all)=>all.findIndex(x=>x.id===s.id)===i),configuration.settings);
    await saveJSON(join(out,`probes-${map.id}.json`),{mapId:map.id,engineFingerprint,inputDigest,...probes});
   }
   completed.push(summary);await saveJSON(join(out,`progress-${map.id}.json`),{mapId:map.id,completed:completed.map(r=>r.caseId),last:summary.caseId,updatedAt:new Date().toISOString()});
   parentPort?.postMessage({type:'complete',map:map.id,caseId:definition.id,summary,bytes:zipped.length});
  }catch(error){await saveJSON(join(dir,`${definition.id}.error.json`),{mapId:map.id,caseId:definition.id,inputDigest,configuration,error:error.stack});parentPort?.postMessage({type:'case-error',map:map.id,caseId:definition.id,error:error.message});throw error;}
 }
 return {mapId:map.id,completed:completed.length};
}
if(!isMainThread){
 try{const result=await runMap(workerData);parentPort.postMessage({type:'map-complete',...result});}catch(error){parentPort.postMessage({type:'fatal',map:workerData.map.id,error:error.stack});process.exitCode=1;}
}else if(fileURLToPath(import.meta.url)===resolve(process.argv[1]??'')){
 const arg=(name,defaultValue)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')??defaultValue;
 const maps=MAPS.filter(m=>arg('maps',MAPS.map(m=>m.id).join(',')).split(',').includes(m.id)),caseIds=arg('cases',CONFIGURATIONS.map(c=>c.id).join(',')).split(','),out=resolve(root,arg('out','artifacts/cross-map-study'));
 if(!maps.length||caseIds.some(id=>!CONFIGURATIONS.some(c=>c.id===id)))throw Error('未知地图或实验配置');
 await mkdir(out,{recursive:true});
 const code=await fingerprint();let previous=null;try{previous=await readJSON(join(out,'manifest.json'));}catch{}
 const revisions=[...(previous?.engineRevisions??(previous?[{hash:previous.engineFingerprint,files:previous.engineFiles,calculationHash:sha(JSON.stringify(previous.engineFiles.filter(s=>s.path!=='scripts/cross-map-study/run.js')))}]:[]))].filter(r=>r.hash!==code.hash);
 revisions.push({hash:code.hash,calculationHash:code.calculationHash,files:code.files});
 const compatibleRevisions=revisions.filter(r=>r.calculationHash===code.calculationHash).map(r=>r.hash);
 const manifest={schema:STUDY_SCHEMA,createdAt:new Date().toISOString(),engineFingerprint:code.hash,calculationFingerprint:code.calculationHash,engineFiles:code.files,engineRevisions:revisions,orchestrationCorrection:'保留原始运行编排指纹和原始记录；仅在计算模块、真实地图输入、完整配置均相同时复用结果。修正深圳示意核心ID到真实建筑的映射，首次失败记录另存，实际约束变更的配置重新求解。',maps,configurations:CONFIGURATIONS.filter(c=>caseIds.includes(c.id)),plannedRuns:maps.length*caseIds.length,randomness:'确定性贪心与固定采样；runId随机尾码仅作标识，不影响求解',audit:'各地图共用2400×2400米、300米间距、0.37格偏移、20/45/90米离地高度，固定独立验证网格；静态覆盖不等于并发承载或实测检出概率',sourceFiles:[]};
 for(const path of (await filesUnder(join(root,'创意二文件'))).filter(p=>/\.(doc|pdf)$/.test(p)))manifest.sourceFiles.push({path:relative(root,path).replaceAll('\\','/'),sha256:sha(await readFile(path)),bytes:(await stat(path)).size});
 await saveJSON(join(out,'manifest.json'),manifest);await saveJSON(join(out,'parameter-dictionary.json'),parameterDictionary());
 let done=0;const failures=[],queue=[...maps],workers=Math.min(Number(arg('workers','3')),maps.length);
 console.log(`计划 ${maps.length} 地图 × ${caseIds.length} 配置 = ${manifest.plannedRuns} 次完整优化；${workers} 个本地计算进程；指纹 ${code.hash.slice(0,12)}`);
 const lane=async()=>{while(queue.length){const map=queue.shift();await new Promise((resolveLane,reject)=>{
  const worker=new Worker(new URL(import.meta.url),{workerData:{map,caseIds,out,engineFingerprint:code.hash,compatibleRevisions},resourceLimits:{maxOldGenerationSizeMb:2048}});
  worker.on('message',message=>{
   if(['complete','skipped'].includes(message.type)){done++;const s=message.summary;console.log(`[${done}/${manifest.plannedRuns}] ${map.id}/${message.caseId} ${message.type} ${(s.elapsedMs/1000).toFixed(1)}s | ${s.deviceCount}设备 | 验证 ${((s.auditCoverage??0)*100).toFixed(1)}% | 最弱 ${((s.auditWorstCoverage??0)*100).toFixed(1)}%`);}
   else if(['fatal','case-error'].includes(message.type)){console.error(JSON.stringify(message));failures.push(message);}
   else if(message.type==='start')console.log(`开始 ${map.id}/${message.caseId}`);
  });worker.on('error',reject);worker.on('exit',code=>code?reject(Error(`${map.id} worker exited ${code}`)):resolveLane());
 }).catch(error=>{failures.push({map:map.id,error:error.message});});}};
 await Promise.all(Array.from({length:workers},lane));
 await saveJSON(join(out,'execution-status.json'),{done,planned:manifest.plannedRuns,failures,finishedAt:new Date().toISOString()});
 if(failures.length||done!==manifest.plannedRuns)process.exitCode=1;else console.log(`全部 ${done} 次完整优化完成，结果在 ${out}`);
}
