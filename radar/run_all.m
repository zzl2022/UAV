% RUN_ALL  一键回归: 按顺序运行全部仿真, 复现 results/ 下所有图件
% 用法: 在MATLAB中 cd 到项目根目录后运行 run_all
% 依赖: config/ core/ environment/ sim/ 及 data/ 下的城市缓存
% 注: 各仿真脚本内含 clear, 会清除工作区变量,
%     故清单/计时/打印全部由 persistent 控制器承担, run后不再持有变量

clear; clc;
proj_root = fileparts(mfilename('fullpath'));
fprintf('===== 雷达特性建模全流程回归 =====\n项目根目录: %s\n\n', proj_root);

sim_ctl('reset');
while sim_ctl('next')
    run(fullfile(proj_root, 'sim', sim_ctl('cur')));
    sim_ctl('done');
end

fprintf('\n===== 全部仿真完成, 图件输出于 results/ =====\n');

function out = sim_ctl(action)
%SIM_CTL  persistent仿真清单控制器, survive 脚本内的 clear
%   sim_ctl('reset')  初始化清单
%   sim_ctl('next')   推进并打印仿真名, 返回是否有剩余
%   sim_ctl('cur')    返回当前仿真名
%   sim_ctl('done')   打印当前仿真完成与耗时
persistent list n t_start
switch action
    case 'reset'
        list = { 'sim_freespace', ...        % 自由空间8km指标验证
                 'sim_environment', ...      % 气象衰减 + 电磁底噪
                 'sim_multipath', ...        % 地面多径零陷
                 'sim_occlusion', ...        % 建筑遮挡 + 衍射 (需城市数据)
                 'sim_failure_boundary', ... % 失效边界综合(含近距盲区)
                 'sim_composite_pd', ...      % 全因子Pd概率图 + 虚假目标
                 'export_layers' };           % 成果导出 GeoTIFF/GeoJSON (供下游Cesium加载)
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
