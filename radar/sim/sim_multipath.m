% SIM_MULTIPATH  阶段B3: 地面多径对低空探测的影响
% 输出: 距离-高度二维检测覆盖图(多径波瓣/零陷空洞)
%       不同架设高度下的低空盲区半径 -> 支撑部署规则提炼

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
        fullfile(proj_root,'environment'));
out_dir = fullfile(proj_root, 'results');
if ~exist(out_dir, 'dir'); mkdir(out_dir); end

rcs = 0.01;  Pd_req = 0.9;  Pfa = 1e-6;
snr_req = snr_required(Pd_req, Pfa);
radars = {radar_02C(), radar_03D()};

R  = linspace(200, 12000, 400);      % 水平距离 m
Ht = linspace(5, 400, 200);          % 目标高度 m

%% --- 图1: 距离-高度 Pd 覆盖图 (h_r=10m) ---
h_r0 = 10;
fig1 = figure('Visible','off','Position',[80 80 1300 520]);
for i = 1:2
    rd = radars{i};
    Htc = Ht(:);                                   % 列向量
    slant = sqrt(R.^2 + (Htc - h_r0).^2);
    el    = atan2d(Htc - h_r0, R);                      % [Ht x R]
    snr0  = radar_snr(rd, slant, rcs);                 % 自由空间
    Fdb   = multipath_factor_db(rd, R, Htc, h_r0, []);
    pd    = pd_swerling1(snr0 + Fdb, Pfa);
    pd(el < rd.el_cov(1) | el > rd.el_cov(2)) = 0;     % 俯仰覆盖限制

    subplot(1,2,i);
    imagesc(R/1e3, Ht, pd); set(gca,'YDir','normal');
    colormap(flipud(gray)); caxis([0 1]); colorbar;
    hold on;
    contour(R/1e3, Ht, pd, [Pd_req Pd_req], 'r', 'LineWidth', 1.5);
    xlabel('水平距离 (km)'); ylabel('目标高度 (m)');
    title(sprintf('%s: P_d 覆盖图 (架设高度%dm, 红线Pd=0.9)', rd.name, h_r0));
end
print(fig1, fullfile(out_dir,'multipath_coverage.png'), '-dpng', '-r150');

%% --- 图2: 架设高度对低空盲区的影响 (目标高50m) ---
% 指标: 多径首次零陷距离 = 自由空间本可检测(Pd>=0.9) 但 多径后Pd<0.9 的第一个空洞
h_target = 50;
h_r_list = [3 10 25];
sty = {'-','--',':'};
fig2 = figure('Visible','off','Position',[80 80 1300 450]);
null_tab = zeros(2, numel(h_r_list));   % 首次零陷距离 km
for i = 1:2
    rd = radars{i};
    subplot(1,2,i); hold on; grid on;
    for j = 1:numel(h_r_list)
        h_r = h_r_list(j);
        slant = sqrt(R.^2 + (h_target-h_r)^2);
        el = atan2d(h_target-h_r, R);
        snr_fs = radar_snr(rd, slant, rcs);
        snr_mp = snr_fs + multipath_factor_db(rd, R, h_target, h_r, []);
        pd_fs = pd_swerling1(snr_fs, Pfa);
        pd_mp = pd_swerling1(snr_mp, Pfa);
        pd_fs(el > rd.el_cov(2)) = 0; pd_mp(el > rd.el_cov(2)) = 0;
        plot(R/1e3, pd_mp, sty{j}, 'LineWidth',1.3, ...
             'DisplayName', sprintf('架高%dm', h_r));
        % 多径零陷点: pd_fs>=req 但 pd_mp<req
        null_idx = find(pd_fs >= Pd_req & pd_mp < Pd_req, 1, 'first');
        if ~isempty(null_idx)
            null_tab(i,j) = R(null_idx)/1e3;
        else
            null_tab(i,j) = Inf;   % 无零陷
        end
    end
    yline(Pd_req,'r--','Pd=0.9');
    xlabel('水平距离 (km)'); ylabel('P_d');
    title(sprintf('%s: 多径Pd起伏 (目标高%dm)', rd.name, h_target));
    legend('Location','northeast'); ylim([0 1.02]);
end
print(fig2, fullfile(out_dir,'multipath_blindzone.png'), '-dpng', '-r150');

fprintf('===== 多径首次零陷距离 (自由空间可检测, 多径后跌破Pd=0.9) =====\n');
fprintf('%-6s %8s %8s %8s\n', '雷达','架高3m','架高10m','架高25m');
for i = 1:2
    vals = null_tab(i,:); vals(isinf(vals)) = nan;
    fprintf('%-6s %7.2fkm %7.2fkm %7.2fkm\n', radars{i}.name, vals);
end

%% --- 表3: 低空盲区半径 = 俯仰覆盖限制(不借助多径)近似低仰角空白区 ---
fprintf('\n===== 低空盲区半径 (纯几何: 俯仰下限0°, 目标高50m) =====\n');
for i = 1:2
    rd = radars{i};
    for h_r = h_r_list
        % 俯仰波束宽度 = 覆盖范围/波位数; 波束下限 ≈ 波宽/2 (假设 -3dB 边界)
        el_bw = (rd.el_cov(2)-rd.el_cov(1)) / rd.el_beams;
        el_min = el_bw/2;
        r_geom = (h_target - h_r) / tan(deg2rad(el_min));  % 近距几何盲区
        fprintf(' %s 架高%dm: 俯仰波宽%.2f°, 波束下限%.2f°, 几何盲区≈%.2fkm\n', ...
                rd.name, h_r, el_bw, el_min, r_geom/1e3);
    end
end
fprintf('图已保存: multipath_coverage.png, multipath_blindzone.png\n');
