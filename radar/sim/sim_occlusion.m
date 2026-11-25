% SIM_OCCLUSION  D2阶段验证: 建筑遮挡模块
% 内容: 楼顶/车载两典型架设的遮蔽角图, 100m高度层可见性热力图,
%       衍射损耗示例, LOS查询性能基准

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
        fullfile(proj_root,'environment'));
out_dir = fullfile(proj_root, 'results');
data_dir = fullfile(proj_root, 'data');

%% --- 加载城市 ---
city = city_load(data_dir);
fprintf('城市数据加载完成: %d 栋建筑, DEM范围 %.0f~%.0f m\n', ...
    city.buildings.n, min(city.dem.Z(:)), max(city.dem.Z(:)));

%% --- 两个典型雷达架设位置 ---
% 雷达A: 楼顶架设, AOI中心, 架高30m(等效约10层楼顶)
xA = 0;   yA = 0;
zA = interp2(city.dem.x, city.dem.y, city.dem.Z, xA, yA) + 30;
pA = [xA yA zA];
fprintf('雷达A(楼顶): (%.0f, %.0f, %.1f) m\n', pA);

% 雷达B: 车载架设, 东北侧, 架高3m
xB = 2500;  yB = -1000;
zB = interp2(city.dem.x, city.dem.y, city.dem.Z, xB, yB) + 3;
pB = [xB yB zB];
fprintf('雷达B(车载): (%.0f, %.0f, %.1f) m\n', pB);

%% --- 遮蔽角图(1度分辨率) ---
maskA = city_mask_map(pA, city);
maskB = city_mask_map(pB, city);
az_deg = (0:359).';

fprintf('\n雷达A平均遮蔽角: %.2f 度, 最大: %.2f 度\n', mean(maskA), max(maskA));
fprintf('雷达B平均遮蔽角: %.2f 度, 最大: %.2f 度\n', mean(maskB), max(maskB));

%% --- 100m高度层可见性热力图(雷达A, 100m栅格) ---
fprintf('\n计算多高度层可见性(200m粗栅格)...\n');
Xg2 = -4800:200:4800;
Yg2 = -2700:200:2700;
[Xm2, Ym2] = meshgrid(Xg2, Yg2);
h_scan = [60 100 150 200 300];
vis_rate = zeros(size(h_scan));
vis_maps = cell(size(h_scan));
for hi = 1:numel(h_scan)
    vm = false(size(Xm2));
    for r = 1:numel(Xm2)
        vm(r) = city_los(pA, [Xm2(r) Ym2(r) h_scan(hi)], city);
    end
    vis_maps{hi} = vm;
    vis_rate(hi) = sum(vm(:))/numel(vm)*100;
    fprintf('  目标高度 %dm: 可见率 %.1f%%\n', h_scan(hi), vis_rate(hi));
end

%% --- 代表点LOS调试 ---
fprintf('\n代表点LOS判定(雷达A @%.0fm):\n', zA);
chk = [500 0 100; 1000 0 100; 500 0 150; 1000 0 200; -1000 0 300; 3000 500 100];
for k = 1:size(chk,1)
    [v, h] = city_los(pA, chk(k,:), city);
    if v
        fprintf('  (%.0f,%.0f,%.0f): 通视\n', chk(k,:));
    else
        fprintf('  (%.0f,%.0f,%.0f): 遮挡于 %s (楼高%.0fm, 视线该处%.0fm)\n', ...
            chk(k,:), city.buildings.name{h.id}, city.buildings.height(h.id), h.z_line);
    end
end

%% --- LOS性能基准(随机500点) ---
rng(42);
n_bench = 500;
R_b = 500 + 8000*rand(n_bench,1);
az_b = 360*rand(n_bench,1) - 180;
p_list = [pA(1)+R_b.*sind(az_b), pA(2)+R_b.*cosd(az_b), 100*ones(n_bench,1)];
tic;
for k = 1:n_bench
    city_los(pA, p_list(k,:), city);
end
t_bench = toc;
fprintf('\nLOS性能基准: %.2f ms/查询 (500次)\n', t_bench/n_bench*1e3);

%% --- 衍射损耗示例 ---
% 找一个被遮挡的目标点, 计算衍射后的等效SNR
p_t = [3000, 500, 100];
[vis, hit] = city_los(pA, p_t, city);
fprintf('\n衍射示例: 目标 (%.0f, %.0f, %.0f)\n', p_t);
if ~vis
    b_id = hit.id;
    bx = city.buildings.enu_x{b_id};
    by = city.buildings.enu_y{b_id};
    cx = mean(bx);  cy = mean(by);
    d1 = hypot(cx-pA(1), cy-pA(2));
    d2 = hypot(p_t(1)-cx, p_t(2)-cy);
    % 视线在刃峰处的等效高度
    t_ratio = d1/(d1+d2);
    z_line_at = pA(3) + (p_t(3)-pA(3))*t_ratio;
    h_eff = city.z_top(b_id) - z_line_at;
    for nm = {'02C','03D'}
        cfg = eval(['radar_', nm{1}, '()']);
        L_d = diffraction_loss_db(h_eff, d1, d2, cfg.fc);
        R_slant = hypot(hypot(p_t(1)-pA(1), p_t(2)-pA(2)), p_t(3)-pA(3));
        snr0 = radar_snr(cfg, R_slant, 0.01);
        fprintf('  [%s] 遮挡建筑: %s(%.0fm高), h_eff=%.1fm, 衍射损耗=%.1fdB, ', ...
            nm{1}, city.buildings.name{b_id}, city.buildings.height(b_id), h_eff, L_d);
        fprintf('SNR=%.1f -> %.1f dB (需21.1dB)\n', snr0, snr0-L_d);
    end
else
    fprintf('  该目标通视, 无衍射\n');
end

%% --- 绘图 ---
fig = figure('Visible','off','Position',[60 60 1500 950]);

% 遮蔽角极坐标图
subplot(2,3,1);
theta = az_deg * pi/180;
polaraxes; hold on;
polarplot(theta, maskA, 'r-', 'LineWidth', 1);
title('雷达A(楼顶30m) 遮蔽角图');

subplot(2,3,2);
polaraxes; hold on;
polarplot(theta, maskB, 'b-', 'LineWidth', 1);
title('雷达B(车载3m) 遮蔽角图');

% 高度层可见性热力图(雷达A, 100m与200m两层)
subplot(2,3,3);
imagesc(Xg2, Yg2, double(~vis_maps{2}));
axis image; colormap([0.85 0.9 0.85; 0.9 0.3 0.3]);
hold on;
plot(pA(1), pA(2), 'k^', 'MarkerFaceColor','k', 'MarkerSize', 10);
xlabel('东 (m)'); ylabel('北 (m)');
title(sprintf('100m高度层可见性 (绿=可见, %.1f%%)', vis_rate(2)));

% 高度-可见率规律
subplot(2,3,5);
bar(h_scan, vis_rate);
xlabel('目标高度 (m)'); ylabel('可见率 (%)');
title('雷达A: 目标高度-可见率规律');
grid on;

% 遮蔽角直方图对比
subplot(2,3,4);
histogram(maskA, 0:1:40, 'FaceColor','r', 'FaceAlpha',0.6); hold on;
histogram(maskB, 0:1:40, 'FaceColor','b', 'FaceAlpha',0.6);
xlabel('遮蔽角 (度)'); ylabel('方位bin数');
legend('雷达A(楼顶)', '雷达B(车载)');
title('遮蔽角分布对比');
grid on;

% 东北向剖面的遮挡细节
subplot(2,3,6);
az_sel = 45;
R_line = 0:50:6000;
xl = pA(1) + R_line.*sind(az_sel);
yl = pA(2) + R_line.*cosd(az_sel);
vis_line = false(size(R_line));
z_line = zA + (100 - zA) * R_line / hypot(xl(end)-pA(1), yl(end)-pA(2));
hold on;
% 画视线
plot(R_line/1e3, z_line, 'g-', 'LineWidth', 1.5);
% 画遮挡建筑
for k = 1:numel(R_line)
    vis_line(k) = city_los(pA, [xl(k) yl(k) 100], city);
end
bad = find(~vis_line);
if ~isempty(bad)
    for k = bad
        hit2 = [];
        [vv, hit2] = city_los(pA, [xl(k) yl(k) 100], city);
        if ~vv
            plot(R_line(k)/1e3, city.z_top(hit2.id), 'r.', 'MarkerSize', 12);
        end
    end
end
xlabel('距离 (km)'); ylabel('高度 (m)');
title('东北45度剖面: 视线与遮挡建筑');
legend('视线(至100m目标)', '遮挡建筑顶', 'Location','northwest');
grid on;

print(fig, fullfile(out_dir, 'occlusion_results.png'), '-dpng', '-r150');
fprintf('\n图已保存: occlusion_results.png\n');
fprintf('D2阶段验证完成。\n');
