function L_db = weather_loss_db(radar, R, el_deg, env)
% WEATHER_LOSS_DB  气象衰减双程损耗 (dB)   [模块B1]
%   输入: radar - 雷达配置;  R - 斜距向量 (m);  el_deg - 仰角 (deg)
%         env.rain_mmh  - 雨强 (mm/h), 0=无雨
%         env.cloud_M   - 云雾液态水含量 (g/m3), 0=无
%   组成: 雨衰 (ITU-R P.838-3) + 云雾 (ITU-R P.840) + 大气吸收 (ITU-R P.676)
%   注意: 低空路径受雨区/云层垂直厚度限制, 路径长度取 min(R, H/sin(el))

    f_ghz = radar.fc / 1e9;

    %% --- 雨衰: ITU-R P.838-3 表5系数, 对数频率插值, 水平极化 ---
    f_tab = [1 2 4 6 8 9 10 12 15 20 25 30 35];
    kH_tab = [0.0000259 0.0000847 0.0001071 0.0007056 0.004115 ...
              0.007535 0.01217 0.02386 0.04481 0.09164 0.1571 0.2403 0.3374];
    aH_tab = [0.9691 1.0664 1.6009 1.5900 1.3905 1.3155 1.2571 ...
              1.1825 1.1233 1.0568 0.9991 0.9485 0.9047];
    kH = 10^interp1(log10(f_tab), log10(kH_tab), log10(f_ghz), 'linear', 'extrap');
    aH = interp1(f_tab, aH_tab, f_ghz, 'linear', 'extrap');

    if env.rain_mmh > 0
        gamma_rain = kH * env.rain_mmh^aH;          % dB/km (单程)
        H_rain = 3.6;                                % 雨区顶高 km [假设: 中纬度0度等温线~3.6km]
        path_rain = min(R/1e3, H_rain./sind(max(el_deg,0.5)));
        L_rain = 2 * gamma_rain .* path_rain;        % 双程
    else
        L_rain = zeros(size(R));
    end

    %% --- 云雾: ITU-R P.840, gamma = K_l * M ---
    if env.cloud_M > 0
        f_kl  = [5 10 15 20 30];
        Kl_tab = [0.0025 0.010 0.024 0.048 0.11];    % (dB/km)/(g/m3), ~10°C
        Kl = interp1(f_kl, Kl_tab, f_ghz, 'linear', 'extrap');
        gamma_cloud = Kl * env.cloud_M;              % dB/km (单程)
        H_cloud = 1.0;                               % 云层厚度 km [假设]
        path_cloud = min(R/1e3, H_cloud./sind(max(el_deg,0.5)));
        L_cloud = 2 * gamma_cloud .* path_cloud;
    else
        L_cloud = zeros(size(R));
    end

    %% --- 大气吸收: ITU-R P.676 近似值 (标准大气, 地面) ---
    f_gas  = [5 10 15 20];
    g_tab  = [0.007 0.009 0.018 0.028];              % dB/km (单程)
    gamma_gas = interp1(f_gas, g_tab, f_ghz, 'linear', 'extrap');
    L_gas = 2 * gamma_gas .* (R/1e3);

    L_db = L_rain + L_cloud + L_gas;
end
