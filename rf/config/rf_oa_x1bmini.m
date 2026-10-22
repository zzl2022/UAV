function dev = rf_oa_x1bmini()
%RF_OA_X1BMINI  OA-X1Bmini 无线电侦测设备参数配置
%   工作模式: 无线电频谱/TDOA (无源被动接收, 便携式)
%   频段: 100MHz-6GHz 连续覆盖; 城市半径0.5-2km (小型轻量5kg)
%   口径: 工作半径=单节点侦测半径; 定位误差<20m=组网TDOA属性

    dev.name      = 'OA-X1Bmini';
    dev.tx_mode    = 'passive';

    % --- 任务书给定指标 ---
    dev.freq_cov  = {[100e6, 6e9]};
    dev.R_urban   = [0.5e3, 2e3];           % 城市半径 0.5-2km (中点1.25km反推)
    dev.loc_err   = 20;
    dev.capacity  = 30;
    dev.weight    = 5;
    dev.size      = [185,185,350];

    % --- 接收机参数 [假设: 由指标反推] ---
    dev.nf_dB     = 5;                      % 便携机噪声系数略高 [假设]
    dev.g_ant_dB  = 2;
    dev.b_detect  = 20e6;
    dev.t_sw      = 0;

    dev.Pfa       = 1e-4;
    dev.Pd_req    = 0.9;
    dev.sigma_t0  = NaN;
end
