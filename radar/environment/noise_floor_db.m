function [dN_db, detail] = noise_floor_db(radar, env)
% NOISE_FLOOR_DB  环境电磁底噪引起的噪声功率抬升 (dB)   [模块B2]
%   env.city_type - 'business'|'residential'|'rural' (ITU-R P.372 人为噪声分级)
%   env.emi_db    - 附加电磁干扰底噪抬升 (dB, 相对热噪声, 默认0)
%   输出: dN_db - 叠加到系统噪声系数的增量 (dB)
%   原理: ITU-R P.372, 系统噪声系数 f_tot = fa - 1 + fr
%         其中 fa 为外部噪声系数 (人为噪声+大气噪声), fr 为接收机噪声系数

    if ~isfield(env,'city_type'); env.city_type = 'business'; end
    if ~isfield(env,'emi_db');    env.emi_db = 0;             end

    % ITU-R P.372 人为噪声中值: Fam = c - d*log10(f_MHz)
    switch env.city_type
        case 'business';     c = 76.8; d = 27.7;
        case 'residential';  c = 72.5; d = 27.7;
        case 'rural';        c = 67.2; d = 27.7;
    end
    f_mhz = radar.fc / 1e6;
    Fam_db = c - d*log10(f_mhz);          % 外部人为噪声系数 (dB)

    % 大气噪声温度贡献 (微波低仰角, 近似): Tatm ~ 150K @ X/Ku -> Fa_atm ~ -2.8dB
    Tatm = 150;  T0 = 290;
    Fa_atm_db = 10*log10(Tatm/T0);

    % 外部噪声合成 (功率相加), 仅计超出290K参考温度的部分 (基准NF已含T0)
    fa = 10^(Fam_db/10) + 10^(Fa_atm_db/10);
    fr = 10^(radar.NF/10);
    fa_excess = max(fa - 1, 0);          % 外部噪声超出kT0B的部分
    dN_db = 10*log10(1 + fa_excess/fr);

    % 附加EMI底噪抬升
    if env.emi_db > 0
        dN_db = dN_db + env.emi_db;
    end

    detail = struct('Fam_db',Fam_db,'Fa_atm_db',Fa_atm_db,...
                    'city_type',env.city_type,'emi_db',env.emi_db);
end
