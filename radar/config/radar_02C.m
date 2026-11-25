function radar = radar_02C()
% RADAR_02C  02C 三坐标雷达参数配置
% X 波段线性调频脉冲, 方位机扫+俯仰相扫, 脉冲多普勒体制
% 带 [假设] 标记的参数为任务书未给出, 按 8km 指标反推的工程估算值

    radar.name        = '02C';
    radar.band        = 'X';

    % --- 任务书给定指标 ---
    radar.fc          = 9.4e9;          % 中心频率 [假设: X波段典型值 Hz]
    radar.R_spec      = 8e3;            % 指标探测距离 >= 8km (m)
    radar.az_cov      = [0, 360];       % 方位覆盖 (deg)
    radar.el_cov      = [0, 40];        % 俯仰覆盖 (deg)
    radar.acc_range   = 8;              % 距离精度 <8m -> 带宽 c/(2*8) [假设取等]
    radar.acc_az      = 0.6;            % 方位精度 <=0.6deg
    radar.acc_el      = 0.4;            % 俯仰精度 <=0.4deg
    radar.data_rate   = 3;              % 数据率 3s -> 方位转速 20 rpm (s)
    radar.capacity    = 500;            % 目标容量 (批)
    radar.weight      = 73;             % 重量 <=73kg
    radar.size        = [980,450,660];  % 尺寸 mm
    radar.power_draw  = 400;            % 功耗 <=400W

    % --- 波形参数 [假设] ---
    radar.BW          = radar_consts() / (2*radar.acc_range); % 18.75 MHz
    radar.pulse_width = 2e-6;           % 脉宽 2us (近距盲区约300m)
    radar.prf         = 12e3;           % PRF 12kHz (不模糊距离12.5km, 覆盖R_max)
    radar.n_pulses    = 128;            % 相参积累脉冲数 (驻留内可用~165)

    % --- 收发系统参数 [假设: 由8km@RCS=0.01m2反推并校核] ---
    radar.Pt          = 1000;           % 峰值发射功率 1kW (占空比2.4%, 平均24W)
    radar.Gt          = 35;             % 发射增益 dB (与980x450mm口径相符)
    radar.Gr          = 35;             % 接收增益 dB
    radar.NF          = 3;              % 噪声系数 dB
    radar.L_sys       = 4;              % 系统损耗 dB (含波束形状/扫描/信号处理损耗)

    % --- 扫描 ---
    radar.el_beams    = 8;              % 俯仰同时/顺序电扫波位数 [假设]
    radar.rot_rpm     = 60/radar.data_rate * 1; % 20 rpm, 数据率3s一转

    % --- 检测门限 ---
    radar.Pfa         = 1e-6;
    radar.Pd_req      = 0.9;
end
