// Task 6.1–6.3：真实 GIS 默认 2400×2400 m、500 m 网格流水线 → 标准默认离线 HTML。
// 多轮规则复用 artifacts/task3/runs；禁止在本文档生成器内手写方案指标。
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createModel} from '../src/model.js';
import {createSceneQuery} from '../src/sensors/scene.js';
import {runTask3Pipeline} from '../src/task3/pipeline.js';
import {validateRun} from '../src/task3/runs.js';
import {deriveRules,rulesToMarkdown} from '../src/task3/rules.js';
import {METRIC_WEIGHTS} from '../src/task3/constants.js';
import {TASK3_DEFAULT_SETTINGS} from '../src/task3/scope.js';
import {PRESETS} from '../src/sensors/presets.js';
import {createDeploymentDocument,renderDeploymentDocument} from '../src/task3/deployment-doc.js';

const root=new URL('../',import.meta.url),readJson=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const [city,terrain]=await Promise.all([readJson('public/data/city.json'),readJson('public/data/terrain.json')]);
const query=createSceneQuery(createModel(city,terrain));
const settings={...TASK3_DEFAULT_SETTINGS,scope:'core',scopeWidthM:2400,scopeDepthM:2400,spacing:500,siteSpacing:500,heights:[30,60,100]};
const started=Date.now();
const {report,run}=await runTask3Pipeline({city,query,settings,weights:{...METRIC_WEIGHTS},presetIds:PRESETS.map(item=>item.id),progress:()=>{},yieldTask:()=>new Promise(resolve=>setImmediate(resolve))});
const record=validateRun({...run,label:'standard-default-2400x2400-500'});
if(report.scope.widthM!==2400||report.scope.depthM!==2400||report.settings.spacing!==500)throw Error('标准默认轮次的范围或网格不符合 Task 6.1');

await mkdir(new URL('artifacts/task3/runs/',root),{recursive:true});
await mkdir(new URL('public/data/',root),{recursive:true});
const previous=[];for(const file of (await readdir(new URL('artifacts/task3/runs/',root))).filter(name=>name.endsWith('.json')).sort()){
 const item=await readJson(`artifacts/task3/runs/${file}`);if(item.runId!==record.runId)previous.push(item);
}
const runs=[...previous,record],{rules,stats}=deriveRules({runs,report,city});
const documentModel=createDeploymentDocument({report,run:record,activePlanId:report.recommendedId,rules,conditionId:'nominal',documentKind:'standard'});
const html=renderDeploymentDocument(documentModel),htmlPath='public/task3-standard-deployment.html';
await writeFile(new URL(`artifacts/task3/runs/${record.runId}.json`,root),JSON.stringify(record));
await writeFile(new URL('artifacts/task3/standard-deployment-report.json',root),JSON.stringify(report));
await writeFile(new URL('artifacts/task3/standard-deployment.json',root),JSON.stringify(documentModel,null,2));
await writeFile(new URL(htmlPath,root),html);
await writeFile(new URL('public/data/task3-doc-rules.json',root),JSON.stringify({schema:'task3-deployment-rules/1.0',generatedAt:documentModel.generatedAt,standardRunId:record.runId,ruleRunIds:stats.runIds,runCount:stats.runCount,rules},null,2));
await writeFile(new URL('docs/task3/deployment-rules.md',root),rulesToMarkdown({rules,stats}));
const sourceRecord={schema:'task3-standard-source/1.0',runId:record.runId,createdAt:record.createdAt,settings:record.settings,scope:report.scope,recommendedId:report.recommendedId,activePlanId:documentModel.source.activePlanId,reportPath:'artifacts/task3/standard-deployment-report.json',runPath:`artifacts/task3/runs/${record.runId}.json`,documentModelPath:'artifacts/task3/standard-deployment.json',htmlPath,htmlSha256:createHash('sha256').update(html).digest('hex'),ruleRunIds:stats.runIds,inputHashes:report.inputHashes,mobileRepairEnabled:false};
await writeFile(new URL('artifacts/task3/standard-deployment-source.json',root),JSON.stringify(sourceRecord,null,2));
console.log(JSON.stringify({runId:record.runId,scope:`${report.scope.widthM}×${report.scope.depthM} m`,spacingM:report.settings.spacing,samples:report.sampling.samples.length,candidates:report.candidateCount,recommendedId:report.recommendedId,devices:documentModel.plan.deviceCount,coverage:documentModel.metrics.conditions.map(row=>({condition:row.condition,covered:row.covered,total:row.total,coverageRate:row.coverageRate})),emc:documentModel.emc,ruleCount:rules.length,ruleRunCount:stats.runCount,cases:documentModel.cases.map(item=>({deviceId:item.deviceId,covered:item.coveredSamples,independent:item.independentSamples})),htmlPath,durationSeconds:(Date.now()-started)/1000},null,2));
