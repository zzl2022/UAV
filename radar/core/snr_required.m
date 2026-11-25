function snr_req_db = snr_required(Pd, Pfa)
% SNR_REQUIRED  Swerling I 目标相干积累后所需SNR (dB)
%   Swerling I 检测概率闭式解: Pd = Pfa^(1/(1+SNR))
%   反解: SNR = ln(Pfa)/ln(Pd) - 1

    snr_req    = log(Pfa)/log(Pd) - 1;
    snr_req_db = 10*log10(snr_req);
end
