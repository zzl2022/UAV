function dev = rf_x1c()
%RF_X1C  X1C 无源无人机侦测定位设备参数配置
%   工作模式: 无线电频谱分析/TDOA (无源被动接收, 高性能固定式)
%   频段: 900M/1.2G/2.4G/5.2G/5.8G 五离散频段
%   城市半径2-5km; 空旷10+km; 定位误差<10m (组网TDOA)
%   口径: 工作半径=单节点侦测半径; 定位误差<10m=组网TDOA属性

    dev.name      = 'X1C';
    dev.tx_mode    = 'passive';

    % --- 任务书给定指标 ---
    % 五离散频段覆盖 (Hz): [f_lo f_hi]
    dev.freq_cov  = {[840.5e6, 928e6], ...      % 900M (含中国无人机专用840.5-845)
                     [1.2e9, 1.45e9], ...       % 1.2G/1.4G (含1430-1444专用)
                     [2.4e9, 2.4835e9], ...      % 2.4G
                     [5.15e9, 5.25e9], ...       % 5.2G
                     [5.725e9, 5.85e9]};         % 5.8G
    dev.fc_list   = [915e6, 1.325e9, 2.44e9, 5.2e9, 5.7875e9]; % 各频段代表频点
    dev.R_urban   = [2e3, 5e3];             % 城市半径 2-5km (中点3.5km反推)
    dev.R_open    = 10e3;                   % 空旷最远10+km
    dev.loc_err   = 10;                     % TDOA定位误差 <10m (组网属性)
    dev.capacity  = 15;
    dev.weight    = 25;
    dev.size      = [513,462,187];

    % --- 接收机参数 [假设: 由指标反推, 性能优于X1B] ---
    dev.nf_dB     = 3;
    dev.g_ant_dB  = 3;
    dev.b_detect  = 20e6;
    dev.t_sw      = 0;

    dev.Pfa       = 1e-5;                   % 高精度机型, 门限更严 [假设]
    dev.Pd_req    = 0.9;
    dev.sigma_t0  = NaN;
end
