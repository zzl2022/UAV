function L_d = diffraction_loss_db(h_eff, d1, d2, freq_hz)
%DIFFRACTION_LOSS_DB (rf) ITU-R P.526 单刃峰衍射损耗 - 复刻自 radar 组
%   L_d = diffraction_loss_db(h_eff, d1, d2, freq_hz)
%   h_eff  : 刃峰(建筑)顶高于视线的高度(m), >0=遮挡, <0=掠过
%   d1/d2  : 接收节点-刃峰 / 刃峰-目标 距离(m)
%   freq_hz: 工作频率(Hz)
%   返回   : 衍射损耗(dB), v<=-0.78时为0
%   注: 低频段(900M/1.2G)波长更长, 衍射损耗较5.8G小, 利于城区绕射补盲.

lambda = 3e8 / freq_hz;
v = h_eff * sqrt(2*(d1+d2) / (lambda*d1*d2));

if v > -0.78
    L_d = 6.9 + 20*log10(sqrt((v-0.1)^2 + 1) + v - 0.1);
    L_d = max(L_d, 0);
else
    L_d = 0;
end
end
