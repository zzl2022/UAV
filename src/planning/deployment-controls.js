// 可选部署控制；缺省值保持原有界面与求解行为。
export const DEPLOYMENT_TYPES=['radar','radio','optical','acoustic'];
export function validateDeploymentControls(settings){
 if(settings.installationHeightM!==undefined&&(!Number.isFinite(settings.installationHeightM)||settings.installationHeightM<.5||settings.installationHeightM>20))throw Error('架设高度必须在表面上方 0.5–20 m');
 if(settings.headingOffsetDeg!==undefined&&(!Number.isFinite(settings.headingOffsetDeg)||Math.abs(settings.headingOffsetDeg)>180))throw Error('方位偏置必须在 -180–180°');
 if(settings.radarPitchesDeg!==undefined&&(!Array.isArray(settings.radarPitchesDeg)||!settings.radarPitchesDeg.length||settings.radarPitchesDeg.length>7||settings.radarPitchesDeg.some(v=>!Number.isFinite(v)||v< -60||v>0)))throw Error('雷达俯仰候选必须为 -60–0° 内的 1–7 个角度');
 if(settings.typeLimits!==undefined){
  if(!settings.typeLimits||typeof settings.typeLimits!=='object'||Array.isArray(settings.typeLimits))throw Error('各类设备数量上限必须为对象');
  for(const [type,value] of Object.entries(settings.typeLimits))if(!DEPLOYMENT_TYPES.includes(type)||!Number.isInteger(value)||value<0||value>64)throw Error('各类设备数量上限必须为 0–64 的整数');
 }
}
export function withinTypeLimit(candidate,selected,typeLimits){
 const type=candidate.device?.type,limit=typeLimits?.[type];
 return limit===undefined||selected.filter(c=>c.device?.type===type).length<limit;
}
