function deepFreeze(value){
 if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
 for(const key of Object.keys(value))deepFreeze(value[key]);
 return Object.freeze(value);
}

export function createTask3RequestSnapshot({settings,weights,presetIds,equipmentSnapshot,scenarioSnapshot,planTypes=[]}){
 return deepFreeze(structuredClone({
  settings,weights,presetIds,equipmentSnapshot,planTypes,
  environment:scenarioSnapshot.environment,target:scenarioSnapshot.target,
 }));
}

export function createTask3RunScheduler({run,hasCurrentResult=()=>false}={}){
 if(typeof run!=='function')throw Error('缺少任务三推演入口');
 let requestId=0,inputRevision=0,requestInputRevision=0,updateReason='待命',lastSuccessfulRequestId=null,lastError=null,staleResult=false;
 function start(reason='手动生成方案'){
  const id=++requestId;updateReason=reason||'手动生成方案';staleResult=!!hasCurrentResult();lastError=null;requestInputRevision=inputRevision;
  run({requestId:id,updateReason});return id;
 }
 function markStale(){
  inputRevision++;staleResult=!!hasCurrentResult();
 }
 function succeed(id){
  if(id!==requestId)return false;
  lastSuccessfulRequestId=id;lastError=null;staleResult=inputRevision!==requestInputRevision;return true;
 }
 function fail(id,error){
  if(id!==requestId)return false;
  lastError=error instanceof Error?error.message:String(error);staleResult=!!hasCurrentResult();return true;
 }
 function cancel(){
  const id=++requestId;updateReason='用户取消';lastError=null;staleResult=!!hasCurrentResult();return id;
 }
 return {start,markStale,succeed,fail,cancel,isCurrent:id=>id>0&&id===requestId,getState:()=>({requestId,updateReason,lastSuccessfulRequestId,lastError,staleResult,pending:false,pendingUpdateReasons:[]})};
}
