% SIM_NETWORK_GDOP  P5(收紧版): 组网 TDOA 定位能力演示 (代表性几何, 不做部署寻优)
%   场景: 4 节点 X1C 方阵 (±1km, 楼顶100m) 环绕 AOI 中心, 参考波形 OcuSync_58G
%   方法: 各节点按自身接收 SNR 由 CRLB 得时延σ -> TDOA 测量协方差 -> 几何解算定位误差图
%   定位误差 = sqrt(trace((H'·R^-1·H)^-1)), 含 CRLB 热噪项(不含 NLOS 系统偏差, 见 P4 结论)
%   输出: 定位误差地图 + <10m(X1C)/<20m 达标域统计  [子任务三部署寻优不在此范围]

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
        fullfile(proj_root,'environment'));
out_dir = fullfile(proj_root, 'results');
if ~exist(out_dir, 'dir'); mkdir(out_dir); end

[c, ~] = rf_consts();
wf_lib = drone_waveforms();
dev = rf_x1c();
sol = sensitivity_solve(dev, wf_lib);
env = struct('city_type','business');
wf_ref = sol.ref_wf;

% 4 节点方阵 (代表性几何, ENU m, 楼顶 100m)
nodes = [-1000 -1000 100; 1000 -1000 100; 1000 1000 100; -1000 1000 100];
N = size(nodes,1);
fprintf('===== rf P5: 组网 TDOA 定位能力演示 (4x X1C 方阵 ±1km, 楼顶100m) =====\n');
fprintf('参考波形 %s, SNR_req=%.1fdB, Gp=%.1fdB\n\n', wf_ref.name, sol.SNR_req_base, sol.Gp);

%% 目标栅格 (固定高度 100m 平面)
xg = linspace(-2500, 2500, 81);
yg = linspace(-2500, 2500, 81);
[Xg, Yg] = meshgrid(xg, yg);
h_t = 100;

%% 逐栅格: 各节点 SNR -> σ_R -> TDOA 协方差 -> 定位误差
sigR = zeros(N, numel(Xg));             % 各节点单站距离等效时延误差 (m)
inside = true(numel(Xg),1);
for n = 1:N
    R_n = sqrt((Xg-nodes(n,1)).^2 + (Yg-nodes(n,2)).^2 + (h_t-nodes(n,3)).^2);
    snr_ant = rx_power_dbm(dev, wf_ref, R_n) - rx_noise_dbm(dev);
    snr_eff = snr_ant + sol.Gp;
    [~, sR] = crlb_sigma_t(wf_ref, snr_eff);   % CRLB σ_R (m)
    sigR(n,:) = reshape(sR, 1, []);
end

Err = zeros(size(Xg));
for ii = 1:numel(Xg)
    xt = [Xg(ii), Yg(ii), h_t];
    d = sqrt(sum((nodes - xt).^2, 2));
    u = (nodes - xt)./d;                    % 各节点单位视线向量
    % 2D 水平定位误差(部署关心口径): 4节点与目标同面时 3D 的 z 不可观(奇异),
    % 取 x/y 分量解 2x2 法方程, 得水平定位误差 RMS (m)
    H2 = [u(2:end,1)-u(1,1), u(2:end,2)-u(1,2)];   % TDOA 雅可比水平分量 (N-1 x 2)
    Rm = diag(sigR(2:end,ii).^2 + sigR(1,ii)^2);   % TDOA 测量协方差
    C = (H2' / Rm * H2);                    % 信息矩阵 J'·R^-1·J, 2x2
    % 定位协方差 = inv(C); 误差 = sqrt(trace(inv(C))). 漏 inv 会使差几何区虚假变小!
    if abs(det(C)) < 1e-12                  % 节点位置处奇异(同面共线)
        Err(ii) = NaN;
    else
        Err(ii) = sqrt(trace(inv(C)));      % 水平定位误差 RMS (m)
    end
end
Err = reshape(Err, size(Xg));

%% 统计
err10 = mean(Err(:) < 10);
err20 = mean(Err(:) < 20);
fprintf('--- 定位误差统计 (4x X1C 方阵, 目标高度100m, CRLB项) ---\n');
fprintf('  误差中位数 = %.1f m (节点位置处无定义, 已排除)\n', median(Err(:),'omitnan'));
fprintf('  <10m (X1C 指标) 区域占比 = %.1f%%\n', 100*err10);
fprintf('  <20m (X1B 指标) 区域占比 = %.1f%%\n', 100*err20);
fprintf('  注: 不含 NLOS 系统偏差(P4 已示其主导性); 部署寻优属子任务三\n');

%% 绘图
fig = figure('Visible','off','Position',[100 100 950 480]);
imagesc(xg/1e3, yg/1e3, Err); set(gca,'YDir','normal'); axis equal tight;
colormap(parula); colorbar; caxis([0 30]); hold on;
contour(xg/1e3, yg/1e3, Err, [10 10], 'w-', 'LineWidth', 1.5);
contour(xg/1e3, yg/1e3, Err, [20 20], 'w--', 'LineWidth', 1.2);
plot(nodes(:,1)/1e3, nodes(:,2)/1e3, 'r^', 'MarkerFaceColor','r', 'MarkerSize',9);
text(0, 2.35, sprintf('白实线<10m: %.0f%%  |  白虚线<20m: %.0f%%', 100*err10, 100*err20), ...
    'Color','k', 'FontSize',9, 'HorizontalAlignment','center', 'FontWeight','bold');
xlabel('东 (km)'); ylabel('北 (km)');
title('4x X1C 方阵 TDOA 定位误差 (OcuSync\_58G, CRLB 项)');
print(fig, fullfile(out_dir,'network_gdop_map.png'), '-dpng', '-r150');

fprintf('\n图件: network_gdop_map.png\n');
fprintf('\n===== P5 GDOP 能力演示完成 =====\n');
