% SIM_FREESPACE  阶段一: 自由空间探测性能仿真与 8km 指标验证
% 验证 02C / 03D 在自由空间下对小型无人机 (RCS=0.01m2, Swerling I)
% 的最大探测距离 >= 8km, 并量化近距盲区与覆盖包络

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'));
out_dir = fullfile(proj_root, 'results');
if ~exist(out_dir, 'dir'); mkdir(out_dir); end

[c, ~] = radar_consts();

%% 目标与检测条件 [假设]
rcs_targets = [0.005, 0.01, 0.05];   % 小型无人机典型RCS (m2)
rcs_design  = 0.01;                  % 设计RCS
Pfa = 1e-6;  Pd_req = 0.9;

radars = {radar_02C(), radar_03D()};
snr_req_db = snr_required(Pd_req, Pfa);
fprintf('Swerling I, Pd=%.1f, Pfa=%.0e -> 所需相干SNR = %.2f dB\n\n', ...
        Pd_req, Pfa, snr_req_db);

%% 逐型雷达计算
results_tab = {};
for i = 1:numel(radars)
    rd = radars{i};

    % 最大探测距离 (设计RCS)
    Rmax = max_range(rd, rcs_design, Pd_req, Pfa);

    % 近距盲区: 发射脉冲遮蔽 + 收发切换 [假设切换时间1us]
    t_sw  = 1e-6;
    R_min = c * (rd.pulse_width + t_sw) / 2;

    % 不模糊距离 (PRF限制)
    R_unamb = c / (2*rd.prf);

    % 方位波束驻留与可用脉冲数校核
    % 由增益估算波束宽度: G ~ 26000/(az_bw*el_bw) [假设el波束宽度]
    el_bw = (rd.el_cov(2)-rd.el_cov(1)) / rd.el_beams;
    az_bw = 26000 / (10^(rd.Gt/10) * el_bw);
    dwell_s     = az_bw/360 * rd.data_rate;
    n_avail     = floor(dwell_s * rd.prf);

    fprintf('===== %s 三坐标雷达 (%s 波段) =====\n', rd.name, rd.band);
    fprintf(' 最大探测距离 R_max = %.2f km  (指标 >= %.1f km)  [%s]\n', ...
            Rmax/1e3, rd.R_spec/1e3, passfail(Rmax >= rd.R_spec));
    fprintf(' 近距盲区 R_min    = %.0f m\n', R_min);
    fprintf(' 不模糊距离 R_unamb = %.1f km  [%s]\n', ...
            R_unamb/1e3, passfail(R_unamb >= Rmax));
    fprintf(' 方位波束宽度 ~%.2f deg, 驻留 %.1f ms, 可用脉冲 %d (需>=%d) [%s]\n', ...
            az_bw, dwell_s*1e3, n_avail, rd.n_pulses, passfail(n_avail >= rd.n_pulses));
    for rcs = rcs_targets
        fprintf('   RCS=%.3f m2: R_max = %.2f km\n', ...
                rcs, max_range(rd, rcs, Pd_req, Pfa)/1e3);
    end
    fprintf('\n');
    results_tab{end+1} = rd;
end

%% 绘图: SNR 与 Pd 随距离变化
R_km = linspace(0.3, 15, 500);  R = R_km*1e3;
colors = {'b', 'r'};
fig1 = figure('Visible','off','Position',[100 100 1200 450]);

subplot(1,2,1); hold on; grid on;
for i = 1:numel(radars)
    rd = radars{i};
    plot(R_km, radar_snr(rd, R, rcs_design), colors{i}, 'LineWidth', 1.5, ...
         'DisplayName', sprintf('%s (%s波段)', rd.name, rd.band));
end
yline(snr_req_db, 'k--', 'SNR需求', 'LineWidth', 1);
xlabel('距离 (km)'); ylabel('相干积累后 SNR (dB)');
title('SNR 随距离变化 (RCS=0.01m^2)'); legend('Location','northeast');

subplot(1,2,2); hold on; grid on;
for i = 1:numel(radars)
    rd = radars{i};
    pd = pd_swerling1(radar_snr(rd, R, rcs_design), Pfa);
    plot(R_km, pd, colors{i}, 'LineWidth', 1.5, ...
         'DisplayName', sprintf('%s (%s波段)', rd.name, rd.band));
end
yline(Pd_req, 'k--', 'Pd=0.9', 'LineWidth', 1);
xlabel('距离 (km)'); ylabel('检测概率 P_d');
title('检测概率随距离变化 (Swerling I)'); legend('Location','southwest');
ylim([0 1.02]);

print(fig1, fullfile(out_dir,'freespace_snr_pd.png'), '-dpng', '-r150');

%% 绘图: 距离-高度覆盖包络
fig2 = figure('Visible','off','Position',[100 100 700 500]); hold on; grid on;
for i = 1:numel(radars)
    rd = radars{i};
    Rmax = max_range(rd, rcs_design, Pd_req, Pfa)/1e3;
    el_max = rd.el_cov(2);
    % 包络: 斜距限制与俯仰上限限制
    th = linspace(0, deg2rad(el_max), 100);
    % 俯仰上限射线
    plot([0 Rmax*cos(deg2rad(el_max))], [0 Rmax*sin(deg2rad(el_max))], ...
         [colors{i} '--'], 'LineWidth', 1);
    % 距离圆弧
    plot(Rmax*cos(th), Rmax*sin(th), colors{i}, 'LineWidth', 1.5, ...
         'DisplayName', sprintf('%s: R_{max}=%.2fkm, 俯仰0-%d°', ...
         rd.name, Rmax, el_max));
end
xlabel('水平距离 (km)'); ylabel('高度 (km)');
title('自由空间探测包络 (RCS=0.01m^2)'); legend('Location','northeast');
xlim([0 12]); ylim([0 8]);
print(fig2, fullfile(out_dir,'freespace_coverage.png'), '-dpng', '-r150');

fprintf('图已保存至 %s\n', out_dir);

function s = passfail(ok)
    if ok, s = '通过'; else, s = '不满足'; end
end
