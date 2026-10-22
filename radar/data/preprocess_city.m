% PREPROCESS_CITY  D1阶段: 城市数据预处理
% 读取 building/DEM, 转ENU坐标, 建立空间索引, 导出MAT格式

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
data_root = fullfile(proj_root, '题目', '区域数据');
out_dir = fullfile(proj_root, 'data');
if ~exist(out_dir, 'dir'); mkdir(out_dir); end

%% ENU原点 (AOI中心, 与白模一致)
lat0 = 34.788899;  lon0 = 113.662169;  h0 = 0;

%% --- D1-1: 读取building Shapefile ---
fprintf('===== D1-1: 读取建筑数据 =====\n');
shp_path = fullfile(data_root, 'building', 'zheng_apart.shp');
S = shaperead(shp_path);
fprintf('要素数: %d\n', numel(S));

% 提取轮廓和高度
n = numel(S);
buildings = struct();
buildings.n = n;
buildings.id = zeros(n,1);
buildings.name = cell(n,1);
buildings.height = zeros(n,1);
buildings.footprint_x = cell(n,1);  % EPSG:3857 X
buildings.footprint_y = cell(n,1);  % EPSG:3857 Y
buildings.enu_x = cell(n,1);        % ENU X (东)
buildings.enu_y = cell(n,1);        % ENU Y (北)
buildings.enu_z = cell(n,1);        % ENU Z (高, 从0到height)

for i = 1:n
    buildings.id(i) = str2double(S(i).ID);
    buildings.name{i} = S(i).NAME;
    buildings.height(i) = S(i).high;

    % 轮廓顶点 (EPSG:3857)
    x3857 = S(i).X(~isnan(S(i).X));
    y3857 = S(i).Y(~isnan(S(i).Y));
    buildings.footprint_x{i} = x3857;
    buildings.footprint_y{i} = y3857;

    % 3857 -> WGS84
    [lat, lon] = projinv(projcrs(3857), x3857, y3857);

    % WGS84 -> ENU
    [xEast, yNorth, zUp] = geodetic2enu(lat, lon, 0, lat0, lon0, h0, wgs84Ellipsoid);
    buildings.enu_x{i} = xEast(:);
    buildings.enu_y{i} = yNorth(:);
end

fprintf('高度范围: %.1f ~ %.1f m\n', min(buildings.height), max(buildings.height));
fprintf('平均高度: %.1f m\n', mean(buildings.height));

% 检查转换后范围
all_x = vertcat(buildings.enu_x{:});
all_y = vertcat(buildings.enu_y{:});
fprintf('ENU范围: X %.0f~%.0f m, Y %.0f~%.0f m\n', ...
    min(all_x), max(all_x), min(all_y), max(all_y));

%% --- D1-2: 读取DEM ---
fprintf('\n===== D1-2: 读取DEM =====\n');
dem_path = fullfile(data_root, 'dem', 'dem.tif');
[Z, R] = readgeoraster(dem_path);
Z = double(Z);
Z(Z == -9999) = NaN;
fprintf('DEM尺寸: %d x %d\n', size(Z,1), size(Z,2));
fprintf('高程范围: %.1f ~ %.1f m\n', min(Z(:),[],'omitnan'), max(Z(:),[],'omitnan'));

% DEM地理坐标 -> ENU (geographicGrid直接返回网格矩阵, 无需meshgrid)
[lat_grid, lon_grid] = geographicGrid(R);
[dem_x, dem_y, ~] = geodetic2enu(lat_grid(:), lon_grid(:), zeros(size(lat_grid(:))), ...
    lat0, lon0, h0, wgs84Ellipsoid);
dem_x = reshape(dem_x, size(Z));
dem_y = reshape(dem_y, size(Z));

% 保存DEM为插值函数可用格式
dem_data.X = dem_x;
dem_data.Y = dem_y;
dem_data.Z = Z;
dem_data.lat0 = lat0;
dem_data.lon0 = lon0;

%% --- D1-3: 建立50m空间索引 ---
fprintf('\n===== D1-3: 建立空间索引 =====\n');
grid_size = 50;  % m
x_min = floor(min(all_x)/grid_size)*grid_size;
x_max = ceil(max(all_x)/grid_size)*grid_size;
y_min = floor(min(all_y)/grid_size)*grid_size;
y_max = ceil(max(all_y)/grid_size)*grid_size;

nx = ceil((x_max - x_min)/grid_size);
ny = ceil((y_max - y_min)/grid_size);

% 每个栅格包含哪些建筑
grid_index = cell(nx, ny);
for i = 1:n
    bx = buildings.enu_x{i};
    by = buildings.enu_y{i};
    gx = floor((bx - x_min)/grid_size) + 1;
    gy = floor((by - y_min)/grid_size) + 1;
    gx = max(1, min(nx, gx));
    gy = max(1, min(ny, gy));
    % 建筑可能跨多个栅格
    gx_range = min(gx):max(gx);
    gy_range = min(gy):max(gy);
    for gxi = gx_range
        for gyi = gy_range
            if isempty(grid_index{gxi, gyi})
                grid_index{gxi, gyi} = i;
            else
                grid_index{gxi, gyi}(end+1) = i;
            end
        end
    end
end
fprintf('索引栅格: %d x %d, 栅格尺寸: %dm\n', nx, ny, grid_size);

%% --- D1-4: 导出 ---
fprintf('\n===== D1-4: 导出 =====\n');
save(fullfile(out_dir, 'buildings_enu.mat'), 'buildings', '-v7.3');
save(fullfile(out_dir, 'dem_enu.mat'), 'dem_data', '-v7.3');
save(fullfile(out_dir, 'building_grid.mat'), 'grid_index', 'x_min', 'x_max', ...
     'y_min', 'y_max', 'grid_size', 'nx', 'ny', '-v7.3');

fprintf('已保存:\n');
fprintf('  %s\n', fullfile(out_dir, 'buildings_enu.mat'));
fprintf('  %s\n', fullfile(out_dir, 'dem_enu.mat'));
fprintf('  %s\n', fullfile(out_dir, 'building_grid.mat'));

%% --- 验证图 ---
fig = figure('Visible','off','Position',[80 80 1200 500]);

subplot(1,2,1); hold on; grid on; axis equal;
% 绘制建筑轮廓(抽样显示, 避免过密)
idx_show = randperm(n, min(2000, n));
for i = idx_show
    plot(buildings.enu_x{i}, buildings.enu_y{i}, 'b-', 'LineWidth', 0.5);
end
xlabel('东 (m)'); ylabel('北 (m)');
title('建筑轮廓 (ENU, 抽样2000栋)');

subplot(1,2,2); hold on; grid on;
% DEM高程着色
h = pcolor(dem_x, dem_y, Z);
h.EdgeColor = 'none';
colorbar;
xlabel('东 (m)'); ylabel('北 (m)');
title('DEM高程 (m)');

print(fig, fullfile(out_dir, 'city_preview.png'), '-dpng', '-r150');
fprintf('  %s\n', fullfile(out_dir, 'city_preview.png'));

fprintf('\nD1阶段完成。\n');
