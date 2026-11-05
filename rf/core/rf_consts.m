function [c, k, t0] = rf_consts()
%RF_CONSTS  物理常量 (避免工具箱依赖, 与 radar 组一致)
%   c: 光速 m/s,  k: 玻尔兹曼常数 J/K,  T0: 参考噪声温度 K
    c  = 299792458;
    k  = 1.380649e-23;
    t0 = 290;
end
