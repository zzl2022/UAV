function pd = detection_prob(snr_eff_db, Pfa)
%DETECTION_PROB 检测概率 Pd vs 等效 SNR (dB)  [与 snr_required 互逆]
%   Pd = Pfa^(1/(1+SNR_lin))   Swerling I 闭式(起伏检测统计量)
%   snr_eff_db : 处理后等效 SNR(=天线端SNR + 处理增益Gp)
%   Pfa       : 虚警概率, 缺省 1e-4
%   [假设/近似] 作为检测统计量; 绝对值依赖模型选择, 相对覆盖对比鲁棒
%   用途: Pd-距离曲线、侦测适用边界(P4)、全因子Pd图(P5)

    if nargin < 2, Pfa = 1e-4; end
    snr_lin = 10.^(snr_eff_db/10);
    pd = Pfa.^(1./(1 + snr_lin));
    pd = min(max(pd, 0), 1);
end
