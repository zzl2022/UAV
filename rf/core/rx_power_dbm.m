function Pr = rx_power_dbm(dev, wf, R)
%RX_POWER_DBM 单向接收功率 (dBm) 自由空间
%   Pr = EIRP_wf + G_ant - L_rx - FSPL(R, fc_wf)
%   dev: 接收设备配置; wf: 无人机波形; R: 斜距(m)
%   L_rx = 接收链路损耗(馈线/失配/极化) [假设 2 dB]

    L_rx = 2;                              % dB [假设]
    if isnan(wf.fc) || isinf(wf.eirp)       % 静默波形
        Pr = -Inf;
        return;
    end
    Pr = wf.eirp + dev.g_ant_dB - L_rx - fspl_db(R, wf.fc);
end
