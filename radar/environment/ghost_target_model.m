function out = ghost_target_model(mode, radar, varargin)
%GHOST_TARGET_MODEL  城区雷达虚假目标现象级模型   [B6 虚假目标]
%   out = ghost_target_model(mode, radar, ...)
%
%   mode = 'multipath_ghost':
%       out = ghost_target_model('multipath_ghost', radar, R_h, h_t, h_r)
%       地面双径反射的镜像鬼影: 反射路径较直达路径的超前量
%         dR = 2*h_r*h_t / R_h, 鬼影出现于 R_ghost = R_h + dR。
%       超前量小于距离分辨单元 c/(2*BW) 时与真目标不可分辨(表现为
%       SNR 干涉起伏, 即 multipath_factor_db); 大于若干单元时形成
%       独立假目标(低空目标/低架高时尤为显著)。
%       返回 struct: .dR_excess(m)  .R_ghost(m)  .range_res(m)
%                     .resolved(logical)  是否可分辨为独立鬼影
%
%   mode = 'corner_reflector':
%       out = ghost_target_model('corner_reflector', radar, R, rcs_corner)
%       建筑墙角/柱状结构形成二面角/三面角强散射体, 城区典型等效
%       RCS 约 10~100 m2 [假设], 远大于小型无人机(0.01 m2)。
%       返回 struct: .snr_db  .Pd  该角反体在距离 R 处超门限概率
%                     (按 Swerling I, Pd 即被报告为假目标的概率)
%
%   mode = 'false_alarm_batch':
%       out = ghost_target_model('false_alarm_batch', radar, n_cells, Pfa)
%       单圈扫描 n_cells 个距离-多普勒分辨单元内至少出现一次
%       热噪声虚警的概率: P = 1 - (1-Pfa)^n_cells
%       返回标量 P (0~1)

switch mode
    case 'multipath_ghost'
        [R_h, h_t, h_r] = varargin{1:3};
        [c, ~] = radar_consts();
        range_res = c / (2 * radar.BW);          % 脉压后距离分辨率 (m)
        dR = 2 * h_r .* h_t ./ R_h;              % 双程反射路径超前量 (m)
        out = struct( ...
            'dR_excess', dR, ...
            'R_ghost',   R_h + dR, ...
            'range_res', range_res, ...
            'resolved',  dR > 2*range_res );     % 大于2倍分辨单元视为独立鬼影

    case 'corner_reflector'
        [R, rcs_corner] = varargin{1:2};
        Pfa = radar.Pfa;
        snr = radar_snr(radar, R, rcs_corner);
        out = struct('snr_db', snr, 'Pd', pd_swerling1(snr, Pfa));

    case 'false_alarm_batch'
        [n_cells, Pfa] = varargin{1:2};
        out = 1 - (1-Pfa)^n_cells;

    otherwise
        error('未知模式: %s', mode);
end
end
