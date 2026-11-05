function [visible, hit, L_diff] = city_los(p_r, p_t, city, freq_hz)
%CITY_LOS (rf) 建筑遮挡视线判定(含刀锋衍射损耗) - 复刻自 radar 组, 频段参数化
%   [visible, hit, L_diff] = city_los(p_r, p_t, city, freq_hz)
%   p_r/p_t: [x y z] ENU坐标(m), z为海拔高程(正常高)
%   freq_hz : 工作频率(Hz) - 无线电各频段均可传入(900M/1.2G/2.4G/5.8G等)
%   visible : true=通视
%   hit     : 首个遮挡建筑, struct('id','t','z_line','z_top'), 无遮挡为[]
%   L_diff  : ITU-R P.526 刀锋衍射损耗 (dB), 通视时为 0
%
% 注: 与 radar/environment/city_los.m 算法一致(视线投影->栅格索引->多边形求交->单刃峰衍射)
%     无线电频段直接传入 freq_hz 即可, 衍射随频率变化(低频段衍射损耗更小, 利于绕射).

if nargin < 4 || isempty(freq_hz), freq_hz = 2.4e9; end
L_diff = 0;

x1 = p_r(1); y1 = p_r(2); z1 = p_r(3);
x2 = p_t(1); y2 = p_t(2); z2 = p_t(3);
dx = x2 - x1;  dy = y2 - y1;  dz = z2 - z1;
Lh = hypot(dx, dy);

if Lh < 1e-3
    visible = true;  hit = [];
    return;
end

%% --- 沿视线采样栅格, 收集候选建筑 ---
gs = city.grid.grid_size;
n_steps = max(2, ceil(Lh/(gs/2)));
ts = (0:n_steps).' / n_steps;
xs = x1 + dx*ts;
ys = y1 + dy*ts;
gx = floor((xs - city.grid.x_min)/gs) + 1;
gy = floor((ys - city.grid.y_min)/gs) + 1;
in = gx >= 1 & gx <= city.grid.nx & gy >= 1 & gy <= city.grid.ny;
if ~any(in)
    visible = true;  hit = [];
    return;
end
idx_cells = city.grid.index(sub2ind([city.grid.nx city.grid.ny], gx(in), gy(in)));
cand = unique([idx_cells{:}]);
if isempty(cand)
    visible = true;  hit = [];
    return;
end

%% --- 逐建筑: AABB预筛(Liang-Barsky) + 多边形边精确相交 ---
t_hit = Inf;
hit_id = 0;
for ii = cand(:).'
    b = city.bbox(ii,:);
    tlo = 0;  thi = 1;  ok = true;
    if dx ~= 0
        ta = (b(1)-x1)/dx;  tb = (b(3)-x1)/dx;
        tlo = max(tlo, min(ta,tb));  thi = min(thi, max(ta,tb));
    elseif x1 < b(1) || x1 > b(3)
        ok = false;
    end
    if ok && dy ~= 0
        ta = (b(2)-y1)/dy;  tb = (b(4)-y1)/dy;
        tlo = max(tlo, min(ta,tb));  thi = min(thi, max(ta,tb));
    elseif ok && (y1 < b(2) || y1 > b(4))
        ok = false;
    end
    if ~ok || tlo > thi
        continue;
    end

    bx = city.buildings.enu_x{ii};
    by = city.buildings.enu_y{ii};
    tx = [bx(2:end); bx(1)];
    ty = [by(2:end); by(1)];
    ex = tx - bx;  ey = ty - by;
    den = dx*ey - dy*ex;
    safe = abs(den) > 1e-12;
    if ~any(safe)
        continue;
    end
    t_int = ((bx-x1).*ey - (by-y1).*ex) ./ den;
    u_int = ((bx-x1).*dy - (by-y1).*dx) ./ den;
    seg = safe & t_int > 0 & t_int < 1 & u_int > 0 & u_int < 1;
    if ~any(seg)
        continue;
    end
    tt = t_int(seg);
    zz = z1 + dz*tt;
    if any(zz < city.z_top(ii))
        t_first = min(tt(zz < city.z_top(ii)));
        if t_first < t_hit
            t_hit = t_first;
            hit_id = ii;
        end
    end
end

visible = (t_hit == Inf);
if visible
    hit = [];
else
    hit = struct('id', hit_id, 't', t_hit, ...
        'z_line', z1 + dz*t_hit, 'z_top', city.z_top(hit_id));

    % --- 单刃峰衍射: 以首个遮挡建筑顶为刃峰, 质心近似刃峰位置 ---
    bx = city.buildings.enu_x{hit_id};
    by = city.buildings.enu_y{hit_id};
    cx = mean(bx);  cy = mean(by);
    d1 = hypot(cx-x1, cy-y1);
    d2 = hypot(x2-cx, y2-cy);
    if d1 > 1 && d2 > 1
        t_ratio = d1/(d1+d2);
        z_line_at = z1 + dz*t_ratio;
        h_eff = city.z_top(hit_id) - z_line_at;
        L_diff = diffraction_loss_db(h_eff, d1, d2, freq_hz);
    end
end
end
