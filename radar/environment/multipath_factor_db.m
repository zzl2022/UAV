function F_db = multipath_factor_db(radar, R, h_t, h_r, ground)
% MULTIPATH_FACTOR_DB  地面双径多径传播因子对SNR的修正 (dB)   [模块B3]
%   输入: R - 水平距离向量 (m);  h_t - 目标高度 (m, 标量或向量)
%         h_r - 雷达架设高度 (m)
%         ground.eps_r - 地面相对介电常数 [假设: 水泥6]
%         ground.sigma - 地面电导率 (S/m) [假设: 0.02]
%         ground.sig_h - 地面粗糙度均方根高度 (m) [假设: 城区0.1]
%   输出: F_db - SNR修正量 (dB), 雷达双程 -> 40*log10|F|
%   模型: 平坦地面双径干涉, 水平极化菲涅尔反射 + 瑞利粗糙度因子
%   适用: 低仰角 (<10°), 距离<=15km 平坦地面近似

    if nargin < 5 || isempty(ground)
        ground = struct('eps_r',6, 'sigma',0.02, 'sig_h',0.1);
    end
    [c, ~] = radar_consts();
    lambda = c / radar.fc;

    R = R(:)';                       % 行向量
    h_t = h_t(:);                    % 列向量
    % 掠过角与直达/反射路径差 (平坦地面近似)
    psi   = atan2(h_r + h_t, R);               % [h_t x R]
    dR    = 2*h_r*h_t ./ R;                    % 路径差
    phase = 2*pi*dR/lambda;                    % 相位差

    % 水平极化菲涅尔反射系数
    eps_c = ground.eps_r - 1i*60*ground.sigma*lambda;
    Gamma = (sin(psi) - sqrt(eps_c - cos(psi).^2)) ./ ...
            (sin(psi) + sqrt(eps_c - cos(psi).^2));

    % 瑞利粗糙度因子
    rho_s = exp(-2*(2*pi*ground.sig_h.*sin(psi)/lambda).^2);

    Gamma_eff = Gamma .* rho_s;

    % 干涉因子幅值
    F_amp = abs(1 + Gamma_eff .* exp(-1i*phase));
    F_db  = 40*log10(max(F_amp, 1e-3));        % 双程, 截断-60dB防奇异
end
