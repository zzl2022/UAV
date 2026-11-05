% SIM_COMPOSITE_PD  P5(收紧版): 单节点全因子 Pd 总图  [对标 radar/composite_pd_map]
%   场景: X1B 楼顶架设(AOI中心, 140m), 东向方位, R-H 二维栅格
%   全因子: 自由空间链路 + 环境噪声(P.372+拥塞) + city_los 遮挡/衍射 + NLOS峡谷超量
%           + FHSS 捕获(≈1) + 静默权重(=0)
%   输出: 威胁画像加权平均 Pd 图(总成果图) + 覆盖统计
%   口径: Pd_avg = Σ wt_w · Pd_w; 覆盖判据 Pd_avg >= 0.9·(1-wt_静默)=0.855
%         即"非静默威胁以90%概率检出"

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
        fullfile(proj_root,'environment'));
out_dir = fullfile(proj_root, 'results');
if ~exist(out_dir, 'dir'); mkdir(out_dir); end

wf_lib = drone_waveforms();
dev = rf_tdoa_x1b();
sol = sensitivity_solve(dev, wf_lib);
env = struct('city_type','business');
city = city_load();
fprintf('===== rf P5: 单节点全因子 Pd 总图 (X1B 楼顶140m, 东向) =====\n');
fprintf('城市: %d 栋建筑, 参考波形 %s\n\n', city.buildings.n, sol.ref_wf.name);

%% 栅格: 水平距离 x 目标高度 (海拔)
az = 0;                                   % 东向 [代表方位]
R_h = 100:100:5000;                       % 水平距离 (m)
H_t = 20:10:300;                          % 目标高度 (m, 海拔)
[Rg, Hg] = meshgrid(R_h, H_t);
p_r = [0, 0, 140];                        % 接收节点 (楼顶)

%% LOS/衍射查询 (每栅格点一次, 衍射用 2.4G 代表频点)
fprintf('LOS 查询中... (%d 点)\n', numel(Rg));
is_los = false(size(Rg));  L_diff = zeros(size(Rg));
for ii = 1:numel(Rg)
    p_t = [Rg(ii)*cosd(az), Rg(ii)*sind(az), Hg(ii)];
    [vis, hit, Ld] = city_los(p_r, p_t, city, 2.4e9);
    is_los(ii) = vis;
    if ~vis; L_diff(ii) = Ld; end
end
fprintf('LOS 比例: %.1f%% (楼顶140m 东向)\n', 100*mean(is_los(:)));

%% 逐波形 Pd 并加权
wt = [wf_lib.wt];
Pd_avg = zeros(size(Rg));
fprintf('波形加权 Pd 计算...\n');
for w = 1:numel(wf_lib)
    wf = wf_lib(w);
    snr_eff = zeros(size(Rg));
    for ii = 1:numel(Rg)
        s = composite_snr_env(dev, wf, Rg(ii), env, is_los(ii), L_diff(ii));
        if isinf(s) && s < 0; snr_eff(ii) = -999; else; snr_eff(ii) = s + sol.Gp; end
    end
    [pe,~] = fhss_detection_prob(wf, 0.1);
    Pd_avg = Pd_avg + wt(w) * pe * detection_prob(snr_eff, dev.Pfa);
    fprintf('  %-16s wt=%.2f  完成\n', wf.name, wt(w));
end

%% 覆盖统计
Pd_th = 0.9 * (1 - wt(strcmp({wf_lib.name},'Silent')));
cov = mean(Pd_avg(:) >= Pd_th);
fprintf('\n--- 覆盖统计 (X1B 单节点, 东向 R-H 剖面) ---\n');
fprintf('  加权 Pd 判据: >= %.3f (非静默威胁 90%% 检出)\n', Pd_th);
fprintf('  覆盖率 = %.1f%%\n', 100*cov);
% 分高度层覆盖
for h_sel = [50 100 200]
    row = abs(H_t - h_sel) < 5;
    fprintf('  高度层 %3dm: 覆盖 %.1f%%\n', h_sel, 100*mean(Pd_avg(row,:) >= Pd_th, 'all'));
end

%% 绘图
fig = figure('Visible','off','Position',[100 100 950 480]);
imagesc(R_h/1e3, H_t, Pd_avg); set(gca,'YDir','normal');
colormap(jet); colorbar; caxis([0 0.95]);
hold on;
contour(R_h/1e3, H_t, Pd_avg, [Pd_th Pd_th], 'w-', 'LineWidth', 1.5);
xlabel('水平距离 (km)'); ylabel('目标高度 (m, 海拔)');
title(sprintf('X1B 单节点加权 Pd (东向, 商业区, 覆盖%.0f%%)', 100*cov));
print(fig, fullfile(out_dir,'composite_pd_map.png'), '-dpng', '-r150');

fprintf('\n图件: composite_pd_map.png (白线为 Pd=%.2f 覆盖边界)\n', Pd_th);
fprintf('\n===== P5 全因子 Pd 总图完成 =====\n');
