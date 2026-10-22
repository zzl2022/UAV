function city = city_load(varargin)
%CITY_LOAD (rf) 只读加载 radar 组已构建的城市缓存, 不重建不写
%   city = city_load()                % 自动定位 ../radar/data/city_cache.mat
%   city = city_load(cache_path)      % 显式指定 city_cache.mat
%
% 设计: rf 与 radar 任务并行, rf 只读复用 radar 组 ENU 缓存(同原点 113.662169E,34.788899N),
%        不在 rf/ 内重建缓存, 避免写冲突. 若缓存不存在, 提示先到 radar/ 运行 preprocess_city.m.
%
% 输出 city 结构体字段同 radar/environment/city_load.m:
%   .buildings .base_z .z_top .bbox .vx/.vy/.vid .dem .grid .lat0 .lon0

    if nargin < 1
        rf_root   = fileparts(fileparts(mfilename('fullpath')));
        radar_data = fullfile(fileparts(rf_root), 'radar', 'data');
        cache_path = fullfile(radar_data, 'city_cache.mat');
    else
        cache_path = varargin{1};
    end

    if ~exist(cache_path, 'file')
        error('rf:city_load:notfound', ...
            ['城市缓存不存在: %s\n', ...
             'rf 只读复用 radar 组缓存; 请先到 radar/ 运行 preprocess_city.m 构建后再重试.'], ...
            cache_path);
    end
    S = load(cache_path);
    city = S.city;
end
