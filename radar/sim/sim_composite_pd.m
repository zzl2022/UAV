% SIM_COMPOSITE_PD  阶段B6: 全因子Pd概率图 (子任务二雷达建模总成果图)
% 全因子: 自由空间 + 气象 + 底噪 + 地面多径 + 建筑遮挡/衍射 + 近距盲区
% 输出: 距离-高度二维Pd概率图 (中位/最差方位两个统计口径)
% 附: 虚假目标模型(ghost_target_model)定量示例

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
        fullfile(proj_root,'environment'));
out_dir = fullfile(proj_root, 'results');
data_dir = fullfile(proj_root, 'data');

Pd_req = 0.9;  Pfa = 1e-6;  rcs = 0.01;
radars = {radar_02C(), radar_03D()};
names  = {'02C','03D'};

env0 = struct('rain_mmh',0,'cloud_M',0,'city_type','business','emi_db',0);

%% --- 城市与雷达架设 (与sim_occlusion一致: AOI中心楼顶, 架高30m) ---
city = city_load(data_dir);
xA = 0;  yA = 0;
ground_z = interp2(city.dem.x, city.dem.y, city.dem.Z, xA, yA);
h_r = 30;                                  % 雷达相对地面架高 (m)
pA  = [xA yA ground_z + h_r];
fprintf('雷达架设: AOI中心楼顶, 海拔%.1fm (地面%.1f + 架高%d)\n', pA(3), ground_z, h_r);

%% --- 扫描网格: 方位x距离x高度 ---
az_list = 0:15:345;                        % 24个方位
R_list  = 250:250:12000;                   % 48档水平距离
h_list  = 20:20:400;                       % 20档目标相对高度
n_az = numel(az_list);  n_R = numel(R_list);  n_h = numel(h_list);

Pd_med = zeros(n_R, n_h, 2);
Pd_min = zeros(n_R, n_h, 2);

for i = 1:2
    rd = radars{i};
    fprintf('\n[%s] 全因子Pd计算: %d方位 x %d距离 x %d高度 = %d次LOS查询...\n', ...
        names{i}, n_az, n_R, n_h, n_az*n_R*n_h);
    Pd_all = zeros(n_az, n_R, n_h);
    tic;
    for a = 1:n_az
        sx = sind(az_list(a));  cx = cosd(az_list(a));
        for r = 1:n_R
            tx = pA(1) + R_list(r)*sx;
            ty = pA(2) + R_list(r)*cx;
            for hh = 1:n_h
                p_t = [tx ty ground_z + h_list(hh)];
                [vis, ~, Ld] = city_los(pA, p_t, city, rd.fc);
                snr = composite_snr_db(rd, R_list(r), h_list(hh), h_r, rcs, env0);
                if ~vis && snr > -900
                    snr = snr - Ld;        % 遮挡: 叠加刀锋衍射损耗
                end
                Pd_all(a, r, hh) = pd_swerling1(snr, Pfa);
            end
        end
    end
    t_el = toc;
    fprintf('  耗时 %.1fs (%.2f ms/查询)\n', t_el, t_el/(n_az*n_R*n_h)*1e3);
    Pd_med(:,:,i) = squeeze(median(Pd_all, 1));
    Pd_min(:,:,i) = squeeze(min(Pd_all, [], 1));
end

%% --- 覆盖统计 (h=100m层, 中位口径, R<=8km) ---
fprintf('\n===== 覆盖统计 (Pd>=%.1f, R<=8km) =====\n', Pd_req);
for i = 1:2
    [~, h100] = min(abs(h_list-100));
    [~, r8k]  = min(abs(R_list-8000));
    cov_med = mean(Pd_med(1:r8k, h100, i) >= Pd_req)*100;
    cov_min = mean(Pd_min(1:r8k, h100, i) >= Pd_req)*100;
    fprintf('[%s] 100m高度层: 中位方位覆盖 %.1f%%, 最差方位覆盖 %.1f%%\n', ...
        names{i}, cov_med, cov_min);
end

%% --- 图: R-H 二维Pd概率图 ---
fig = figure('Visible','off','Position',[60 60 1500 560]);
for i = 1:2
    subplot(1,2,i);
    imagesc(R_list/1e3, h_list, Pd_med(:,:,i).'); hold on;
    set(gca,'YDir','normal');
    colormap(gca, jet);  caxis([0 1]);  cb = colorbar;  ylabel(cb,'P_d');
    [C, hplt] = contour(R_list/1e3, h_list, Pd_med(:,:,i).', [Pd_req Pd_req], ...
        'k-', 'LineWidth', 1.5);
    clabel(C, hplt, 'FontSize', 8);
    % 最差方位口径的0.9包络(红虚线)
    contour(R_list/1e3, h_list, Pd_min(:,:,i).', [Pd_req Pd_req], ...
        'r--', 'LineWidth', 1.2);
    xlabel('水平距离 (km)');  ylabel('目标相对高度 (m)');
    title(sprintf('%s: 全因子P_d (黑实线=中位口径, 红虚线=最差方位)', names{i}));
    xlim([0 12]);  ylim([20 400]);
end
print(fig, fullfile(out_dir,'composite_pd_map.png'), '-dpng', '-r150');
fprintf('\n图已保存: composite_pd_map.png\n');

%% --- 虚假目标模型定量示例 ---
fprintf('\n===== 虚假目标模型示例 =====\n');
for i = 1:2
    rd = radars{i};
    % 1) 多径鬼影: 目标高50m, 距离2km
    g = ghost_target_model('multipath_ghost', rd, 2000, 50, h_r);
    fprintf('[%s] 多径鬼影 (目标2km/50m): 超前量 %.1fm, 出现于 %.3f km, ', ...
        names{i}, g.dR_excess, g.R_ghost/1e3);
    if g.resolved
        fprintf('>2倍分辨单元(%.1fm) -> 可分辨为独立鬼影\n', g.range_res);
    else
        fprintf('<2倍分辨单元(%.1fm) -> 与真目标不可分辨, 表现为SNR起伏\n', g.range_res);
    end
    % 2) 建筑角反伪峰: 等效RCS 30 m2, 距离3km
    cr = ghost_target_model('corner_reflector', rd, 3000, 30);
    fprintf('[%s] 建筑角反 (RCS=30m2 @3km): SNR=%.1fdB -> 超门限概率 P_d=%.4f (每扫描圈)\n', ...
        names{i}, cr.snr_db, cr.Pd);
    % 3) 热噪声批虚警: 距离单元 x 多普勒单元
    n_cells = round(8000 / g.range_res) * rd.n_pulses;
    pfa_batch = ghost_target_model('false_alarm_batch', rd, n_cells, rd.Pfa);
    fprintf('[%s] 热噪声虚警: %d个RD单元/圈 -> 每圈至少1次虚警概率 %.4f\n', ...
        names{i}, n_cells, pfa_batch);
end
fprintf('B6阶段完成。\n');
