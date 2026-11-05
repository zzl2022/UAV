function [L_excess, info] = nlos_excess_db(R, env, L_diff)
%NLOS_EXCESS_DB 城区 NLOS 超量损耗 (dB)  [L2]
%   R       : 路径距离 (m)
%   env.city_type : business|residential|rural
%   L_diff  : city_los 单刃峰衍射损耗(dB, 可选), 表征几何遮挡
%   L_excess = L_diff(几何遮挡) + L_canyon(城市峡谷统计超量, 随路径长度增长)
%   L_canyon = c0 + s0*log10(R/100)  [假设, ITU-R P.1411 NLOS 典型量级]
%   无线电穿透建筑能力弱, NLOS 探测距离显著收缩(对比雷达, rf 低频段绕射可部分补盲)

    if nargin < 3 || isempty(L_diff), L_diff = 0; end
    if nargin < 2 || isempty(env); env = struct('city_type','business'); end
    if ~isfield(env,'city_type'); env.city_type='business'; end

    switch env.city_type
        case 'business';    c0=15; s0=8;
        case 'residential'; c0=10; s0=6;
        case 'rural';       c0=5;  s0=4;
    end
    R = max(R, 1);
    L_canyon = c0 + s0*log10(R/100);
    L_excess = L_diff + L_canyon;

    if nargout > 1
        info = struct('L_diff',L_diff,'L_canyon',L_canyon,'city_type',env.city_type);
    end
end
