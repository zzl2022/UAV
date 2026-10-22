% SIM_ENVIRONMENT  P3: 城区环境机制 (L2 NLOS超量损耗 / L3 分频段噪声 / L4 多径TDOA偏差)
% 量化三型设备在城区复杂环境下:
%   L3  噪声底分解(热噪+P.372人为噪声+公共频段拥塞), 频段差异;
%   L2  NLOS 超量损耗导致的侦测距离收缩(对比自由空间);
%   L4  NLOS 多径超量路径引发的 TDOA 偏差与定位误差(对标 <20m/<10m 指标).

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
        fullfile(proj_root,'environment'));
out_dir = fullfile(proj_root, 'results');
if ~exist(out_dir, 'dir'); mkdir(out_dir); end

[c, ~] = rf_consts();
wf_lib = drone_waveforms();
devs  = {rf_tdoa_x1b(), rf_oa_x1bmini(), rf_x1c()};
env_b = struct('city_type','business');       % 商业区基准场景

% 复用 P2 灵敏度反推(门限 SNR_ant = SNR_ant_mid)
sols = cell(1, numel(devs));
for i = 1:numel(devs); sols{i} = sensitivity_solve(devs{i}, wf_lib); end

fprintf('===== rf P3: 城区环境机制 (business 场景) =====\n\n');

%% --- L3: 噪声底分解 (各波形频段) ---
fprintf('--- L3 噪声底分解 (商业区, 设备 X1C) ---\n');
fprintf('%-16s %-9s %-8s %-8s %-8s %-9s\n', ...
    '波形','热噪','P.372','拥塞','串扰','N_env');
d3 = devs{3};
for w = 1:numel(wf_lib)
    wf = wf_lib(w);
    if strcmp(wf.name,'Silent'); continue; end
    [N_env, det] = rx_noise_env_dbm(d3, wf, env_b);
    fprintf('%-16s %-8.1f %-7.1f %-7.1f %-7.1f %-8.1f dBm\n', ...
        wf.name, det.N_th, det.dN_manmade, det.emi_db, det.co_site, N_env);
end
fprintf('  (高频段人为噪声≈0, 2.4/5.8G 拥塞为主增量; 900M专用频段噪声增量最小)\n\n');

%% --- L2: NLOS 侦测距离收缩 (对比自由空间) ---
fprintf('--- L2 NLOS 侦测距离收缩 (参考波形 OcuSync_58G, 商业区峡谷) ---\n');
fprintf('%-12s %-10s %-10s %-10s %-10s\n','设备','R_max_空旷','R_max_NLOS','收缩率','门限SNR');
Rg = (50:50:8000);
for i = 1:numel(devs)
    wf_ref = sols{i}.ref_wf;
    thr = sols{i}.SNR_ant_mid;                      % 检测门限(天线端SNR)
    snr_los  = arrayfun(@(r) composite_snr_env(devs{i}, wf_ref, r, env_b, true,  0), Rg);
    snr_nlos = arrayfun(@(r) composite_snr_env(devs{i}, wf_ref, r, env_b, false, 0), Rg);
    R_free = r_max_freespace(devs{i}, wf_ref, sols{i}.Pmin_eff);
    % NLOS R_max: SNR_env>=thr 的最大R
    ok = find(snr_nlos >= thr);
    if isempty(ok); R_nlos = 0; else R_nlos = Rg(ok(end)); end
    fprintf('%-12s %-9.2fkm %-9.2fkm %-9.1f%% %-9.1fdB\n', ...
        devs{i}.name, R_free/1e3, R_nlos/1e3, 100*R_nlos/R_free, thr);
end
fprintf('  (NLOS 峡谷超量使侦测距离收缩至 1/5~1/8; 补盲需多站/楼顶架设恢复 LOS)\n\n');

%% --- L4: TDOA 多径偏差与定位误差 ---
fprintf('--- L4 NLOS 多径 TDOA 偏差与定位误差 (商业区) ---\n');
fprintf('%-10s %-10s %-12s %-12s %-12s\n','距离','Δd超量','bias_R','CRLB σ_R','合成误差');
Rc = [500, 1000, 2000, 4000];
wf_ref = sols{1}.ref_wf;
snr_eff_15 = 15;                                    % 近距 15dB 处理后SNR(代表)
[~, sR15] = crlb_sigma_t(wf_ref, snr_eff_15);
for R = Rc
    [bR, ~] = multipath_tdoa_bias(R, env_b, false);   % NLOS 偏差
    fprintf('%-9.1fkm %-9.0fm %-11.1fm %-11.2fm %-11.1fm\n', ...
        R/1e3, bR, bR, sR15, bR + sR15);
end
fprintf('  (NLOS 偏差随距离线性增长, 4km 处达 80m >> 指标20m; LOS 时偏差=0, 仅 CRLB σ_R≈%.1fm)\n', sR15);
fprintf('  -> 指标 <20m/<10m 需 LOS 为主的站址几何; NLOS 区域靠多站冗余+剔除偏差站\n\n');

%% --- 图件 ---
% (a) SNR_env vs R: LOS vs NLOS (X1B 参考波形, 商业区) + 门限
fig1 = figure('Visible','off','Position',[100 100 1000 420]); hold on; grid on;
R_km = linspace(0.1, 8, 400);  R = R_km*1e3;
wf_ref = sols{1}.ref_wf;  thr1 = sols{1}.SNR_ant_mid;
snr_los  = arrayfun(@(r) composite_snr_env(devs{1}, wf_ref, r, env_b, true, 0), R);
snr_nlos = arrayfun(@(r) composite_snr_env(devs{1}, wf_ref, r, env_b, false,0), R);
plot(R_km, snr_los,  'b-', 'LineWidth',1.5, 'DisplayName','LOS (通视)');
plot(R_km, snr_nlos, 'r-', 'LineWidth',1.5, 'DisplayName','NLOS (峡谷遮挡)');
plot(R_km([1 end]), [thr1 thr1], 'k--', 'LineWidth',1, 'HandleVisibility','off');
text(0.2, thr1+0.6, sprintf('门限 %.1fdB', thr1), 'Color','k');
xlabel('距离 (km)'); ylabel('天线端 SNR (dB)');
title(sprintf('X1B 参考波形 SNR: LOS vs NLOS (商业区, %s)', wf_ref.name));
legend('Location','northeast'); xlim([0 8]); ylim([-15 30]);
print(fig1, fullfile(out_dir,'env_snr_los_nlos.png'), '-dpng', '-r150');

% (b) 噪声底组成堆叠 (各波形, 商业区, X1C)
fig2 = figure('Visible','off','Position',[100 100 1000 420]); hold on; grid on;
wnames=[]; Nth=[]; dNm=[]; emi=[];
for w = 1:numel(wf_lib)
    wf = wf_lib(w);  if strcmp(wf.name,'Silent'); continue; end
    [~, det] = rx_noise_env_dbm(devs{3}, wf, env_b);
    wnames=[wnames, {wf.name}];  Nth=[Nth det.N_th];
    dNm=[dNm det.dN_manmade];  emi=[emi det.emi_db];
end
b = bar([Nth(:)-(-174) dNm(:) emi(:)], 'stacked');
set(gca,'XTickLabel',wnames,'XTickLabelRotation',30);
xlabel('无人机波形(频段)'); ylabel('噪声增量 (dB, 相对 -174dBm/Hz)');
title('噪声底组成 (商业区, X1C): 热噪+P.372+拥塞');
legend('热噪(NF)','P.372人为噪声','拥塞','Location','northwest');
print(fig2, fullfile(out_dir,'env_noise_composition.png'), '-dpng', '-r150');

% (c) TDOA 偏差与定位误差 vs 距离
fig3 = figure('Visible','off','Position',[100 100 1000 420]); hold on; grid on;
Rd = linspace(0.2, 6, 300);
bR = arrayfun(@(r) multipath_tdoa_bias(r, env_b, false), Rd);
plot(Rd, bR, 'r-', 'LineWidth',1.5, 'DisplayName','NLOS偏差 bias\_R');
plot(Rd, bR+sR15, 'r--', 'LineWidth',1.2, 'DisplayName','合成(bias+\sigma_R)');
plot(Rd, zeros(size(Rd)), 'b:', 'LineWidth',1.2, 'DisplayName','LOS偏差=0');
yline(20, 'k-', '指标20m', 'LineWidth',1, 'HandleVisibility','off');
yline(10, 'k:', '指标10m', 'LineWidth',1, 'HandleVisibility','off');
xlabel('距离 (km)'); ylabel('定位误差 (m)');
title('TDOA 定位误差 vs 距离 (商业区, 单站时差)'); legend('Location','northwest');
ylim([0 150]);
print(fig3, fullfile(out_dir,'env_tdoa_bias.png'), '-dpng', '-r150');

fprintf('图件: env_snr_los_nlos.png / env_noise_composition.png / env_tdoa_bias.png\n');
fprintf('\n===== P3 环境机制完成: NLOS/噪声/多径 TDOA 三机制量化就绪 =====\n');
