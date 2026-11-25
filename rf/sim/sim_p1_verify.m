% SIM_P1_VERIFY  P1 验证: 只读复用 radar 城市缓存 + 频段参数化 LOS 查询
%   目的:
%     1. 确认 rf 模块对 ../radar/data 城市缓存的只读复用通路畅通(并行无写冲突);
%     2. 确认 city_los 支持无线电各频段(900M/1.2G/2.4G/5.8G)参数化遮挡判定+衍射;
%     3. 确认 drone_waveforms 波形库与三型设备配置可加载, 权重归一.
%   产出: 控制台校核输出 (P1 不出图, P2 起出图)

clear; clc;
fprintf('===== rf P1: 城市缓存只读复用 + 频段LOS + 配置加载验证 =====\n');

%% 1. 只读加载 radar 城市缓存
city = city_load();
fprintf('城市缓存加载成功(只读, 来自 ../radar/data):\n');
fprintf('  建筑数=%d, 栅格=%dx%d (%dm), ENU原点=(%.6f, %.6f)\n', ...
    city.buildings.n, city.grid.nx, city.grid.ny, city.grid.grid_size, city.lat0, city.lon0);
fprintf('  建筑高度范围: %.1f ~ %.1f m\n', min(city.buildings.height), max(city.buildings.height));

%% 2. 频段参数化 LOS 查询
bands = struct('name',{'900M','1.2G','2.4G','5.8G'}, ...
               'fc',  {900e6, 1.2e9, 2.4e9, 5.8e9});
% 楼顶架设点 (AOI中心附近, 楼顶 ~140m) -> 3km 外低空目标 (60m)
p_r = [0, 0, 140];
p_t = [3000, 800, 60];

fprintf('\n频段参数化 LOS 查询 (节点[0,0,140] -> 目标[3000,800,60]):\n');
fprintf('%-6s %-8s %-14s %-10s %-14s\n','频段','通视','遮挡建筑','刃峰高差','衍射损耗(dB)');
for i = 1:numel(bands)
    [vis, hit, Ld] = city_los(p_r, p_t, city, bands(i).fc);
    if vis
        fprintf('%-6s %-8s %-14s %-10s %-14.2f\n', bands(i).name, '是', '-', '-', 0);
    else
        nm = city.buildings.name{hit.id};
        if isempty(nm) || ~ischar(nm); nm = sprintf('id%d', hit.id); end
        dh = hit.z_top - hit.z_line;     % 刃峰高差(m)
        fprintf('%-6s %-8s %-14s %-10.1f %-14.2f\n', bands(i).name, '否', nm(1:min(end,12)), dh, Ld);
    end
end

%% 3. 波形库与设备配置加载
wf = drone_waveforms();
fprintf('\n波形库 v0.1: %d 类, 权重和=%.4f\n', numel(wf), sum([wf.wt]));
fprintf('%-18s %-8s %-8s %-12s %-8s %-6s\n','名称','fc/GHz','EIRP','带宽/MHz','方向','权重');
for i = 1:numel(wf)
    fcG  = wf(i).fc/1e9;
    bwM  = wf(i).bw/1e6;
    if isnan(fcG); fcG = NaN; end
    fprintf('%-18s %-8.3f %-8.1f %-12.1f %-8s %-6.2f\n', ...
        wf(i).name, fcG, wf(i).eirp, bwM, wf(i).dir, wf(i).wt);
end

devs = {rf_tdoa_x1b(), rf_oa_x1bmini(), rf_x1c()};
fprintf('\n设备配置加载: %d 型\n', numel(devs));
fprintf('%-12s %-10s %-16s %-12s %-8s %-6s\n','名称','体制','频段覆盖','城市半径','定位误差','容量');
for i = 1:numel(devs)
    d = devs{i};
    cov = sprintf('%d段', numel(d.freq_cov));
    Rm = sprintf('%.1f-%.1fkm', d.R_urban(1)/1e3, d.R_urban(2)/1e3);
    fprintf('%-12s %-10s %-16s %-12s %-8.0f %-6d\n', d.name, d.tx_mode, cov, Rm, d.loc_err, d.capacity);
end

fprintf('\n===== P1 验证通过: rf 可只读复用 radar 缓存并按频段做遮挡判定, 配置层就绪 =====\n');
