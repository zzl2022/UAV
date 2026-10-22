function [N_dbm, detail] = rx_noise_dbm(dev)
%RX_NOISE_DBM 接收机热噪声底 (dBm)  [P2 自由空间基准]
%   N = -174(dBm/Hz) + NF + 10*log10(B_detect)
%   P3 再叠加 ITU-R P.372 人为噪声 + 公共频段拥塞抬升
%   输入 dev: 设备配置 (.nf_dB / .b_detect)

    [c, k, t0] = rf_consts();
    N_dbm = -174 + dev.nf_dB + 10*log10(dev.b_detect);
    if nargout > 1
        detail = struct('nf_dB', dev.nf_dB, 'B_detect', dev.b_detect, ...
                        'T0', t0, 'thermal_dbm', N_dbm);
    end
end
