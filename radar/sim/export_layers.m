% EXPORT_LAYERS  导出雷达成果为下游 Cesium 可加载的标准格式
%   100m高度层 Pd 水平栅格 -> GeoTIFF (ENU->经纬度, geotiffwrite)
%   360度遮蔽角         -> GeoJSON (雷达点 + mask_deg数组)
%   失败时降级存 .mat/.csv, 不中断 run_all
%   输出: results/export/pd_<radar>_layer100m.tif, mask_angle.geojson
%   注: Pd 用雷达-目标单射线近似(每点到雷达一条LOS+综合SNR);
%       中位方位口径见 sim_composite_pd. 作为下游三维叠加覆盖图足够.

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
        fullfile(proj_root,'environment'));
data_dir = fullfile(proj_root,'data');
out_dir  = fullfile(proj_root,'results','export');
if ~exist(out_dir,'dir'); mkdir(out_dir); end

Pfa = 1e-6;  rcs = 0.01;
h_t = 100;  h_r = 30;                                    % 目标高度层 / 雷达架高
env0 = struct('rain_mmh',0,'cloud_M',0,'city_type','business','emi_db',0);

city = city_load(data_dir);
radars = {radar_02C(), radar_03D()};
names  = {'02C','03D'};

%% 雷达架设: AOI中心楼顶 (与 sim_composite_pd 一致)
xA = 0;  yA = 0;
gz_r = interp2(city.dem.x, city.dem.y, city.dem.Z, xA, yA, 'linear');
if isnan(gz_r), gz_r = median(city.dem.Z(:),'omitnan'); end
pR = [xA yA gz_r + h_r];
fprintf('雷达架设 ENU=[%g %g %g] 海拔 %.1f m\n', xA, yA, pR(3), pR(3));

lat0 = city.lat0;  lon0 = city.lon0;
ell  = wgs84Ellipsoid;

%% 100m 层 Pd 水平栅格 (250m 间距, ±6km)
gx = -6000:250:6000;  gy = -6000:250:6000;
nX = numel(gx);  nY = numel(gy);
gy_desc = gy(end:-1:1);                                  % 行1 = 最北

for i = 1:numel(radars)
    rd = radars{i};  nm = names{i};
    fprintf('[%s] 计算 100m 层 Pd 栅格 (%dx%d 点)...\n', nm, nX, nY);
    Pd = zeros(nY, nX);
    tic;
    for iy = 1:nY
        ey = gy_desc(iy);
        for ix = 1:nX
            ex = gx(ix);
            R_h = hypot(ex, ey);
            gz_t = interp2(city.dem.x, city.dem.y, city.dem.Z, ex, ey, 'linear');
            if isnan(gz_t), gz_t = gz_r; end
            pT = [ex ey gz_t + h_t];
            snr = composite_snr_db(rd, R_h, h_t, h_r, rcs, env0);
            [vis,~,Ld] = city_los(pR, pT, city, rd.fc);
            if ~vis && snr > -900
                snr = snr - Ld;
            end
            Pd(iy,ix) = pd_swerling1(snr, Pfa);
        end
    end
    fprintf('  耗时 %.1fs, Pd 均值 %.3f, Pd>=0.9 占比 %.1f%%\n', ...
        toc, mean(Pd(:),'omitnan'), 100*mean(Pd(:)>=0.9,'omitnan'));

    %% ENU 角点 -> 经纬度, 构规则栅格空间参考
    [lat1,lon1] = enu2geodetic(gx(1),      gy_desc(1),    0, lat0, lon0, 0, ell);
    [lat2,lon2] = enu2geodetic(gx(end),    gy_desc(end),  0, lat0, lon0, 0, ell);
    lat_min = min(lat1,lat2);  lat_max = max(lat1,lat2);
    lon_min = min(lon1,lon2);  lon_max = max(lon1,lon2);

    tif = fullfile(out_dir, sprintf('pd_%s_layer100m.tif', nm));
    try
        R = georasterref('RasterSize',[nY nX],'RasterInterpretation','cells');
        R.LatitudeLimits  = [lat_min lat_max];
        R.LongitudeLimits = [lon_min lon_max];
        R.ColumnsStartFrom = 'north';
        geotiffwrite(tif, Pd, R);
        fprintf('  GeoTIFF: %s\n', tif);
    catch ME
        fprintf('  [warn] GeoTIFF 写入失败 (%s), 降级存 mat+csv\n', ME.message);
        save(fullfile(out_dir,sprintf('pd_%s_layer100m.mat',nm)),'Pd','gx','gy');
        writematrix(Pd, fullfile(out_dir,sprintf('pd_%s_layer100m.csv',nm)));
    end
end

%% 遮蔽角 GeoJSON (建筑决定, 两型共用)
mask = city_mask_map(pR, city, 360);
[lat_r, lon_r, ~] = enu2geodetic(xA, yA, pR(3), lat0, lon0, 0, ell);

% 直接赋值构建, 避免 struct() 把 cell 当展开符 / num2cell 触发结构体展开
feat = struct();
feat.type = 'Feature';
feat.geometry = struct('type','Point','coordinates',[lon_r lat_r]);
feat.properties = struct('name','radar_AOI_center', ...
    'elevation_m',pR(3),'height_above_ground_m',h_r,'mask_deg',mask);
fc = struct();
fc.type = 'FeatureCollection';
fc.features = {feat};   % 用 cell 包裹 -> jsonencode 输出 JSON 数组 [{"type":"Feature",...}]

geo = fullfile(out_dir,'mask_angle.geojson');
try
    fid = fopen(geo,'w');
    fwrite(fid, jsonencode(fc,'PrettyPrint',true));
    fclose(fid);
    fprintf('遮蔽角 GeoJSON: %s (max遮蔽 %.1f°)\n', geo, max(mask));
catch ME
    fprintf('  [warn] GeoJSON 写入失败: %s\n', ME.message);
    save(fullfile(out_dir,'mask_angle.mat'),'mask','pR','lat_r','lon_r');
end

fprintf('导出完成, 输出目录: %s\n', out_dir);
