import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync } from 'node:fs';
import {collectRunsStats,extractRules,rulesToMarkdown} from '../src/task3/rules.js';

const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));

function fakeRun({runId,gapWidths=[],silentDrop=0.05,shadowDistances=[],acousticRatio=2,coChannel=0}={}){
 const b=city.buildings.slice(0,2);
 return {schema:'task3-run/1.0',runId,
  summary:{recommendedId:'balanced',plans:[{id:'balanced',cost:150,metrics:[{condition:'nominal',coverageRate:0.95},{condition:'silent',coverageRate:0.95-silentDrop}]}]},
  blindspots:{balanced:[{conditionId:'nominal',stats:{total:gapWidths.length+shadowDistances.length,byCategory:{}},points:[
   ...gapWidths.map((w,i)=>({sampleId:`g${i}`,position:[i*10,100,0],agl:30,core:true,category:'gap',cause:{gapWidthM:w,buildingIds:[b[0].id,b[1].id],agl:30}})),
   ...shadowDistances.map((d,i)=>({sampleId:`s${i}`,position:[i*10,100,0],agl:30,core:false,category:'shadow',cause:{blockerDistanceM:d}})),
  ]}]},
  threats:{},emc:{balanced:{verdict:coChannel?'fail':'pass',counts:{fail:coChannel,warning:0},conflicts:Array.from({length:coChannel},(_,i)=>({a:'x',b:'y',kind:'co-channel',severity:'fail',distanceM:100+i*50,penaltyDb:5-i,recommendation:'r'}))}},
  rulesInput:{candidateStats:[...Array(9)].map((_,i)=>({type:'acoustic',presetId:'acoustic-cry',heightRank:i<3?0.2:i<6?0.5:0.9,coverCount:i<6?10:10*acousticRatio})),perHeightBlind:[{height:30,validGridCells:100,blindGridCells:10},{height:60,validGridCells:100,blindGridCells:2},{height:100,validGridCells:100,blindGridCells:1}],recommendedId:'balanced',nominalCondition:'nominal'}};
}

test('rules: 阈值全部来自过程数据统计且可追溯',()=>{
 const runs=[fakeRun({runId:'r1',gapWidths:[10,20,30,40,50],shadowDistances:[40,60,80,100],coChannel:2}),fakeRun({runId:'r2',gapWidths:[15,25,35,45],shadowDistances:[50,70,90],coChannel:0})];
 const {rules,stats}=extractRules({runs,report:null,city});
 assert.equal(stats.runCount,2);
 const ids=rules.map(r=>r.id);
 for(const id of ['R1','R2','R3','R4','R5','R6'])assert.ok(ids.includes(id),`缺 ${id}`);
 const r1=rules.find(r=>r.id==='R1');assert.match(r1.text,/间距小于 \d+ 米且高度差大于 \d+ 米/);assert.ok(r1.evidence.samples>=9);assert.match(r1.evidence.runIds,/r1/);
 const r4=rules.find(r=>r.id==='R4');assert.match(r4.text,/下降 5\.0 个百分点/);
 const r3=rules.find(r=>r.id==='R3');assert.match(r3.text,/2\.0 倍/);
 const md=rulesToMarkdown({rules,stats});assert.match(md,/# 任务三 · 标准化布设规则/);assert.match(md,/r1、r2/);assert.equal((md.match(/## R\d/g)||[]).length,6);
});

test('rules: 样本不足时如实缺省对应规则而非编造',()=>{
 const runs=[fakeRun({runId:'r1'})];const {rules}=extractRules({runs,report:null,city});
 const ids=rules.map(r=>r.id);assert.ok(!ids.includes('R1'));assert.ok(ids.includes('R3')&&ids.includes('R4')&&ids.includes('R5'));
});
