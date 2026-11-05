% SIM_ENVIRONMENT  阶段B1+B2: 气象衰减与电磁底噪对探测性能的影响
% 输出: 不同雨强/雾/底噪档位下两型雷达的探测距离衰减、SNR变化

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
        fullfile(proj_root,'environment'));
out_dir = fullfile(proj_root, 'results');
if ~exist(out_dir, 'dir'); mkdir(out_dir); end

rcs = 0.01;  Pd = 0.9;  Pfa = 1e-6;  el = 5;
radars = {radar_02C(), radar_03D()};
colors = {'b','r'};

%% --- 场景一: 雨强扫描 ---
rain_rates = [0, 2.5, 12.5, 25, 50];   % 无/小/中/大/暴雨 mm/h
rain_names = {'无雨','小雨2.5','中雨12.5','大雨25','暴雨50'};
fprintf('===== 雨衰影响 (仰角%d°) =====\n', el);
fprintf('%-14s', '场景');
for i = 1:numel(radars); fprintf('%18s', radars{i}.name); end
fprintf('\n');
Rmax_rain = zeros(numel(rain_rates), 2);
for s = 1:numel(rain_rates)
    env = struct('rain_mmh',rain_rates(s),'cloud_M',0);
    fprintf('%-14s', rain_names{s});
    for i = 1:numel(radars)
        Rmax_rain(s,i) = max_range_env(radars{i}, rcs, Pd, Pfa, env, el);
        fprintf('%15.2f km', Rmax_rain(s,i)/1e3);
    end
    fprintf('\n');
end

%% --- 场景二: 雾 (轻雾0.05 / 大雾0.5 g/m3) ---
fprintf('\n===== 云雾影响 =====\n');
for M = [0.05, 0.5]
    env = struct('rain_mmh',0,'cloud_M',M);
    for i = 1:numel(radars)
        Rm = max_range_env(radars{i}, rcs, Pd, Pfa, env, el);
        fprintf(' M=%.2f g/m3  %s: R_max = %.2f km\n', M, radars{i}.name, Rm/1e3);
    end
end

%% --- 场景三: 电磁底噪 ---
fprintf('\n===== 环境电磁底噪影响 =====\n');
for city = {'business','residential','rural'}
    env = struct('rain_mmh',0,'cloud_M',0,'city_type',city{1},'emi_db',0);
    for i = 1:numel(radars)
        [dN, det] = noise_floor_db(radars{i}, env);
        fprintf(' %-12s %s: Fam=%.1f dB, 底噪抬升=%.3f dB\n', ...
                city{1}, radars{i}.name, det.Fam_db, dN);
    end
end
fprintf('-- 附加EMI档位 (business) --\n');
for emi = [0 3 6 10]
    env = struct('rain_mmh',0,'cloud_M',0,'city_type','business','emi_db',emi);
    for i = 1:numel(radars)
        Rm = max_range_env(radars{i}, rcs, Pd, Pfa, env, el);
        fprintf(' EMI=+%2ddB  %s: R_max = %.2f km\n', emi, radars{i}.name, Rm/1e3);
    end
end

%% --- 绘图 ---
fig = figure('Visible','off','Position',[100 100 1200 450]);

subplot(1,2,1); hold on; grid on;
for i = 1:2
    plot(rain_rates, Rmax_rain(:,i)/1e3, [colors{i} '-o'], 'LineWidth',1.5, ...
         'DisplayName', radars{i}.name);
end
yline(8, 'k--', '指标8km');
xlabel('雨强 (mm/h)'); ylabel('最大探测距离 (km)');
title('雨衰导致的探测距离衰减 (RCS=0.01m^2)'); legend('Location','northeast');

subplot(1,2,2); hold on; grid on;
R_km = linspace(0.3, 15, 500); R = R_km*1e3;
sty = {'-','--',':'};
s_show = [1 3 5];   % 无雨/中雨/暴雨
for i = 1:2
    rd = radars{i};
    for j = 1:numel(s_show)
        s = s_show(j);
        env = struct('rain_mmh',rain_rates(s),'cloud_M',0);
        [dN,~] = noise_floor_db(rd, env);
        snr = radar_snr(rd, R, rcs) - weather_loss_db(rd, R, el, env) - dN;
        plot(R_km, snr, [colors{i} sty{j}], ...
             'LineWidth',1.2, 'DisplayName', sprintf('%s %s', rd.name, rain_names{s}));
    end
end
yline(snr_required(Pd,Pfa), 'k-', 'SNR需求');
xlabel('距离 (km)'); ylabel('SNR (dB)');
title('SNR 随距离变化 (含气象+底噪)'); legend('Location','northeast');

print(fig, fullfile(out_dir,'env_weather_noise.png'), '-dpng', '-r150');
fprintf('\n图已保存: env_weather_noise.png\n');
