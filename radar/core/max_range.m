function R_max = max_range(radar, rcs, Pd, Pfa)
% MAX_RANGE  由距离方程(能量形式)反解最大探测距离 (m)
%   R^4 = Pt*tau*Gt*Gr*lambda^2*rcs*n / ((4pi)^3 * k*T0*NF*L*SNR_req)

    [c, k]  = radar_consts();
    T0      = 290;
    lambda  = c / radar.fc;
    snr_req = 10^(snr_required(Pd, Pfa)/10);

    R4 = radar.Pt * radar.pulse_width * 10^(radar.Gt/10) * 10^(radar.Gr/10) * ...
         lambda^2 * rcs * radar.n_pulses / ...
         ((4*pi)^3 * k * T0 * 10^(radar.NF/10) * ...
          10^(radar.L_sys/10) * snr_req);

    R_max = R4^0.25;
end
