function snr_req_db = snr_required(Pd, Pfa)
%SNR_REQUIRED 检测所需 SNR (dB) — Swerling I 闭式 (与 radar 组一致, 工具箱无关)
%   无人机信号经 FHSS/衰落, 脉间起伏近似 Swerling I;
%   闭式: Pd = Pfa^(1/(1+SNR))  ->  SNR = ln(Pfa)/ln(Pd) - 1
%   [假设/近似] 作为检测统计量所需 SNR 的基准; 实际波形感知增益并入 sensitivity_solve 的 Gp
    snr_req    = log(Pfa)/log(Pd) - 1;
    snr_req_db = 10*log10(snr_req);
end
