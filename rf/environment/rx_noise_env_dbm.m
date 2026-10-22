function [N_dbm, detail] = rx_noise_env_dbm(dev, wf, env)
%RX_NOISE_ENV_DBM 环境噪声底 (dBm)  [L3]
%   热噪 + ITU-R P.372 人为噪声(频变, <300MHz显著) + 公共频段拥塞(emi_db) + 同址串扰
%   env.city_type      : business|residential|rural (P.372 人为噪声分级)
%   env.emi_db         : 公共频段拥塞抬升(dB), 缺省按频段+城区自动给定 [假设]
%   env.co_site_emi_db : 同址设备串扰(dB), 缺省0 [假设]
%   方向结论: 高频段(2.4/5.8G)人为噪声可忽略, 拥塞为主增量;
%             低频段(900M无人机专用)人为噪声小且拥塞低, 噪声增量最小

    if ~isfield(env,'city_type');      env.city_type='business';       end
    if ~isfield(env,'co_site_emi_db'); env.co_site_emi_db=0;           end

    N_th = rx_noise_dbm(dev);                                   % 热噪(dBm)

    % --- ITU-R P.372 人为噪声中值: Fam = c - d*log10(f_MHz) ---
    switch env.city_type
        case 'business';    cc=76.8; dd=27.7;
        case 'residential'; cc=72.5; dd=27.7;
        case 'rural';       cc=67.2; dd=27.7;
    end
    fMHz    = wf.fc/1e6;
    Fam_db  = cc - dd*log10(fMHz);                              % 外部人为噪声系数(dB)
    fr      = 10^(dev.nf_dB/10);
    fa      = 10^(Fam_db/10);
    fa_excess= max(fa - 1, 0);
    dN_mm   = 10*log10(1 + fa_excess/fr);                      % 叠加到系统噪声的增量(dB)

    % --- 公共频段拥塞(2.4/5.8G ISM), 缺省按频段+城区给定 ---
    if ~isfield(env,'emi_db') || isempty(env.emi_db)
        env.emi_db = congestion_default_db(wf.fc, env.city_type);
    end
    emi = env.emi_db;

    N_dbm = N_th + dN_mm + emi + env.co_site_emi_db;

    if nargout > 1
        detail = struct('N_th',N_th,'Fam_db',Fam_db,'dN_manmade',dN_mm, ...
            'emi_db',emi,'co_site',env.co_site_emi_db,'city_type',env.city_type);
    end
end

function e = congestion_default_db(fc, city_type)
%CONGESTION_DEFAULT 公共频段拥塞抬升默认(dB) [假设, ISM 城区典型]
    wt = struct('business',1, 'residential',0.6, 'rural',0.3);
    w  = wt.(city_type);
    if fc < 300e6
        e = 0;                                  % <300M: 无 ISM 拥塞(人为噪声已含)
    elseif fc >= 2.4e9*0.98 && fc <= 2.4835e9    % 2.4G ISM: WiFi/蓝牙密集
        e = 8 * w;
    elseif fc >= 5.15e9 && fc <= 5.85e9           % 5.2/5.8G ISM: WiFi 5/6
        e = 5 * w;
    else
        e = 0;                                  % 900M无人机专用/1.2G专用: 拥塞低
    end
end
