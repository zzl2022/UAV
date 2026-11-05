function Rmax = r_max_freespace(dev, wf, Pmin_eff)
%R_MAX_FREESPACE 自由空间最大侦测距离 (m): Pr(R) = Pmin_eff
%   FSPL(R, fc) = EIRP + G_ant - L_rx - Pmin_eff  ->  R
%   静默波形(wf.fc=NaN) -> Rmax=0 (失效边界: 不可侦测)
%   注: 自由空间值; 城区实际距离由 P3 NLOS 超量损耗进一步压缩

    L_rx = 2;                              % dB [假设, 与 rx_power_dbm 一致]
    if isnan(wf.fc) || isinf(wf.eirp)
        Rmax = 0;                          % 静默无人机
        return;
    end
    c = 299792458;
    L_target = wf.eirp + dev.g_ant_dB - L_rx - Pmin_eff;
    Rmax = 10^((L_target - 20*log10(wf.fc) - 20*log10(4*pi/c))/20);
end
