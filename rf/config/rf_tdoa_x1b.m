function dev = rf_tdoa_x1b()
%RF_TDOA_X1B  TDOA-X1B 无线电侦测设备参数配置
%   工作模式: 无线电频谱/TDOA (无源被动接收)
%   频段: 100MHz-6GHz 连续覆盖
%   带 [假设] 标记的接收机内部参数厂商未公开, 由"城市半径2-6km"指标反推 (P2完成)
%   口径: 工作半径=单节点侦测半径; 定位误差<20m=组网TDOA解算属性

    dev.name      = 'TDOA-X1B';
    dev.tx_mode    = 'passive';            % 无源

    % --- 任务书给定指标 ---
    dev.freq_cov  = {[100e6, 6e9]};         % 频段覆盖 (Hz), 连续
    dev.R_urban   = [2e3, 6e3];             % 城市工作半径 2-6km (取中点4km反推)
    dev.loc_err   = 20;                     % TDOA定位误差 <20m (组网属性)
    dev.capacity  = 35;                     % 同时探测 >35架次
    dev.weight    = 12;                     % kg
    dev.size      = [260,260,637];          % mm

    % --- 接收机参数 [假设: 由指标反推, P2校核] ---
    dev.nf_dB     = 4;                      % 噪声系数 dB [假设]
    dev.g_ant_dB  = 2;                     % 天线增益 dBi (宽带全向-ish) [假设]
    dev.b_detect  = 20e6;                   % 检测信道带宽 Hz [假设]
    dev.t_sw      = 0;                     % 无源无收发切换, 无近距盲区

    % --- 检测门限 ---
    dev.Pfa       = 1e-4;                   % 频谱检测虚警概率 [假设]
    dev.Pd_req    = 0.9;

    % --- TDOA 时延估计 (组网层, P5用) ---
    dev.sigma_t0  = NaN;                    % 单站时延RMS (由CRLB按SNR算, P5)
end
