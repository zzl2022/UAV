import fs from 'node:fs';
import {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,ImageRun,Header,Footer,AlignmentType,HeadingLevel,BorderStyle,WidthType,ShadingType,VerticalAlign,PageNumber,PageBreak,TableLayoutType,Math as DocxMath,MathRun,MathFraction,MathSubScript,MathSuperScript,MathSubSuperScript,MathSum} from 'docx';
import {deriveRules} from '../src/task3/rules.js';
import {createDeploymentDocument} from '../src/task3/deployment-doc.js';
import {createDeviceDisplayMap} from '../src/task3/device-display.js';
import {TYPES} from '../src/sensors/presets.js';

const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const report=readJson('artifacts/task3/latest-report.json'),source=readJson('artifacts/task3/latest-source.json'),run=readJson(source.runPath),blind=readJson('artifacts/task3/mobile-repair-evidence.json'),city=readJson('public/data/city.json');
const runs=source.runIds.map(id=>readJson(`artifacts/task3/runs/${id}.json`));
const {rules}=deriveRules({runs,report,city});
const best=report.plans.find(item=>item.id===report.recommendedId),display=createDeviceDisplayMap(best.devices),representative=createDeploymentDocument({report,run,activePlanId:best.id,rules,conditionId:'nominal',documentKind:'current'});
const A='artifacts/task3/word-assets',S='artifacts/task3/showcase';
const font={ascii:'Arial',hAnsi:'Arial',eastAsia:'Microsoft YaHei'};
const fmt=(v,d=2)=>Number(v).toFixed(d),pct=(v,d=2)=>v===null||v===undefined?'不适用':`${(v*100).toFixed(d)}%`,dash=v=>v===null||v===undefined?'—':String(v),angle=v=>Number.isFinite(v)?fmt(v,1):'—';
const children=[];
const add=(...items)=>children.push(...items);
const body=(text,{bold=false,align=AlignmentType.JUSTIFIED,size=22,after=120,before=0,italic=false,color='222222'}={})=>new Paragraph({alignment:align,spacing:{after,before,line:330},children:[new TextRun({text,bold,italics:italic,size,font,color})]});
const h1=text=>new Paragraph({heading:HeadingLevel.HEADING_1,children:[new TextRun(text)]});
const h2=text=>new Paragraph({heading:HeadingLevel.HEADING_2,children:[new TextRun(text)]});
const h3=text=>new Paragraph({heading:HeadingLevel.HEADING_3,children:[new TextRun(text)]});
const caption=text=>new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:60,after:130},children:[new TextRun({text,size:18,font,color:'444444'})]});
const note=text=>new Paragraph({shading:{type:ShadingType.CLEAR,fill:'F1F4F5'},spacing:{before:90,after:130,line:310},children:[new TextRun({text,size:20,font,color:'263B42'})]});
const code=text=>new Paragraph({shading:{type:ShadingType.CLEAR,fill:'F5F5F5'},spacing:{after:55,line:260},children:[new TextRun({text,size:18,font:{ascii:'Consolas',hAnsi:'Consolas',eastAsia:'Microsoft YaHei'},color:'333333'})]});
// Word 原生 OMML 公式组件
const mr=t=>new MathRun(t);
const msub=(base,s)=>new MathSubScript({children:[mr(base)],subScript:[mr(s)]});
const msup=(base,s)=>new MathSuperScript({children:[mr(base)],superScript:[mr(s)]});
const msubsup=(base,s,p)=>new MathSubSuperScript({children:[mr(base)],subScript:[mr(s)],superScript:[mr(p)]});
const mfrac=(n,d)=>new MathFraction({numerator:n,denominator:d});
const msum=(sub,sup,body)=>new MathSum({children:body,subScript:[mr(sub)],...(sup?{superScript:[mr(sup)]}:{})});
const eq=(children,number)=>new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:90,after:130},children:[new DocxMath({children}),new TextRun({text:'　（'+number+'）',size:20,font})]});
let coverBreak=1;
const page=()=>{if(coverBreak>0){coverBreak--;add(new Paragraph({children:[new PageBreak()]}));}};
const border={style:BorderStyle.SINGLE,size:2,color:'8FA6AD'},borders={top:border,bottom:border,left:border,right:border};
function makeCell(value,width,size,bold=false,fill=null){
 const paragraphs=value instanceof ImageRun?[new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:0},children:[value]})]:String(value??'—').split('\n').map(line=>new Paragraph({spacing:{after:0,line:Math.max(220,size*1.45)},children:[new TextRun({text:line,size,font,bold,color:'1D292D'})]}));
 return new TableCell({borders,width:{size:width,type:WidthType.DXA},verticalAlign:VerticalAlign.CENTER,margins:{top:80,bottom:80,left:100,right:100},...(fill?{shading:{type:ShadingType.CLEAR,fill}}:{}),children:paragraphs});
}
function makeTable(headers,rows,widths,fontSize=17){
 const total=widths.reduce((a,b)=>a+b,0);
 return new Table({width:{size:total,type:WidthType.DXA},columnWidths:widths,layout:TableLayoutType.FIXED,rows:[new TableRow({cantSplit:true,tableHeader:true,children:headers.map((header,i)=>makeCell(header,widths[i],fontSize,true,'D3E2E8'))}),...rows.map(row=>new TableRow({cantSplit:true,children:row.map((value,i)=>makeCell(value,widths[i],fontSize))}))]});
}
function figure(file,width,height,title,description){
 add(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:80,after:40},children:[new ImageRun({type:'png',data:fs.readFileSync(file),transformation:{width,height},altText:{title,description,name:title}})]}),caption(title+'。'+description));
}
function screenshot(file,width,height,title,description){figure(file,width,height,title,description);}
function shotPair(a,b,cap){
 const mk=(file,title,desc)=>new ImageRun({type:'png',data:fs.readFileSync(file),transformation:{width:320,height:213},altText:{title,description:desc,name:title}});
 add(new Table({width:{size:10050,type:WidthType.DXA},columnWidths:[5025,5025],layout:TableLayoutType.FIXED,rows:[new TableRow({cantSplit:true,children:[makeCell(mk(a[0],a[1],a[2]),5025,17),makeCell(mk(b[0],b[1],b[2]),5025,17)]})]}));
 add(caption(cap));
}
// 将同阶段同类型的连续事件压缩为省略行：保留每个连续段的前 3 条与末 1 条，
// 中间段以“范围 + 起止指标”汇总，完整明细可由 run JSON 复核。
function condenseEvents(events){
 const runs=[];let cur=null;
 for(const e of events){
  const key=`${e.phase}|${e.type}`;
  if(!cur||cur.key!==key){cur={key,items:[]};runs.push(cur);}
  cur.items.push(e);
 }
 const out=[];
 for(const run of runs){
  if(run.items.length<=5){out.push(...run.items);continue;}
  const head=run.items.slice(0,3),mid=run.items.slice(3,-1),tail=run.items.slice(-1);
  out.push(...head);
  const gains=mid.filter(e=>e.gainPerCost!==undefined&&e.gainPerCost!==null);
  out.push({ellipsis:`第 ${mid[0].step}–${mid[mid.length-1].step} 步（${mid.length} 条同规律事件）`+(gains.length?`：增益/成本由 ${fmt(gains[0].gainPerCost,2)} 递减至 ${fmt(gains[gains.length-1].gainPerCost,2)}，累计成本 ${fmt(mid[0].cumulativeCost,1)} → ${fmt(mid[mid.length-1].cumulativeCost,1)}`:'')+'，完整明细见 run JSON'});
  out.push(...tail);
 }
 return out;
}
const traceWidths=[420,880,680,2980,880,940,900,1370];
function traceTable(plan){
 const rows=condenseEvents(plan.optimizationTrace.events).map(item=>{
  if(item.ellipsis)return ['…','—','—',item.ellipsis,'—','—','—','—'];
  const event=item;
  return [event.step,`${event.phase}/P${event.pass}`,event.type==='select'?'选点':'反向删除',`${event.deviceId}\n${event.siteId}`,
   event.type==='select'?fmt(event.gain,3):'—',event.type==='select'?fmt(event.cost,3):`释放 ${fmt(event.releasedCost,3)}`,
   event.type==='select'?fmt(event.gainPerCost,3):'—',`${fmt(event.cumulativeCost,3)}\n${fmt(event.coveredWeightPct,2)}%`];
 });
 return makeTable(['步','阶段/轮','动作','设备 ID / 站点','新增权重','成本/释放','增益成本','累计成本/覆盖'],rows,traceWidths,14);
}
function traceStats(plan){
 const events=plan.optimizationTrace.events;
 return {total:events.length,selects:events.filter(e=>e.type==='select').length,deletes:events.filter(e=>e.type==='delete').length,
  released:events.filter(e=>e.type==='delete').reduce((s,e)=>s+(e.releasedCost??0),0),shown:condenseEvents(events).length};
}
const scoring=report.scoring.plans,recScore=scoring.find(row=>row.id===best.id);
const ruleBoundaries={R1:'同类 LoD1 城区；重新计算缝宽与高差分布',R2:'相同装备和高度层；重算分层盲区与雷达距离',R3:'有声学候选且差异可复现；实测声反射和噪声',R4:'同一静默定义；实测主动探测补位能力',R5:'仅限当前 EMC 代理和模型频道；现场频谱复核',R6:'同类遮挡几何；重算遮挡距离与可视点位'};
const limitationRows=[
 ['离散采样不等于连续空域证明',`当前为 ${report.sampling.samples.length} 个有效采样、${report.settings.spacing} m 网格，采样之间仍可能存在空洞。`,'对残余盲点和高权重区自适应加密，并沿航迹做连续线段射线抽检。','加密后残余率、连续线段抽检覆盖率'],
 ['加权贪心没有全局最优证明','optimizationTrace 能复核实际过程，但不能排除跨候选组合获得更优解。','对小场景用 OR-Tools/HiGHS 精确求解对标，对大场景增加大邻域交换搜索。','最优差距、运行耗时、交换后的覆盖增益'],
 ['感知参数与安装姿态未标定','雷达俯仰、光电识别阈值、声学参数等含模型假设，margin 不是实测探测概率。','采集实测 RCS、声谱、天线方向图和安装姿态，替换假设并保留版本号。','检出率、虚警率、裕量误差与标定置信区间'],
 ['LoD1 与 DEM 垂直基准有限','细部立面、屋顶结构和统一高程基准缺失可能改变遮挡结论。','补充高精度白模、立面结构和统一垂直基准，再执行同一覆盖矩阵。','遮挡复核一致率、高程误差、盲点迁移数量'],
 ['EMC 代理与误探真值不足','当前只有冲突、penalty 和 ghost 风险代理，不能给出真实虚警率。','接入方向图、波形、接收机门限和非目标标注集，输出混淆矩阵。','干扰召回率、虚警率、漏警率、现场一致性'],
 ['施工与道路可达未实测','施工可行性是重量/体积/安装代理，移动点只是开阔地表几何候选。','接入承重、供电、网络、道路和禁停区，并增加现场审核状态。','施工审核通过率、道路可达率、现场复核偏差'],
 ['成本为相对单位','162.51 等数值只能在当前成本和权重下比较，不能作为采购预算。','接入采购、架设、运维和生命周期成本，重新归一化比较。','预算偏差、全生命周期成本、推荐方案稳定性'],
 ['移动派生方案未自动重算排名和威胁','移动补盲已重算覆盖、盲区和 EMC，但原排名与威胁仍属于基线方案。','对派生方案重跑三威胁与评分，保存独立 report/run 和派生来源。','派生威胁指标完整率、评分批次一致性'],
 ['规则依赖本场景多轮分布','R1–R4 阈值来自当前六轮变体，跨城市直接套用可能失效。','在新场景重跑网格、预算和高度变体，重新计算阈值及置信区间。','跨场景阈值稳定性、规则触发后的覆盖改善率']
];
const sotaStages=[
 ['白模/地形解析与射线遮挡',[['three-mesh-bvh（项目已集成）','MIT','Three.js BVH 射线加速，15,889 栋建筑遮挡实判的首选，已进入依赖'],['GDAL / rasterio','MIT/BSD','SHP/DEM 事实标准，已在 Python 数据预处理侧使用'],['CesiumJS','Apache-2.0','3D Tiles 城市级渲染成熟，但与现有 Three.js 栈重复建设，弃用'],['Blender API / NVIDIA OptiX','GPL/闭源','GPL 传染性或需 CUDA，不符合浏览器架构，排除']]],
 ['覆盖/盲区传播模型',[['NTIA ITM（Longley-Rice 官方实现）','公共领域','标准化地形传播损耗，仅考虑地形，与本项目建筑射线遮挡互补，用作离线对标'],['SPLAT! / CloudRF Signal-Server','GPLv2/GPL','ITM+ITWOM 支持干扰与覆盖分析，C 内核可作离线引擎'],['ITU-Rpy','MIT','ITU-R P.618 雨衰、P.676 大气吸收的 Python 实现，用于链路预算校核'],['RadarSimPy','预编译限制','雷达射线仿真强但非纯开源，仅作参考']]],
 ['部署优化求解器',[['HiGHS（npm highs，WASM）','MIT','LP/MIP 精确求解，官方 WASM 可直接进 Worker，可作贪心对拍或后续精解增强'],['Google OR-Tools CP-SAT','Apache-2.0','带约束选址最强开源求解器，Python 侧易集成，适合离线对拍'],['PySAL/spopt','BSD','内置 LSCP/MCLP/P-Median/P-Center，与地理数据天然对接'],['pymoo','Apache-2.0','NSGA-II/III 多目标优化（覆盖 vs 成本 vs EMC）候选']]],
 ['威胁场景推演',[['gym-pybullet-drones（UTIAS）','MIT','轻量运动学+多机仿真，可离线生成蜂群航迹 JSON 供对照'],['ArduPilot SITL','GPLv3','真实飞控逻辑，可模拟多机蜂群，部署重，仅作验证数据源'],['Flightmare / AirSim / Gazebo','MIT/Apache','动力学+渲染完整但需 UE/Unity/ROS，与 Vite 架构冲突，不引入'],['自研逐帧推演（flight.js 模式）','—','与既有报警/检出链路完全一致，帧级可追溯，最终采用']]],
 ['电磁兼容校核',[['GNU Radio','GPLv3','SDR 信号/干扰仿真事实标准，可生成 EMC 测试波形，仅离线参考'],['CloudRF Signal-Server / SPLAT!','GPL','多发射机同频干扰叠加分析，同频复用距离方法论出处'],['ITU-Rpy / NTIA 传播库','MIT/公共领域','P. 系列模型为 EMC 校核提供标准化衰减依据'],['openEMS（FDTD）','GPL','天线级近场精细仿真，明显过重且无天线方向图输入，排除']]]
];

// ===== P1 封面 =====
add(body('创意科目二 · 反无装备优化部署与仿真推演',{align:AlignmentType.CENTER,size:24,bold:true,before:800,after:480,color:'315B66'}));
add(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:260},children:[new TextRun({text:'任务三  多方案优化与最优部署',size:52,bold:true,font,color:'173F4F'})]}));
add(body('技术方案与真实仿真成果报告',{align:AlignmentType.CENTER,size:34,bold:true,after:560,color:'173F4F'}));
add(body('完整推演轨迹 · 量化方案筛选 · 全量设备明细 · 可复用布设规则 · SOTA 选型依据',{align:AlignmentType.CENTER,size:23,after:600,color:'4B636A'}));
add(makeTable(['项目','本报告采用的真实基线'],[
 ['数据批次',source.runId],['场景与采样',`河南博物院周边 2400×2400 m；${report.sampling.samples.length} 个有效空域采样`],['候选与方案',`${report.candidateCount} 个装备变体；经济型 / 均衡型 / 冗余增强型三套方案`],['推荐结果',`${best.name}；${best.devices.length} 台设备；相对成本 ${fmt(best.cost)}`],['规则证据',`${runs.length} 轮默认装备变体；完整 optimizationTrace 与 report/run 可追溯`]
],[2200,7850],19));
add(body('编制时间：2026 年 11 月',{align:AlignmentType.CENTER,size:22,before:480,after:100,color:'4B636A'}));
add(body('说明：本报告中的“最优”特指当前模型、采样、约束和权重下的推荐结果，不宣称数学全局最优，也不替代现场施工与频谱合规认证。',{align:AlignmentType.CENTER,size:18,before:220,color:'555555'}));
page();

// ===== P2 第1章 =====
add(h1('第1章  任务边界、数据基线与复现证据'));
add(body('任务三的目标不是单独摆放若干设备，而是在同一城市几何、装备参数和环境工况下，自动形成多套可执行部署方案，并用可复核的数据解释为什么推荐其中一套。平台直接读取装备建模已选型号和保存参数，优化推演不再维护第二套模型勾选或示例部署。'));
add(h2('1.1 默认输入与评价边界'));
add(makeTable(['输入维度','实际配置','对结果的影响'],[
 ['空间范围','核心区域 2400×2400 m；核心区半径 700 m','只计算真实 GIS/DEM 覆盖内的有效采样，不外推无数据区域'],
 ['空域采样','500 m 网格；离地 30/60/100 m；共 113 个有效点','覆盖率是离散采样口径，核心采样权重 ×3'],
 ['装备集合','02C 雷达、TDOA-X1B、NVT-951、CRY8500','候选由真实屋顶站点×型号×姿态构成，不使用独立示例部署'],
 ['感知门槛','within-model 且 margin ≥ 3 dB','几何、遮挡、频段、环境和 EMC 损耗共同决定覆盖'],
 ['相对成本','雷达12 / 无线电5 / 光电4 / 声学2','只用于方案横向比较，不是人民币报价'],
 ['方案约束','总预算600、设备上限64；三方案分别调整类型池、预算和上限','形成可解释的差异化解，而不是对同一方案重复命名']
],[1500,4300,4250],17));
add(h2('1.2 六轮变体与规则证据'));
add(body('六轮记录均显式使用当前界面默认四款装备。默认轮用于三方案对比，其他轮次改变网格、预算或高度层，用于检验布设规则是否只在单一配置下成立。'));
add(makeTable(['轮次','runId','主要变化','推荐方案 / 设备数'],runs.map((item,index)=>[['baseline','fine-grid','coarse-grid','low-budget','high-budget','low-layers'][index],item.runId,index===0?'默认参数':index===1?'网格 350 m':index===2?'网格 700 m':index===3?'预算 400':index===4?'预算 800':'高度层 20/45/60 m',`${item.summary.recommendedId} / ${item.summary.plans.find(p=>p.id===item.summary.recommendedId).devices} 台`]),[1350,3500,2500,2700],15));
add(note(`复现锚点：report=${source.reportPath}；run=${source.runPath}。输入 SHP、DBF、PRJ、DEM、白模变换和影像均保留 SHA-256；本文图表只读取上述真实批次。`));
page();

// ===== P3 第1章续：平台截图 =====
add(h1('第1章（续）  平台入口与装备数据链路'));
add(body('推演数据从三维城市与装备建模两个模块直接进入优化推演：城市模块确定目标与环境工况，装备模块保存型号与参数快照，优化推演按快照自动执行，无需二次选择模型。以下两张实测截图对应这条数据链的两端。'));
add(shotPair([`${S}/home.png`,'城市建模工作台','三维城市与三模块工作台'],[`${S}/sensors.png`,'装备建模界面','装备分类、型号选择与参数管理界面'],'图1-1 平台实测：三维城市工作台与装备建模界面。'));
add(body('图1-1 左图为河南博物院片区三维城市：15,889 栋真实建筑轮廓叠加 DEM 地形与航拍影像，黄色轮廓为核心防护目标；右图为装备建模界面：四类装备的参数分组编辑、保存与恢复。优化推演读取的正是该界面保存后的参数快照，任何草稿修改在未保存前不会进入推演，保证报告数值与界面参数严格一致。'));
add(note('操作路径：城市建模确认目标与环境 → 装备建模选择型号并保存 → 优化推演自动读取快照 → 「推演输入」调整范围/网格/权重/成本/威胁配置 → 导出 report/run JSON 供复核。'));
page();

// ===== P4 第2章 =====
add(h1('第2章  代码运行逻辑与覆盖矩阵'));
figure(`${A}/figure-1-pipeline.png`,650,296,'图2-1 任务三代码执行链黑白原理图','真实输入、覆盖矩阵、三方案优化、EMC、量化择优和实测验证的先后关系');
add(h2('2.1 候选生成与四工况覆盖实判'));
add(body(`runTask3Pipeline 先调用 generateSamples 建立有效空域采样，再由 generateCandidatesWithEquipment 在 ${report.siteCount} 个真实站点上生成 ${report.candidateCount} 个候选。每个候选保留设备 ID、型号、位置、站点安装代理、俯仰/朝向和模型频道；雷达候选使用 0°、−15°、−30°姿态变体，残余盲点邻近补点继续受真实表面与四工况可见性约束。`));
add(h2('2.2 感知模型的具体公式'));
add(body('四类装备的“覆盖”判定共用同一条链路预算框架：自由空间路径损耗按式（2-1）计算，雷达按能量形式雷达方程给出 SNR（式 2-2），无线电侦测按链路预算给出 SNR（式 2-3），最终覆盖成立当且仅当裕量满足式（2-4）。'));
add(eq([msub('L','fs'),mr('(d,f) = 20 '),msub('log','10'),mr('('),mfrac([mr('4π'),mr('d'),mr(' f')],[mr('c')]),mr(')')],'2-1'));
add(body('其中 d 为设备—采样视距（m），f 为载频（Hz），c 为光速。建筑穿透、单刀刃绕射与立面反射损耗在此基础上叠加。',{size:20}));
add(eq([mr('γ = 10 '),msub('log','10'),mr('('),mfrac([msub('P','t'),mr('τ·'),msup('10','(Gt+Gr)/10'),mr(' '),msup('λ','2'),mr(' σ '),msub('N','p')],[msup('(4π)','3'),mr(' '),msup('R','4'),mr(' k '),msub('T','0'),mr('·'),msup('10','(NF+Ls)/10')]),mr(')')],'2-2'));
add(body('式（2-2）中 P_t 为峰值功率、τ 为脉宽、G_t/G_r 为收发增益、λ 为波长、σ 为目标 RCS、N_p 为相参积累脉冲数、R 为距离、kT₀ 为热噪声基准、N_F 为噪声系数、L_s 为系统损耗——全部来自装备建模页保存的物理参数。',{size:20}));
add(eq([mr('SNR = EIRP + '),msub('G','r'),mr(' − '),msub('L','rx'),mr(' − '),msub('L','fs'),mr('(d,f) − '),msub('N','0'),mr(' + '),msub('G','p'),mr('，　'),msub('N','0'),mr(' = −174 + F + 10 '),msub('log','10'),mr(' B')],'2-3'));
add(eq([mr('M = SNR − '),msub('γ','req'),mr(' ≥ '),msub('M','0'),mr('，　'),msub('γ','req'),mr(' = 10 '),msub('log','10'),mr('('),mfrac([mr('ln '),msub('P','fa')],[mr('ln '),msub('P','d')]),mr(' − 1)')],'2-4'));
add(note('式（2-4）为覆盖判定的最终门槛：检出门限 γ_req 由假设虚警概率 P_fa 与检出概率 P_d 反推（Swerling 型近似），M₀ 为预留裕量（默认 3 dB）。雨雾、噪声、目标静默与 EMC 同频损耗都折算进 SNR 后再比较，因此所有工况共用同一判据。'));
page();

// ===== P5 第2章续 =====
add(h1('第2章（续）  四工况语义与推演完成态'));
add(body('evaluateCandidates 对每个候选、采样和工况执行同一感知内核：先用距离和视场做几何快判，再以 BVH 射线检查建筑/地形遮挡，最后把雨雾、噪声、目标静默和干扰计入裕量。覆盖矩阵随后同时服务于选点、盲区归因、设备独立贡献和威胁逐帧验证，避免不同模块采用互相矛盾的检出定义。'));
add(makeTable(['工况','目标/环境变化','优化意义'],[
 ['基线 · 发射','目标正常发射，使用当前城市环境','衡量常规条件下的基础覆盖'],
 ['无线电静默','目标 emitting=false','无线电侦测硬失效，检验雷达/光电/声学补位'],
 ['雨雾及街道噪声','降雨 30 mm/h、能见度 0.3 km，并提高雨噪/交通噪声','检验气象与声学传播退化下的稳健性'],
 ['电磁干扰','底噪 +10 dB、同频 +10 dB、串扰 +5 dB','检验干扰裕量下降后的覆盖保持能力']
],[1700,4800,3550],17));
add(screenshot(`${S}/task3-run.png`,560,373,'图2-2 优化推演完成态实测','推演输入、进度与状态区在真实运行后的界面'));
add(note('图2-2 中状态栏显示候选数、采样数、耗时与推荐方案，与本报告第1章基线表逐项一致；界面数字不作为本文数据源，report/run JSON 才是。'));
page();

// ===== P6 第3章 SOTA =====
add(h1('第3章  模型选型与 SOTA 参考'));
add(body('总体策略为“自研为主 + 轻量库拼接”：子任务一/二已建成三维模型与四类装备物理模型，任务三各环节调研 ≥3 个开源 SOTA 候选后，重型仿真引擎（Gazebo/AirSim/SPLAT!）与 Vite + Three.js + Web Worker 架构不匹配，只借鉴其模型参数与验证思路；求解与传播类库用于离线对标，不进入前端运行时。'));
add(makeTable(['环节','最终采用','SOTA 参照与用途'],[
 ['白模/地形解析与遮挡','three-mesh-bvh + GDAL/rasterio','CesiumJS/OptiX 排除；BVH 射线为 15,889 栋建筑遮挡实判核心'],
 ['部署优化','自研加权贪心集合覆盖','HiGHS/OR-Tools/spopt 作为精解对拍候选，记录于改进路径'],
 ['覆盖/盲区仿真','自研物理模型','NTIA ITM 与 ITU-Rpy 提供标准化传播参数与对标曲线'],
 ['威胁场景推演','自研逐帧运动学推演','gym-pybullet-drones 可作蜂群航迹离线对照样本'],
 ['电磁兼容校核','自研五规则代理引擎','GNU Radio / CloudRF 方法论为同频复用距离规则出处']
],[2000,3200,4850],16));
add(note('该领域无“开箱即用 EMC 校核”开源件；工程做法 = 传播模型 + 链路预算 + 频率分配规则自研。前端运行时零新增重依赖，全部候选的协议、优劣与部署成本见下页分环节对比。'));
page();

// ===== P7 SOTA 分环节 =====
add(h1('第3章（续）  分环节 SOTA 候选对比'));
add(body('以下对比覆盖五个环节共 20 个候选；协议列用于评估商用与二次开发合规风险，部署成本列决定是否进入运行时。'));
for(const [stage,cands] of sotaStages){
 add(h2(`3.${sotaStages.indexOf([stage,cands])+1} ${stage}`));
 add(makeTable(['候选','协议','优劣评估与采用结论'],cands.map(c=>[c[0],c[1],c[2]]),[3300,1400,5350],15));
}
page();

// ===== P8 第4章 算法原理 =====
add(h1('第4章  优化算法核心原理'));
figure(`${A}/figure-5-greedy.png`,640,320,'图4-1 加权贪心集合覆盖原理示意图','左侧为候选与采样覆盖关系，右侧为增益/成本排序；与 chooseGreedy 实际行为一致');
add(body('每轮在预算和设备上限内选择“新增覆盖权重/成本”最大的候选（式 4-1）；首轮饱和后反向检查已选设备，若其全部覆盖样本仍至少由两台设备覆盖，则执行冗余删除并释放成本（式 4-2）；释放预算后再次补选，最多四个 pass。冗余增强型在此基础上把仅一重覆盖的样本按 0.5 权重继续计入收益（式 4-3），形成核心区二重覆盖。'));
add(eq([msup('c','*'),mr(' = '),msub('argmax','c∈C'),mr(' '),mfrac([msum('j∈cov(c)∖S',null,[msub('w','j')])],[msub('κ','c')]),mr('，　s.t. Σ'),msub('κ','i'),mr(' ≤ B，|S| ≤ '),msub('N','max')],'4-1'));
add(eq([mr('remove(c) ⟺ ∀j∈cov(c)：　'),msubsup('n','j','−c'),mr(' ≥ 2')],'4-2'));
add(eq([msubsup('w','j','enh'),mr(' = '),msub('u','j'),mr('·'),msub('v','k'),mr('·'),mr('['),msub('n','j'),mr('=0 ? 1 : '),msub('n','j'),mr('=1 ? 0.5 : 0]')],'4-3'));
add(body('式（4-1）中 w_j 为样本权重（核心采样空间权重 ×3、基线工况权重 ×2 的乘积），κ_c 为候选相对成本，B 与 N_max 为方案预算与设备数上限；式（4-2）中 n_j 为样本 j 的当前覆盖计数，上标 −c 表示移除 c 后的计数；式（4-3）为增强型的分段增益函数。'));
add(note('轨迹可信性：每个真实 select/delete 事件写入 optimizationTrace（设备、站点、增益、成本、累计覆盖权重），本文第6–8章表格逐行来自该记录，不是事后重放另一套算法。'));
page();

// ===== P9 第4章续 评分 =====
add(h1('第4章（续）  多指标归一化与 EMC 回写'));
figure(`${A}/figure-8-scoring.png`,640,303,'图4-2 四指标归一化与 EMC 回写原理图','指标原始值跨方案 min-max 归一化后加权，EMC 结论作为乘性因子回写');
add(body('覆盖完整性取四工况最小值（稳健口径）加核心二重覆盖加成；盲区占比取四工况均值并反向归一；成本与施工可行性同样归一后加权（式 4-4、4-5）。EMC 结论随后回写：fail 每例得分 ×0.85（累计下限 0.7），仅 warning ×0.97（式 4-6）；推荐排序先比较是否存在未解决 fail，再比较回写后得分与成本。'));
add(eq([msubsup('x','i','^'),mr(' = '),mfrac([msub('x','i'),mr(' − '),msub('min','k'),mr(' '),msub('x','k')],[msub('max','k'),mr(' '),msub('x','k'),mr(' − '),msub('min','k'),mr(' '),msub('x','k')])],'4-4'));
add(eq([msub('S','raw'),mr(' = 0.40 '),msup('C','^'),mr(' + 0.25 '),msup('B','^'),mr(' + 0.20 '),msup('K','^'),mr(' + 0.15 '),msup('F','^')],'4-5'));
add(eq([mr('S = '),msub('S','raw'),mr(' × '),msub('f','emc'),mr('，　'),msub('f','emc'),mr(' = max(0.7, '),msup('0.85','nfail'),mr(') 或 0.97（仅 warning）')],'4-6'));
add(body('这套设计的含义：EMC 不是事后附加说明，而是直接参与排序的硬约束。增强型在本批次处置后 fail 归零，但 21 条 warning 仍使其得分乘以 0.97；均衡型 warning 较少且盲区/成本/施工组合最优，因此排名第一。'));
page();

// ===== P10 第5章 策略总览 =====
add(h1('第5章  三方案优化策略与完整轨迹总览'));
add(makeTable(['方案','类型池 / 预算 / 上限','冗余目标','候选池 / 实际事件'],report.plans.map(plan=>[plan.name,`${plan.presetSubset.join('、')}\n预算 ${plan.budget}；上限 ${plan.maxDevices}`,`${plan.id==='enhanced'?'核心二重覆盖增益 ×0.5':'只奖励未覆盖样本'}`,`${plan.optimizationTrace.poolSize} / ${plan.optimizationTrace.events.length} 条`]),[2200,3500,2300,2050],16));
add(figure(`${A}/figure-2-traces.png`,650,307,'图5-1 三方案实际选点增益/成本轨迹','横轴为真实事件步号；反向删除位置保留在记录中'));
add(makeTable(['方案','select 次数','delete 次数','最终设备','最终成本','轨迹含义'],report.plans.map(plan=>{const events=plan.optimizationTrace.events;return [plan.name,events.filter(e=>e.type==='select').length,events.filter(e=>e.type==='delete').length,plan.devices.length,fmt(plan.cost),plan.id==='enhanced'?'含核心二重覆盖补选':'贪心、删除与再补选'];}),[2000,1050,1050,1050,1150,3750],16));
add(note('筛选逻辑：三套方案在同一覆盖矩阵上运行，差异仅来自类型池、预算、设备上限与冗余目标——任何排名差异都能追溯到这四项输入与逐条事件，而非人为指定结果。'));
page();

// ===== P11 经济型轨迹 =====
add(h1('第6章  经济型方案：推演轨迹'));
add(body(`经济型只使用雷达与无线电长距装备，预算 300、设备上限 32，共产生 ${traceStats(report.plans.find(p=>p.id==='economy')).total} 条实际事件。为避免逐条罗列同规律的连续选点，下表将连续贪心段压缩为省略行（保留每段首尾与起止指标），反向删除等关键事件完整保留；全量事件可在 ${source.runPath} 中复核。`));
add(traceTable(report.plans.find(p=>p.id==='economy')));
add(caption(`表6-1 经济型 optimizationTrace 压缩视图：${traceStats(report.plans.find(p=>p.id==='economy')).total} 条事件压缩为 ${traceStats(report.plans.find(p=>p.id==='economy')).shown} 行。`));
add(note('筛选含义：第1步 TDOA-X1B 以 69.068 的增益成本比入选（无线电单台覆盖广、成本低），随后雷达按边际收益依次进入；第23–25步反向删除 3 台完全冗余设备释放 15.99 成本。经济型类型池不含光电/声学，静默与近距补盲手段受限，其优劣必须由后续四工况和四指标结果判断。'));
page();

// ===== P12 均衡型轨迹 =====
add(h1('第7章  均衡型方案：推演轨迹'));
add(body(`均衡型开放四类装备，预算 450、设备上限 48，共产生 ${traceStats(best).total} 条实际事件。首轮先选覆盖增益成本比高的无线电和雷达，再以声学候选补充近距采样；反向删除只移除覆盖完全冗余的设备，释放成本后继续补选。表格压缩规则与表6-1相同。`));
add(traceTable(best));
add(caption(`表7-1 推荐均衡型 optimizationTrace 压缩视图：${traceStats(best).total} 条事件压缩为 ${traceStats(best).shown} 行。`));
add(note('代码衔接：轨迹最终选择先进入 assignRadarChannels，再进入 remediateEmcConflicts。本方案 EMC 为 not-required，因此最终设备与轨迹之间没有换频/移位差异；覆盖贡献按实际设备逐样本重新统计，独立覆盖数可从覆盖矩阵直接复核。'));
page();

// ===== P13 增强型轨迹 + EMC =====
add(h1('第8章  冗余增强型方案：推演轨迹与 EMC 处置'));
add(body(`增强型预算 600、设备上限 64，共产生 ${traceStats(report.plans.find(p=>p.id==='enhanced')).total} 条实际事件，为三方案中最多。除未覆盖样本外，它按式（4-3）把仅一重覆盖样本以 0.5 权重计入收益，因此轨迹中出现 redundancy 阶段。表格压缩规则与前两章相同。`));
add(traceTable(report.plans.find(p=>p.id==='enhanced')));
add(caption(`表8-1 冗余增强型 optimizationTrace 压缩视图：${traceStats(report.plans.find(p=>p.id==='enhanced')).total} 条事件压缩为 ${traceStats(report.plans.find(p=>p.id==='enhanced')).shown} 行。`));
add(note('前 22 步与经济/均衡型同为贪心选点，第 24–25 步出现反向删除；此后贪心自然饱和——候选池中没有新增覆盖收益为正且满足预算的候选，转入 redundancy 阶段。'));
add(h2('8.1 选后 EMC 处置与覆盖复核'));
add(makeTable(['设备/动作','处置前','处置后','fail 变化','覆盖权重损失'],report.plans.find(p=>p.id==='enhanced').emcRemediation.actions.map(action=>[
 `${action.deviceId}\n${action.action==='retune'?'合法换频':'局部同型号移位'}`,`${action.action==='retune'?`${action.before.frequencyGHz} GHz`:`${action.before.siteId}\n${action.before.position.map((v,i)=>fmt(i===2?-v:v,1)).join(' / ')}`}\nfail ${action.before.emcCounts.fail}`,`${action.action==='retune'?`${action.after.frequencyGHz} GHz`:`${action.after.siteId}\n${action.after.position.map((v,i)=>fmt(i===2?-v:v,1)).join(' / ')}`}\nfail ${action.after.emcCounts.fail}`,`${action.before.emcCounts.fail} → ${action.after.emcCounts.fail}`,fmt(action.coverageLoss,3)
]),[2500,2600,2600,1100,1250],14));
add(note('增强型处置前 4 fail / 32 warning，经过 4 步合法换频或真实候选点局部移位后为 0 fail / 21 warning。处置后仍按实际频率和位置重算覆盖；warning 没有被删除或隐藏，并继续以 ×0.97 因子影响最终排名。'));
page();

// ===== P15 量化对比 =====
add(h1('第9章  多方案量化对比与推荐依据'));
add(h2('9.1 四工况覆盖结果'));
add(makeTable(['方案','工况','覆盖','覆盖率','盲区率','核心覆盖','核心二重'],report.plans.flatMap(plan=>plan.metrics.map(metric=>[plan.name,metric.name,`${metric.covered}/${metric.total}`,pct(metric.coverageRate),pct(metric.blindRate),pct(metric.coreCoverageRate),pct(metric.coreRedundantRate)])),[2100,1550,1050,1150,1150,1150,1250],15));
add(h2('9.2 四指标归一化与 EMC 回写'));
add(makeTable(['排名','方案','覆盖归一','盲区归一','成本归一','施工归一','原始分','EMC因子','最终分'],scoring.map(row=>[row.rank,row.name,fmt(row.normalized.coverage,4),fmt(row.normalized.blindRatio,4),fmt(row.normalized.cost,4),fmt(row.normalized.feasibility,4),fmt(row.scoreRaw??row.score,4),fmt(row.emcFactor??1,4),fmt(row.score,4)]),[600,2300,1100,1100,1100,1100,1050,1050,1100],15));
add(body(`推荐方案为${best.name}。三套方案覆盖原值经当前指标计算均为 1，但均衡型的盲区归一化、成本归一化和施工归一化组合得分最高；其原始分 ${fmt(recScore.scoreRaw??recScore.score,4)}，因存在 warning 乘以 0.97 后为 ${fmt(recScore.score,4)}。该结果说明推荐不是“设备最多”或“成本最低”的单指标结论。`));
add(makeTable(['对比对象','最终分差','覆盖指标差','盲区率差','相对成本差','对方 EMC'],scoring.filter(row=>row.id!==best.id).map(row=>[row.name,fmt(recScore.score-row.score,4),fmt(recScore.indicators.coverage-row.indicators.coverage,4),`${fmt((row.indicators.blindRatio-recScore.indicators.blindRatio)*100,2)} pp`,fmt(row.indicators.cost-recScore.indicators.cost,2),`${row.emcVerdict} / 可部署=${row.emcDeployable?'是':'否'}`]),[2600,1250,1250,1350,1450,2400],15));
add(note('评分按式（4-4）至（4-6）计算：经济型成本低但盲区/施工组合较弱；增强型覆盖与冗余更高，但成本、施工和处置后 warning 仍影响综合排序。'));
page();

// ===== P16 最优部署空间 =====
add(h1('第10章  最优部署方案：空间结构与代表点'));
figure(`${A}/figure-3-deployment.png`,620,407,'图10-1 推荐方案 21 台设备黑白点位原理图','共址设备按平台同一分散规则展开，细线回指真实坐标；编号对应后续全量明细');
add(makeTable(['结构维度','实际结果','技术解释'],[
 ['设备构成',Object.entries(best.typeCounts).map(([type,count])=>`${TYPES[type]??type} ${count} 台`).join('；'),'无线电/雷达承担广域覆盖，声学负责近距补盲，光电候选未被强制选入'],
 ['相对成本',fmt(best.cost),'成本由型号相对成本与站点安装代理共同构成'],
 ['空间组织',`核心覆盖 ${pct(best.metrics[0].coreCoverageRate)}；核心二重 ${pct(best.metrics[0].coreRedundantRate)}`,'外围长距覆盖与核心多重重叠同时使用，不是简单均匀撒点'],
 ['EMC 状态',`${report.emc[best.id].counts.fail} fail / ${report.emc[best.id].counts.warning} warning`,'无严重冲突；共址和前端阻塞提示仍需现场处置'],
 ['方案性质','当前模型、采样、约束和权重下推荐','不把贪心结果包装为全局最优证明']
],[1600,3700,4750],16));
add(h2('10.1 代表点为何被保留'));
add(makeTable(['代表设备','点位与型号','真实覆盖贡献及部署依据'],representative.cases.map(item=>[`${item.displayName} / ${item.modelName}`,`${item.siteName}\n东 ${fmt(item.position[0],1)} / 北 ${fmt(-item.position[2],1)} / 高 ${fmt(item.position[1],1)}`,item.reasons.join('；')]),[1900,3300,4850],15));
page();

// ===== P17 平台地图截图 =====
add(h1('第10章（续）  地图实测：部署、盲区与方案对比'));
add(body('以下三张截图为同一推演批次在平台中的真实画面：图10-2 为推荐方案覆盖态势与核心权重区；图10-3 为「盲区分布」标签页的四类图例与逐条成因列表；图10-4 为「方案对比」标签页，其三套方案指标与第9章表格一致。'));
add(screenshot(`${S}/task3-coverage.png`,540,360,'图10-2 推荐方案覆盖态势实测','彩色点位为装备，黄圈为核心权重区，彩色小点为分类盲区'));
add(shotPair([`${S}/task3-blindspots.png`,'四类盲区排查','盲区图例与成因列表'],[`${S}/task3-plans.png`,'方案对比标签页','三套方案四指标对比'], '图10-3 / 图10-4 「盲区分布」与「方案对比」标签页实测。'));
add(note('盲区图例支持按类别开关，列表逐条给出成因（如“楼栋夹缝 · 缝宽 41 m”“低空贴楼 · 贴楼 0.0 m · 离地 30 m”）；截图仅作界面证据，数值以 report/run 为准。'));
page();

// ===== P18 设备明细一 =====
add(h1('第11章  最优部署全量技术明细（一）'));
add(body('以下设备 1–11 与图10-1 编号一致。坐标采用局部东/北/高米制；贡献统一写成“工况：覆盖采样数/独立覆盖采样数”。安装姿态与模型频道和平台当前参数一致，施工与道路条件不作未经验证的推断。'));
function deviceTable(devices){return makeTable(['编号/类型/型号','内部 ID / 站点 / 安装','东 / 北 / 高 / m','姿态/频道','成本','四工况贡献'],devices.map((device,localIndex)=>{const index=best.devices.indexOf(device),site=best.sites[index],entry=display.details(device.id),cost=report.settings.costs[device.type]+site.installationProxy*.2,contrib=report.conditions.map((condition,ci)=>{const row=best.coverageContributions[device.id][ci];return `${condition.id}:${row.coveredSamples}/${row.independentSamples}`;}).join('\n');return [`${entry.displayName}\n${TYPES[device.type]} / ${entry.modelName}`,`${device.id}\n${site.name??site.id}\n${site.installation??'候选点安装代理'}`,`${fmt(device.position[0],2)}\n${fmt(-device.position[2],2)}\n${fmt(device.position[1],2)}`,`俯仰 ${angle(device.parameters.pitch)}°\n朝向 ${angle(device.parameters.heading)}°\n${dash(device.parameters.frequencyGHz)} GHz`,fmt(cost,3),contrib];}),[1250,2750,1100,1200,650,3100],13);}
add(deviceTable(best.devices.slice(0,11)));
add(caption('表11-1 推荐方案设备 1–11 全量参数与逐工况贡献。'));
page();

// ===== P19 设备明细二 =====
add(h1('第11章（续）  最优部署全量技术明细（二）'));
add(deviceTable(best.devices.slice(11)));
add(caption('表11-2 推荐方案设备 12–21；与上页合并为完整 21 台设备清单。'));
add(h2('11.1 明细表的读法与独立覆盖价值'));
add(body('“覆盖/独立覆盖”是评价单点必要性的关键：独立覆盖大于 0 的设备移除后必然产生新盲点（如设备-1 在基线工况独立覆盖 2 个采样），独立覆盖为 0 的设备提供的是冗余与工况稳健性（如声学设备在电磁干扰工况下独立覆盖回升）。21 台设备中既有不可替代的骨干点，也有面向静默/干扰工况的冗余点，二者共同构成推荐方案的稳健性来源。'));
add(body('成本列由型号相对成本与站点安装代理（高度越高代理越大）相加得到，与第5章轨迹中的成本逐项一致；姿态与频道为优化后实际值，与 EMC 校核使用的参数完全相同，不存在“展示一套、计算一套”的差异。'));
page();

// ===== P20 盲区归因与移动补盲 =====
add(h1('第12章  盲区归因与移动补盲验证'));
figure(`${A}/figure-6-blindtree.png`,640,356,'图12-1 四类盲区归因判定树','夹缝 > 阴影 > 贴楼 > 边角 > 其他的几何判定优先级');
add(body('盲区不是“没画到”，而是逐台设备用同一套感知公式算出来的：没有任何设备在该点同时满足几何可达与裕量门槛。归因树把每个盲点分配到楼栋夹缝、背面阴影、低空贴楼、围墙边角或其他，成因字段（缝宽、贴楼距、遮挡距离）写入报告供规则提炼。'));
figure(`${A}/figure-10-mobile.png`,640,303,'图12-2 移动补盲候选搜索原理','粗圆环 500/750/1000 m × 12 方向，粗搜无候选时对剩余盲点做 750 m×25 m 细网格');
page();

// ===== P21 补盲结果与截图 =====
add(h1('第12章（续）  移动补盲实测结果'));
add(body('消除比例按离散有效采样盲点集合计算（式 12-1）：B₀ 为基线盲点集合，B₁ 为补盲后盲点集合；分母为 0 时记为“不适用”，不写成 100%。'));
add(eq([mr('η = '),mfrac([mr('|'),msub('B','0'),mr('| − |'),msub('B','1'),mr('|')],[mr('|'),msub('B','0'),mr('|')])],'12-1'));
add(makeTable(['工况','前盲点','后盲点','消除数','消除比例','前覆盖率','后覆盖率'],blind.derived.metrics.map((metric,index)=>{const before=blind.baseline.blindspots[index].stats.total,after=blind.derived.blindspots[index].stats.total;return [metric.name,before,after,before-after,before?pct((before-after)/before):'不适用',pct(blind.baseline.metrics[index].coverageRate),pct(metric.coverageRate)];}),[1900,1050,1050,1050,1350,1350,1350],16));
add(body(`独立浏览器批次 ${blind.runId} 中，基线工况 4 个盲点全部消除，消除比例 100%，新增 4 台移动雷达且新增 EMC fail 为 0；无线电静默等工况仍有残余盲点，不能用基线工况的 100% 代替全域无盲区结论。取消补盲后，设备、盲点、EMC 与原始报告恢复一致。`));
add(shotPair([`artifacts/task3/mobile-repair.png`,'移动补盲后地图','新增移动雷达与覆盖贡献'],[`artifacts/task3/mobile-repair-restored.png`,'取消补盲恢复基线','取消后设备/盲点/EMC 恢复'], '图12-3 / 图12-4 移动补盲后与取消恢复的平台实测画面。'));
add(note('补盲设备为警车移动部署，挂载高度 2 m 为模型假设，候选仅为开阔地表几何代理，道路可达性未验证；这些限制如实写入导出报告，不作为施工坐标。'));
page();

// ===== P22 威胁推演 =====
add(h1('第13章  三类威胁场景鲁棒性推演'));
figure(`${A}/figure-9-threats.png`,640,285,'图13-1 三类威胁场景径向航路原理图','方位角以核心目标正北为 0° 顺时针；逐帧复用感知模型实判，容量按帧截取');
add(makeTable(['场景','配置','目标数','平均检出占比','最低检出占比','容量溢出','全目标同帧检出'],[
 ['单机单点入侵','8 方位×1 架，15 m/s，AGL 30/60 m',report.threats.single.summary.targetCount,pct(report.threats.single.summary.meanDetectedFraction,1),pct(report.threats.single.summary.minDetectedFraction,1),report.threats.single.summary.overflowEvents,`${report.threats.single.summary.framesWithAllDetected}/${report.threats.single.summary.totalFrames}`],
 ['多方向同步入侵','4 方向×1 架，15 m/s，AGL 45/60 m',report.threats.multi.summary.targetCount,pct(report.threats.multi.summary.meanDetectedFraction,1),pct(report.threats.multi.summary.minDetectedFraction,1),report.threats.multi.summary.overflowEvents,`${report.threats.multi.summary.framesWithAllDetected}/${report.threats.multi.summary.totalFrames}`],
 ['蜂群饱和攻击','3 方向×14 架=42，12 m/s，AGL 30/45/60 m',report.threats.swarm.summary.targetCount,pct(report.threats.swarm.summary.meanDetectedFraction,1),pct(report.threats.swarm.summary.minDetectedFraction,1),report.threats.swarm.summary.overflowEvents,`${report.threats.swarm.summary.framesWithAllDetected}/${report.threats.swarm.summary.totalFrames}`]
],[1600,2500,800,1150,1150,900,1400],15));
add(body('蜂群场景 42 架超出无线电装备的文档并发容量（TDOA-X1B 35 / OA-X1Bmini 30 / X1C 15 架次），推演如实记录 397 架次溢出、42 架目标均出现过漏探帧——这暴露了并发容量而非探测能力是蜂群场景的瓶颈，是增加声学/无线电点位或引入更高容量装备的定量依据。'));
page();

// ===== P23 威胁截图 =====
add(h1('第13章（续）  威胁推演平台实测'));
add(body('以下三张截图为三类场景播放中的真实画面：红色无人机沿径向航路逼近核心区，红色连线为当前帧实际检出它的装备，报警设备同步闪烁红光并动态缩放。'));
add(screenshot(`${S}/task3-threat-single.png`,540,360,'图13-2 单机单点入侵推演实测','8 方位航路逐帧验证'));
add(shotPair([`${S}/task3-threat-multi.png`,'多方向同步入侵','4 方向同时进入'],[`${S}/task3-threat-swarm.png`,'蜂群饱和攻击','42 架蜂群与容量溢出统计'],'图13-3 / 图13-4 多方向同步与蜂群饱和攻击推演实测。'));
add(note('蜂群截图左侧统计含容量溢出 397 架次——这是装备文档容量参数的真实后果，未做美化；威胁配置（数量、方位角、AGL、速度）均可在面板中调整并自动重算。'));
page();

// ===== P24 EMC 深度解析 =====
add(h1('第14章  电磁兼容优化与验证'));
figure(`${A}/figure-7-emc.png`,640,338,'图14-1 装备频谱事实与五类冲突规则','雷达发射频点高于无线电接收上限，跨类耦合天然不成立；同带雷达间需同频/邻频规则');
add(body('同频干扰的量化代理按式（14-1）计算：两发射机频差小于 0.1 GHz 且三维距离 d 小于 600 m 时判 fail，双方各累积同频损耗 L_cc；该损耗通过式（2-3）进入 SNR 后重算覆盖，即 EMC 会真实改变检出边界而非只产生告警文字。'));
add(eq([msub('L','cc'),mr('(d) = 6 × (1 − '),mfrac([mr('d')],[mr('600')]),mr(')　[dB]，　Δf < 0.1 GHz 且 d < 600 m')],'14-1'));
add(h2('14.1 规避策略与处置结果'));
add(makeTable(['方案','处置前 fail/warning','处置后 fail/warning','动作数','状态','最终结论'],report.plans.map(plan=>[plan.name,`${plan.emcRemediation.before.counts.fail} / ${plan.emcRemediation.before.counts.warning}`,`${plan.emcRemediation.after.counts.fail} / ${plan.emcRemediation.after.counts.warning}`,plan.emcRemediation.actions.length,plan.emcRemediation.status,{pass:'通过',degraded:'降额',fail:'不通过'}[report.emc[plan.id].verdict]]),[2400,1700,1700,850,1500,1350],15));
add(body('处置顺序：初始图着色式频道分配（同频冲突权重 ×10、邻频 ×1）→ 单设备合法换频（只使用装备既有离散频道，每步必须减少 fail）→ 同型号同俯仰真实候选点局部移位（搜索半径 ≤1200 m、候选 ≤24 个）→ 按 fail、warning、覆盖损失、移动距离排序选动作 → 处置后按实际载频/位置重算受影响覆盖。'));
page();

// ===== P25 EMC 截图与残余风险 =====
add(h1('第14章（续）  EMC 实测与残余风险'));
add(screenshot(`${S}/task3-emc.png`,540,360,'图14-2 电磁兼容界面实测','结论横幅与设备冲突清单（含距离、频差、处置建议）'));
add(makeTable(['风险类型','本批次证据','处置建议'],[
 ['共址过密（warning）','推荐方案存在同点位部署提示','现场错开安装点位 ≥10 m'],
 ['前端阻塞（warning）','1500 W 级雷达邻近无源接收机','大功率雷达与无源接收机间距 ≥50 m'],
 ['增强型残余 warning','处置后仍有 21 条邻频/共址提示','接受降额结论或在人工调整点位后重跑'],
 ['误探证据边界','仅有 ghost 风险代理，无实测虚警真值','接入非目标标注集后以混淆矩阵验收']
],[2200,4200,3650],16));
add(note('EMC 结论的工程含义：推荐方案无严重冲突，6 条提示均可通过现场间距处置；校核为工程代理规则，不是频谱合规认证，施工前必须执行现场频谱扫描。'));
page();

// ===== P26 布设规则 =====
add(h1('第15章  可复用的标准化布设规则'));
add(body('规则由六轮默认装备变体自动提炼，只有具备真实样本、统计方法和 runId 的条目才保留。量化阈值用于同类城区的候选筛选与复核，不替代新场景重跑；R2 的跨轮有效比值样本较少，因此复用时必须提高验证等级。'));
figure(`${A}/figure-4-rules.png`,530,330,'图15-1 四类布设规则黑白原理示意图','夹缝、低空、声学制高点和静默冗余分别对应可执行部署动作');
add(makeTable(['规则','量化表述与执行动作','统计证据','清晰性/复用性评估'],rules.map(rule=>[`${rule.id} ${rule.title}`,rule.text,`样本 ${rule.evidence.samples}；${rule.evidence.method}`,ruleBoundaries[rule.id]??'仅限当前模型，迁移时重新标定']),[1250,3950,3150,2700],14));
add(note('复用方法：先把规则作为候选生成约束或人工审核清单，再用新场景多轮数据重算 X/Y/Z/W 等阈值；如果样本不足或跨轮符号反转，应停止使用该条规则，而不是沿用本文数值。'));
page();

// ===== P27 综合验证与航迹 =====
add(h1('第16章  示例航迹与报警记录'));
add(body('示例航迹直接使用优化推演当前方案、工况和装备参数，不单独生成第二套部署：无人机 D-01 沿真实 DEM 连通域内的西→东航路穿越城区，逐帧复用覆盖判定，检出设备在地图上红光闪烁并动态缩放，支持中文语音播报、速度调节、进度拖动与报警记录导出。'));
add(screenshot(`${S}/planning.png`,540,360,'图16-1 示例航迹实测','四旋翼模型与实时检出连线、HUD 离地高度'));
add(shotPair([`${S}/alarms.png`,'报警记录','报警事件列表与检出状态'],[`${S}/task3-blindspots.png`,'盲区联动','盲区分布面板'],'图16-2 / 图16-3 报警记录与盲区联动界面实测。'));
add(note('报警按离散模型帧更新、运动按轨迹插值，不保证帧间始终可探测；导出的航迹报告与任务三 requestId 绑定，可与本文第1章批次互相核对。'));
page();

// ===== P28 局限与改进一 =====
add(h1('第17章  方案局限性与可落地改进路径（一）'));
add(body('改进路径按“限制—影响—具体实现—验收指标”闭环组织，避免仅写“提高精度”“继续优化”等无法验证的表述。前五项优先影响模型结论的可信度。'));
add(makeTable(['局限与当前证据','具体改进路径','实施位置/新增数据','验收指标'],limitationRows.slice(0,5).map(([name,evidence,improve,metric])=>[`${name}\n${evidence}`,improve,name.includes('采样')?'sampling/generateSamples':name.includes('贪心')?'pipeline/chooseWithRedundancy':name.includes('感知')?'presets/engine':name.includes('LoD1')?'GIS/DEM 预处理':'emc/engine + 标注数据',metric]),[3300,3400,2000,2400],15));
add(h2('优先级建议'));
add(body('先建立真实目标/非目标标注集和现场几何核验，再标定感知与 EMC 参数，最后比较优化器差距。若先用更复杂搜索算法放大未标定输入，得到的只是更精细但不更可信的排名。连续采样与标注数据应成为第一优先级，感知/EMC 标定为第二优先级，精确求解对标为第三优先级。'));
page();

// ===== P29 局限与改进二 + 结论 =====
add(h1('第17章（续）  方案局限性与可落地改进路径（二）'));
add(makeTable(['局限与当前证据','具体改进路径','实施位置/新增数据','验收指标'],limitationRows.slice(5).map(([name,evidence,improve,metric])=>[`${name}\n${evidence}`,improve,name.includes('施工')?'sites/mobile-repair + 现场数据':name.includes('成本')?'settings.costs + 成本台账':name.includes('派生')?'mobile-repair/threats':'rules.js + 新场景多轮数据',metric]),[3300,3400,2000,2400],15));
add(h2('17.1 复现与审计要求'));
add(code('node scripts/task3_report.js                  # 六轮默认装备真实推演'));
add(code('node scripts/task3_mobile_repair_browser_smoke.js  # 补盲前后与恢复验证'));
add(code('node scripts/task3_word_assets.py && python scripts/task3_word_assets2.py  # 黑白原理图'));
add(code('node scripts/task3_word_report.js           # 本 Word 报告'));
add(h2('17.2 结论'));
add(body(`本平台已在同一真实数据链上完成 ${report.candidateCount} 个候选到三套方案的完整推演，并以 ${best.name} 形成当前推荐部署。经济型、均衡型和增强型的每一次选点、删除、补选及 EMC 动作均可追溯；推荐方案的 21 台设备坐标、型号、姿态、频道、成本和逐工况贡献均已展开。六轮数据进一步形成可执行的量化布设规则，移动补盲、三类威胁和 EMC 实测则同时展示能力边界。后续工作应按本文改进路径补充连续几何、现场标定和真实虚警数据，再评价更高层级的全局优化与施工可行性。`));
add(note('最终口径：报告价值在于“可复现的计算过程 + 完整的方案细节 + 不回避的局限性”。任何采样覆盖率、消除比例或 EMC 结论都不得脱离其数据批次、模型假设和验证边界单独引用。'));

const doc=new Document({
 creator:'AI Assistant',title:'任务三 多方案优化与最优部署技术方案与真实仿真成果报告',description:'三方案完整推演、最优部署全量明细、SOTA 选型、可复用规则与改进路径',
 styles:{default:{document:{run:{font,size:22,color:'222222'},paragraph:{spacing:{after:120,line:330}}}},paragraphStyles:[
  {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:32,bold:true,font,color:'173F4F'},paragraph:{spacing:{before:240,after:200},outlineLevel:0,keepNext:true,keepLines:true}},
  {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:26,bold:true,font,color:'285764'},paragraph:{spacing:{before:150,after:130},outlineLevel:1,keepNext:true,keepLines:true}},
  {id:'Heading3',name:'Heading 3',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:23,bold:true,font,color:'333333'},paragraph:{spacing:{before:110,after:100},outlineLevel:2,keepNext:false,keepLines:false}}
 ]},
 sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:720,right:850,bottom:720,left:850,header:360,footer:360}}},headers:{default:new Header({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'创意科目二｜任务三  多方案优化与最优部署',size:15,font,color:'5B6F75'})]})]})},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'第 ',size:15,font}),new TextRun({children:[PageNumber.CURRENT],size:15,font}),new TextRun({text:' 页 / 共 ',size:15,font}),new TextRun({children:[PageNumber.TOTAL_PAGES],size:15,font}),new TextRun({text:' 页',size:15,font})]})]})},children}]
});
const buffer=await Packer.toBuffer(doc),output='任务三多方案优化与最优部署技术方案报告.docx';
fs.writeFileSync(output,buffer);
console.log(JSON.stringify({output,plans:report.plans.map(plan=>({id:plan.id,events:plan.optimizationTrace.events.length})),devices:best.devices.length,rules:rules.length,figures:10,screenshots:15,size:buffer.length},null,2));
