function [bias_R, bias_t, info] = multipath_tdoa_bias(R, env, is_los)
%MULTIPATH_TDOA_BIAS NLOS 多径超量路径引起的 TDOA 偏差  [L4]
%   NLOS: 信号经反射/绕射, 超量路径 Δd -> 时差偏差 bias_t=Δd/c -> 距离偏差 bias_R=Δd
%   Δd = k * R  (峡谷超量路径比例 [假设], 随路径长度+建筑密度增长); LOS 时为 0
%   这是城区 TDOA 定位误差的主要来源(超出 CRLB 热噪声项);
%   指标 <20m/<10m 主要在 LOS/近LOS 几何下成立, NLOS 需多站冗余抑制偏差

    [c, ~] = rf_consts();
    if nargin < 3, is_los = true; end
    if nargin < 2 || isempty(env); env = struct('city_type','business'); end
    if ~isfield(env,'city_type'); env.city_type='business'; end

    if is_los
        bias_R = 0;  bias_t = 0;
        if nargout > 2; info = struct('is_los',true,'delta_d',0); end
        return;
    end

    switch env.city_type
        case 'business';    k = 0.020;     % Δd = k*R [假设]
        case 'residential'; k = 0.012;
        case 'rural';       k = 0.006;
    end
    delta_d = k * R;
    bias_R  = delta_d;
    bias_t  = delta_d / c;
    if nargout > 2
        info = struct('is_los',false,'delta_d',delta_d,'k',k);
    end
end
