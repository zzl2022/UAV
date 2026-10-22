function city = city_load(data_dir)
%CITY_LOAD 加载D1城市数据并构建查询缓存
%   city = city_load()          % 默认 <proj>/data 目录
%   city = city_load(data_dir)
%
% 输出city结构体:
%   .buildings   D1建筑轮廓(enu_x/enu_y/height/name)
%   .base_z      建筑基底海拔高程 (m, 轮廓顶点DEM最大值)
%   .z_top       建筑顶海拔高程 = base_z + height
%   .bbox        [xmin ymin xmax ymax] 每栋包围盒
%   .vx/.vy/.vid 全部轮廓顶点拼接及所属建筑id
%   .dem         规则ENU网格高程 (.x/.y/.Z, 30m)
%   .grid        50m栅格空间索引(.index/.x_min/.y_min/.nx/.ny/.grid_size)
%   .lat0/.lon0  ENU原点经纬度
%
% 首次调用构建缓存 city_cache.mat, 之后直接读取

if nargin < 1
    proj_root = fileparts(fileparts(mfilename('fullpath')));
    data_dir = fullfile(proj_root, 'data');
end
cache_file = fullfile(data_dir, 'city_cache.mat');
if exist(cache_file, 'file')
    S = load(cache_file);
    city = S.city;
    return;
end

load(fullfile(data_dir, 'buildings_enu.mat'), 'buildings');
load(fullfile(data_dir, 'dem_enu.mat'), 'dem_data');
load(fullfile(data_dir, 'building_grid.mat')); %#ok<NASGU>

%% --- DEM重采样到规则ENU网格(30m) ---
gx = dem_data.X(:);  gy = dem_data.Y(:);  gz = dem_data.Z(:);
v = ~isnan(gz);
F = scatteredInterpolant(gx(v), gy(v), gz(v), 'linear', 'none');
xq = -5000:30:5000;
yq = -2800:30:2800;
[Xq, Yq] = meshgrid(xq, yq);
Zq = F(Xq, Yq);

%% --- 建筑基底高程(轮廓顶点地形最大值)/顶高/包围盒 ---
n = buildings.n;
base_z = zeros(n,1);
z_top  = zeros(n,1);
bbox   = zeros(n,4);
z_med  = median(gz(v));
for i = 1:n
    bx = buildings.enu_x{i};
    by = buildings.enu_y{i};
    zb = interp2(xq, yq, Zq, bx, by, 'linear');
    zb(isnan(zb)) = z_med;
    base_z(i) = max(zb);
    z_top(i)  = base_z(i) + buildings.height(i);
    bbox(i,:) = [min(bx) min(by) max(bx) max(by)];
end

%% --- 全部顶点拼接(供遮蔽角图向量化) ---
vx = cell2mat(cellfun(@(c) c(:), buildings.enu_x, 'UniformOutput', false));
vy = cell2mat(cellfun(@(c) c(:), buildings.enu_y, 'UniformOutput', false));
vid = zeros(numel(vx),1);
p0 = 1;
for i = 1:n
    len = numel(buildings.enu_x{i});
    vid(p0:p0+len-1) = i;
    p0 = p0 + len;
end

%% --- 组装 ---
city.buildings = buildings;
city.base_z = base_z;
city.z_top  = z_top;
city.bbox   = bbox;
city.vx = vx;  city.vy = vy;  city.vid = vid;
city.dem = struct('x', xq, 'y', yq, 'Z', Zq);
city.grid = struct('index', {grid_index}, 'x_min', x_min, 'y_min', y_min, ...
    'grid_size', grid_size, 'nx', nx, 'ny', ny);
city.lat0 = dem_data.lat0;
city.lon0 = dem_data.lon0;

save(cache_file, 'city', '-v7.3');
end
