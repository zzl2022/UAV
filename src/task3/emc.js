// 任务三电磁兼容校核：依据 EQUIPMENT_FACTS 频段事实与 EMC_RULES 工程代理阈值，
// 对方案内全部无序设备对检查同频/邻频/发射-接收耦合/前端阻塞/同点位过密五类冲突。
// 规则为工程代理（EMC_RULES.source），不是频谱合规认证。
import {EQUIPMENT_FACTS,EMC_RULES} from './constants.js';

const RX_TOLERANCE_GHZ=0.02; // 发射频点落入接收频段的判定容差

export function deviceSpectrum(device){
 const facts=EQUIPMENT_FACTS[device.presetId];
 if(!facts)throw Error(`未知装备预设 ${device.presetId}`);
 let emissionGHz=[...(facts.emissionGHz??[])];
 const tuned=device.parameters?.frequencyGHz;
 // 用户可调频：parameters.frequencyGHz 与事实发射频段不同时以 parameters 为准
 if(Number.isFinite(tuned)&&!emissionGHz.some(f=>Math.abs(f-tuned)<1e-9))emissionGHz=[tuned];
 return {emissionGHz,receiveRangeGHz:facts.receiveRangeGHz?[...facts.receiveRangeGHz]:null,receiveDiscreteGHz:facts.receiveDiscreteGHz?[...facts.receiveDiscreteGHz]:null,powerW:facts.powerW??null};
}

function hitReceiver(emissionGHz,spectrum){
 return emissionGHz.find(f=>
  (spectrum.receiveRangeGHz&&f>=spectrum.receiveRangeGHz[0]-RX_TOLERANCE_GHZ&&f<=spectrum.receiveRangeGHz[1]+RX_TOLERANCE_GHZ)||
  (spectrum.receiveDiscreteGHz&&spectrum.receiveDiscreteGHz.some(g=>Math.abs(g-f)<=RX_TOLERANCE_GHZ)));
}

export function emcAnalysis(devices){
 const spectra=new Map(devices.map(d=>[d.id,deviceSpectrum(d)]));
 const penalties=Object.fromEntries(devices.map(d=>[d.id,0])),conflicts=[],notes=[];
 if(devices.some(d=>['optical','acoustic'].includes(d.type)))notes.push('光电/声学设备无射频发射与接收，射频兼容天然通过');
 for(let i=0;i<devices.length;i++)for(let j=i+1;j<devices.length;j++){
  const a=devices[i],b=devices[j],sa=spectra.get(a.id),sb=spectra.get(b.id);
  const distance=Math.hypot(...a.position.map((v,k)=>v-b.position[k]));
  if(sa.emissionGHz.length&&sb.emissionGHz.length){
   const minDelta=Math.min(...sa.emissionGHz.flatMap(fa=>sb.emissionGHz.map(fb=>Math.abs(fa-fb))));
   if(minDelta<EMC_RULES.coChannelSeparationGHz&&distance<EMC_RULES.coChannelMinDistanceM){
    const penaltyDb=6*(1-distance/EMC_RULES.coChannelMinDistanceM); // 与 planning emcCheck 同口径
    penalties[a.id]+=penaltyDb;penalties[b.id]+=penaltyDb;
    conflicts.push({a:a.id,b:b.id,kind:'co-channel',severity:'fail',distanceM:distance,detailGHz:minDelta,penaltyDb,recommendation:'换频（错开 ≥0.1 GHz）或拉距至 ≥600 m'});
   }else if(minDelta<EMC_RULES.adjacentChannelGHz&&distance<EMC_RULES.adjacentMinDistanceM)
    conflicts.push({a:a.id,b:b.id,kind:'adjacent-channel',severity:'warning',distanceM:distance,detailGHz:minDelta,recommendation:'拉距 ≥300 m 或换频'});
  }
  for(const [tx,rx,txs,rxs] of [[a,b,sa,sb],[b,a,sb,sa]]){
   const hit=hitReceiver(txs.emissionGHz,rxs);
   if(hit!==undefined)conflicts.push({a:tx.id,b:rx.id,kind:'receiver-overlap',severity:'fail',distanceM:distance,detailGHz:hit,recommendation:'接收机换型/换频段或显著拉距'});
   if((txs.powerW??0)>=EMC_RULES.frontendBlockPowerW&&rx.type==='radio'&&distance<EMC_RULES.frontendBlockDistanceM)
    conflicts.push({a:tx.id,b:rx.id,kind:'frontend-block',severity:'warning',distanceM:distance,recommendation:'大功率雷达与无源接收机间距 ≥50 m'});
  }
  // 同点位过密仅在至少一方有射频发射时提示（纯无源/光电/声学共址无射频互扰）。
  if(distance<EMC_RULES.coSiteMinDistanceM&&(sa.emissionGHz.length||sb.emissionGHz.length))conflicts.push({a:a.id,b:b.id,kind:'co-site',severity:'warning',distanceM:distance,recommendation:'错开安装点位 ≥10 m'});
 }
 const counts={fail:conflicts.filter(c=>c.severity==='fail').length,warning:conflicts.filter(c=>c.severity==='warning').length};
 const verdict=counts.fail?'fail':counts.warning?'degraded':'pass';
 return {verdict,conflicts,penalties,counts,notes,source:EMC_RULES.source};
}

export function emcVerdictText(result){
 const label={pass:'通过',degraded:'降额',fail:'不通过'}[result.verdict];
 if(!result.conflicts.length)return `电磁兼容校核${label}：未发现装备间射频冲突。`;
 const top=result.conflicts.find(c=>c.severity==='fail')??result.conflicts[0];
 return `电磁兼容校核${label}：发现 ${result.conflicts.length} 项冲突（严重 ${result.counts.fail}、提示 ${result.counts.warning}），首要处置建议：${top.recommendation}。`;
}
