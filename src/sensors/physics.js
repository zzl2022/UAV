// Browser port of radar/core/radar_snr.m and rf/core/{rx_power_dbm,
// rx_noise_dbm,sensitivity_solve,detection_prob}. No MATLAB runtime required.
export const C=299792458;
export const requiredSnr=(pd,pfa)=>10*Math.log10(Math.log(pfa)/Math.log(pd)-1);
export const detectionProbability=(snr,pfa)=>pfa**(1/(1+10**(snr/10)));
export const fspl=(distance,ghz)=>20*Math.log10(4*Math.PI*Math.max(1,distance)*ghz*1e9/C);
export function facadeLoss(paths,distance,frequency,reflection,roundTrip=false){
 let re=1,im=0;
 for(const path of paths??[]){const phase=2*Math.PI*(path.distance-distance)*frequency/C,amplitude=reflection*distance/path.distance;re+=amplitude*Math.cos(phase);im-=amplitude*Math.sin(phase);}
 return Math.max(-30,Math.min(60,-(roundTrip?20:10)*Math.log10(Math.max(1e-6,re*re+im*im))));
}
const f=(label,unit,min,max,value)=>({label,unit,min,max,step:'any',value,source:'假设 · MATLAB 模型'});
export const PHYSICS_FIELDS={
 radar:{peakPowerW:f('峰值发射功率','W',1,1e6,1000),pulseWidthUs:f('脉宽','μs',0.01,1000,2),switchTimeUs:f('收发切换时间','μs',0,100,1),txGainDb:f('发射增益','dB',0,80,35),rxGainDb:f('接收增益','dB',0,80,35),noiseFigureDb:f('噪声系数','dB',0,40,3),systemLossDb:f('系统损耗','dB',0,60,4),pulses:f('相参积累脉冲数','个',1,10000,128),pfa:f('假设虚警概率','',1e-12,0.1,1e-6),pdRequired:f('模型检出概率门限','',0.1,0.99999,0.9)},
 radio:{noiseFigureDb:f('噪声系数','dB',0,40,4),rxGainDb:f('接收天线增益','dBi',0,60,2),bandwidthMHz:f('检测信道带宽','MHz',0.001,1000,20),receiverLossDb:f('馈线与失配损耗','dB',0,60,2),referenceFrequencyGHz:f('反推参考波形频率','GHz',0.001,100,5.8),referenceEirpDbm:f('反推参考波形 EIRP','dBm',-40,80,25.5),pfa:f('假设虚警概率','',1e-12,0.1,1e-4),pdRequired:f('模型检出概率门限','',0.1,0.99999,0.9),observationSeconds:f('跳频观测窗口','s',0.00001,10,0.1),hopSeconds:f('跳频驻留周期','s',0.00001,10,0.01)},
};
export function physicsDefaults(id,type){
 if(!PHYSICS_FIELDS[type])return undefined;
 const p=Object.fromEntries(Object.entries(PHYSICS_FIELDS[type]).map(([k,f])=>[k,f.value]));
 if(id==='radar-03d')Object.assign(p,{peakPowerW:2200,txGainDb:38,rxGainDb:38,noiseFigureDb:4,pulses:40});
 if(id==='radio-mini')p.noiseFigureDb=5;
 if(id==='radio-x1c')Object.assign(p,{noiseFigureDb:3,rxGainDb:3,pfa:1e-5});
 return p;
}
export function radarSnr(p,frequencyGHz,distance,rcs){
 const energy=p.peakPowerW*p.pulseWidthUs*1e-6*10**((p.txGainDb+p.rxGainDb)/10)*(C/(frequencyGHz*1e9))**2*rcs*p.pulses;
 return 10*Math.log10(energy/((4*Math.PI)**3*Math.max(1,distance)**4*1.380649e-23*290*10**((p.noiseFigureDb+p.systemLossDb)/10)));
}
export function radioBudget(p,range,frequencyGHz,eirp,distance){
 const noiseDbm=-174+p.noiseFigureDb+10*Math.log10(p.bandwidthMHz*1e6);
 const referencePower=p.referenceEirpDbm+p.rxGainDb-p.receiverLossDb-fspl(range,p.referenceFrequencyGHz);
 const processingGainDb=requiredSnr(p.pdRequired,p.pfa)-(referencePower-noiseDbm);
 const receivedPowerDbm=eirp+p.rxGainDb-p.receiverLossDb-fspl(distance,frequencyGHz);
 return {noiseDbm,processingGainDb,receivedPowerDbm,snrDb:receivedPowerDbm-noiseDbm+processingGainDb};
}
