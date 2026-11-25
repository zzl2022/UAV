% SIM_FREESPACE  P2 阶段一: 自由空间单向链路预算 + 灵敏度反推 + CRLB 时延
% 验证三型无线电侦测设备在自由空间下对无人机波形的最大侦测距离,
% 由"城市工作半径"指标反推检测灵敏度 Pmin_eff 与处理增益 Gp, 并校核 Gp 合理性;
% 给出 CRLB 时延/距离精度打底(供 P5 组网 GDOP 使用).
%
% 口径(已冻结): 工作半径=单节点侦测半径; 参考波形=OcuSync_58G(主导消费级).

clear; clc;
proj_root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'));
out_dir = fullfile(proj_root, 'results');
if ~exist(out_dir, 'dir'); mkdir(out_dir); end

[c, ~] = rf_consts();

wf_lib = drone_waveforms();
devs  = {rf_tdoa_x1b(), rf_oa_x1bmini(), rf_x1c()};

fprintf('===== rf P2: 自由空间链路预算 + 灵敏度反推 + CRLB =====\n');
fprintf('检测模型: Swerling I 闭式 (Pd=Pfa^(1/(1+SNR))), 处理增益 Gp 表征波形感知\n\n');

%% 1. 逐设备反推灵敏度与 Gp
sols = cell(1, numel(devs));
fprintf('--- 设备灵敏度反推 (参考波形 OcuSync_58G, EIRP=25.5dBm) ---\n');
fprintf('%-12s %-8s %-9s %-9s %-9s %-8s %-8s %-6s\n', ...
    '设备','R_mid','SNR_req','N_th','SNR_ant','Gp','Pmin','判据');
for i = 1:numel(devs)
    s = sensitivity_solve(devs{i}, wf_lib);
    sols{i} = s;
    fprintf('%-12s %-7.2fkm %-8.1fdB %-8.1fdB %-8.1fdB %-7.1fdB %-7.1fdB %-6s\n', ...
        s.dev_name, s.R_mid/1e3, s.SNR_req_base, s.N_dbm, ...
        s.SNR_ant_mid, s.Gp, s.Pmin_eff, passfail(s.plausible));
end
fprintf('  (Gp 合理区间 6-22 dB; 便携机偏低, 固定式偏高; 表征匹配滤波/前导相关/FHSS 聚合处理增益)\n\n');

%% 2. 逐设备 x 逐波形自由空间最大侦测距离
fprintf('--- 自由空间最大侦测距离 R_max (km) [Pr(R)=Pmin_eff] ---\n');
hdr = sprintf('%-12s', '波形\\设备');
for i = 1:numel(devs); hdr = [hdr sprintf('%-10s', devs{i}.name)]; end
fprintf('%s\n', hdr);
for w = 1:numel(wf_lib)
    wf = wf_lib(w);
    if strcmp(wf.name,'Silent')
        fprintf('%-18s', 'Silent(静默)');
        for i = 1:numel(devs); fprintf('%-10s','0(失效)'); end
        fprintf('\n'); continue;
    end
    fprintf('%-18s', wf.name);
    for i = 1:numel(devs)
        Rm = r_max_freespace(devs{i}, wf, sols{i}.Pmin_eff)/1e3;
        fprintf('%-10.2f', Rm);
    end
    fprintf('\n');
end

% 参考波形 R_max == R_mid 闭环校核
fprintf('\n--- 参考波形闭环校核 (R_max 应 = R_mid) ---\n');
for i = 1:numel(devs)
    wf_ref = sols{i}.ref_wf;
    Rm = r_max_freespace(devs{i}, wf_ref, sols{i}.Pmin_eff);
    fprintf('%-12s R_max=%.3fkm vs R_mid=%.3fkm  [%s]\n', ...
        devs{i}.name, Rm/1e3, sols{i}.R_mid/1e3, passfail(abs(Rm-sols{i}.R_mid)<1));
end

%% 3. CRLB 时延/距离精度打底
fprintf('\n--- CRLB 时延/距离精度 (单基线, 矩形谱 beta=B/sqrt(12)) ---\n');
fprintf('%-12s %-10s %-10s %-10s %-10s\n','设备','beta/MHz','SNR@Rmid','sigma_t','sigma_R');
for i = 1:numel(devs)
    wf_ref = sols{i}.ref_wf;
    beta = wf_ref.bw/sqrt(12);
    snr_eff = sols{i}.SNR_req_base;        % 门限处等效 SNR(处理后) = SNR_req_base
    [st, sR] = crlb_sigma_t(wf_ref, snr_eff);
    fprintf('%-12s %-9.2f %-9.1fdB %-9.1fns %-9.2fm\n', ...
        devs{i}.name, beta/1e6, snr_eff, st*1e9, sR);
end
fprintf('  (门限 SNR 处最差; 近距高 SNR 更优; 组网定位误差 = GDOP*sigma_R, P5 解算)\n');
fprintf('  X1C 指标<10m, X1B/mini<20m; 门限处 sigma_R 已接近指标量级, 多站 GDOP 合理即可达标\n');

%% 4. 图件
% (a) SNR_antenna 随距离 (参考波形) + 门限线
fig1 = figure('Visible','off','Position',[100 100 1100 420]);
hold on; grid on;
R_km = linspace(0.1, 40, 600);  R = R_km*1e3;
clr = {'b','r','g'};
for i = 1:numel(devs)
    wf_ref = sols{i}.ref_wf;
    snr_ant = arrayfun(@(r) rx_power_dbm(devs{i}, wf_ref, r) - sols{i}.N_dbm, R);
    plot(R_km, snr_ant, clr{i}, 'LineWidth', 1.5, ...
        'DisplayName', sprintf('%s (%s)', devs{i}.name, wf_ref.name));
    thr = sols{i}.SNR_req_base - sols{i}.Gp;     % 各自门限(=SNR_ant@R_mid)
    plot(R_km([1 end]), [thr thr], [clr{i} ':'], 'LineWidth', 1, ...
        'HandleVisibility', 'off');
end
xlabel('距离 (km)'); ylabel('天线端 SNR (dB)');
title('参考波形(OcuSync\_58G)天线端 SNR 随距离'); legend('Location','northeast');
xlim([0 40]); ylim([-10 40]);

print(fig1, fullfile(out_dir,'freespace_snr.png'), '-dpng', '-r150');

% (b) 各设备 x 各波形 R_max 柱状图
fig2 = figure('Visible','off','Position',[100 100 1100 460]);
hold on; grid on;
wf_names = {wf_lib.name};
ndata = numel(devs); nwf = numel(wf_lib);
Rmat = zeros(nwf, ndata);
for w = 1:nwf
    if strcmp(wf_lib(w).name,'Silent'); continue; end
    for i = 1:numel(devs)
        Rmat(w,i) = r_max_freespace(devs{i}, wf_lib(w), sols{i}.Pmin_eff)/1e3;
    end
end
b = bar(Rmat,'grouped');
set(gca,'XTickLabel', wf_names, 'XTickLabelRotation', 30);
xlabel('无人机波形'); ylabel('自由空间 R_{max} (km)');
title('各设备 x 各波形 自由空间最大侦测距离');
dev_names = cellfun(@(d) d.name, devs, 'UniformOutput', false);  % 设备字段非全一致, 逐个提取
legend(dev_names, 'Location','northeast');
ylim([0 max(Rmat(:))*1.1]);
print(fig2, fullfile(out_dir,'freespace_rmax.png'), '-dpng', '-r150');

fprintf('\n图件已保存至 %s\n', out_dir);
fprintf('\n===== P2 自由空间基准完成: 灵敏度反推闭环, CRLB 时延打底就绪 =====\n');

function s = passfail(ok)
    if ok, s = '通过'; else, s = '需复核'; end
end
