function L = fspl_db(R, fc)
%FSPL_DB 单向自由空间路径损耗 (dB)
%   L = fspl_db(R, fc)
%   R  : 斜距 (m)
%   fc : 频率 (Hz)
%   单向链路(无线电侦测: 无人机发射 -> 接收节点), 与雷达双向 R^4 体制不同
%   FSPL = 20log10(R) + 20log10(fc) + 20log10(4*pi/c)   (R in m, fc in Hz)

    c = 299792458;
    R = max(R, 1);                         % 避免 log(0)
    L = 20*log10(R) + 20*log10(fc) + 20*log10(4*pi/c);
end
