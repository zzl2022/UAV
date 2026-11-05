function [sigma_t, sigma_R, beta] = crlb_sigma_t(wf, snr_eff_db)
%CRLB_SIGMA_T 时延估计 CRLB (已知信号, 相干处理)  [P5 组网 GDOP 打底]
%   sigma_t >= 1 / (beta * sqrt(2*SNR_lin))
%   beta    : RMS 带宽, 矩形谱 beta = B/sqrt(12)
%   sigma_R : 单基线时差 -> 距离等效, sigma_R = c*sigma_t
%   snr_eff_db: 处理后(含 Gp)等效 SNR (dB)
%   组网定位误差 ~ GDOP * sigma_R (P5 用多站几何解算 GDOP)

    c = 299792458;
    if isnan(wf.fc) || wf.bw <= 0
        sigma_t = Inf;  sigma_R = Inf;  beta = 0;
        return;
    end
    beta     = wf.bw / sqrt(12);
    snr_lin  = 10.^(snr_eff_db/10);
    sigma_t  = 1 ./ (beta .* sqrt(2*snr_lin));
    sigma_R  = c * sigma_t;
end
