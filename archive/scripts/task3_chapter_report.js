// 任务三章节版报告生成器：按《子任务一报告_精简版.docx》版式规范输出
// 覆盖《任务三多方案优化与最优部署技术方案报告.docx》。全文黑白灰、无项目符号、无注释框。
import fs from 'node:fs';
import {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,ImageRun,Footer,AlignmentType,HeadingLevel,BorderStyle,WidthType,VerticalAlign,PageNumber,PageBreak,TableLayoutType,Math as DocxMath,MathRun,MathFraction,MathSubScript,MathSuperScript,MathSubSuperScript,MathSum} from 'docx';
import {deriveRules} from '../src/task3/rules.js';
import {createDeploymentDocument} from '../src/task3/deployment-doc.js';
import {createDeviceDisplayMap} from '../src/task3/device-display.js';
import {TYPES,PRESETS} from '../src/sensors/presets.js';

const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const report=readJson('artifacts/task3/latest-report.json'),source=readJson('artifacts/task3/latest-source.json'),run=readJson(source.runPath),blind=readJson('artifacts/task3/mobile-repair-evidence.json'),city=readJson('public/data/city.json');
const runs=source.runIds.map(id=>readJson(`artifacts/task3/runs/${id}.json`));
const {rules}=deriveRules({runs,report,city});
const best=report.plans.find(item=>item.id===report.recommendedId);
const display=createDeviceDisplayMap(best.devices);
const representative=createDeploymentDocument({report,run,activePlanId:best.id,rules,conditionId:'nominal',documentKind:'current'});
const G='artifacts/task3/word-assets/gray';
const presetName=id=>PRESETS.find(p=>p.id===id)?.name??id;
const fmt=(v,d=2)=>Number(v).toFixed(d),pct=(v,d=2)=>v===null||v===undefined?'不适用':`${(v*100).toFixed(d)}%`,dash=v=>v===null||v===undefined?'—':String(v),angle=v=>Number.isFinite(v)?fmt(v,1):'—';
const condShort={nominal:'基线',silent:'静默',weather:'雨雾',interference:'干扰'};

// ===== 版式常量（对齐参考文档） =====
const FONT={ascii:'Times New Roman',hAnsi:'Times New Roman',eastAsia:'宋体'};
const FONT_HEI={ascii:'Times New Roman',hAnsi:'Times New Roman',eastAsia:'黑体'};
const BLACK='000000',GRAY='404040',GRAY2='464646';
const children=[];
const add=(...items)=>children.push(...items);
const figCaps=[],tblCaps=[],eqNums=[];
// 正文：两端对齐、首行缩进 420、行距 360 auto、段后 60
const body=(text,{align=AlignmentType.JUSTIFIED,size=21,bold=false,color=BLACK,before=0,after=60,indent=420}={})=>new Paragraph({alignment:align,spacing:{before,after,line:360,lineRule:'auto'},...(indent?{indent:{firstLine:indent}}:{}),children:[new TextRun({text,size,bold,font:FONT,color})]});
const h1=text=>new Paragraph({heading:HeadingLevel.HEADING_1,children:[new TextRun({text,font:FONT_HEI})]});
const h2=text=>new Paragraph({heading:HeadingLevel.HEADING_2,children:[new TextRun({text,font:FONT_HEI})]});
const h3=text=>new Paragraph({heading:HeadingLevel.HEADING_3,children:[new TextRun({text,font:FONT_HEI})]});
// 题注：9pt、#404040、居中、段前 40 段后 120
const caption=text=>new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:40,after:120},children:[new TextRun({text,size:18,font:FONT,color:GRAY})]});
// OMML 公式组件
const mr=t=>new MathRun(t);
const msub=(base,s)=>new MathSubScript({children:[mr(base)],subScript:[mr(s)]});
const msup=(base,s)=>new MathSuperScript({children:[mr(base)],superScript:[mr(s)]});
const msubsup=(base,s,p)=>new MathSubSuperScript({children:[mr(base)],subScript:[mr(s)],superScript:[mr(p)]});
const mfrac=(n,d)=>new MathFraction({numerator:n,denominator:d});
const msum=(sub,sup,body)=>new MathSum({children:body,subScript:[mr(sub)],...(sup?{superScript:[mr(sup)]}:{})});
const eq=(items,number)=>{eqNums.push('（'+number+'）');return new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:60,after:120},children:[new DocxMath({children:items}),new TextRun({text:'　（'+number+'）',size:21,font:FONT,color:BLACK})]});};
// 表格：全框线 0.5pt 黑、居中、固定布局、表头黑体 8pt 居中、表体 8.5pt、行距 264 auto、段后 0
const BORDER={style:BorderStyle.SINGLE,size:4,color:BLACK},BORDERS={top:BORDER,bottom:BORDER,left:BORDER,right:BORDER};
function makeCell(value,width,size,bold,header){
 const paras=String(value??'—').split('\n').map(line=>new Paragraph({alignment:header?AlignmentType.CENTER:AlignmentType.LEFT,spacing:{after:0,line:264,lineRule:'auto'},children:[new TextRun({text:line,size,bold,font:header?FONT_HEI:FONT,color:BLACK})]}));
 return new TableCell({borders:BORDERS,width:{size:width,type:WidthType.DXA},verticalAlign:VerticalAlign.CENTER,margins:{top:40,bottom:40,left:80,right:80},children:paras});
}
function makeTable(headers,rows,widths,fontSize=17){
 const total=widths.reduce((a,b)=>a+b,0);
 return new Table({width:{size:total,type:WidthType.DXA},columnWidths:widths,layout:TableLayoutType.FIXED,alignment:AlignmentType.CENTER,rows:[new TableRow({cantSplit:true,tableHeader:true,children:headers.map((header,i)=>makeCell(header,widths[i],16,true,true))}),...rows.map(row=>new TableRow({cantSplit:true,children:row.map((value,i)=>makeCell(value,widths[i],fontSize,false,false))}))]});
}
function tblCap(text){tblCaps.push(text);add(caption(text));}
function figure(file,width,height,title,description){
 figCaps.push(title);
 add(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:80,after:40},children:[new ImageRun({type:'png',data:fs.readFileSync(file),transformation:{width,height},altText:{title,description,name:title}})]}),caption(title+'。'+description));
}
let coverBreakLeft=1;
const pageBreak=()=>{if(coverBreakLeft>0){coverBreakLeft--;add(new Paragraph({children:[new PageBreak()]}));}};
const traceStats=plan=>{const ev=plan.optimizationTrace.events;return {selects:ev.filter(e=>e.type==='select').length,deletes:ev.filter(e=>e.type==='delete').length,released:ev.filter(e=>e.type==='delete').reduce((s,e)=>s+(e.releasedCost??0),0)};};
const scoring=report.scoring.plans,recScore=scoring.find(row=>row.id===best.id);
const ruleBoundaries={R1:'仅复用于同类 LoD1 城区；迁移时须重新统计缝宽与高差分布',R2:'仅对相同装备集合与高度层划分成立；迁移时须重算分层盲区率与雷达距离分位数',R3:'要求场景具备声学候选且高度分组差异可复现；迁移前须实测声反射与环境噪声',R4:'仅在相同静默目标定义下成立；迁移时须实测主动探测装备的补位能力'};

// ===== 封面（居中、无首行缩进） =====
const coverLine=(text,{size=24,bold=false,color=BLACK,before=0,after=120}={})=>new Paragraph({alignment:AlignmentType.CENTER,spacing:{before,after,line:360,lineRule:'auto'},children:[new TextRun({text,size,bold,font:bold?FONT_HEI:FONT,color})]});
add(coverLine('创意科目二：反无装备优化部署与仿真推演',{size:24,color:GRAY2,before:1600,after:480}));
add(coverLine('反无装备优化部署与仿真推演平台',{size:44,bold:true,after:200}));
add(coverLine('优化推演模块',{size:52,bold:true,after:200}));
add(coverLine('最优装备全域无死角覆盖快速优化',{size:44,bold:true,after:1200}));
add(coverLine('参赛团队：________________________',{size:24,after:240}));
add(coverLine('指导教师：________________________',{size:24,after:240}));
add(coverLine('编制日期：2026年11月',{size:24,after:120}));
pageBreak();

// ===== 第三章标题 =====
add(h1('第三章 最优装备全域无死角覆盖快速优化'));

// ===== 3.1 任务概述 =====
add(h2('3.1 任务概述'));
add(h3('3.1.1 任务完成情况概述'));
const t311='本任务围绕核心防护目标河南博物院，在真实三维城区环境中完成最优装备全域无死角覆盖快速优化，任务要求的全流程均已闭环落地。在部署方案设计上，以核心防护目标为中心，于三维环境中配置候选点位的装备类型组合、安装高度与覆盖角度，自动形成经济型、均衡型、冗余增强型三套候选方案；在覆盖效果推演上，基于15,889栋建筑白模与DEM地形对113个有效空域采样逐点实判，重点排查楼栋夹缝、围墙边角、低空贴楼与建筑背面阴影区四类典型盲区；在多维度方案择优上，以覆盖完整性、盲区面积占比、装备配置成本与施工可行性四维指标归一化加权评分，均衡型综合得分最高并作为推荐方案；在多威胁场景鲁棒性验证上，对单机单点、多方向同步与蜂群饱和攻击三类威胁逐帧推演，平均检出占比均不低于95%；在电磁兼容性校核上，依据同频干扰与信号互扰规则排查可能引发探测失效、漏探与误探的冲突，推荐方案严重冲突为零、仅余六条可现场处置的提示；在标准化布设规则提炼上，由六轮参数变体沉淀四条量化布设规则，统一采用「触发条件—量化阈值—执行动作」的格式表述，并附多样本统计证据。';
console.log('3.1.1 实际字数（含标点、不含空格）:',t311.replace(/\s/g,'').length);
add(body(t311));
add(h3('3.1.2 对任务一与任务二的参考'));
add(body('任务三的空间与目标输入直接来自任务一：任务一构建了研究区15,889栋建筑的LoD1白模、DEM数字高程模型与航拍影像，建立了以河南博物院为核心定位的局部ENU米制坐标系；本章的空域采样点坐标、建筑遮挡射线求交与候选点位坐标均在该坐标系与白模之上计算，核心防护目标的定位与核心权重区划分也沿用任务一结果。'));
add(body('任务三的感知与校核模型来自任务二：任务二确定了02C三坐标雷达、NVT-951双光谱光电、TDOA-X1B无线电侦测设备与CRY8500声学相机四类装备的物理参数，并建立了雷达能量方程、无线电链路预算与视场/遮挡判定等感知模型；本章的覆盖矩阵计算、四工况判定与电磁兼容校核均以任务二保存的装备参数快照为唯一输入，不另行维护第二套模型。'));
pageBreak();

// ===== 3.2 推演输入与数据基线 =====
add(h2('3.2 推演输入与数据基线'));
add(body('任务三的目标不是单独摆放若干设备，而是在同一城市几何、装备参数与环境工况下自动形成多套可执行部署方案，并用可复核的数据解释推荐其中一套的理由。推演输入的六个维度如表3.1所示，全部取值与平台当前保存的快照一致。'));
tblCap('表3.1 推演输入维度与实际配置');
add(makeTable(['输入维度','实际配置','对结果的影响'],[
 ['范围','核心区域2400×2400 m；核心区半径700 m','只计算真实GIS/DEM覆盖内的有效采样，不外推无数据区域'],
 ['采样','500 m网格；离地30/60/100 m；共113个有效点','覆盖率是离散采样口径，核心采样权重×3'],
 ['装备集合','02C雷达、TDOA-X1B、NVT-951、CRY8500','候选由真实屋顶站点×型号×姿态构成，不使用独立示例部署'],
 ['感知门槛','模型内可达且裕量≥3 dB','几何、遮挡、频段、环境与电磁损耗共同决定覆盖'],
 ['相对成本','雷达12/无线电5/光电4/声学2','只用于方案横向比较，不是人民币报价'],
 ['方案约束','总预算600、设备上限64；三方案分别调整类型池、预算与上限','形成可解释的差异化解，而非对同一方案重复命名']
],[1500,4100,3752]));
add(body('六轮推演均显式使用当前默认四款装备：基准轮用于三方案对比，其余五轮分别改变网格、预算或高度层，用于检验布设规则是否只在单一配置下成立，结果如表3.2所示。'));
tblCap('表3.2 六轮变体设置与推荐结果');
add(makeTable(['轮次','推演批次号','主要变化','推荐方案 / 设备数'],runs.map((item,index)=>[
 ['基准轮','细网格轮','粗网格轮','低预算轮','高预算轮','低高度层轮'][index],item.runId,
 index===0?'默认参数':index===1?'网格加密至350 m':index===2?'网格放宽至700 m':index===3?'预算收紧至400':index===4?'预算放宽至800':'高度层改为20/45/60 m',
 `${item.summary.plans.find(p=>p.id===item.summary.recommendedId).name.split(' ')[0]} / ${item.summary.plans.find(p=>p.id===item.summary.recommendedId).devices} 台`
]),[1250,3050,2550,2502],16));
add(body('图3.1给出任务三从真实输入到报告输出的完整代码执行链：采样与候选生成、四工况覆盖矩阵、三方案优化、电磁兼容校核、量化择优与实测验证依次衔接，任一环节数值均可回溯至对应推演批次文件。'));
figure(`${G}/figure-1-pipeline.png`,640,292,'图3.1 任务三代码执行链原理图','真实输入、覆盖矩阵、三方案优化、电磁兼容、量化择优与实测验证的先后关系');
pageBreak();

// ===== 3.3 感知模型与覆盖判定 =====
add(h2('3.3 感知模型与覆盖判定'));
add(body('四类装备的「覆盖」判定共用同一条链路预算框架：自由空间路径损耗按式（3-1）计算，雷达按能量形式雷达方程给出信噪比（式3-2），无线电侦测按链路预算给出信噪比（式3-3），覆盖成立当且仅当裕量满足式（3-4）。'));
add(eq([msub('L','fs'),mr('(d,f) = 20 '),msub('log','10'),mr('('),mfrac([mr('4π'),mr('d'),mr(' f')],[mr('c')]),mr(')')],'3-1'));
add(body('其中d为设备—采样视距（m），f为载频（Hz），c为光速；建筑穿透、单刀刃绕射与立面反射损耗在此基础上叠加。'));
add(eq([mr('γ = 10 '),msub('log','10'),mr('('),mfrac([msub('P','t'),mr('τ·'),msup('10','(Gt+Gr)/10'),mr(' '),msup('λ','2'),mr(' σ '),msub('N','p')],[msup('(4π)','3'),mr(' '),msup('R','4'),mr(' k '),msub('T','0'),mr('·'),msup('10','(NF+Ls)/10')]),mr(')')],'3-2'));
add(body('式（3-2）中峰值功率、脉宽、收发增益、波长、目标散射截面积、相参积累脉冲数、噪声系数与系统损耗全部来自装备建模页保存的物理参数。'));
add(eq([mr('SNR = EIRP + '),msub('G','r'),mr(' − '),msub('L','rx'),mr(' − '),msub('L','fs'),mr('(d,f) − '),msub('N','0'),mr(' + '),msub('G','p'),mr('，　'),msub('N','0'),mr(' = −174 + F + 10 '),msub('log','10'),mr(' B')],'3-3'));
add(eq([mr('M = SNR − '),msub('γ','req'),mr(' ≥ '),msub('M','0'),mr('，　'),msub('γ','req'),mr(' = 10 '),msub('log','10'),mr('('),mfrac([mr('ln '),msub('P','fa')],[mr('ln '),msub('P','d')]),mr(' − 1)')],'3-4'));
add(body('式（3-4）为覆盖判定的最终门槛：检出门限由假设虚警概率与检出概率反推，预留裕量默认3 dB。雨雾、噪声、目标静默与同频干扰损耗都折算进信噪比后再比较，因此四种工况共用同一判据，工况定义如表3.3所示。'));
tblCap('表3.3 四种推演工况定义');
add(makeTable(['工况','目标与环境变化','优化意义'],[
 ['基线 · 发射','目标正常发射，使用当前城市环境','衡量常规条件下的基础覆盖'],
 ['无线电静默','目标关闭无线电发射','无线电侦测硬失效，检验雷达/光电/声学补位'],
 ['雨雾及街道噪声','降雨30 mm/h、能见度0.3 km，并提高雨噪与交通噪声','检验气象与声学传播退化下的稳健性'],
 ['电磁干扰','底噪+10 dB、同频+10 dB、串扰+5 dB','检验干扰裕量下降后的覆盖保持能力']
],[1700,4652,3000]));
add(body('覆盖评估函数对每个候选、每个采样、每种工况执行同一感知内核：先以距离和视场做几何快判，再以加速结构射线检查建筑与地形遮挡，最后把雨雾、噪声、目标静默和干扰计入裕量。覆盖矩阵随后同时服务于选点、盲区归因、设备独立贡献统计与威胁逐帧验证，避免不同模块采用互相矛盾的检出定义。'));
pageBreak();

// ===== 3.4 部署优化算法 =====
add(h2('3.4 部署优化算法'));
add(body('优化采用「加权贪心选点＋反向冗余删除＋冗余增益补选」三段结构，原理如图3.2所示。每轮在预算与设备上限内选择新增覆盖权重与成本之比最大的候选（式3-5）；首轮饱和后反向检查已选设备，若其全部覆盖样本仍至少由两台设备覆盖，则执行冗余删除并释放成本（式3-6）；释放预算后再次补选，最多四个轮次。冗余增强型在此基础上把仅一重覆盖的样本按0.5权重继续计入收益（式3-7），形成核心区二重覆盖。'));
figure(`${G}/figure-5-greedy.png`,640,320,'图3.2 加权贪心集合覆盖原理示意图','左侧为候选与采样的覆盖关系，右侧为增益成本比排序，与选点函数实际行为一致');
add(eq([msup('c','*'),mr(' = '),msub('argmax','c∈C'),mr(' '),mfrac([msum('j∈cov(c)∖S',null,[msub('w','j')])],[msub('κ','c')]),mr('，　s.t. Σ'),msub('κ','i'),mr(' ≤ B，|S| ≤ '),msub('N','max')],'3-5'));
add(eq([mr('remove(c) ⟺ ∀j∈cov(c)：　'),msubsup('n','j','−c'),mr(' ≥ 2')],'3-6'));
add(eq([msubsup('w','j','enh'),mr(' = '),msub('u','j'),mr('·'),msub('v','k'),mr('·'),mr('['),msub('n','j'),mr('=0 ? 1 : '),msub('n','j'),mr('=1 ? 0.5 : 0]')],'3-7'));
add(body('式（3-5）中样本权重为核心空间权重与基线工况权重的乘积，κ为候选相对成本，B与设备数上限为方案约束；式（3-6）中n为样本当前覆盖计数，上标−c表示移除该设备后的计数；式（3-7）为增强型的分段增益函数。每一次选点与删除都写入优化过程记录（设备、站点、增益、成本、累计覆盖权重），可逐条复核，不是事后重放另一套算法。'));
add(body('三套方案在同一覆盖矩阵上运行，差异仅来自类型池、预算、设备上限与冗余目标四项输入，如表3.4所示；三方案的实际选点增益与成本轨迹如图3.3所示，汇总指标如表3.5所示。'));
tblCap('表3.4 三方案优化策略差异');
add(makeTable(['方案','类型池','预算','设备上限','冗余目标','候选池'],report.plans.map(plan=>[
 plan.name,plan.presetSubset.map(presetName).join('、'),plan.budget,plan.maxDevices,
 plan.id==='enhanced'?'核心二重覆盖增益×0.5':'只奖励未覆盖样本',plan.optimizationTrace.poolSize
]),[1750,2600,900,1000,1600,1502],16));
figure(`${G}/figure-2-traces.png`,640,302,'图3.3 三方案实际选点增益与成本轨迹曲线','横轴为真实事件步号，反向删除位置保留在记录中');
tblCap('表3.5 三方案优化过程轨迹汇总');
add(makeTable(['方案','选点次数','删除次数','释放成本','最终设备','最终成本','轨迹含义'],report.plans.map(plan=>{const s=traceStats(plan);return [plan.name,s.selects,s.deletes,fmt(s.released),plan.devices.length,fmt(plan.cost),plan.id==='enhanced'?'贪心选点＋删除＋冗余补选':'贪心选点＋删除＋再补选'];}),[1750,1050,1050,1100,1000,1100,2302],16));
const firstOf=plan=>{const ev=plan.optimizationTrace.events.find(e=>e.type==='select');return {name:createDeviceDisplayMap(plan.devices).nameOf(ev.deviceId),ratio:fmt(ev.gainPerCost,3)};};
const eco=report.plans.find(p=>p.id==='economy'),enh=report.plans.find(p=>p.id==='enhanced');
add(body(`从轨迹特征看，三套方案首步均选中${firstOf(best).name}（TDOA-X1B，增益成本比${firstOf(best).ratio}），因为无线电侦测单台覆盖广且成本低；随后雷达按边际收益依次进入。经济型共${traceStats(eco).selects}次选点、${traceStats(eco).deletes}次反向删除、释放成本${fmt(traceStats(eco).released)}，类型池不含光电与声学，近距补盲手段受限；均衡型共${traceStats(best).selects}次选点、${traceStats(best).deletes}次删除、释放成本${fmt(traceStats(best).released)}，在贪心选点饱和后即收敛；冗余增强型共${traceStats(enh).selects}次选点、${traceStats(enh).deletes}次删除，饱和后进入冗余增益阶段，对仅一重覆盖的核心样本继续补选，最终形成${enh.devices.length}台设备的最大规模方案。`));
pageBreak();

// ===== 3.5 多方案量化对比与最优方案 =====
add(h2('3.5 多方案量化对比与最优方案'));
add(body('三套方案在四种工况下的覆盖实判结果如表3.6所示，覆盖率、盲区率、核心覆盖与核心二重覆盖均为同一覆盖矩阵的直接统计。'));
tblCap('表3.6 三方案四工况覆盖实判结果');
add(makeTable(['方案','工况','覆盖数','覆盖率','盲区率','核心覆盖','核心二重'],report.plans.flatMap(plan=>plan.metrics.map(metric=>[plan.name,metric.name,`${metric.covered}/${metric.total}`,pct(metric.coverageRate),pct(metric.blindRate),pct(metric.coreCoverageRate),pct(metric.coreRedundantRate)])),[1900,1500,1100,1250,1200,1200,1200],16));
add(body('覆盖完整性取四工况最小值（稳健口径）并计入核心二重覆盖加成，盲区占比取四工况均值并反向归一，成本与施工可行性同样跨方案归一（式3-8）后按权重0.40/0.25/0.20/0.15加权（式3-9）；电磁兼容结论随后作为乘性因子回写：存在未解决严重冲突时每例得分×0.85（累计下限0.7），仅提示项×0.97（式3-10）。归一化与评分结果如表3.7所示，评分构成原理如图3.4所示。'));
add(eq([msubsup('x','i','^'),mr(' = '),mfrac([msub('x','i'),mr(' − '),msub('min','k'),mr(' '),msub('x','k')],[msub('max','k'),mr(' '),msub('x','k'),mr(' − '),msub('min','k'),mr(' '),msub('x','k')])],'3-8'));
add(eq([msub('S','raw'),mr(' = 0.40 '),msup('C','^'),mr(' + 0.25 '),msup('B','^'),mr(' + 0.20 '),msup('K','^'),mr(' + 0.15 '),msup('F','^')],'3-9'));
add(eq([mr('S = '),msub('S','raw'),mr(' × '),msub('f','emc'),mr('，　'),msub('f','emc'),mr(' = max(0.7, '),msup('0.85','nfail'),mr(') 或 0.97（仅提示项）')],'3-10'));
tblCap('表3.7 三方案指标归一化与加权评分');
add(makeTable(['排名','方案','覆盖归一','盲区归一','成本归一','施工归一','原始分','电磁因子','最终分'],scoring.map(row=>[row.rank,row.name,fmt(row.normalized.coverage,4),fmt(row.normalized.blindRatio,4),fmt(row.normalized.cost,4),fmt(row.normalized.feasibility,4),fmt(row.scoreRaw??row.score,4),fmt(row.emcFactor??1,4),fmt(row.score,4)]),[650,1850,1050,1050,1050,1050,1050,702,900],16));
figure(`${G}/figure-8-scoring.png`,640,302,'图3.4 四指标归一化与电磁兼容回写评分构成原理图','指标原始值跨方案极差归一后加权，电磁兼容结论作为乘性因子回写');
const enhScore=scoring.find(r=>r.id==='enhanced'),ecoScore=scoring.find(r=>r.id==='economy');
add(body(`推荐方案为${best.name}。三套方案覆盖归一值均为1，但均衡型的盲区归一、成本归一与施工归一组合最优，原始分${fmt(recScore.scoreRaw,4)}，因存在提示项乘以0.97后最终得分${fmt(recScore.score,4)}，居三方案之首。与落选的两套方案相比：冗余增强型盲区归一最高（${fmt(enhScore.normalized.blindRatio,4)}）且核心二重覆盖更强，但相对成本${fmt(enhScore.indicators.cost,1)}约为均衡型的1.9倍，成本归一降至0，施工归一仅${fmt(enhScore.normalized.feasibility,4)}，电磁处置后仍余21条提示项，最终得分${fmt(enhScore.score,4)}，与均衡型相差${fmt(recScore.score-enhScore.score,4)}；经济型成本归一${fmt(ecoScore.normalized.cost,4)}接近均衡型，但盲区归一为0、施工归一为0，静默工况盲区率9.73%为三者最高，且类型池缺少光电与声学手段，最终得分${fmt(ecoScore.score,4)}，相差${fmt(recScore.score-ecoScore.score,4)}。该结果说明推荐不是「设备最多」或「成本最低」的单指标结论。`));
pageBreak();

// ===== 3.6 最优部署方案 =====
add(h2('3.6 最优部署方案'));
add(body('推荐方案的空间组织如图3.5所示：无线电与雷达承担广域覆盖，声学负责近距补盲，共址设备按平台同一分散规则展开；图3.6为平台中该方案覆盖态势的实测画面，黄色圈定为核心权重区。方案结构汇总如表3.8所示。'));
figure(`${G}/figure-3-deployment.png`,620,407,'图3.5 推荐方案21台设备点位原理图','共址设备按同一分散规则展开，细线回指真实坐标，编号与表3.9一致');
figure(`${G}/task3-coverage.png`,560,373,'图3.6 平台覆盖态势实测画面','推荐方案装备点位、核心权重区与分类盲区的真实运行界面');
tblCap('表3.8 推荐方案结构汇总');
add(makeTable(['结构维度','实际结果','技术解释'],[
 ['设备构成',Object.entries(best.typeCounts).map(([type,count])=>`${TYPES[type]??type}${count}台`).join('；'),'无线电/雷达承担广域覆盖，声学负责近距补盲，光电候选未被强制选入'],
 ['相对成本',fmt(best.cost),'成本由型号相对成本与站点安装代理共同构成'],
 ['空间组织',`核心覆盖${pct(best.metrics[0].coreCoverageRate)}；核心二重${pct(best.metrics[0].coreRedundantRate)}`,'外围长距覆盖与核心多重重叠同时使用，不是简单均匀撒点'],
 ['电磁兼容',`${report.emc[best.id].counts.fail}严重冲突 / ${report.emc[best.id].counts.warning}提示`,'无严重冲突；共址与前端阻塞提示仍需现场处置'],
 ['方案性质','当前模型、采样、约束与权重下的推荐结果','不把贪心结果包装为全局最优证明']
],[1600,3700,4052],16));
add(body('推荐方案全部21台设备的显示名、型号、站点、坐标、姿态、频道、相对成本与四工况贡献如表3.9所示。坐标采用局部东/北/高米制；贡献统一写作「工况：覆盖采样数/独立覆盖采样数」；独立覆盖大于0的设备移除后必然产生新盲点，独立覆盖为0的设备提供的是冗余与工况稳健性。'));
const deviceRows=devices=>devices.map(device=>{const index=best.devices.indexOf(device),site=best.sites[index],entry=display.details(device.id),cost=report.settings.costs[device.type]+site.installationProxy*.2,contrib=report.conditions.map((c,ci)=>{const row=best.coverageContributions[device.id][ci];return `${condShort[c.id]}:${row.coveredSamples}/${row.independentSamples}`;}).join('\n');return [
 `${entry.displayName}`,`${TYPES[device.type]}\n${entry.modelName}`,`${site.name??`屋顶候选点${index+1}`}`,`东${fmt(device.position[0],1)}\n北${fmt(-device.position[2],1)}\n高${fmt(device.position[1],1)}`,`俯仰${angle(device.parameters.pitch)}°\n朝向${angle(device.parameters.heading)}°\n${dash(device.parameters.frequencyGHz)} GHz`,fmt(cost,3),contrib];});
const devWidths=[700,1300,1900,1400,1250,750,2052];
tblCap('表3.9 推荐方案21台设备全量明细（设备1–11）');
add(makeTable(['显示名','类型/型号','站点名称','东/北/高（m）','俯仰/朝向/频道','相对成本','四工况贡献'],deviceRows(best.devices.slice(0,11)),devWidths,15));
add(caption('表3.9（续） 设备12–21'));
add(makeTable(['显示名','类型/型号','站点名称','东/北/高（m）','俯仰/朝向/频道','相对成本','四工况贡献'],deviceRows(best.devices.slice(11)),devWidths,15));
const caseText=representative.cases.slice(0,3).map(c=>`${c.displayName}（${c.modelName}，${c.siteName}）基线工况覆盖${c.coveredSamples}/${c.totalSamples}个采样、独立覆盖${c.independentSamples}个，距核心中心${fmt(c.distanceToCoreM,0)} m`).join('；');
add(body(`代表点的保留依据可由独立覆盖直接解释：${caseText}。这类设备构成方案的不可替代骨干；而独立覆盖为0的设备（如声学点位）在静默与电磁干扰工况下独立覆盖回升，是稳健性来源。成本列与表3.5轨迹中的成本逐项一致，姿态与频道为优化后实际值，与电磁兼容校核所用参数完全相同。`));
pageBreak();

// ===== 3.7 盲区排查与移动补盲 =====
add(h2('3.7 盲区排查与移动补盲'));
add(body('盲区不是「没画到」，而是逐台设备用同一套感知公式计算后仍无任何设备同时满足几何可达与裕量门槛的采样点。归因判定树（图3.7）按楼栋夹缝、建筑背面阴影、低空贴楼、围墙边角及其他的优先级把每个盲点分配到成因类别，缝宽、贴楼距、遮挡距离等字段写入报告供规则提炼；移动补盲搜索（图3.8）以粗圆环与细网格两阶段在开阔地表几何候选中寻找可消除盲点的移动雷达位置。'));
figure(`${G}/figure-6-blindtree.png`,640,356,'图3.7 四类盲区归因判定树','夹缝、阴影、贴楼、边角与其他的几何判定优先级');
figure(`${G}/figure-10-mobile.png`,640,302,'图3.8 移动补盲候选搜索原理','500/750/1000 m×12方向粗搜，无候选时对剩余盲点做750 m×25 m细网格');
add(body('补盲消除比例按离散有效采样盲点集合计算（式3-11）：消除前盲点集合与消除后盲点集合之差占消除前集合的比例；分母为0时记为不适用，不写成100%。'));
add(eq([mr('η = '),mfrac([mr('|'),msub('B','0'),mr('| − |'),msub('B','1'),mr('|')],[mr('|'),msub('B','0'),mr('|')])],'3-11'));
add(body('分工况补盲结果如表3.10所示：基线工况4个盲点全部消除，消除率100%，新增4台警车移动雷达且未引入新的严重冲突；静默与电磁干扰工况仍有残余盲点，不能用基线工况的100%代替全域无盲区结论。'));
tblCap('表3.10 分工况移动补盲结果');
add(makeTable(['工况','补盲前盲点','补盲后盲点','消除数','消除率','前覆盖率','后覆盖率'],blind.derived.metrics.map((metric,index)=>{const before=blind.baseline.blindspots[index].stats.total,after=blind.derived.blindspots[index].stats.total;return [metric.name,before,after,before-after,before?pct((before-after)/before):'不适用',pct(blind.baseline.metrics[index].coverageRate),pct(metric.coverageRate)];}),[1700,1100,1100,1100,1400,1400,1452],16));
add(body('补盲后与取消恢复的平台实测画面分别如图3.9、图3.10所示：取消补盲后设备、盲点、电磁兼容与原始报告恢复一致，证明补盲为可逆的派生方案。补盲设备挂载高度2 m为模型假设，候选仅为开阔地表几何代理，道路可达性未验证，不作为施工坐标。'));
figure(`${G}/mobile-repair.png`,560,373,'图3.9 移动补盲后平台实测画面','新增4台移动雷达及其覆盖贡献');
figure(`${G}/mobile-repair-restored.png`,560,373,'图3.10 取消补盲恢复基线的平台实测画面','取消后设备、盲点与电磁兼容状态恢复');
pageBreak();

// ===== 3.8 电磁兼容 =====
add(h2('3.8 电磁兼容'));
add(body('电磁兼容校核基于装备频谱事实与五类冲突规则（图3.11）：雷达发射频点高于无线电接收上限，跨类耦合天然不成立；同带雷达之间需执行同频与邻频规则。同频干扰的量化代理按式（3-12）计算：两发射机频差小于0.1 GHz且三维距离小于600 m时判为严重冲突，双方各累积同频损耗，该损耗经链路预算进入信噪比后重算覆盖，即电磁兼容会真实改变检出边界而非只产生告警文字。'));
figure(`${G}/figure-7-emc.png`,640,338,'图3.11 装备频谱事实与五类冲突规则','雷达发射频点高于无线电接收上限，跨类耦合不成立，同带雷达间执行同频/邻频规则');
add(eq([msub('L','cc'),mr('(d) = 6 × (1 − '),mfrac([mr('d')],[mr('600')]),mr(')　[dB]，　Δf < 0.1 GHz 且 d < 600 m')],'3-12'));
add(body('处置顺序为：初始图着色式频道分配（同频冲突权重×10、邻频×1）→单设备合法换频（只使用装备既有离散频道，每步必须减少严重冲突）→同型号同俯仰真实候选点局部移位（搜索半径≤1200 m）→按严重冲突、提示、覆盖损失、移动距离排序选动作→处置后按实际载频与位置重算受影响覆盖。三方案处置结果如表3.11所示。'));
tblCap('表3.11 三方案电磁兼容处置结果');
add(makeTable(['方案','处置前 严重/提示','处置后 严重/提示','动作数','处置状态','最终结论'],report.plans.map(plan=>[plan.name,`${plan.emcRemediation.before.counts.fail} / ${plan.emcRemediation.before.counts.warning}`,`${plan.emcRemediation.after.counts.fail} / ${plan.emcRemediation.after.counts.warning}`,plan.emcRemediation.actions.length,{'not-required':'无需处置','applied':'已处置'}[plan.emcRemediation.status]??plan.emcRemediation.status,{pass:'通过',degraded:'降额通过',fail:'不通过'}[report.emc[plan.id].verdict]]),[2200,1700,1700,900,1452,1400],16));
const enhDisplay=createDeviceDisplayMap(enh.devices);
const actionText=enh.emcRemediation.actions.map(a=>{const entry=enhDisplay.details(a.replacementDeviceId),bp=a.before.position,ap=a.after.position,pos=p=>`东${fmt(p[0],1)} m、北${fmt(-p[2],1)} m、高${fmt(p[1],1)} m`;return `第${['一','二','三','四'][a.step-1]}步，${entry.displayName}（${entry.modelName}）在同型号真实候选点内局部移位，由${pos(bp)}迁至${pos(ap)}，载频保持${a.before.frequencyGHz} GHz，严重冲突由${a.before.emcCounts.fail}降为${a.after.emcCounts.fail}`;}).join('；');
add(body(`冗余增强型处置前存在4例严重冲突、32条提示，经四步处置后降为0例严重冲突、21条提示，且四步的覆盖权重损失均为0：${actionText}。处置后仍按实际频率与位置重算覆盖；提示项未被删除或隐藏，并继续以×0.97因子影响该方案最终排名。经济型与均衡型处置前即为0例严重冲突，状态为无需处置。`));
pageBreak();

// ===== 3.9 威胁场景验证 =====
add(h2('3.9 威胁场景验证'));
add(body('三类威胁场景按径向航路构造（图3.12），方位角以核心目标正北为0°顺时针；推演逐帧复用感知模型实判，容量按帧截取，结果如表3.12所示。'));
figure(`${G}/figure-9-threats.png`,640,284,'图3.12 三类威胁场景径向航路原理图','方位角以核心目标正北为0°顺时针，逐帧复用感知模型实判，容量按帧截取');
tblCap('表3.12 三类威胁场景推演结果');
add(makeTable(['场景','配置','目标数','平均检出占比','最低检出占比','容量溢出','全目标同帧检出'],[
 ['单机单点入侵','8方位×1架，15 m/s，离地30/60 m',report.threats.single.summary.targetCount,pct(report.threats.single.summary.meanDetectedFraction,1),pct(report.threats.single.summary.minDetectedFraction,1),report.threats.single.summary.overflowEvents,`${report.threats.single.summary.framesWithAllDetected}/${report.threats.single.summary.totalFrames}`],
 ['多方向同步入侵','4方向×1架，15 m/s，离地45/60 m',report.threats.multi.summary.targetCount,pct(report.threats.multi.summary.meanDetectedFraction,1),pct(report.threats.multi.summary.minDetectedFraction,1),report.threats.multi.summary.overflowEvents,`${report.threats.multi.summary.framesWithAllDetected}/${report.threats.multi.summary.totalFrames}`],
 ['蜂群饱和攻击','3方向×14架=42，12 m/s，离地30/45/60 m',report.threats.swarm.summary.targetCount,pct(report.threats.swarm.summary.meanDetectedFraction,1),pct(report.threats.swarm.summary.minDetectedFraction,1),report.threats.swarm.summary.overflowEvents,`${report.threats.swarm.summary.framesWithAllDetected}/${report.threats.swarm.summary.totalFrames}`]
],[1500,2600,800,1150,1150,852,1300],16));
add(body('单机单点与多方向同步场景的平均检出占比分别为96.6%与95.3%，最低检出占比均为85.4%，方案对常规入侵具备稳定探测能力；蜂群场景42架超出无线电装备的文档并发容量（TDOA-X1B 35架次、OA-X1Bmini 30架次、X1C 15架次），推演如实记录397架次溢出、42架目标均出现过漏探帧（图3.13）——这暴露了并发容量而非探测能力是蜂群场景的瓶颈，是增加声学/无线电点位或引入更高容量装备的定量依据。'));
figure(`${G}/task3-threat-swarm.png`,560,373,'图3.13 蜂群饱和攻击推演实测画面','42架蜂群沿径向航路逼近与容量溢出统计的真实运行界面');
pageBreak();

// ===== 3.10 标准化布设规则 =====
add(h2('3.10 标准化布设规则'));
add(body('布设规则由六轮默认装备变体自动提炼，只有具备真实样本、统计方法与批次号的条目才保留，四类规则原理如图3.14所示。量化阈值用于同类城区的候选筛选与复核，不替代新场景重跑。'));
figure(`${G}/figure-4-rules.png`,560,349,'图3.14 四类布设规则原理示意图','夹缝、低空、声学制高点与静默冗余分别对应可执行部署动作');
rules.forEach((rule,i)=>{const runCount=String(rule.evidence.runIds).split('、').length;add(body(`规则${['一','二','三','四'][i]}（${rule.title}）：${rule.text}统计证据：${rule.evidence.samples}个样本，来自${runCount}轮推演（${rule.evidence.method}）。复用边界：${ruleBoundaries[rule.id]??'仅限当前模型，迁移时重新标定'}。`));});
add(body('复用方法：先把规则作为候选生成约束或人工审核清单，再用新场景多轮数据重算各项阈值；如果样本不足或跨轮符号反转，应停止使用该条规则，而不是沿用本文数值。'));
pageBreak();

// ===== 3.11 模型选型参考 =====
add(h2('3.11 模型选型参考'));
add(body('总体策略为「自研为主＋轻量库拼接」：任务一、任务二已建成三维模型与四类装备物理模型，任务三各环节调研三个以上开源候选后，重型仿真引擎与前端架构不匹配，只借鉴其模型参数与验证思路；求解与传播类库用于离线对标，不进入运行时。五个环节的选型汇总如下表所示。'));
add(caption('五环节模型选型与开源参照汇总表'));
add(makeTable(['环节','最终采用','开源参照与用途'],[
 ['白模/地形解析与遮挡','three-mesh-bvh＋GDAL/rasterio','CesiumJS/OptiX排除；BVH射线为15,889栋建筑遮挡实判核心'],
 ['部署优化求解','自研加权贪心集合覆盖','HiGHS/OR-Tools/spopt作为精解对拍候选，记录于改进路径'],
 ['覆盖/盲区仿真','自研物理模型','NTIA ITM与ITU-Rpy提供标准化传播参数与对标曲线'],
 ['威胁场景推演','自研逐帧运动学推演','gym-pybullet-drones可作蜂群航迹离线对照样本'],
 ['电磁兼容校核','自研五规则代理引擎','GNU Radio/CloudRF方法论为同频复用距离规则出处']
],[2000,3052,4300],16));
add(body('该领域无开箱即用的电磁兼容校核开源件；工程做法为传播模型＋链路预算＋频率分配规则自研。前端运行时零新增重依赖。'));

// ===== 3.12 局限性与改进路径 =====
add(h2('3.12 局限性与改进路径'));
add(body('以下九项局限按「局限—当前证据—具体改进—验收指标」闭环组织，避免仅写「提高精度」「继续优化」等无法验证的表述。'));
const limitations=[
 ['离散采样不等于连续空域证明','当前为113个有效采样、500 m网格，采样之间仍可能存在空洞','对残余盲点和高权重区自适应加密采样，并沿航迹做连续线段射线抽检','加密后残余率、连续线段抽检覆盖率'],
 ['加权贪心没有全局最优证明','优化过程记录可复核实际过程，但不能排除跨候选组合获得更优解','对小场景用精确求解器对标，对大场景增加大邻域交换搜索','最优差距、运行耗时、交换后的覆盖增益'],
 ['感知参数与安装姿态未标定','雷达俯仰、光电识别阈值、声学参数含模型假设，裕量不是实测探测概率','采集实测散射截面积、声谱、天线方向图与安装姿态，替换假设并保留版本号','检出率、虚警率、裕量误差与标定置信区间'],
 ['白模与地形垂直基准有限','细部立面、屋顶结构和统一高程基准缺失可能改变遮挡结论','补充高精度白模、立面结构和统一垂直基准，再执行同一覆盖矩阵','遮挡复核一致率、高程误差、盲点迁移数量'],
 ['电磁兼容代理与误探真值不足','当前只有冲突计数、惩罚项和误探风险代理，不能给出真实虚警率','接入方向图、波形、接收机门限和非目标标注集，输出混淆矩阵','干扰召回率、虚警率、漏警率、现场一致性'],
 ['施工与道路可达未实测','施工可行性是重量/体积/安装代理，移动点只是开阔地表几何候选','接入承重、供电、网络、道路和禁停区，并增加现场审核状态','施工审核通过率、道路可达率、现场复核偏差'],
 ['成本为相对单位','162.51等数值只能在当前成本和权重口径下比较，不能作为采购预算','接入采购、架设、运维和生命周期成本，重新归一化比较','预算偏差、全生命周期成本、推荐方案稳定性'],
 ['移动派生方案未自动重算排名和威胁','移动补盲已重算覆盖、盲区和电磁兼容，但原排名与威胁结论仍属于基线方案','对派生方案重跑三类威胁与评分，保存独立报告与推演记录','派生威胁指标完整率、评分批次一致性'],
 ['布设规则依赖本场景多轮分布','四条规则阈值来自当前六轮变体，跨城市直接套用可能失效','在新场景重跑网格、预算和高度变体，重新计算阈值及置信区间','跨场景阈值稳定性、规则触发后的覆盖改善率']
];
limitations.forEach(([name,evidence,improve,metric],i)=>add(body(`局限${['一','二','三','四','五','六','七','八','九'][i]}，${name}。当前证据：${evidence}。具体改进：${improve}。验收指标：${metric}。`)));

// ===== 文档组装 =====
const doc=new Document({
 creator:'参赛团队',title:'第三章 最优装备全域无死角覆盖快速优化',description:'任务三多方案优化与最优部署技术方案报告（章节版）',
 styles:{default:{document:{run:{font:FONT,size:21,color:BLACK},paragraph:{spacing:{after:60,line:360,lineRule:'auto'}}}},paragraphStyles:[
  {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:32,bold:true,font:FONT_HEI,color:BLACK},paragraph:{spacing:{before:240,after:120},outlineLevel:0,keepNext:true,keepLines:true}},
  {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:26,bold:true,font:FONT_HEI,color:BLACK},paragraph:{spacing:{before:160,after:80},outlineLevel:1,keepNext:true,keepLines:true}},
  {id:'Heading3',name:'Heading 3',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:24,bold:true,font:FONT_HEI,color:BLACK},paragraph:{spacing:{before:200,after:80},outlineLevel:2,keepNext:true,keepLines:true}}
 ]},
 sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1191,right:1304,bottom:1191,left:1304,header:720,footer:720}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({children:[PageNumber.CURRENT],size:18,font:FONT,color:BLACK})]})]})},children}]
});
const buffer=await Packer.toBuffer(doc),output='任务三多方案优化与最优部署技术方案报告.docx';
fs.writeFileSync(output,buffer);
console.log(JSON.stringify({output,size:buffer.length,chars311:t311.replace(/\s/g,'').length,tables:tblCaps.length,figures:figCaps.length,figureCaps:figCaps,tableCaps:tblCaps,equations:eqNums},null,2));
