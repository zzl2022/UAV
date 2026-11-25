function wf = drone_waveforms()
%DRONE_WAVEFORMS  无人机辐射波形库 v0.1 (SRRC口径, 场景=中国郑州)
%   供 rf 模块单向链路预算与静默边界分析使用.
%   字段: name / fc(Hz) / eirp(dBm) / bw(Hz占用带宽) / mod(体制) / dir(发射方向) / wt(威胁权重) / src(来源)
%   权重 wt 为默认威胁画像(消费级为主+10%自制远距/穿越+5%静默), 赛题未指定机型构成时启用.
%   静默模式 Pd≡0, 仅用于失效边界分析, 不参与链路预算.

% --- 大疆 OcuSync 图传/飞控 (官方规格, SRRC) ---
wf(1) = struct('name','OcuSync_24G','fc',2.4e9,'eirp',19,  'bw',20e6,'mod','OFDM/FHSS','dir','both','wt',0.18,'src','DJI官方(SRRC)');
wf(2) = struct('name','OcuSync_58G','fc',5.8e9,'eirp',25.5,'bw',20e6,'mod','OFDM/FHSS','dir','both','wt',0.27,'src','DJI官方(FCC,SRRC上限33)');

% --- 大疆/消费级 增强WiFi (官方+法规限值) ---
wf(3) = struct('name','EnhWiFi_24G','fc',2.4e9,'eirp',20,  'bw',20e6,'mod','WiFi802.11','dir','both','wt',0.15,'src','中国ISM限值<=20dBm');
wf(4) = struct('name','EnhWiFi_58G','fc',5.8e9,'eirp',28,  'bw',40e6,'mod','WiFi802.11','dir','both','wt',0.10,'src','DJI官方(FCC<30)');

% --- 消费级 WiFi 机 (非大疆, 法规限值) ---
wf(5) = struct('name','WiFiConsumer_24G','fc',2.4e9,'eirp',20, 'bw',20e6,'mod','WiFi802.11','dir','both','wt',0.10,'src','中国ISM限值');

% --- 行业机 900M 数传电台 (厂商规格, 中国无人机专用频段840.5-845M) ---
wf(6) = struct('name','DataLink_900M','fc',915e6,'eirp',30.5,'bw',200e3,'mod','GMSK/FHSS','dir','uplink','wt',0.05,'src','厂商规格(0.5-2W两档)');

% --- 自制/远距 1.2G/1.4G 图传 (行业典型值, 中国专用1430-1444M) ---
wf(7) = struct('name','LongRange_12G','fc',1.325e9,'eirp',33, 'bw',8e6, 'mod','AnaFM/OFDM','dir','downlink','wt',0.05,'src','行业典型(1-4W)');

% --- 穿越机 5.8G 模拟FPV (行业典型值) ---
wf(8) = struct('name','AnaFPV_58G','fc',5.8e9,'eirp',25,  'bw',8e6,  'mod','AnaFM',     'dir','downlink','wt',0.05,'src','行业典型(25mW-2W)');

% --- 静默模式 (预编程航线, 无图传/飞控上行, 失效边界定义项) ---
wf(9) = struct('name','Silent','fc',NaN,'eirp',-Inf,'bw',0,'mod','none','dir','none','wt',0.05,'src','失效边界: Pd≡0');

% 权重归一化校验
w = [wf.wt];
assert(abs(sum(w)-1) < 1e-9, 'drone_waveforms: 权重和!=1 (%.4f)', sum(w));
end
