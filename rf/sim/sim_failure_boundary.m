% SIM_FAILURE_BOUNDARY  P4: 侦测失效边界与适用边界
%   1. 静默无人机失效机制(Pd≡0)与适用边界声明;
%   2. Pd-距离曲线(LOS/NLOS), 标定 Pd_req 失效边界;
%   3. EIRP-距离侦测适用边界图(各波形可侦测区/失效区);
%   4. FHSS 跳频驻留捕获概率(快速过境降级分析).
%   对标任务书"静默式无人机目标的侦测失效机制与适用边界".

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
        fullfile(proj_root,'environment'));
out_dir = fullfile(proj_root, 'results');
if ~exist(out_dir, 'dir'); mkdir(out_dir); end

wf_lib = drone_waveforms();
devs  = {rf_tdoa_x1b(), rf_oa_x1bmini(), rf_x1c()};
env_b = struct('city_type','business');
sols = cell(1, numel(devs));
for i = 1:numel(devs); sols{i} = sensitivity_solve(devs{i}, wf_lib); end

fprintf('===== rf P4: 侦测失效边界与适用边界 =====\n\n');

%% 1. 静默失效机制 + 适用边界总表 (X1B 为代表)
fprintf('--- 静默无人机失效机制 ---\n');
fprintf('  静默模式(预编程航线, 无图传/飞控上行): 无射频辐射 -> Pd≡0\n');
fprintf('  -> 无线电侦测本质失效, 必须由雷达(主动)/声学补盲, 属适用边界外\n\n');

fprintf('--- 侦测适用边界总表 (设备 X1B, 商业区, 参考点楼顶140m) ---\n');
fprintf('%-16s %-7s %-9s %-9s %-9s\n','波形','EIRP','R_max_LOS','R_max_NLOS','判定');
d1 = devs{1}; s1 = sols{1};
Rg = (50:25:6000);
for w = 1:numel(wf_lib)
    wf = wf_lib(w);
    if strcmp(wf.name,'Silent')
        fprintf('%-16s %-7s %-9s %-9s %-9s\n','Silent(静默)','-', '0(失效)','0(失效)','交雷达');
        continue;
    end
    thr = s1.SNR_ant_mid;
    snr_los  = arrayfun(@(r) composite_snr_env(d1, wf, r, env_b, true,  0), Rg);
    snr_nlos = arrayfun(@(r) composite_snr_env(d1, wf, r, env_b, false, 0), Rg);
    okl = find(snr_los  >= thr);  okn = find(snr_nlos >= thr);
    Rl = (~isempty(okl))*Rg(min(end,max(1,okl(end))));
    if isempty(okl); Rl=0; end
    if isempty(okn); Rn=0; else Rn=Rg(okn(end)); end
    if Rl >= d1.R_urban(1); jd='达标'; elseif Rl>0; jd='部分'; else jd='失效'; end
    fprintf('%-16s %-6.1fdB %-8.2fkm %-8.2fkm %-9s\n', wf.name, wf.eirp, Rl/1e3, Rn/1e3, jd);
end
fprintf('  (LOS 通视下消费级波形可达城市半径; NLOS 峡谷下普遍失效, 需多站恢复LOS)\n\n');

%% 2. Pd-距离曲线 (X1B 参考波形, LOS vs NLOS)
wf_ref = s1.ref_wf;
R_km = linspace(0.1, 8, 400);  R = R_km*1e3;
snr_los  = arrayfun(@(r) composite_snr_env(d1, wf_ref, r, env_b, true,  0), R);
snr_nlos = arrayfun(@(r) composite_snr_env(d1, wf_ref, r, env_b, false, 0), R);
pd_los  = detection_prob(snr_los  + s1.Gp, d1.Pfa);
pd_nlos = detection_prob(snr_nlos + s1.Gp, d1.Pfa);
% 边界距离(Pd>=Pd_req 的最远R)
b_los = R_km(find(pd_los  >= d1.Pd_req, 1, 'last'));
b_nlos = R_km(find(pd_nlos >= d1.Pd_req, 1, 'last'));
if isempty(b_los); b_los=0; end
if isempty(b_nlos); b_nlos=0; end
fprintf('--- Pd 失效边界 (X1B, %s, Pd_req=%.1f) ---\n', wf_ref.name, d1.Pd_req);
fprintf('  LOS  Pd>=0.9 边界 = %.2f km\n', b_los);
fprintf('  NLOS Pd>=0.9 边界 = %.2f km  (失效区起点)\n', b_nlos);
fprintf('  -> NLOS 场景 %.2fkm 外即侦测失效\n\n', b_nlos);

%% 3. EIRP-距离 侦测适用边界图 (X1B, 商业区)
%  EIRP_min(R) = SNR_req_base - Gp + L_rx - G + FSPL(R,fc) + N_env + L_nlos(R)
L_rx = 2;  Gp = s1.Gp;  SNR_req = s1.SNR_req_base;  G_ant = d1.g_ant_dB;
[~, ndet] = rx_noise_env_dbm(d1, wf_ref, env_b);  N_env = ndet.N_th + ndet.dN_manmade + ndet.emi_db;
Rc = linspace(0.1, 8, 400)*1e3;
FSPL = fspl_db(Rc, wf_ref.fc);
Lcanyon = arrayfun(@(r) nlos_excess_db(r, env_b, 0), Rc);   % 无单刃峰, 仅峡谷
EIRP_min_LOS  = SNR_req - Gp + L_rx - G_ant + FSPL        + N_env;
EIRP_min_NLOS  = SNR_req - Gp + L_rx - G_ant + FSPL + Lcanyon + N_env;

fprintf('--- EIRP 侦测适用边界 (X1B, %s, 商业区) ---\n', wf_ref.name);
fprintf('  各波形是否落入可侦测区(在指标半径4km处):\n');
for w = 1:numel(wf_lib)
    wf = wf_lib(w);
    if strcmp(wf.name,'Silent'); continue; end
    eirp_at4_LOS = EIRP_min_LOS(Rc>=4000); eirp_at4_LOS = eirp_at4_LOS(1);
    eirp_at4_NLOS = EIRP_min_NLOS(Rc>=4000); eirp_at4_NLOS = eirp_at4_NLOS(1);
    los_ok = wf.eirp >= eirp_at4_LOS;  nlos_ok = wf.eirp >= eirp_at4_NLOS;
    fprintf('  %-16s EIRP=%4.1fdB | 4km LOS %s | 4km NLOS %s\n', ...
        wf.name, wf.eirp, tern(los_ok,'可侦测','失效'), tern(nlos_ok,'可侦测','失效'));
end
fprintf('\n');

%% 4. FHSS 驻留捕获概率
fprintf('--- FHSS 跳频驻留捕获概率 (T_obs 扫描) ---\n');
fprintf('%-16s %-10s %-10s %-10s\n','波形','T_obs=20ms','T_obs=100ms','T_obs=1s');
T_list = [20e-3, 100e-3, 1];
for w = 1:numel(wf_lib)
    wf = wf_lib(w);
    line = sprintf('%-18s', wf.name);
    for t = T_list
        [pe,~] = fhss_detection_prob(wf, t);
        line = [line sprintf('%-10.3f', pe)];
    end
    fprintf('%s\n', line);
end
fprintf('  (正常监测 T_obs>>T_hop 捕获≈1; 快速过境 T_obs<10ms 才显著降级)\n');

%% 图件
% (a) Pd-距离: LOS vs NLOS + Pd_req 边界
fig1 = figure('Visible','off','Position',[100 100 900 420]); hold on; grid on;
plot(R_km, pd_los,  'b-', 'LineWidth',1.5, 'DisplayName','LOS (通视)');
plot(R_km, pd_nlos, 'r-', 'LineWidth',1.5, 'DisplayName','NLOS (峡谷)');
plot(R_km([1 end]), [d1.Pd_req d1.Pd_req], 'k--', 'LineWidth',1, 'HandleVisibility','off');
text(0.45, d1.Pd_req+0.02, sprintf('Pd=%.1f', d1.Pd_req), 'Color','k');
xline(b_nlos, 'r:', 'LineWidth',1, 'HandleVisibility','off');
text(b_nlos+0.1, 0.5, sprintf('NLOS失效\\rightarrow%.2fkm', b_nlos), 'Color','r');
xlabel('距离 (km)'); ylabel('检测概率 P_d');
title(sprintf('X1B 参考波形 Pd 失效边界 (%s, 商业区)', wf_ref.name));
legend('Location','northeast'); xlim([0 8]); ylim([0 1.02]);
print(fig1, fullfile(out_dir,'failure_pd_boundary.png'), '-dpng', '-r150');

% (b) EIRP-距离 适用边界: EIRP_min 曲线 + 各波形 EIRP 水平线
fig2 = figure('Visible','off','Position',[100 100 1000 460]); hold on; grid on;
plot(R_km, EIRP_min_LOS,  'b-', 'LineWidth',1.8, 'DisplayName','可侦测下限(LOS)');
plot(R_km, EIRP_min_NLOS, 'r-', 'LineWidth',1.8, 'DisplayName','可侦测下限(NLOS)');
clr={'k','m','g',[0 .5 0],'c',[0 .6 .6],[.8 0 .8],[.5 .5 0]};
for w = 1:numel(wf_lib)
    wf = wf_lib(w); if strcmp(wf.name,'Silent'); continue; end
    plot(R_km([1 end]), [wf.eirp wf.eirp], '--', 'Color',clr{mod(w-1,8)+1}, ...
        'LineWidth',1, 'HandleVisibility','off');
    text(8.05, wf.eirp, sprintf('%s %.0f', wf.name, wf.eirp), 'Color',clr{mod(w-1,8)+1}, ...
        'FontSize',8, 'HorizontalAlignment','left');
end
set(gca,'Ydir','normal');
xlabel('距离 (km)'); ylabel('EIRP (dBm)');
title('侦测适用边界: 波形 EIRP vs 可侦测下限 (X1B, 商业区)');
legend('Location','northwest'); xlim([0 8]); ylim([10 45]);
print(fig2, fullfile(out_dir,'failure_eirp_boundary.png'), '-dpng', '-r150');

fprintf('\n图件: failure_pd_boundary.png / failure_eirp_boundary.png\n');
fprintf('\n===== P4 失效边界完成: 静默失效+适用边界图就绪 =====\n');

function s = tern(cond, a, b)
    if cond, s=a; else, s=b; end
end
