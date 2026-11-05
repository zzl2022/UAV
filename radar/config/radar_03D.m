function radar = radar_03D()
% RADAR_03D  03D 三坐标雷达参数配置
% Ku 波段 DBF 三坐标雷达, 方位机扫+俯仰相扫, 脉冲多普勒体制
% 带 [假设] 标记的参数为任务书未给出, 按 8km 指标反推的工程估算值

    radar.name        = '03D';
    radar.band        = 'Ku';

    % --- 任务书给定指标 ---
    radar.fc          = 15e9;           % 中心频率 [假设: Ku波段典型值 Hz]
    radar.R_spec      = 8e3;            % 指标探测距离 >= 8km (m)
    radar.az_cov      = [0, 360];       % 方位覆盖 (deg)
    radar.el_cov      = [0, 60];        % 俯仰覆盖 (deg)
    radar.acc_range   = 6;              % 距离精度 6m -> 带宽 c/(2*6)
    radar.acc_az      = 0.3;            % 方位精度 <=0.3deg
    radar.acc_el      = 0.3;            % 俯仰精度 <=0.3deg
    radar.data_rate   = 2;              % 数据率 2s -> 30 rpm (s)
    radar.capacity    = 500;            % 目标容量 (批)
    radar.weight      = 85;             % 重量 <=85kg
    radar.size        = [775,450,760];  % 尺寸 mm
    radar.power_draw  = 1500;           % 功耗 <=1500W

    % --- 波形参数 [假设] ---
    radar.BW          = radar_consts() / (2*radar.acc_range); % 25 MHz
    radar.pulse_width = 2e-6;           % 脉宽 2us
    radar.prf         = 10e3;           % PRF 10kHz (不模糊距离15km, 覆盖R_max)
    radar.n_pulses    = 40;             % 相参积累脉冲数 (驻留内可用~46)

    % --- 收发系统参数 [假设: 由8km@RCS=0.01m2反推并校核] ---
    % 注: Ku波段波长更短, 同等口径增益更高; 功耗1500W支持更大发射功率
    radar.Pt          = 2200;           % 峰值发射功率 2.2kW (行波管, 平均44W)
    radar.Gt          = 38;             % 发射增益 dB
    radar.Gr          = 38;             % 接收增益 dB
    radar.NF          = 4;              % 噪声系数 dB
    radar.L_sys       = 4;              % 系统损耗 dB

    % --- 扫描 (DBF: 俯仰多波束同时形成) ---
    radar.el_beams    = 12;             % 俯仰同时接收波位数 [假设]
    radar.rot_rpm     = 60/radar.data_rate * 1; % 30 rpm

    % --- 检测门限 ---
    radar.Pfa         = 1e-6;
    radar.Pd_req      = 0.9;
end
