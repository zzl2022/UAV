export const DEMO_MAX_ACTIVE=1;
export const DEMO_MIN_SEPARATION_M=30;
export const DEMO_START_COOLDOWN_MS=1500;
export const DEMO_MAX_SAMPLES=24000;

export function deviceDemoStartDecision(active,requested,lastStart,now){
 if(active?.id===requested.id)return 'focus';
 if(active&&Math.hypot(...active.position.map((value,index)=>value-requested.position[index]))<DEMO_MIN_SEPARATION_M)return 'nearby';
 return now-lastStart<DEMO_START_COOLDOWN_MS?'cooldown':'start';
}
