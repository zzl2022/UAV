export function recordedScenariosForPlan(report,planId){
 if(!report||!planId)return null;
 return report.threatsByPlan?.[planId]??(planId===report.recommendedId?report.threats??null:null);
}

export function recordedDuration(record){
 const frames=record?.frames;
 if(!Array.isArray(frames)||frames.length<2)return 0;
 const end=frames.at(-1)?.time;
 return Number.isFinite(end)&&end>0?end:0;
}

export function resolvePlaybackAvailability({custom,mapSwitching,selectingBuildings,invalidConstraints,deviceDemo,busy,hasPlan,record}){
 if(custom)return {status:'scene-unavailable',blocked:true,message:'自定义区域提供感知覆盖和电磁兼容分析。飞行回放可在内置演示区域查看。'};
 if(mapSwitching)return {status:'map-switching',blocked:true,message:'地图正在切换，请等待加载完成。'};
 if(selectingBuildings)return {status:'building-selection',blocked:true,message:'结束地图选点后可播放。'};
 if(invalidConstraints)return {status:'outdated-constraints',blocked:true,message:'建筑禁部署约束已变化，请先重新生成方案。'};
 if(deviceDemo)return {status:'device-demo',blocked:true,message:'停止设备仿真后可播放。'};
 if(busy)return {status:'calculating',blocked:true,message:'正在计算，请等待本轮结果。'};
 if(!hasPlan)return {status:'no-plan',blocked:false,message:'请先在“推演输入 → 方案生成”中生成方案。'};
 if(!recordedDuration(record))return {status:'no-recording',blocked:true,message:'当前方案没有保存这类场景的回放记录。请在当前演示区域重新生成方案。'};
 return {status:'ready',blocked:false,message:''};
}
