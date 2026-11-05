function snr_db = composite_snr_db(radar, R_h, h_t, h_r, rcs, env)
% COMPOSITE_SNR_DB  综合损耗后的SNR (dB)   [B5 失效边界核心]
%   输入: R_h - 水平距离向量 (m);  h_t - 目标高度 (m);  h_r - 雷达架设高度 (m)
%         rcs - 目标RCS (m2);  env - 环境配置(rain_mmh/cloud_M/city_type/emi_db)
%   叠加: 自由空间 + 气象衰减 + 底噪 + 地面多径 + 近距盲区截断
%   近距盲区: 单基地脉冲雷达 R_min = c*(tau+t_sw)/2 (脉宽2us+收发切换1us [假设] -> 450m)

    slant = sqrt(R_h.^2 + (h_t - h_r).^2);
    el    = atan2d(h_t - h_r, R_h);
    snr = radar_snr(radar, slant, rcs);

    [dN, ~] = noise_floor_db(radar, env);
    Lw = weather_loss_db(radar, R_h, el, env);
    snr = snr - Lw - dN;

    Fdb = multipath_factor_db(radar, R_h, h_t, h_r, []);
    snr = snr + Fdb;

    [c, ~] = radar_consts();
    t_sw = 1e-6;                                 % 收发切换时间 [假设 1us]
    R_min = c * (radar.pulse_width + t_sw) / 2;  % 近距盲区半径 (m)
    snr(slant < R_min) = -999;
    snr(el > radar.el_cov(2)) = -999;
    snr_db = snr;
end
