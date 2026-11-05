function [snr_db, info] = composite_snr_env(dev, wf, R, env, is_los, L_diff)
%COMPOSITE_SNR_ENV 综合环境 SNR (dB)  [L2+L3 综合, 供 P5 地图/查询]
%   = rx_power(单向链路) - N_env(热噪+P.372+拥塞+串扰) - (NLOS? nlos_excess : 0)
%   静默波形 -> -Inf
%   is_los : 通视标志(由 city_los 给); L_diff: city_los 衍射(传入避免重算)
%   检测判据: snr_db >= SNR_ant门限(=SNR_req_base-Gp, 见 sensitivity_solve)

    if nargin < 5 || isempty(is_los), is_los = true; end
    if nargin < 6, L_diff = 0; end
    if isnan(wf.fc) || isinf(wf.eirp)
        snr_db = -Inf;  info = struct();  return;
    end
    Pr  = rx_power_dbm(dev, wf, R);
    [N_env, det] = rx_noise_env_dbm(dev, wf, env);
    if is_los
        L_nlos = 0;
    else
        L_nlos = nlos_excess_db(R, env, L_diff);
    end
    snr_db = Pr - N_env - L_nlos;
    if nargout > 1
        info = struct('Pr',Pr,'N_env',N_env,'L_nlos',L_nlos,'is_los',is_los,'noise_det',det);
    end
end
