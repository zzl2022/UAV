function snr_db = radar_snr(radar, R, rcs)
% RADAR_SNR  自由空间雷达距离方程(能量形式): 给定距离与RCS, 返回相干积累后SNR (dB)
%   SNR = Pt * tau * Gt * Gr * lambda^2 * rcs * n_pulses / ...
%         ((4pi)^3 * R^4 * k * T0 * NF * L)
%   能量形式: tau 表征脉冲能量, 匹配滤波/脉压增益已隐含, 分母不再出现带宽B

    [c, k]  = radar_consts();
    T0      = 290;
    lambda  = c / radar.fc;

    Pt    = radar.Pt;
    Gt    = 10^(radar.Gt/10);
    Gr    = 10^(radar.Gr/10);
    tau   = radar.pulse_width;
    n     = radar.n_pulses;
    NF    = 10^(radar.NF/10);
    L     = 10^(radar.L_sys/10);

    snr = Pt .* tau .* Gt .* Gr .* lambda.^2 .* rcs .* n ./ ...
          ((4*pi)^3 .* R.^4 .* k .* T0 .* NF .* L);

    snr_db = 10*log10(snr);
end
