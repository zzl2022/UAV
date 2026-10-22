% RUN_ALL  rf 一键回归: 按顺序运行全部仿真 (镜像 radar/run_all.m 范式)
% 用法: 在MATLAB中 cd 到 rf 目录后运行 run_all
% 依赖: config/ core/ environment/ sim/ 及 ../radar/data 城市缓存(只读复用)
% 阶段随工程推进逐步解锁: P1验证 -> P2核心物理 -> P3环境 -> P4失效边界 -> P5综合

clear; clc;
fprintf('===== 无线电侦测建模全流程回归 =====\n项目根目录: %s\n\n', fileparts(mfilename('fullpath')));
addpath(genpath(fullfile(fileparts(mfilename('fullpath')),'config')));
addpath(genpath(fullfile(fileparts(mfilename('fullpath')),'core')));
addpath(genpath(fullfile(fileparts(mfilename('fullpath')),'environment')));

sim_ctl('reset');
while sim_ctl('next')
    % 仿真脚本内含 clear 会清除工作区变量, 故 proj_root 每轮重算(persistent 控制器不受影响)
    proj_root = fileparts(mfilename('fullpath'));
    run(fullfile(proj_root, 'sim', sim_ctl('cur')));
    sim_ctl('done');
end

fprintf('\n===== 全部仿真完成, 图件输出于 results/ =====\n');

function out = sim_ctl(action)
%SIM_CTL  persistent仿真清单控制器, survive 脚本内的 clear
persistent list n t_start
switch action
    case 'reset'
        list = { 'sim_p1_verify', ...                % P1: 缓存复用+频段LOS+配置验证
                 'sim_freespace', ...                 % P2: 自由空间链路预算+灵敏度反推+CRLB
                 'sim_environment', ...               % P3: NLOS超量+分频段噪声+多径TDOA偏差
                 'sim_failure_boundary', ...          % P4: 静默失效+Pd边界+EIRP适用边界
                 'sim_composite_pd', ...              % P5: 单节点全因子Pd总图
                 'sim_network_gdop' };                % P5: 组网GDOP能力演示(代表性几何)
        % P3起逐步追加: 'sim_urban_nlos' 'sim_noise_interference' 'sim_multipath_bias' ...
        n = 0;
        out = true;
    case 'next'
        n = n + 1;
        out = n <= numel(list);
        if out
            t_start = tic;
            fprintf('\n########## [%d/%d] %s ##########\n', n, numel(list), list{n});
        end
    case 'cur'
        out = list{n};
    case 'done'
        fprintf('---------- %s 完成, 耗时 %.1fs ----------\n', list{n}, toc(t_start));
        out = true;
end
end
