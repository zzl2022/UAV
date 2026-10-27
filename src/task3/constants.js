// 任务三共享常量。装备事实数据转录自 创意二文件/创意二数据集/装备参数.doc；
// 文档未给出的字段一律标注为模型假设，禁止臆造后当作文档参数。
export const TASK3_VERSION='task3-1.0';
export const RUN_SCHEMA='task3-run/1.0';

// 默认推演范围：河南博物院周边 2.4×2.4 km（复用 optimizer.boundsFor 的 core 分支）。
export const DEFAULT_SCOPE='core';
export const CORE_RADIUS_M=700; // 核心权重区半径，沿用 planning 默认。

// 盲区类别（任务书：楼栋夹缝、围墙边角、低空贴楼区域、建筑背面阴影区）。
export const BLIND_CATEGORIES={
 gap:'楼栋夹缝',
 corner:'围墙边角',
 lowFacade:'低空贴楼区域',
 shadow:'建筑背面阴影区',
 other:'其他盲区',
};
export const BLIND_COLORS={gap:0xff9f5a,corner:0xffd783,lowFacade:0x70d6ff,shadow:0xff776d,other:0xb89aff};

// 盲区分类的几何阈值初值（来自几何构造，阶段六用仿真数据校订后回填出处）。
export const BLIND_THRESHOLDS={
 gapMaxWidthM:60,        // 两侧建筑对向间距上限，超出不记为夹缝
 cornerMaxDistanceM:25,  // 距建筑轮廓顶点（角部）上限
 lowFacadeMaxAglM:45,    // 低空贴楼的离地高度上限（覆盖最低采样层 30 m）
 lowFacadeMaxDistanceM:20, // 距最近建筑立面水平距离上限
 shadowMaxBlockerDistanceM:120, // 阴影区：遮挡建筑距盲点的最大距离
 source:'几何构造初值；经 artifacts/task3/runs 仿真统计校订后在 deployment-rules.md 注明出处',
};

// 装备参数.doc 转录：重量/尺寸/功耗/架设方式/频段。用于施工可行性代理与 EMC 校核。
export const EQUIPMENT_FACTS={
 'radar-02c':{weightKg:73,sizeMm:[980,450,660],powerW:400,mount:'车载式/固定式',band:'X',emissionGHz:[9.4],receiveGHz:[9.4],source:'文档（波段 X；9.4 GHz 为 presets.js 模型假设）'},
 'radar-03d':{weightKg:85,sizeMm:[775,450,760],powerW:1500,mount:'车载式/固定式',band:'Ku',emissionGHz:[15],receiveGHz:[15],source:'文档（波段 Ku；15 GHz 为 presets.js 模型假设）'},
 'radio-tdoa':{weightKg:12,sizeMm:[260,260,637],powerW:null,mount:'固定式',band:null,emissionGHz:[],receiveRangeGHz:[0.1,6],source:'文档（100MHz–6GHz，无源侦测不发射）'},
 'radio-mini':{weightKg:5,sizeMm:[185,185,350],powerW:null,mount:'固定式',band:null,emissionGHz:[],receiveRangeGHz:[0.1,6],source:'文档（100MHz–6GHz，无源侦测不发射）'},
 'radio-x1c':{weightKg:25,sizeMm:[513,462,187],powerW:null,mount:'固定式',band:null,emissionGHz:[],receiveDiscreteGHz:[0.9,1.2,2.4,5.2,5.8],source:'文档（离散频点，无源侦测不发射）'},
 'optical-nvt':{weightKg:8,sizeMm:[345,190,245],powerW:60,mount:'固定式/车载/铁塔',band:null,emissionGHz:[],receiveGHz:[],source:'文档（双光谱光电，无射频发射）'},
 'acoustic-cry':{weightKg:3.8,sizeMm:null,powerW:null,mount:'固定式',band:null,emissionGHz:[],receiveGHz:[],source:'文档（20Hz–20kHz 声学，无射频发射；尺寸以 8 英寸屏为准）'},
};

// EMC 规则阈值（工程代理，出处写入 EMC 报告；非频谱合规认证）。
export const EMC_RULES={
 coChannelSeparationGHz:0.1,   // 同频判定：雷达载频差小于该值
 coChannelMinDistanceM:600,    // 同频复用最小间距（沿用 planning 代理）
 adjacentChannelGHz:0.5,       // 邻频判定带宽
 adjacentMinDistanceM:300,     // 邻频最小间距
 frontendBlockDistanceM:50,    // 大功率发射就近致接收机前端阻塞的间距代理
 frontendBlockPowerW:1000,     // 触发前端阻塞提示的发射功率阈值
 coSiteMinDistanceM:10,        // 同点位过密部署提示
 source:'工程代理规则，参考同频复用距离/邻道抑制方法（GNU Radio、CloudRF Signal-Server 同类方法论）；不是 EMC 认证',
};

// 威胁场景定义（任务书：单机单点入侵、多方向同步入侵、蜂群饱和攻击）。
export const THREAT_SCENARIOS={
 single:{name:'单机单点入侵',directions:8,dronesPerDirection:1,speedMps:15,aglM:[30,60]},
 multi:{name:'多方向同步入侵',directions:4,dronesPerDirection:1,speedMps:15,aglM:[45,60],simultaneous:true},
 swarm:{name:'蜂群饱和攻击',directions:3,dronesPerDirection:14,speedMps:12,aglM:[30,45,60],simultaneous:true,note:'42 架，超出 TDOA-X1B(35)/OA-X1Bmini(30)/X1C(15) 并发容量，用于检验容量溢出与漏探'},
};

// 四指标默认权重（界面可调）。
export const METRIC_WEIGHTS={coverage:0.4,blind:0.25,cost:0.2,feasibility:0.15};
export const METRIC_LABELS={coverage:'覆盖完整性',blind:'盲区面积占比(越小越好)',cost:'装备配置成本(相对单位,非人民币报价)',feasibility:'现场施工可行性代理'};

// 施工可行性代理：重量/体积越大、安装越高越难；车载式设备对屋顶承重要求更高。
export const FEASIBILITY_MODEL={
 maxWeightKg:85,maxVolumeM3:0.31,heightPenaltyPer100M:0.15,
 weights:{mass:0.4,volume:0.25,mount:0.15,height:0.2},
 source:'依据装备参数.doc 的重量/尺寸/架设方式构造的相对代理；屋顶承重、供电、网络未实测',
};
