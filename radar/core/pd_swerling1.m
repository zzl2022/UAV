function pd = pd_swerling1(snr_db, Pfa)
% PD_SWERLING1  Swerling I 目标检测概率
    snr = 10.^(snr_db/10);
    pd  = Pfa .^ (1./(1+snr));
end
