function GUI_radar
% GUI_RADAR  雷达探测能力推演台 (创意科目二·子任务二 GUI)
%   三栏: 左参数配置+重算/运行; 中成果图件浏览+指标卡; 右部署推演单点查询
%   直连 config/core/environment/sim 现成函数, 参数动态可调即时重算
%   用法: cd 到项目根目录后 >> GUI_radar

    proj_root = fileparts(fileparts(mfilename('fullpath')));
    addpath(fullfile(proj_root,'config'), fullfile(proj_root,'core'), ...
            fullfile(proj_root,'environment'), fullfile(proj_root,'sim'));

    state.cur_name = '02C';
    state.radar = radar_02C();
    try
        state.city = city_load(fullfile(proj_root,'data'));
    catch
        state.city = [];
    end
    state.cur_png = 'composite_pd_map.png';

    f = uifigure('Name','雷达探测能力推演台','Position',[60 50 1200 760]);
    gl = uigridlayout(f,[3 3],'RowHeight',{42 '1x' 24},...
        'ColumnWidth',{'1x' '1.7x' '0.95x'});
    gl.RowSpacing = 6; gl.ColumnSpacing = 6;

    %% ===== 顶栏 (跨3列) =====
    top = uigridlayout(gl,[1 6],'ColumnWidth',{170 64 64 24 130 '1x'});
    top.Layout.Row = 1; top.Layout.Column = [1 3];
    top.RowSpacing = 6; top.ColumnSpacing = 6;
    uilabel(top,'Text','雷达探测能力推演台','FontWeight','bold','FontSize',13,...
        'HorizontalAlignment','left');
    b02c = uibutton(top,'Text','02C','ButtonPushedFcn',@sel02c);
    b03d = uibutton(top,'Text','03D','ButtonPushedFcn',@sel03d);
    uilabel(top,'Text','');
    runbtn = uibutton(top,'Text','▶ 运行 run_all','ButtonPushedFcn',@runall);
    statLbl = uilabel(top,'Text','就绪','HorizontalAlignment','right','FontSize',10);

    %% ===== 左栏: 参数配置 =====
    left = uigridlayout(gl,[10 2],'RowHeight',{22 22 22 22 22 22 22 24 8 '1x'});
    left.Layout.Row = 2; left.Layout.Column = 1;
    left.RowSpacing = 4; left.ColumnSpacing = 4;
    lblCfg = uilabel(left,'Text','参数配置','FontWeight','bold','HorizontalAlignment','left');
    lblCfg.Layout.Column = [1 2];
    uilabel(left,'Text','峰值功率 Pt (W)','HorizontalAlignment','left');
    edPt = uieditfield(left,'numeric','Value',state.radar.Pt);
    uilabel(left,'Text','收发增益 Gt (dB)','HorizontalAlignment','left');
    edGt = uieditfield(left,'numeric','Value',state.radar.Gt);
    uilabel(left,'Text','中心频率 fc (GHz)','HorizontalAlignment','left');
    edFc = uieditfield(left,'numeric','Value',state.radar.fc/1e9);
    uilabel(left,'Text','脉宽 (us)','HorizontalAlignment','left');
    edPw = uieditfield(left,'numeric','Value',state.radar.pulse_width*1e6);
    uilabel(left,'Text','PRF (kHz)','HorizontalAlignment','left');
    edPrf = uieditfield(left,'numeric','Value',state.radar.prf/1e3);
    uilabel(left,'Text','相参脉冲数','HorizontalAlignment','left');
    edNp = uieditfield(left,'numeric','Value',state.radar.n_pulses);
    recompBtn = uibutton(left,'Text','↻ 重算指标','ButtonPushedFcn',@recompute);
    recompBtn.Layout.Column = [1 2];
    lblGap1 = uilabel(left,'Text','');
    lblGap1.Layout.Column = [1 2];
    envg = uigridlayout(left,[2 4]);
    envg.Layout.Row = 10; envg.Layout.Column = [1 2];
    envg.RowSpacing = 4; envg.ColumnSpacing = 4;
    uilabel(envg,'Text','RCS(m²)','HorizontalAlignment','left');
    edRcs = uieditfield(envg,'numeric','Value',0.01);
    uilabel(envg,'Text','雨强(mm/h)','HorizontalAlignment','left');
    edRain = uieditfield(envg,'numeric','Value',0);
    uilabel(envg,'Text','EMI(dB)','HorizontalAlignment','left');
    edEmi = uieditfield(envg,'numeric','Value',0);
    uilabel(envg,'Text','架高(m)','HorizontalAlignment','left');
    edHr = uieditfield(envg,'numeric','Value',30);

    %% ===== 中栏: 成果图件浏览 + 指标卡 =====
    ctr = uigridlayout(gl,[3 1],'RowHeight',{26 '1x' 46});
    ctr.Layout.Row = 2; ctr.Layout.Column = 2;
    ctr.RowSpacing = 4; ctr.ColumnSpacing = 4;
    tg = uitabgroup(ctr);
    tg.Layout.Row = 1; tg.Layout.Column = 1;
    tabs = struct('title',{},'png',{});
    tabdefs = {'自由空间','freespace_snr_pd.png'; '气象','env_weather_noise.png'; ...
        '多径','multipath_coverage.png'; '遮挡','occlusion_results.png'; ...
        '失效','failure_boundary.png'; '全因子','composite_pd_map.png'};
    for i = 1:size(tabdefs,1)
        t = uitab(tg,'Title',tabdefs{i,1});
        t.UserData = tabdefs{i,2};
    end
    tg.SelectionChangedFcn = @onTab;
    imgAx = uiaxes(ctr);
    imgAx.Layout.Row = 2; imgAx.Layout.Column = 1;
    imgAx.Toolbar = [];
    title(imgAx,'成果图件 (运行 run_all 后刷新)');
    metricG = uigridlayout(ctr,[1 4]);
    metricG.Layout.Row = 3; metricG.Layout.Column = 1;
    metricG.RowSpacing = 6; metricG.ColumnSpacing = 6;
    mLbl1 = uilabel(metricG,'Text','R_max: -','HorizontalAlignment','left','FontSize',11);
    mLbl2 = uilabel(metricG,'Text','R_min: -','HorizontalAlignment','left','FontSize',11);
    mLbl3 = uilabel(metricG,'Text','R_unamb: -','HorizontalAlignment','left','FontSize',11);
    mLbl4 = uilabel(metricG,'Text','可用脉冲: -','HorizontalAlignment','left','FontSize',11);

    %% ===== 右栏: 部署推演查询 =====
    rgt = uigridlayout(gl,[14 2],'RowHeight',{22 22 22 22 22 24 6 18 18 18 18 18 6 '1x'});
    rgt.Layout.Row = 2; rgt.Layout.Column = 3;
    rgt.RowSpacing = 4; rgt.ColumnSpacing = 4;
    lblRgt = uilabel(rgt,'Text','部署推演查询','FontWeight','bold','HorizontalAlignment','left');
    lblRgt.Layout.Column = [1 2];
    uilabel(rgt,'Text','雷达 x (m)','HorizontalAlignment','left');
    edRx = uieditfield(rgt,'numeric','Value',0);
    uilabel(rgt,'Text','雷达 y (m)','HorizontalAlignment','left');
    edRy = uieditfield(rgt,'numeric','Value',0);
    uilabel(rgt,'Text','目标 x (m)','HorizontalAlignment','left');
    edTx = uieditfield(rgt,'numeric','Value',1500);
    uilabel(rgt,'Text','目标 y (m)','HorizontalAlignment','left');
    edTy = uieditfield(rgt,'numeric','Value',0);
    uilabel(rgt,'Text','目标相对高 (m)','HorizontalAlignment','left');
    edTht = uieditfield(rgt,'numeric','Value',100);
    queryBtn = uibutton(rgt,'Text','查询 city_los','ButtonPushedFcn',@query);
    queryBtn.Layout.Column = [1 2];
    lblGap2 = uilabel(rgt,'Text','');
    lblGap2.Layout.Column = [1 2];
    lblRes = uilabel(rgt,'Text','结果','FontWeight','bold','HorizontalAlignment','left');
    lblRes.Layout.Column = [1 2];
    uilabel(rgt,'Text','通视','HorizontalAlignment','left');
    lblVis = uilabel(rgt,'Text','-','HorizontalAlignment','left');
    uilabel(rgt,'Text','遮蔽角 (°)','HorizontalAlignment','left');
    lblMask = uilabel(rgt,'Text','-','HorizontalAlignment','left');
    uilabel(rgt,'Text','衍射 (dB)','HorizontalAlignment','left');
    lblDiff = uilabel(rgt,'Text','-','HorizontalAlignment','left');
    uilabel(rgt,'Text','SNR (dB)','HorizontalAlignment','left');
    lblSnr = uilabel(rgt,'Text','-','HorizontalAlignment','left');
    uilabel(rgt,'Text','Pd','HorizontalAlignment','left');
    lblPd = uilabel(rgt,'Text','-','HorizontalAlignment','left');
    lblGap3 = uilabel(rgt,'Text','');
    lblGap3.Layout.Column = [1 2];
    maskAx = uiaxes(rgt);
    maskAx.Layout.Row = 14; maskAx.Layout.Column = [1 2];
    maskAx.Toolbar = [];
    title(maskAx,'360° 遮蔽角'); axis(maskAx,'off');

    %% ===== 底栏 =====
    bot = uigridlayout(gl,[1 3],'ColumnWidth',{'1x' '1x' '1x'});
    bot.Layout.Row = 3; bot.Layout.Column = [1 3];
    uilabel(bot,'Text','results/ · 8 png','HorizontalAlignment','left','FontSize',10);
    uilabel(bot,'Text','LOS 0.8–1.1 ms / 查询','HorizontalAlignment','center','FontSize',10);
    uilabel(bot,'Text','MATLAB R2025a','HorizontalAlignment','right','FontSize',10);

    %% ===== 初始化 =====
    fillParams();
    recompute();
    showImg(state.cur_png);

    % ===================== 嵌套回调 =====================
    function sel02c(~,~)
        state.cur_name = '02C'; state.radar = radar_02C(); fillParams(); recompute();
    end
    function sel03d(~,~)
        state.cur_name = '03D'; state.radar = radar_03D(); fillParams(); recompute();
    end

    function fillParams()
        r = state.radar;
        edPt.Value = r.Pt; edGt.Value = r.Gt; edFc.Value = r.fc/1e9;
        edPw.Value = r.pulse_width*1e6; edPrf.Value = r.prf/1e3; edNp.Value = r.n_pulses;
    end

    function r = buildRadarFromPanel()
        r = state.radar;
        r.Pt = edPt.Value; r.Gt = edGt.Value; r.fc = edFc.Value*1e9;
        r.pulse_width = edPw.Value*1e-6; r.prf = edPrf.Value*1e3; r.n_pulses = edNp.Value;
    end

    function recompute(~,~)  %#ok<INUSD>
        r = buildRadarFromPanel();
        [c,~] = radar_consts();
        rcs = edRcs.Value;
        Rmax = max_range(r, rcs, r.Pd_req, r.Pfa);
        Rmin = c*(r.pulse_width + 1e-6)/2;
        Runamb = c/(2*r.prf);
        el_bw = (r.el_cov(2)-r.el_cov(1))/r.el_beams;
        az_bw = 26000/(10^(r.Gt/10)*el_bw);
        dwell = az_bw/360*r.data_rate;
        n_avail = floor(dwell*r.prf);
        mLbl1.Text = sprintf('R_max: %.2f km %s', Rmax/1e3, passmark(Rmax>=r.R_spec));
        mLbl2.Text = sprintf('R_min: %.0f m', Rmin);
        mLbl3.Text = sprintf('R_unamb: %.1f km %s', Runamb/1e3, passmark(Runamb>=Rmax));
        mLbl4.Text = sprintf('可用脉冲: %d / 需%d %s', n_avail, r.n_pulses, passmark(n_avail>=r.n_pulses));
    end

    function runall(~,~)
        statLbl.Text = 'run_all 运行中… (约2分钟)'; drawnow;
        evalin('base', sprintf('run(''%s'')', fullfile(proj_root,'run_all.m')));
        statLbl.Text = 'run_all 完成'; drawnow;
        showImg(state.cur_png);
    end

    function onTab(src,~)
        t = src.SelectedTab;
        if isfield(t,'UserData') && ~isempty(t.UserData)
            state.cur_png = t.UserData;
            showImg(state.cur_png);
        end
    end

    function showImg(png)
        p = fullfile(proj_root,'results',png);
        if exist(p,'file')
            imshow(p,'Parent',imgAx);
        else
            cla(imgAx); title(imgAx,sprintf('%s (尚未生成, 请先运行 run_all)',png));
        end
    end

    function query(~,~)
        if isempty(state.city)
            statLbl.Text = '错误: 城市缓存未加载, 先跑 data/preprocess_city'; return;
        end
        r = buildRadarFromPanel();
        rx = edRx.Value; ry = edRy.Value; h_r = edHr.Value;
        tx = edTx.Value; ty = edTy.Value; h_t = edTht.Value;
        dem = state.city.dem;
        gz_r = interp2(dem.x, dem.y, dem.Z, rx, ry, 'linear');
        if isnan(gz_r), gz_r = median(dem.Z(:),'omitnan'); end
        gz_t = interp2(dem.x, dem.y, dem.Z, tx, ty, 'linear');
        if isnan(gz_t), gz_t = gz_r; end
        pR = [rx ry gz_r + h_r];
        pT = [tx ty gz_t + h_t];
        [vis,~,Ld] = city_los(pR, pT, state.city, r.fc);
        R_h = hypot(tx-rx, ty-ry);
        env = struct('rain_mmh',edRain.Value,'cloud_M',0,'city_type','business','emi_db',edEmi.Value);
        snr = composite_snr_db(r, R_h, h_t, h_r, edRcs.Value, env);
        if ~vis && snr > -900
            snr = snr - Ld;
        end
        pd = pd_swerling1(snr, r.Pfa);
        if vis, lblVis.Text = '是 · 通视'; else, lblVis.Text = '否 · 遮挡'; end
        mask = city_mask_map(pR, state.city, 360);
        lblMask.Text = sprintf('%.1f', max(mask));
        lblDiff.Text = sprintf('%.1f', Ld);
        lblSnr.Text = sprintf('%.1f', snr);
        lblPd.Text = sprintf('%.3f', pd);
        plotMask(mask);
        statLbl.Text = sprintf('查询完成: R=%.2fkm %s', R_h/1e3, ternary(vis,'通视','遮挡'));
    end

    function plotMask(mask)
        cla(maskAx);
        th = 0:359;
        M = max(mask); if M==0, M=1; end
        x = mask/M.*cosd(th); y = mask/M.*sind(th);
        hold(maskAx,'on');
        patch(maskAx, x, y, [0.1 0.37 0.65], 'FaceAlpha', 0.35, 'EdgeColor',[0.1 0.37 0.65]);
        th2 = 0:10:360;
        plot(maskAx, cosd(th2), sind(th2), '-', 'Color',[0.7 0.7 0.7], 'LineWidth',0.5);
        plot(maskAx, [1 -1],[0 0],'-','Color',[0.7 0.7 0.7],'LineWidth',0.5);
        plot(maskAx, [0 0],[1 -1],'-','Color',[0.7 0.7 0.7],'LineWidth',0.5);
        title(maskAx,sprintf('360° 遮蔽角 (max %.1f°)',max(mask)));
        axis(maskAx,'equal','off'); xlim(maskAx,[-1.15 1.15]); ylim(maskAx,[-1.15 1.15]);
    end

    function s = passmark(ok)
        if ok, s = '✓'; else, s = '✗'; end
    end
    function s = ternary(ok,a,b)
        if ok, s = a; else, s = b; end
    end
end
