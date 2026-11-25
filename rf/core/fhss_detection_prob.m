function [pd_eff, info] = fhss_detection_prob(wf, T_obs)
%FHSS_DETECTION_PROB 跳频信号观测捕获概率 [现象级]  [P4 失效机制]
%   宽带频谱感知(TDOA 设备)捕获整个跳频带, 但每跳驻留内有效积分时间受限;
%   捕获概率 Pd_capture = 1 - exp(-T_obs/T_hop)  (观测窗内至少捕到1跳)
%   非跳频(OFDM静态/WiFi/模拟FM): Pd_capture = 1
%   静默: Pd_capture = 0 (无发射)
%   T_obs : 单频段观测时间(s), 缺省0.1 [假设, 谱感知典型]
%   结论方向: 正常监测(T_obs>>T_hop)捕获≈1; 仅快速过境(T_obs<T_hop)才显著降级
%   pd_eff : 捕获概率(乘到能量检测Pd上)

    if nargin < 2, T_obs = 0.1; end
    if strcmp(wf.mod,'none') || isnan(wf.fc)
        pd_eff = 0;  info = struct('type','silent','note','静默无发射, Pd=0');
        return;
    end
    is_fhss = contains(wf.mod,'FHSS') || contains(wf.mod,'跳频');
    if ~is_fhss
        pd_eff = 1;  info = struct('type','static','T_obs',T_obs);
        return;
    end
    T_hop = 10e-3;                                   % 跳频驻留周期 [假设, OcuSync~10ms]
    pd_eff = min(1 - exp(-T_obs/T_hop), 1);
    info = struct('type','fhss','T_obs',T_obs,'T_hop',T_hop);
end
