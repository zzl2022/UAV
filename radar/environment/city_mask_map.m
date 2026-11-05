function mask_map = city_mask_map(p_r, city, n_az)
%CITY_MASK_MAP 360度方位遮蔽角图
%   mask_map = city_mask_map(p_r, city, n_az)
%   p_r: [x y z] 雷达位置(ENU, z为海拔)
%   n_az: 方位bin数(默认360, 即1度分辨率)
%   返回: n_az×1向量, 每个方位的最大建筑遮蔽仰角(度, 0=无遮挡)
%   方位定义: 0=正北, 顺时针(方位角)
%
% 算法: 全部建筑轮廓顶点对雷达的仰角, 按方位bin取最大(accumarray)
% 注: 顶点近似对侧向顶点有高估(保守), 建筑宽度/距离比小, 误差有限

if nargin < 3, n_az = 360; end

dxv = city.vx - p_r(1);
dyv = city.vy - p_r(2);
d = hypot(dxv, dyv);
ok = d > 5;   % 排除雷达所在建筑自身
az = mod(atan2d(dxv(ok), dyv(ok)), 360);
el = atan2d(city.z_top(city.vid(ok)) - p_r(3), d(ok));
el(el < 0) = 0;   % 低于雷达高度的顶点不构成遮蔽

bin = floor(az * n_az / 360) + 1;
bin(bin > n_az) = n_az;
mask_map = accumarray(bin, el, [n_az 1], @max, 0);
end
