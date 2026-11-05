function R_max = max_range_env(radar, rcs, Pd, Pfa, env, el_deg)
% MAX_RANGE_ENV  含环境损耗的最大探测距离 (m): fzero 求解 SNR(R)=SNR_req

    if nargin < 6, el_deg = 5; end
    R_free = max_range(radar, rcs, Pd, Pfa);
    [dN_db, ~] = noise_floor_db(radar, env);
    snr_req = snr_required(Pd, Pfa);

    % 求解 SNR(R) - L(R) - dN = SNR_req, fzero 避免不动点迭代振荡
    g = @(R) radar_snr(radar, R, rcs) - weather_loss_db(radar, R, el_deg, env) ...
             - dN_db - snr_req;
    if g(R_free*0.02) <= 0
        R_max = R_free*0.02;   % 极端损耗: 即使近距离也不满足
        return;
    end
    R_max = fzero(g, [R_free*0.02, R_free]);
end
