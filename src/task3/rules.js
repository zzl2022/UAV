// 任务三 · 标准化布设规则提炼：对 artifacts/task3/runs/ 的多轮仿真过程数据做统计，
// 提取阈值（X/Y/Z/W 等）并生成带来源标注的规则。所有阈值均可追溯到具体 runId 与样本量。
const pct=x=>`${(x*100).toFixed(1)}%`;
const quantile=(xs,q)=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))];};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const round5=x=>Math.ceil(x/5)*5;

// 汇总多轮过程数据，供规则提取与文档引用。
export function collectRunsStats(runs){
 const stats={runIds:runs.map(r=>r.runId),runCount:runs.length};
 // R4 静默工况覆盖下降：各轮推荐方案 nominal→silent coverageRate 差值
 stats.silentDrops=runs.map(r=>{const plan=r.summary?.plans.find(p=>p.id===r.summary.recommendedId);if(!plan)return null;const n0=plan.metrics.find(m=>m.condition==='nominal'),s0=plan.metrics.find(m=>m.condition==='silent');return n0&&s0?n0.coverageRate-s0.coverageRate:null;}).filter(v=>v!==null);
 // R5 EMC 同频冲突：全部轮次全部方案的 co-channel 冲突距离/损耗
 const conflicts=runs.flatMap(r=>Object.values(r.emc??{}).flatMap(e=>(e.conflicts??[]).filter(c=>c.kind==='co-channel')));
 stats.coChannel={count:conflicts.length,distances:conflicts.map(c=>c.distanceM),penalties:conflicts.map(c=>c.penaltyDb)};
 // R2 分层盲区：各轮推荐方案各高度层盲区率
 stats.perHeight=runs.map(r=>({runId:r.runId,rows:r.rulesInput?.perHeightBlind??[]})).filter(r=>r.rows.length);
 // R3 候选池：按类型分组的 高度分位 vs 覆盖数
 stats.candidateStats=runs.map(r=>({runId:r.runId,rows:r.rulesInput?.candidateStats??[]})).filter(r=>r.rows.length);
 // R1/R6 盲点成因：全部轮次推荐方案 nominal 工况的盲点
 stats.blindPoints=runs.flatMap(r=>{
  const rec=r.summary?.recommendedId,rows=r.blindspots?.[rec]??[];
  const nominal=rows.find(x=>x.conditionId==='nominal')??rows[0];
  return (nominal?.points??[]).map(p=>({...p,runId:r.runId}));
 });
 return stats;
}

// 从过程数据统计提炼 ≥5 条布设规则。report 为最近一次完整报告（含采样与盲点坐标），city 用于解析建筑高度。
export function extractRules({runs,report,city}){
 const stats=collectRunsStats(runs),rules=[],byId=new Map(city.buildings.map(b=>[b.id,b]));
 const runRef=stats.runIds.slice(0,6).join('、')+(stats.runCount>6?` 等 ${stats.runCount} 轮`:'');

 // R1 楼栋夹缝补盲：夹缝类盲点的宽度与两侧楼高差分布
 {
  const gap=stats.blindPoints.filter(p=>p.category==='gap'&&Number.isFinite(p.cause?.gapWidthM));
  if(gap.length>=3){
   const widths=gap.map(p=>p.cause.gapWidthM);
   const diffs=gap.map(p=>{const [a,b]=p.cause.buildingIds??[];const ba=byId.get(a),bb=byId.get(b);return ba&&bb?Math.abs(ba.height-bb.height):null;}).filter(v=>v!==null);
   const X=round5(quantile(widths,0.9)),Y=diffs.length?Math.round(quantile(diffs,0.5)):null;
   const share=gap.length/Math.max(1,stats.blindPoints.length);
   rules.push({id:'R1',title:'楼栋夹缝补盲',text:`当两栋建筑间距小于 ${X} 米且高度差大于 ${Y??'—'} 米时，夹缝低层空域易成盲区，应在较低建筑的顶部增设补盲节点。`,evidence:{runIds:runRef,samples:gap.length,method:`对 ${stats.runCount} 轮仿真 nominal 工况夹缝类盲点的 gapWidthM 取 P90 得 X=${X} m（分布 ${Math.round(Math.min(...widths))}–${Math.round(Math.max(...widths))} m），两侧楼高差取中位数得 Y=${Y??'—'} m；夹缝类盲点占全部盲点 ${pct(share)}`}});
  }
 }
 // R2 低空盲区与雷达半径：最低采样层盲区率倍数 + 盲点距最近雷达距离
 {
  const ratios=[];
  for(const {rows} of stats.perHeight){
   const sorted=[...rows].sort((a,b)=>a.height-b.height),low=sorted[0],mid=sorted[Math.min(1,sorted.length-1)];
   const rLow=low.blindGridCells/Math.max(1,low.validGridCells),rMid=mid.blindGridCells/Math.max(1,mid.validGridCells);
   if(rMid>0)ratios.push({ratio:rLow/rMid,lowH:low.height,midH:mid.height});
  }
  const lowPts=stats.blindPoints.filter(p=>p.agl<=30);
  let W=null;
  if(report&&lowPts.length>=3){
   const radars=report.plans.find(p=>p.id===report.recommendedId)?.devices.filter(d=>d.type==='radar')??[];
   if(radars.length){
    const dists=lowPts.map(p=>Math.min(...radars.map(d=>Math.hypot(p.position[0]-d.position[0],p.position[2]-d.position[2]))));
    W=Math.round(quantile(dists,0.8));
   }
  }
  if(ratios.length){
   const Z=mean(ratios.map(r=>r.ratio));
   rules.push({id:'R2',title:'低空层补盲与光电/声学配套',text:`低空（≤${ratios[0].lowH} m）层盲区率约为 ${ratios[0].midH} m 层的 ${Z.toFixed(1)} 倍${W!==null?`，且 80% 的低空盲点位于距最近雷达 ${W} m 以外`:''}；雷达部署高度不足或间距过大时，须在其 ${W!==null?`${W} m 半径外`:'覆盖边缘'}的低空通道配套光电/声学补盲点位。`,evidence:{runIds:runRef,samples:ratios.length,method:`各轮推荐方案最低层与次低层网格盲区率之比取均值（n=${ratios.length}）${W!==null?`；W 为最近一期报告低空盲点距最近雷达水平距离的 P80`:''}`}});
  }
 }
 // R3 声学制高点：声学候选 高度上 1/3 vs 下 1/3 的平均覆盖数之比
 {
  const ratios=[];
  for(const {rows} of stats.candidateStats){
   const ac=rows.filter(r=>r.type==='acoustic');if(ac.length<6)continue;
   const top=ac.filter(r=>r.heightRank>=2/3),bottom=ac.filter(r=>r.heightRank<=1/3);
   const mt=mean(top.map(r=>r.coverCount)),mb=mean(bottom.map(r=>r.coverCount));
   if(mt!==null&&mb>0)ratios.push(mt/mb);
  }
  if(ratios.length){
   const Q=mean(ratios);
   rules.push({id:'R3',title:'声学节点优先制高点',text:`声学感知节点应优先部署于区域制高点：仿真中位于站点高度上 1/3 的声学候选平均覆盖采样数为下 1/3 的 ${Q.toFixed(1)} 倍，制高点可显著降低建筑声反射与遮挡干扰。`,evidence:{runIds:runRef,samples:ratios.length,method:`各轮候选池声学设备按站点高度分位上/下 1/3 分组的平均 coverCount 之比，跨轮取均值（n=${ratios.length} 轮含声学候选）`}});
  }
 }
 // R4 无线电静默冗余
 {
  if(stats.silentDrops.length){
   const D=mean(stats.silentDrops);
   rules.push({id:'R4',title:'无线电静默工况冗余',text:`无线电侦测对静默目标失效：静默工况下推荐方案采样覆盖较基线平均下降 ${(D*100).toFixed(1)} 个百分点；核心区须由雷达/光电形成不依赖目标发射的冗余覆盖。`,evidence:{runIds:runRef,samples:stats.silentDrops.length,method:`各轮推荐方案 nominal 与 silent 工况 coverageRate 之差取均值（n=${stats.silentDrops.length}）`}});
  }
 }
 // R5 同频雷达间距
 {
  const c=stats.coChannel;
  if(c.count){
   rules.push({id:'R5',title:'同频雷达最小间距',text:`同频（载频差 <0.1 GHz）雷达间距小于 600 m 时产生互扰：仿真中 ${c.count} 对冲突的单台附加损耗 ${Math.min(...c.penalties).toFixed(1)}–${Math.max(...c.penalties).toFixed(1)} dB（距离 ${Math.round(Math.min(...c.distances))}–${Math.round(Math.max(...c.distances))} m）；布设时间距应 ≥600 m 或错频 ≥0.1 GHz。`,evidence:{runIds:runRef,samples:c.count,method:`全部轮次全部方案的 co-channel 冲突距离与 penaltyDb 取值区间（与 planning EMC 代理同口径：penalty=6×(1−d/600)）`}});
  }else{
   rules.push({id:'R5',title:'同频雷达最小间距',text:'同频（载频差 <0.1 GHz）雷达间距小于 600 m 会产生互扰损耗（代理模型 penalty=6×(1−d/600)，d<600 m）；布设时间距应 ≥600 m 或错频 ≥0.1 GHz。',evidence:{runIds:runRef,samples:0,method:`本轮 ${stats.runCount} 次仿真未出现 co-channel 冲突（候选频道分组已规避）；阈值沿用 planning EMC 代理口径`}});
  }
 }
 // R6 建筑背面阴影区对视补盲
 {
  const shadow=stats.blindPoints.filter(p=>p.category==='shadow'&&Number.isFinite(p.cause?.blockerDistanceM));
  if(shadow.length>=3){
   const X=round5(quantile(shadow.map(p=>p.cause.blockerDistanceM),0.9));
   rules.push({id:'R6',title:'建筑背面阴影区对视补盲',text:`建筑背面阴影区盲点的遮挡建筑 90% 位于盲点 ${X} m 以内；在高层建筑背向主防方向一侧，应在距离不超过 ${X} m 的邻近楼顶增设与该楼对视的补盲节点。`,evidence:{runIds:runRef,samples:shadow.length,method:`全部轮次 nominal 工况 shadow 类盲点 cause.blockerDistanceM 的 P90（n=${shadow.length}）`}});
  }
 }
 return {rules,stats};
}

export function rulesToMarkdown({rules,stats}){
 const lines=['# 任务三 · 标准化布设规则','',`> 全部规则阈值提炼自 \`artifacts/task3/runs/\` 的 ${stats.runCount} 轮仿真过程数据（runId：${stats.runIds.join('、')}），统计口径逐条注明；非经验拍值。适用边界：河南博物院周边 2.4×2.4 km 城区、本仓库四类装备模型与采样密度；迁移到他场景需重新标定。`,''];
 for(const r of rules){lines.push(`## ${r.id} ${r.title}`,``,`**规则**：${r.text}`,``,`**数据依据**：${r.evidence.method}。样本量 ${r.evidence.samples}；来源批次：${r.evidence.runIds}。`,'');}
 lines.push('## 局限性','','- 阈值为离散采样下的统计量，不构成连续空域证明；采样加密后阈值可能漂移，需用新轮次数据重新提炼。','- EMC 间距/损耗为工程代理口径，非频谱合规认证。','- 施工可行性未纳入规则（屋顶承重/供电/网络无实测数据）。','');
 return lines.join('\n');
}
