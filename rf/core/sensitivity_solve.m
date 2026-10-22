function sol = sensitivity_solve(dev, wf_lib)
%SENSITIVITY_SOLVE 由"城市工作半径"指标反推设备检测灵敏度与处理增益 Gp
%   口径(已冻结): 工作半径=单节点侦测半径; 参考波形=主导消费级 OcuSync_58G
%   反推: 参考波形在城市半径中点 R_mid 处恰达 Pd_req
%         SNR_ant(R_mid) = Pr(R_mid) - N
%         Gp = SNR_req_base - SNR_ant(R_mid)        (处理增益, 表征匹配滤波/前导相关/FHSS聚合)
%         Pmin_eff = N + SNR_ant(R_mid) = Pr(R_mid)  (等效检测门限, dBm)
%   Gp 合理区间 6-22 dB (便携机处理增益较低, 固定式较高); 偏离则提示假设参数需复核
%   输出 sol: .dev .ref_wf .R_mid .SNR_req_base .N_dbm .Pr_mid .SNR_ant_mid
%             .Gp .Pmin_eff .plausible

    % 参考波形: OcuSync_58G (权重 0.27, 主导消费级, 各设备均覆盖 5.8G)
    ref_name = 'OcuSync_58G';
    ref_wf = [];
    for i = 1:numel(wf_lib)
        if strcmp(wf_lib(i).name, ref_name); ref_wf = wf_lib(i); break; end
    end
    assert(~isempty(ref_wf), 'sensitivity_solve: 参考波形 %s 未在波形库', ref_name);

    R_mid         = mean(dev.R_urban);
    SNR_req_base  = snr_required(dev.Pd_req, dev.Pfa);
    N_dbm         = rx_noise_dbm(dev);
    Pr_mid        = rx_power_dbm(dev, ref_wf, R_mid);
    SNR_ant_mid   = Pr_mid - N_dbm;
    Gp            = SNR_req_base - SNR_ant_mid;
    Pmin_eff      = Pr_mid;                  % 门限=参考波形在中点处的接收功率

    plausible = (Gp >= 6) && (Gp <= 22);

    sol = struct('dev_name', dev.name, 'ref_wf', ref_wf, 'R_mid', R_mid, ...
        'SNR_req_base', SNR_req_base, 'N_dbm', N_dbm, 'Pr_mid', Pr_mid, ...
        'SNR_ant_mid', SNR_ant_mid, 'Gp', Gp, 'Pmin_eff', Pmin_eff, ...
        'plausible', plausible);
end
