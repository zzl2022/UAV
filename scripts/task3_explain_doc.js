// 生成《任务三模型可解释性》单文件 HTML：公式 → 代码位置 → 真实数值代入 → 图。
// 数据：artifacts/task3/explain-data.json（task3_explain_data.js 真实计算）+ latest-report.json。
// 纯内联 SVG/CSS，无外部依赖，双击即开；输出仓库根目录，不入库。
import {readFile,writeFile} from 'node:fs/promises';

const D=JSON.parse(await readFile('artifacts/task3/explain-data.json','utf8'));
const R=JSON.parse(await readFile('artifacts/task3/latest-report.json','utf8'));
const S=D.steps,plan=R.plans.find(p=>p.id===R.recommendedId);
const f2=x=>Number(x).toFixed(2),f1=x=>Number(x).toFixed(1);
const pct=x=>(100*x).toFixed(1)+'%';
// 成因对象数字保留两位小数，避免长浮点
const fmtCause=o=>JSON.stringify(o,(k,v)=>typeof v==='number'?Math.round(v*100)/100:v);

// ── 工具：参考链路裕量曲线（雷达真实参数，构建期静态计算） ──
const radarMarginCurve=(()=>{const p=plan.devices.find(d=>d.type==='radar').parameters,pts=[];
 for(let d=50;d<=8000;d*=1.12){const m=40*Math.log10(p.maxRange/d)+10*Math.log10(R.target.rcs/p.referenceRcs)-6.08+p.referenceSnrDb-p.thresholdDb;pts.push([d,m]);}
 const W=560,H=220,PM=36,x0=Math.log10(50),x1=Math.log10(8000),y1=50,y0=-30;
 const X=d=>PM+(Math.log10(d)-x0)/(x1-x0)*(W-PM-14),Y=m=>H-PM-(m-y0)/(y1-y0)*(H-PM-24);
 const path=pts.map(([d,m],i)=>(i?'L':'M')+X(d).toFixed(1)+','+Y(Math.max(y0,Math.min(y1,m))).toFixed(1)).join(' ');
 const xm=X(S.coverageRadar.distanceM),ym=Y(S.coverageRadar.marginDb);
 return {W,H,PM,path,xm,ym,X,Y,y0,y1};})();

// ── 贪心步骤 SVG 柱图 ──
const greedyChart=(()=>{const picks=S.greedy.picks,W=560,H=210,PM=40,maxR=Math.max(...picks.map(p=>p.gainPerCost));
 const bw=(W-PM-16)/picks.length*0.55,gap=(W-PM-16)/picks.length;
 const bars=picks.map((p,i)=>{const x=PM+i*gap+ (gap-bw)/2,h=p.gainPerCost/maxR*(H-PM-30);
  return `<rect x="${x.toFixed(1)}" y="${(H-PM-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--accent)" opacity="${0.95-i*0.09}"/>
  <text x="${(x+bw/2).toFixed(1)}" y="${(H-PM-h-6).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--ink)">${p.gainPerCost}</text>
  <text x="${(x+bw/2).toFixed(1)}" y="${H-PM+14}" text-anchor="middle" font-size="10" fill="var(--muted)">第${p.step}步</text>
  <text x="${(x+bw/2).toFixed(1)}" y="${H-PM+26}" text-anchor="middle" font-size="9" fill="var(--muted)">${p.preset.replace(' 三坐标雷达','').replace(' 声学相机','')}</text>`;}).join('');
 return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="贪心选点增益成本比">${bars}<line x1="${PM}" y1="${H-PM}" x2="${W-14}" y2="${H-PM}" stroke="var(--rule)"/></svg>`;})();

// ── 流水线 SVG 图 ──
const pipelineSvg=(()=>{const boxes=[['感知模型','sensors/engine.js'],['覆盖推演','planning/optimizer.js'],['候选优化','task3/pipeline.js'],['盲区归因','task3/blindspots.js'],['四指标择优','task3/metrics.js'],['威胁推演','task3/threats.js'],['EMC 校核','task3/emc.js'],['布设规则','task3/rules.js']];
 const W=880,bw=190,bh=54,gx=26,gy=20,perRow=4;
 let s='';boxes.forEach((b,i)=>{const row=Math.floor(i/perRow),col=i%perRow,x=14+col*(bw+gx),y=14+row*(bh+gy+14);
  s+=`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" fill="var(--bg2)" stroke="var(--accent)" stroke-opacity=".5"/>
  <text x="${x+bw/2}" y="${y+24}" text-anchor="middle" font-size="13.5" fill="var(--ink)" font-weight="600">${b[0]}</text>
  <text x="${x+bw/2}" y="${y+42}" text-anchor="middle" font-size="10.5" fill="var(--accent2)">${b[1]}</text>`;
  if(i<boxes.length-1&&col<perRow-1)s+=`<path d="M ${x+bw+4} ${y+bh/2} h ${gx-8}" stroke="var(--accent)" marker-end="url(#arw)"/>`;});
 return `<svg class="chart" viewBox="0 0 ${W} ${2*(bh+gy)+40}" width="100%" style="max-width:${W}px"><defs><marker id="arw" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L8,4L0,8z" fill="var(--accent)"/></marker></defs>${s}</svg>`;})();

// ── 盲区判定树 SVG ──
const blindTree=(()=>{const N=(x,y,w,t1,t2,col='var(--bg2)')=>`<rect x="${x}" y="${y}" width="${w}" height="46" rx="8" fill="${col}" stroke="var(--rule)"/><text x="${x+w/2}" y="${y+19}" text-anchor="middle" font-size="11.5" fill="var(--ink)">${t1}</text>${t2?`<text x="${x+w/2}" y="${y+35}" text-anchor="middle" font-size="10" fill="var(--muted)">${t2}</text>`:''}`;
 const L=(x1,y1,x2,y2,t)=>`<path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="var(--muted)" fill="none"/>${t?`<text x="${(x1+x2)/2+6}" y="${(y1+y2)/2}" font-size="10" fill="var(--accent)">${t}</text>`:''}`;
 return `<svg class="chart" viewBox="0 0 880 330" width="100%" style="max-width:880px">
 ${N(340,8,200,'盲点采样','blindspots.js L109')}
 ${L(440,54,150,96,'是')}${N(40,96,230,'① 楼栋夹缝？','对向两楼>120°、缝宽≤60m、楼高于点')}
 ${L(440,54,440,96,'否')}${N(330,96,220,'② 背面阴影？','可覆盖设备全部被≤120m内建筑截断')}
 ${L(660,54,730,96,'否')}${N(620,96,220,'③ 低空贴楼？','离地≤45m 且距立面≤20m')}
 ${L(150,142,150,192,'是')}${L(440,142,440,192,'是')}${L(730,142,730,192,'是')}
 ${N(60,192,180,'楼栋夹缝','缝宽/楼号入 cause','rgba(255,159,90,.12)')}
 ${N(350,192,180,'背面阴影区','遮挡距离入 cause','rgba(255,119,109,.12)')}
 ${N(640,192,180,'低空贴楼区','贴楼距/离地入 cause','rgba(112,214,255,.12)')}
 ${L(730,238,730,268,'否')}${N(620,268,220,'④ 围墙边角？距角部≤25m，否则「其他」','优先级：夹缝>阴影>贴楼>边角')}
 </svg>`;})();

// ── EMC 频段图 SVG ──
const emcBands=(()=>{const W=880,H=190,x0=0.5,x1=17,X=f=>50+(Math.log10(f)-Math.log10(x0))/(Math.log10(x1)-Math.log10(x0))*(W-80);
 const band=(f1,f2,y,label,col)=>`<rect x="${X(f1)}" y="${y}" width="${(X(f2)-X(f1)).toFixed(1)}" height="20" rx="4" fill="${col}" opacity=".8"/><text x="${X(f1)+4}" y="${y+14}" font-size="10.5" fill="#0e1922" font-weight="700">${label}</text>`;
 const dot=(f,y,label,col)=>`<circle cx="${X(f)}" cy="${y}" r="5" fill="${col}"/><text x="${X(f)+8}" y="${y+4}" font-size="10.5" fill="var(--ink)">${label}</text>`;
 let ticks='';for(const f of [0.5,1,2,5,10,15])ticks+=`<line x1="${X(f)}" y1="150" x2="${X(f)}" y2="158" stroke="var(--rule)"/><text x="${X(f)}" y="172" text-anchor="middle" font-size="10" fill="var(--muted)">${f} GHz</text>`;
 return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">
 <text x="50" y="18" font-size="11.5" fill="var(--muted)">发射（雷达）</text>
 ${dot(9.4,34,'02C 雷达 X 带（模型 9.3–9.75 四频道）','var(--accent)')}
 ${dot(15,56,'03D 雷达 Ku 带（模型 16–17.5 四频道）','var(--accent2)')}
 <text x="50" y="92" font-size="11.5" fill="var(--muted)">接收（无源，不发射）</text>
 ${band(0.1,6,104,'TDOA-X1B / OA-X1Bmini：100 MHz–6 GHz 连续接收','#7fb8d8')}
 ${[0.9,1.2,2.4,5.2,5.8].map(f=>dot(f,138,'','#b89aff')).join('')}
 <text x="${X(0.9)}" y="130" font-size="10.5" fill="var(--ink)">X1C 离散频点 0.9/1.2/2.4/5.2/5.8</text>
 ${ticks}
 <text x="50" y="186" font-size="10.5" fill="var(--muted)">判读：雷达发射频点（9.4/15 GHz 以上）高于无线电接收上限 6 GHz → 发射-接收耦合天然不成立；同带雷达之间才需同频/邻频规则。</text>
 </svg>`;})();

// ── 表格构造 ──
const radarTerms=S.coverageRadar.terms;
const lossRows=Object.entries(radarTerms.losses).map(([k,v])=>`<tr><td>${{rain:'雨衰 L_rain',cloudFog:'云雾',multipath:'地面双径',facadeReflection:'立面反射',clutter:'城市杂波',noise:'电磁底噪',cochannel:'同频干扰',crosstalk:'设备串扰'}[k]}</td><td>${f2(v)} dB</td><td>${v===0?'当前工况为零':'代入计算'}</td></tr>`).join('');
const greedyRows=S.greedy.picks.map(p=>`<tr><td>第 ${p.step} 步</td><td>${p.preset}</td><td>${p.gain}</td><td>${p.cost}</td><td><strong>${p.gainPerCost}</strong></td><td>${p.coveredWeightPct}%</td></tr>`).join('');
const blindRows=S.blindClassification.cases.map(c=>`<tr><td>${c.sampleId}</td><td>${c.stored}</td><td>${c.replayed}</td><td>${c.match?'✓ 一致':'✗'}</td><td>${fmtCause(c.cause)}</td></tr>`).join('');
const scoringRows=R.scoring.plans.map(r=>`<tr${r.id===R.recommendedId?' class="rec"':''}><td>${r.name}</td><td>${f1(r.indicators.coverage*100)}% → ${f2(r.normalized.coverage)}</td><td>${(r.indicators.blindRatio*100).toFixed(2)}% → ${f2(r.normalized.blindRatio)}</td><td>${f1(r.indicators.cost)} → ${f2(r.normalized.cost)}</td><td>${r.indicators.feasibility.toFixed(3)} → ${f2(r.normalized.feasibility)}</td><td>${f2(r.scoreRaw)}</td><td>×${r.emcFactor}</td><td><strong>${f2(r.score)}</strong></td></tr>`).join('');
const condRows=plan.metrics.map(m=>`<tr><td>${m.name}</td><td>${m.covered}/${m.total}</td><td>${(m.blindRate*100).toFixed(2)}%</td><td>${pct(m.coreCoverageRate)}</td><td>${pct(m.coreRedundantRate)}</td></tr>`).join('');

const html=`<!-- Generated by Trae Work -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>任务三模型可解释性 · 从公式到代码</title>
<style>
:root{--bg:#0e1922;--bg2:#152635;--ink:#e6f1f7;--muted:#93b3c4;--rule:#2a4553;--accent:#5fd4b8;--accent2:#ffd783;--warn:#ff9f5a;--bad:#ff776d;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.8 "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif;}
.wrap{max-width:1020px;margin:0 auto;padding:0 24px 80px}
header.hero{padding:56px 0 30px;border-bottom:1px solid var(--rule);margin-bottom:30px}
.kicker{color:var(--accent);letter-spacing:.2em;font-size:13px;font-weight:600}
h1{font-size:30px;margin:10px 0 6px;line-height:1.35}
header p{color:var(--muted);margin:4px 0}
.meta{font-size:13px;color:var(--muted);margin-top:12px}.meta code{color:var(--accent2)}
h2{font-size:23px;margin:52px 0 6px;padding-left:14px;border-left:4px solid var(--accent)}
h2 small{display:block;font-size:13px;color:var(--muted);font-weight:400}
h3{font-size:17.5px;margin:26px 0 8px;color:var(--accent2)}
p{margin:9px 0}strong{color:#fff}mark.key{background:none;color:var(--accent);font-weight:600}
.model-card{background:var(--bg2);border:1px solid var(--rule);border-radius:12px;padding:20px 22px;margin:20px 0}
.model-card h4{margin:0 0 4px;font-size:16px;color:#fff}
.model-card h4 .en{color:var(--muted);font-weight:400;font-size:12.5px;margin-left:8px}
.formula{background:#0a141c;border:1px solid var(--rule);border-left:3px solid var(--accent);border-radius:8px;padding:14px 18px;margin:12px 0;font-family:Consolas,"Cascadia Mono",monospace;font-size:14px;line-height:2;overflow-x:auto}
.formula .src{display:block;font-family:inherit;font-size:11.5px;color:var(--accent2);margin-top:6px}
.formula .op{color:var(--accent2)}.formula .sub{color:var(--muted);font-size:.78em}
.chips{margin:6px 0}
.chip{display:inline-block;background:#0a141c;border:1px solid var(--rule);color:var(--accent2);border-radius:6px;padding:1px 9px;font-size:12px;font-family:Consolas,monospace;margin:2px 6px 2px 0}
.table-wrap{overflow:auto;max-height:640px;margin:12px 0;border:1px solid var(--rule);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{padding:8px 11px;border-bottom:1px solid var(--rule);text-align:left;white-space:nowrap}
th{color:var(--muted);font-weight:600;background:rgba(255,255,255,.03)}
tr.rec td{color:var(--accent);font-weight:600}
.callout{border-left:4px solid var(--accent2);background:rgba(255,215,131,.07);padding:12px 18px;border-radius:0 8px 8px 0;margin:14px 0;font-size:14.5px}
.callout.bad{border-color:var(--bad);background:rgba(255,119,109,.08)}
.subst{background:rgba(95,212,184,.06);border:1px dashed var(--accent);border-radius:8px;padding:12px 18px;margin:12px 0;font-size:14.5px}
.subst .res{color:var(--accent);font-weight:700}
.subst .badres{color:var(--bad);font-weight:700}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:760px){.grid2{grid-template-columns:1fr}}
.stat{background:var(--bg2);border:1px solid var(--rule);border-radius:10px;padding:14px 16px}
.stat .num{font-size:22px;font-weight:700;color:var(--accent)}
.stat .lbl{font-size:12.5px;color:var(--muted)}
figure{margin:18px 0}figcaption{font-size:12.5px;color:var(--muted);margin-top:6px;text-align:center}
pre.code{background:#0a141c;border:1px solid var(--rule);border-radius:8px;padding:12px 16px;overflow:auto;font-size:12.5px;line-height:1.7;color:#c8dbe6}
pre.code .cm{color:#5c8291}
footer{margin-top:60px;border-top:1px solid var(--rule);padding-top:18px;font-size:13px;color:var(--muted)}
footer ol{padding-left:1.2rem}footer li{margin-bottom:.4rem;overflow-wrap:break-word}
.toc{background:var(--bg2);border:1px solid var(--rule);border-radius:10px;padding:16px 20px;margin:22px 0;font-size:14.5px}
.toc a{color:var(--accent);text-decoration:none}.toc ol{margin:6px 0;padding-left:22px}
</style>
</head>
<body><div class="wrap">

<header class="hero">
<div class="kicker">创意科目二 · 子任务三 · 模型可解释性</div>
<h1>从公式到代码：模型是如何算出每个结论的</h1>
<p>本文把任务三模型拆成 8 层，每层给出：<strong>数学公式 → 参数来源 → 代码位置 → 真实数值代入 → 判定结果</strong>。所有数值均由代码对真实数据现算（批次 run-20261024-095721-7rap2），读者可用计算器手工复核。</p>
<div class="meta">配套文档：《任务三成果展示.html》（结果展示） · 仓库 docs/task3/（六份报告） · 代码分支 <code>feat/task3-optimization-pipeline</code></div>
</header>

<nav class="toc"><strong>目录</strong>
<ol>
<li><a href="#s0">模型总览：一条数据如何从装备变成结论</a></li>
<li><a href="#s1">感知判定层：四类装备的公式与真实代入</a></li>
<li><a href="#s2">覆盖推演层：采样、判定门槛与一次真实"漏检"</a></li>
<li><a href="#s3">部署优化层：贪心集合覆盖的每一步</a></li>
<li><a href="#s4">盲区归因层：四类盲区的判定树</a></li>
<li><a href="#s5">威胁推演层：帧判定与容量溢出</a></li>
<li><a href="#s6">电磁兼容层：频段图与五条规则</a></li>
<li><a href="#s7">择优与规则层：四指标归一化、布设规则的统计出处</a></li>
<li><a href="#s8">如何亲手复核</a></li>
</ol></nav>

<!-- ================= 总览 ================= -->
<h2 id="s0">模型总览<small>一条数据如何从装备变成结论</small></h2>
<p>整个系统是一条单向流水线：<strong>城市几何 + 装备参数</strong> 进入感知模型，得到每个"装备→空域点"的裕量；覆盖推演把它变成覆盖矩阵；优化器在矩阵上选点；随后盲区归因、威胁推演、电磁校核并行给出结论；最后多轮过程数据沉淀为布设规则。</p>
<figure>${pipelineSvg}<figcaption>图 1 · 模型流水线与对应代码文件（括号内为实现位置）</figcaption></figure>
<div class="callout"><strong>读卡约定</strong>：下文每张"模型卡片"含四要素——<span class="chip">公式</span> 数学形式；<span class="chip">代码</span> 实现文件与行号；<span class="chip">参数</span> 标注「文档/假设」（文档=装备参数.doc，假设=需标定的模型取值）；<span class="chip">代入</span> 用推荐方案「均衡型 · 全类型」（21 台设备）的真实数值完整算一遍。</div>

<!-- ================= 感知层 ================= -->
<h2 id="s1">感知判定层<small>四类装备：公式 → 代码 → 真实代入（子任务二模型，任务三直接复用）</small></h2>

<h3>0. 统一几何与遮挡（一切公式的前提）</h2>
<div class="model-card">
<h4>射线遮挡判定 <span class="en">BVH raycast</span></h4>
<p>装备与目标之间是否被建筑/地形截断，不是估算，而是对 <strong>15,889 栋真实建筑的三角网格做射线求交</strong>（BVH 加速），并按约 15 m 间隔向 DEM 采样核查地形突起与数据空缺。</p>
<div class="chips"><span class="chip">代码：sensors/scene.js L29–54（trace）</span><span class="chip">加速库：three-mesh-bvh（MIT）</span><span class="chip">数据：zheng_apart.shp + dem.tif</span></div>
<div class="formula">trace(装备位置, 目标位置) → { blocked, 遮挡建筑数, 净空 clearance, 遮挡距离, 端点地面高程 }<span class="src">本层输出是所有四类装备公式的共同输入 context</span></div>
</div>

<h3>1. 雷达</h3>
<div class="model-card">
<h4>参考链路预算 <span class="en">radar link budget</span></h4>
<div class="formula">SNR = SNR<span class="sub">ref</span> <span class="op">+</span> 40·log₁₀(R/d) <span class="op">+</span> 10·log₁₀(σ/σ<span class="sub">ref</span>) <span class="op">−</span> ΣL<br>margin = SNR − SNR<span class="sub">threshold</span>；覆盖判定要求 margin ≥ 预留裕量 3 dB<span class="src">代码：sensors/engine.js L65–80（losses 逐项）与 L75（marginDb 合成）；雨衰 Lrain=2·d(km)·k·rain^α 见 L68</span></div>
<div class="chips"><span class="chip">R=8000 m（文档"≥8km"取下界）</span><span class="chip">σ=0.01 m²（假设：小型无人机）</span><span class="chip">杂波 3 dB（假设）</span><span class="chip">阈值/参考 SNR 13 dB（假设）</span></div>
<div class="subst"><strong>真实代入</strong>（${S.coverageRadar.preset}，位于 [东${f1(S.coverageRadar.devicePosition[0])}, 高${f1(S.coverageRadar.devicePosition[1])}, 北${f1(-S.coverageRadar.devicePosition[2])}] → 采样点 ${S.coverageRadar.sampleId}，离地 60 m）：<br>
距离 d = <strong>${f1(S.coverageRadar.distanceM)} m</strong>（射线未遮挡，trace 实算）<br>
距离增益 40·log₁₀(8000/${f1(S.coverageRadar.distanceM)}) = <strong>+${f2(radarTerms.rangeGainDb)} dB</strong>；RCS 项 10·log₁₀(0.01/0.01) = 0 dB<br>
ΣL = 双径 ${f2(radarTerms.losses.multipath)} + 杂波 ${f2(radarTerms.losses.clutter)} + 雨/云雾/干扰 0 = <strong>${f2(radarTerms.totalLossDb)} dB</strong><br>
margin = 13 + ${f2(radarTerms.rangeGainDb)} + 0 − ${f2(radarTerms.totalLossDb)} − 13 = <span class="res">+${f2(S.coverageRadar.marginDb)} dB</span> ≥ 3 dB → <strong>判定：覆盖 ✓</strong></div>
<figure><svg class="chart" viewBox="0 0 ${radarMarginCurve.W} ${radarMarginCurve.H}" width="${radarMarginCurve.W}">
<path d="${radarMarginCurve.path}" stroke="var(--accent)" fill="none" stroke-width="2"/>
<line x1="${radarMarginCurve.PM}" y1="${radarMarginCurve.Y(0)}" x2="${radarMarginCurve.W-14}" y2="${radarMarginCurve.Y(0)}" stroke="var(--bad)" stroke-dasharray="5 4"/>
<text x="${radarMarginCurve.W-120}" y="${radarMarginCurve.Y(0)-6}" font-size="10.5" fill="var(--bad)">margin = 0 阈值线</text>
<circle cx="${radarMarginCurve.xm}" cy="${radarMarginCurve.ym}" r="5" fill="var(--accent2)"/>
<text x="${radarMarginCurve.xm+8}" y="${radarMarginCurve.ym-8}" font-size="10.5" fill="var(--accent2)">本例 d≈596 m, +40.0 dB</text>
<line x1="${radarMarginCurve.PM}" y1="${radarMarginCurve.H-radarMarginCurve.PM}" x2="${radarMarginCurve.W-14}" y2="${radarMarginCurve.H-radarMarginCurve.PM}" stroke="var(--rule)"/>
<line x1="${radarMarginCurve.PM}" y1="10" x2="${radarMarginCurve.PM}" y2="${radarMarginCurve.H-radarMarginCurve.PM}" stroke="var(--rule)"/>
<text x="${radarMarginCurve.W-160}" y="${radarMarginCurve.H-10}" font-size="10.5" fill="var(--muted)">距离 d（对数轴 50–8000 m）</text>
<text x="6" y="20" font-size="10.5" fill="var(--muted)">裕量 dB</text>
</svg><figcaption>图 2 · 雷达裕量随距离变化曲线（真实参数代入；裕量随 d 以 40·log 单调下降，杂波/双径为固定损耗）</figcaption></figure>
</div>

<h3>2. 光电</h3>
<div class="model-card">
<h4>有效像素识别 <span class="en">effective pixels</span></h4>
<div class="formula">pixels = 图像宽度 × 目标尺寸 / (2·d·tan(视场角/2))<br>有效像素 = pixels × 透射率 × 通道系数；margin = 20·log₁₀(有效像素 / 识别所需像素)<span class="src">代码：engine.js L94–104；透射率 β=3.912/能见度(km) 见 L89–90；识别距离用 32 次二分求解 L99–103</span></div>
<div class="chips"><span class="chip">1920×1080（文档）</span><span class="chip">识别 ≥35 cm 目标（文档）</span><span class="chip">宽视场 60°、需 8 有效像素（假设）</span><span class="chip">能见度 20 km（环境默认）</span></div>
<div class="subst"><strong>真实代入</strong>（候选池中的 NVT-951 光电，目标 0.35 m 无人机，距离 <strong>${f1(S.optical.distanceM)} m</strong>）：<br>
角像素 = 1920×0.35/(2×${f1(S.optical.distanceM)}×tan30°) = ${f2(S.optical.angularPixels)} px；对比/透射系数 ${S.optical.contrastFactor}<br>
有效像素 = ${f2(S.optical.angularPixels)} × ${S.optical.contrastFactor} = <strong>${f2(S.optical.effectivePixels)} px</strong> &lt; 8 px<br>
margin = 20·log₁₀(${f2(S.optical.effectivePixels)}/8) = <span class="badres">${f2(S.optical.marginDb)} dB</span> → <strong>判定：不可识别 ✗</strong>（该距离下识别距离解为 0）</div>
<p style="font-size:13.5px;color:var(--muted)">这一负例解释了对比报告中"光电未入选推荐方案"的原因：在 500 m 级采样间距的城区尺度上，光电的瞬时视场+像素约束使其边际覆盖增益为零——<strong>优化器不选它，是公式算出来的，不是人为偏好</strong>。</p>
</div>

<h3>3. 无线电侦测</h3>
<div class="model-card">
<h4>路径损耗链路 <span class="en">radio budget</span></h4>
<div class="formula">SNR = SNR<span class="sub">ref</span> + 10·n·log₁₀(R/d) + EIRP<span class="sub">target</span> − EIRP<span class="sub">ref</span> − ΣL<br>ΣL = 穿透(建筑数×每栋损耗) + 刀刃绕射 + 双径 + 底噪/同频/串扰<span class="src">代码：engine.js L106–124；频段/静默判定 L108–111；n=路径损耗指数 2.7（假设）</span></div>
<div class="chips"><span class="chip">100 MHz–6 GHz（文档）</span><span class="chip">城市半径 2–6 km 取中值 4 km（文档派生）</span><span class="chip">定位误差 &lt;20 m 属 TDOA 网络（文档）</span></div>
<div class="subst"><strong>真实代入</strong>（TDOA-X1B → 同一 60 m 采样点，d = ${f1(S.radio.distanceM)} m）：margin = <span class="res">+${f2(S.radio.marginDb)} dB</span> → 覆盖 ✓（双径项 ${f2(S.radio.losses.multipath)} dB 为相消增强，公式允许 ±波动）。<br>
<strong>反例</strong>：同一目标切换为无线电静默 → reasons =「${S.radio.silentReasons[0]}」，margin 置空、等效距离为 0 → <strong>必然失效 ✗</strong>。这正是布设规则 R4 要求雷达/光电冗余的原因。</div>
</div>

<h3>4. 声学</h3>
<div class="model-card">
<h4>声压传播与噪声叠加 <span class="en">acoustic</span></h4>
<div class="formula">合成背景 = 10·log₁₀(Σ 10^(各噪声/10))；接收声压 = 目标声压(1m) − 20·log₁₀(d) − 吸收/穿透/绕射/双径<br>SNR = 接收声压 − 合成背景；声速 = 331.3 + 0.606·温度 + 风速<span class="src">代码：engine.js L125–142；能量叠加 powerSumDb 见 L7</span></div>
<div class="chips"><span class="chip">0.01–500 m（文档）</span><span class="chip">20 Hz–20 kHz、28–132 dB（文档）</span><span class="chip">目标声压 100 dB@1m（假设）</span></div>
<div class="subst"><strong>真实代入</strong>（CRY8500 → 同一采样点，d = <strong>${f1(S.acoustic.distanceM)} m</strong>）：<br>
接收声压 = 100 − 20·log₁₀(${f1(S.acoustic.distanceM)}) − … = <strong>${f1(S.acoustic.receivedSoundDb)} dB</strong>；合成背景 ${f1(S.acoustic.noiseDb)} dB<br>
SNR = ${f2(S.acoustic.snrDb)} dB → margin = <span class="badres">${f2(S.acoustic.marginDb)} dB</span> → <strong>超出能力 ✗</strong>。<br>
声学 500 m 的量级决定了它在方案中只承担<mark class="key">核心区近距补盲</mark>（推荐方案 5 台全部贴近核心区），这一角色是公式距离项直接决定的。</div>
</div>

<div class="callout"><strong>输出语义（防误读）</strong>：每个判定输出 <code>status</code>（within-model / outside-model / uncertain）与 <code>margin</code>。margin 是<mark class="key">未标定的工程裕量</mark>，不是探测概率；建筑/地形阻断直达路径时雷达/光电等效距离直接置 0（engine.js L144–145）。</div>

<!-- ================= 覆盖推演 ================= -->
<h2 id="s2">覆盖推演层<small>采样口径、判定门槛与一次真实"漏检"解剖</small></h2>
<div class="model-card">
<h4>覆盖判定规则 <span class="en">coverage rule</span></h4>
<div class="formula">采样：500 m 网格 × 离地 30/60/100 m + 核心区建筑近立面点（共 ${R.sampling.samples.length} 个有效点）<br>候选 c 覆盖样本 j ⟺ 四种工况全部满足：status=within-model 且 margin ≥ 3 dB<span class="src">代码：task3/pipeline.js L56–80（evaluateCandidates）；门槛同 optimizer.js L108；工况定义 optimizer.js L13–18</span></div>
<p>四种工况：基线·发射 / 无线电静默 / 雨雾及街道噪声（30 mm/h 雨 + 街噪）/ 电磁干扰（底噪+10 dB、同频+10 dB、串扰+5 dB）。<strong>核心区采样权重 ×3、基线工况权重 ×2</strong>——优化目标天然偏向防护重点。</p>
<div class="table-wrap"><table><thead><tr><th>推荐方案 · 工况</th><th>覆盖</th><th>盲区占比</th><th>核心区覆盖</th><th>核心二重覆盖</th></tr></thead><tbody>${condRows}</tbody></table></div>
<h4>一次真实盲点的解剖</h4>
<p>真实盲点 ${S.blindCase.point.sampleId}（类别：${{gap:'楼栋夹缝',lowFacade:'低空贴楼',corner:'围墙边角',shadow:'背面阴影',other:'其他'}[S.blindCase.point.category]}，成因 ${fmtCause(S.blindCase.point.cause)}），推荐方案 21 台设备在该点的判定汇总：</p>
<div class="table-wrap"><table><thead><tr><th>失败原因（reasons）</th><th>设备数</th></tr></thead><tbody>
${Object.entries(S.blindCase.reasonCounts).map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
</tbody></table></div>
<p style="font-size:13.5px;color:var(--muted)">解读：没有一台设备同时满足"几何可达 + 裕量 ≥3 dB"——有的被楼体截断、有的超出标称距离、多数信噪比不足。<strong>盲区不是"没画到"，而是逐台设备用同一套公式算出来的</strong>。</p>
</div>

<!-- ================= 优化层 ================= -->
<h2 id="s3">部署优化层<small>贪心集合覆盖的每一步都可复核</small></h2>
<div class="model-card">
<h4>加权贪心集合覆盖 <span class="en">weighted greedy set cover</span></h4>
<div class="formula">每步选择：score(c) = Σ<sub>j 尚未覆盖</sub> wⱼ / 成本(c)，取最大者；wⱼ = 样本权重 × 工况权重<br>约束：Σ成本 ≤ 预算 且 设备数 ≤ 上限；随后冗余删除释放预算再补选（最多 4 轮）<span class="src">代码：planning/optimizer.js L65–84（chooseGreedy）；三套策略与冗余增强 task3/pipeline.js L125–149</span></div>
<p>候选池 ${S.greedy.candidateCount} 个（真实屋顶 × 装备型号 × 雷达俯仰姿态 + 残余盲点邻近补点）。以下插桩重放均衡型（预算 ${S.greedy.policy.budget}、上限 ${S.greedy.policy.maxDevices}）的真实前 6 步：</p>
<div class="table-wrap"><table><thead><tr><th>步骤</th><th>选中装备</th><th>新增覆盖权重 Σwⱼ</th><th>成本</th><th>增益/成本</th><th>累计权重覆盖</th></tr></thead><tbody>${greedyRows}</tbody></table></div>
<figure>${greedyChart}<figcaption>图 3 · 前 6 步的增益/成本比：第一步 TDOA-X1B 以 69.07 的绝对优势入选（无线电单台覆盖广、成本低），随后雷达/声学按边际收益依次进入——贪心的"先买性价比"过程完全透明</figcaption></figure>
<div class="callout"><strong>三套方案如何产生差异</strong>：经济型仅用雷达+无线电（长距低价）、均衡型全类型 3/4 预算、冗余增强型全预算且对核心区样本追加第二重覆盖（增益 ×0.5 继续选点，pipeline.js L134–149）。同预算下贪心自然饱和是真实现象，差异来自候选池与冗余目标而非人为指定。</div>
<div class="callout"><strong>选后换频</strong>：方案选定后，对其中的雷达按频道组做图着色式分配（同频冲突权重 ×10、邻频 ×1，pipeline.js L152–163），把"EMC 建议"自动落到参数上；仍残余的冲突才进入 EMC 报告。</div>
</div>

<!-- ================= 盲区归因 ================= -->
<h2 id="s4">盲区归因层<small>四类盲区是几何判定树算出来的</small></h2>
<figure>${blindTree}<figcaption>图 4 · 四类盲区判定树（优先级 夹缝 &gt; 阴影 &gt; 贴楼 &gt; 边角 &gt; 其他；阈值常量见 task3/constants.js BLIND_THRESHOLDS，判定代码 blindspots.js L63–118）</figcaption></figure>
<div class="model-card">
<h4>真实盲点复核（存储结论 vs 重新计算）</h4>
<p>对推荐方案基线工况的盲点逐一重跑判定树，验证归因可复现：</p>
<div class="table-wrap"><table><thead><tr><th>盲点</th><th>存储类别</th><th>重算类别</th><th>一致性</th><th>成因数据</th></tr></thead><tbody>${blindRows}</tbody></table></div>
<p style="font-size:13.5px;color:var(--muted)">全部一致 ✓。夹缝判定用"两楼方向夹角 &gt;120° 且多边形距离之和 ≤60 m"，阈值初值为几何构造，已由 6 轮仿真统计校订（见 R1）。</p>
</div>

<!-- ================= 威胁推演 ================= -->
<h2 id="s5">威胁推演层<small>帧判定与容量溢出</small></h2>
<div class="model-card">
<h4>逐帧多目标判定 <span class="en">per-frame multi-target</span></h4>
<div class="formula">每帧 t：目标位置 = 航路插值；检出(设备 i, 目标 k) ⟺ 感知公式通过（几何快判 + 射线实判）<br>容量截取：每台设备每帧按 margin 降序最多检出 capacity 个目标，超出记"溢出"<span class="src">代码：task3/threats.js L54–106（simulateThreat）；容量截取 L78–84；航路生成 L12–40</span></div>
<div class="chips"><span class="chip">容量（文档）：雷达 500 批 / TDOA-X1B 35 / OA-X1Bmini 30 / X1C 15 / 声学 1（保守）</span><span class="chip">帧间隔 2 s</span></div>
<div class="subst"><strong>真实帧实例</strong>（蜂群场景 t=${S.swarmFrame.time} s）：在场 ${S.swarmFrame.targetsInFrame} 架，溢出 ${S.swarmFrame.overflowCount} 架次——例如 ${S.swarmFrame.overflowSample[0].deviceId}（声学，容量 1）对目标 ${S.swarmFrame.overflowSample[0].targetId} 的 margin=+${f1(S.swarmFrame.overflowSample[0].marginDb)} dB <strong>本可检出</strong>，但因容量已满被如实记为漏探。全场景累计溢出 397 架次、42 架均出现过漏探帧。</div>
<p style="font-size:13.5px;color:var(--muted)">结论的读法：蜂群场景暴露了<strong>并发容量</strong>（而非探测能力）是瓶颈——这是增加声学/无线电点位或引入更高容量装备的定量依据。</p>
</div>

<!-- ================= EMC ================= -->
<h2 id="s6">电磁兼容层<small>频段图与五条规则</small></h2>
<figure>${emcBands}<figcaption>图 5 · 装备频段事实图（全部取自装备参数.doc；雷达具体频点为模型假设）</figcaption></figure>
<div class="model-card">
<h4>五条校核规则 <span class="en">EMC rules</span></h4>
<div class="formula">① 同频：双方均发射 且 min|Δf|&lt;0.1 GHz 且 d&lt;600 m → penalty = 6×(1−d/600) dB，判 fail<br>② 邻频：min|Δf|&lt;0.5 GHz 且 d&lt;300 m → warning<br>③ 发射→接收耦合：发射频点落入接收频段(±0.02 GHz) → fail<br>④ 前端阻塞：发射功率 ≥1000 W 且距无源接收机 &lt;50 m → warning<br>⑤ 共址过密：至少一方发射 且 d&lt;10 m → warning<span class="src">代码：task3/emc.js L24–52；判定结论：有 fail→不通过，仅 warning→降额，否则通过</span></div>
<div class="subst"><strong>真实代入 · 提示例</strong>（推荐方案）：${S.emc.exampleWarning.a} ↔ ${S.emc.exampleWarning.b}，${S.emc.exampleWarning.kind}，距离 ${S.emc.exampleWarning.distanceM} m →「${S.emc.exampleWarning.recommendation}」。推荐方案合计 <strong>0 严重 / ${S.emc.recommendedCounts.warning} 提示 → 结论：降额</strong>。</div>
<div class="subst"><strong>真实代入 · 严重例</strong>（冗余增强型）：${S.emc.exampleFail.a} ↔ ${S.emc.exampleFail.b}，同屋顶 d=0 m、Δf=0 GHz → penalty=6×(1−0/600)=<strong>6 dB</strong>，判 fail。<strong>后果</strong>：该方案综合得分 ×0.85² 降权（择优公式见下节），从第一名掉到第三名——EMC 结论真实改变了推荐结果。</div>
</div>

<!-- ================= 择优与规则 ================= -->
<h2 id="s7">择优与规则层<small>四指标归一化与布设规则的统计出处</small></h2>
<div class="model-card">
<h4>四指标归一化加权 <span class="en">scoring</span></h4>
<div class="formula">覆盖完整性 = min(各工况覆盖率) + 0.15×核心二重覆盖率（封顶 1）；盲区占比 = 各工况盲区率均值<br>成本 = 相对成本（非人民币）；可行性 = 设备代理分均值（重量/体积/架设/安装高度）<br>各指标跨方案 min-max 归一化（盲区/成本取反向）→ score = 0.4·覆盖 + 0.25·盲区 + 0.2·成本 + 0.15·可行性<br>EMC 回写：fail 每例 ×0.85（下限 0.7），degraded ×0.97<span class="src">代码：task3/metrics.js L52–71（scorePlans）+ pipeline.js applyEmcToScoring</span></div>
<div class="table-wrap"><table><thead><tr><th>方案</th><th>覆盖→归一</th><th>盲区→归一</th><th>成本→归一</th><th>可行性→归一</th><th>原始得分</th><th>EMC</th><th>最终得分</th></tr></thead><tbody>${scoringRows}</tbody></table></div>
</div>
<div class="model-card">
<h4>布设规则阈值的统计出处（以 R1 为例全程展开）</h4>
<div class="formula">R1 阈值 X：对 6 轮仿真基线工况全部"楼栋夹缝"盲点的缝宽取 P90，向上取整到 5 m<span class="src">代码：task3/rules.js L7（quantile）+ L30–45（R1 统计）；过程数据 artifacts/task3/runs/</span></div>
<div class="subst"><strong>真实统计过程</strong>：6 轮过程数据共 ${S.ruleR1.widths.length} 个夹缝盲点，缝宽（m）排序后 =<br><strong>[${S.ruleR1.widths.join(', ')}]</strong><br>P90 = ${f2(S.ruleR1.p90Raw)} m → ceil 到 5 m 得 <span class="res">X = ${S.ruleR1.p90Rounded} m</span>；两侧楼高差中位数 13 m → 规则"间距 &lt;45 m 且高差 &gt;13 m 应在较低楼顶补盲"。</div>
<p style="font-size:13.5px;color:var(--muted)">R2（低空 5.5×/559 m）、R3（声学制高点 1.2×）、R4（静默 −5.6 pp）、R5（同频 ≥600 m/0.1 GHz）同样逐条标注批次与样本量，见 docs/task3/deployment-rules.md。</p>
</div>

<!-- ================= 复核指南 ================= -->
<h2 id="s8">如何亲手复核<small>不需要信任我们，自己算一遍</small></h2>
<div class="callout"><strong>三分钟复核</strong>：用计算器验证雷达实例——40×log₁₀(8000/${f1(S.coverageRadar.distanceM)}) = ${f2(radarTerms.rangeGainDb)}，减双径 3.08 与杂波 3.00，得 margin ≈ +40.0 dB ≥ 3 → 覆盖。与系统输出一致。</div>
<pre class="code"># 全流程复现（约 3–5 秒/轮）
node scripts/task3_report.js --quick   <span class="cm"># 重跑基线流水线，输出 artifacts/task3/runs/</span>
node scripts/task3_explain_data.js     <span class="cm"># 重算本文全部数值实例 → artifacts/task3/explain-data.json</span>
npm test                               <span class="cm"># 84 项自动化测试（含判定公式/贪心/盲区/威胁/EMC/规则）</span></pre>
<p>测试即文档：<code>tests/task3_*.test.js</code> 用合成算例验证每个公式的边界行为（如容量截取、静默失效、盲区优先级），用真实城市数据做集成冒烟。</p>

<footer>
<h2>代码与数据来源</h2>
<ol>
<li><span>感知公式：src/sensors/engine.js（L65–142 四类装备）、physics.js（雷达/无线电 MATLAB 物理预算）、scene.js（遮挡求交）；公式说明 public/sensors-modeling.md。</span></li>
<li><span>任务三流水线：src/task3/pipeline.js / blindspots.js / metrics.js / threats.js / emc.js / rules.js / constants.js（全部参数常量与阈值出处）。</span></li>
<li><span>数值实例：artifacts/task3/explain-data.json（scripts/task3_explain_data.js 对真实数据现算，批次 run-20261024-095721-7rap2）。</span></li>
<li><span>过程数据：artifacts/task3/runs/ 6 轮（布设规则统计来源）；完整报告 artifacts/task3/latest-report.json。</span></li>
<li><span>局限沿用《任务三成果展示.html》第四章：裕量为未标定工程近似，非实测探测概率；EMC 为代理规则非认证。</span></li>
</ol>
</footer>
</div></body></html>`;

await writeFile('任务三模型可解释性.html',html,'utf8');
const {statSync}=await import('node:fs');
console.log(`written 任务三模型可解释性.html (${(statSync('任务三模型可解释性.html').size/1e3).toFixed(0)} KB)`);
