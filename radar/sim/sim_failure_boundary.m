% SIM_FAILURE_BOUNDARY  阶段B5: 低空弱小目标探测失效边界综合
% 指标定义:
%   1. 最大连续探测距离: 从近端起连续 Pd>=0.9 的最大距离
%   2. 首次零陷距离: 自由空间可检测但多径后首次跌破 Pd=0.9
%   3. 盲区比例: 0~R_max_free 范围内 Pd<0.9 的占比

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
        fullfile(proj_root,'environment'));
out_dir = fullfile(proj_root, 'results');
if ~exist(out_dir, 'dir'); mkdir(out_dir); end

Pd_req = 0.9;  Pfa = 1e-6;
snr_req = snr_required(Pd_req, Pfa);
radars = {radar_02C(), radar_03D()};
names = {'02C','03D'};

R_h = linspace(100, 15000, 1000);   % 水平距离扫描, 加密避免漏零陷

%% --- 近距盲区: 单基地脉冲雷达 R_min = c*(tau+t_sw)/2 ---
[c, ~] = radar_consts();
for i = 1:2
    rd = radars{i};
    R_min = c * (rd.pulse_width + 1e-6) / 2;   % t_sw=1us [假设], 与sim_freespace一致
    fprintf('[%s] 近距盲区半径 R_min = %.0f m (脉宽 %.1f us + 收发切换 1 us)\n', ...
        names{i}, R_min, rd.pulse_width*1e6);
end
fprintf('\n');

%% --- 边界1: RCS × 目标高度, 无雨/无EMI, 架高10m ---
rcs_list = [0.005 0.01 0.02 0.05 0.1];
ht_list  = [20 50 100 150 200 300];
h_r = 10;
env0 = struct('rain_mmh',0,'cloud_M',0,'city_type','business','emi_db',0);

fprintf('===== 边界1: 最大连续探测距离 (km), 无雨, 架高10m =====\n');
fprintf('RCS\\高度\t'); fprintf('%6dm\t', ht_list); fprintf('\n');
Rmax_b1 = zeros(numel(rcs_list), numel(ht_list), 2);
for i = 1:2
    rd = radars{i};
    for j = 1:numel(rcs_list)
        fprintf('%.3f m2\t', rcs_list(j));
        for k = 1:numel(ht_list)
            snr = composite_snr_db(rd, R_h, ht_list(k), h_r, rcs_list(j), env0);
            pd = pd_swerling1(snr, Pfa);
            Rmax_b1(j,k,i) = continuous_range(R_h, pd, Pd_req)/1e3;
            fprintf('%7.2f\t', Rmax_b1(j,k,i));
        end
        fprintf('  [%s]\n', names{i});
    end
    if i==1, fprintf('\n'); end
end

%% --- 边界2: RCS × 雨强, 目标高50m, 架高10m ---
rain_list = [0 5 12.5 25 50];
fprintf('\n===== 边界2: 最大连续探测距离 (km), 目标高50m, 架高10m =====\n');
fprintf('RCS\\雨强\t'); fprintf('%5.1f\t', rain_list); fprintf('\n');
Rmax_b2 = zeros(numel(rcs_list), numel(rain_list), 2);
for i = 1:2
    rd = radars{i};
    for j = 1:numel(rcs_list)
        fprintf('%.3f m2\t', rcs_list(j));
        for k = 1:numel(rain_list)
            env = struct('rain_mmh',rain_list(k),'cloud_M',0,...
                         'city_type','business','emi_db',0);
            snr = composite_snr_db(rd, R_h, 50, h_r, rcs_list(j), env);
            pd = pd_swerling1(snr, Pfa);
            Rmax_b2(j,k,i) = continuous_range(R_h, pd, Pd_req)/1e3;
            fprintf('%7.2f\t', Rmax_b2(j,k,i));
        end
        fprintf('  [%s]\n', names{i});
    end
    if i==1, fprintf('\n'); end
end

%% --- 边界3: RCS × EMI, 目标高50m, 架高10m ---
emi_list = [0 3 6 10];
fprintf('\n===== 边界3: 最大连续探测距离 (km), 目标高50m, 架高10m =====\n');
fprintf('RCS\\EMI\t'); fprintf('%+4ddB\t', emi_list); fprintf('\n');
Rmax_b3 = zeros(numel(rcs_list), numel(emi_list), 2);
for i = 1:2
    rd = radars{i};
    for j = 1:numel(rcs_list)
        fprintf('%.3f m2\t', rcs_list(j));
        for k = 1:numel(emi_list)
            env = struct('rain_mmh',0,'cloud_M',0,...
                         'city_type','business','emi_db',emi_list(k));
            snr = composite_snr_db(rd, R_h, 50, h_r, rcs_list(j), env);
            pd = pd_swerling1(snr, Pfa);
            Rmax_b3(j,k,i) = continuous_range(R_h, pd, Pd_req)/1e3;
            fprintf('%7.2f\t', Rmax_b3(j,k,i));
        end
        fprintf('  [%s]\n', names{i});
    end
    if i==1, fprintf('\n'); end
end

%% --- 首次零陷距离 & 盲区比例 (典型场景: RCS=0.01, 高50m, 架高10m) ---
fprintf('\n===== 多径影响指标 (RCS=0.01m2, 高50m, 架高10m) =====\n');
fprintf('%-6s %10s %10s %10s\n', '场景','零陷距离km','盲区比例%','备注');
for i = 1:2
    rd = radars{i};
    for s = 1:3
        if s==1; env=struct('rain_mmh',0,'cloud_M',0,'city_type','business','emi_db',0); tag='无雨'; end
        if s==2; env=struct('rain_mmh',12.5,'cloud_M',0,'city_type','business','emi_db',0); tag='中雨12.5'; end
        if s==3; env=struct('rain_mmh',0,'cloud_M',0,'city_type','business','emi_db',6); tag='EMI+6dB'; end

        snr_fs = radar_snr(rd, sqrt(R_h.^2+(50-10)^2), 0.01);
        % 公平比较: 自由空间SNR同样扣除近距盲区, 使"零陷距离"指多径零陷
        R_min = c * (rd.pulse_width + 1e-6) / 2;
        snr_fs(sqrt(R_h.^2+(50-10)^2) < R_min) = -999;
        snr_mp = composite_snr_db(rd, R_h, 50, 10, 0.01, env);
        pd_fs = pd_swerling1(snr_fs, Pfa);
        pd_mp = pd_swerling1(snr_mp, Pfa);

        % 首次零陷: 自由空间可检测但多径后不可检测
        null_idx = find(pd_fs >= Pd_req & pd_mp < Pd_req, 1, 'first');
        first_null = ifelse(isempty(null_idx), Inf, R_h(null_idx)/1e3);

        % 盲区比例: 0~R_max_free 内 Pd<0.9 的占比
        R_max_free = max_range(rd, 0.01, Pd_req, Pfa);
        in_range = R_h <= R_max_free;
        blind_ratio = sum(pd_mp(in_range) < Pd_req) / sum(in_range) * 100;

        fprintf('%-6s %10.2f %10.1f %10s\n', names{i}, first_null, blind_ratio, tag);
    end
end

%% --- 图: 失效边界曲线 (最大连续探测距离 vs RCS, 不同雨强) ---
fig = figure('Visible','off','Position',[80 80 1400 500]);
rcs_vec = logspace(log10(0.005), log10(0.1), 30);
ht_vec  = [20 50 100];
rain_vec = [0 12.5 25];
sty = {'-','--',':'};
for i = 1:2
    rd = radars{i};
    subplot(1,2,i); hold on; grid on;
    cmap = 'kbr';
    for r = 1:numel(rain_vec)
        env = struct('rain_mmh',rain_vec(r),'cloud_M',0,...
                     'city_type','business','emi_db',0);
        for h = 1:numel(ht_vec)
            Rmax_line = zeros(size(rcs_vec));
            for c = 1:numel(rcs_vec)
                snr = composite_snr_db(rd, R_h, ht_vec(h), 10, rcs_vec(c), env);
                pd = pd_swerling1(snr, Pfa);
                Rmax_line(c) = continuous_range(R_h, pd, Pd_req)/1e3;
            end
            plot(rcs_vec, Rmax_line, [cmap(mod(h-1,3)+1) sty{r}], 'LineWidth',1.2, ...
                 'DisplayName', sprintf('h_t=%dm, 雨%gmm/h', ht_vec(h), rain_vec(r)));
        end
    end
    set(gca,'XScale','log');
    xlabel('RCS (m^2)'); ylabel('最大连续探测距离 (km)');
    title(sprintf('%s: 失效边界 (架高10m)', names{i}));
    legend('Location','southeast','FontSize',7);
    xlim([0.005 0.1]); ylim([0 10]);
end
print(fig, fullfile(out_dir,'failure_boundary.png'), '-dpng', '-r150');
fprintf('\n图已保存: failure_boundary.png\n');

function Rmax = continuous_range(R_h, pd, Pd_req)
% 最大连续探测距离: 从近距盲区边界(首个可检测点)起连续 Pd>=Pd_req 的最大距离
    ok = pd >= Pd_req;
    first_ok = find(ok, 1, 'first');
    if isempty(first_ok)
        Rmax = 0;
        return;
    end
    first_bad = find(~ok(first_ok:end), 1, 'first');
    if isempty(first_bad)
        Rmax = R_h(end);
    else
        Rmax = R_h(first_ok + first_bad - 2);
    end
end

function out = ifelse(cond, a, b)
    if cond, out = a; else, out = b; end
end
