function deepFreeze(value){
 if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
 for(const key of Object.keys(value))deepFreeze(value[key]);
 return Object.freeze(value);
}

export function createTask3RequestSnapshot({settings,weights,presetIds,equipmentSnapshot,scenarioSnapshot}){
 return deepFreeze(structuredClone({
  settings,weights,presetIds,equipmentSnapshot,
  environment:scenarioSnapshot.environment,target:scenarioSnapshot.target,
 }));
}

export function createTask3RunScheduler({run,debounceMs=120,hasCurrentResult=()=>false,setTimer=(callback,delay)=>setTimeout(callback,delay),clearTimer=timer=>clearTimeout(timer)}={}){
 if(typeof run!=='function')throw Error('缺少任务三推演入口');
 let requestId=0,timer=null,pendingReasons=[],updateReason='待命',lastSuccessfulRequestId=null,lastError=null,staleResult=false;
 function start(reason='手动推演'){
  if(timer!==null){clearTimer(timer);timer=null;}
  const reasons=[...pendingReasons];if(reason&&!reasons.includes(reason))reasons.push(reason);pendingReasons=[];
  const id=++requestId;updateReason=reasons.join('、')||'手动推演';staleResult=!!hasCurrentResult();lastError=null;
  run({requestId:id,updateReason});return id;
 }
 function schedule(reason='参数变更自动更新'){
  if(!pendingReasons.includes(reason))pendingReasons.push(reason);
  staleResult=!!hasCurrentResult();
  if(timer!==null)clearTimer(timer);
  timer=setTimer(()=>{timer=null;start('');},debounceMs);
 }
 function succeed(id){
  if(id!==requestId||timer!==null)return false;
  lastSuccessfulRequestId=id;lastError=null;staleResult=false;return true;
 }
 function fail(id,error){
  if(id!==requestId||timer!==null)return false;
  lastError=error instanceof Error?error.message:String(error);staleResult=!!hasCurrentResult();return true;
 }
 function cancel(){
  if(timer!==null){clearTimer(timer);timer=null;}pendingReasons=[];
  const id=++requestId;updateReason='用户取消';lastError=null;staleResult=!!hasCurrentResult();return id;
 }
 return {start,schedule,succeed,fail,cancel,isCurrent:id=>id>0&&id===requestId&&timer===null,getState:()=>({requestId,updateReason,lastSuccessfulRequestId,lastError,staleResult,pending:timer!==null,pendingUpdateReasons:[...pendingReasons]})};
}
