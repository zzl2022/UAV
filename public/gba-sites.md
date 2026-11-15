# GBA LoD1 站点模型：北京片区 / 杭州萧山机场 / 海南昌江核电厂 / 深圳国际交流中心

主界面“场景模型”下拉中的 **深圳国际交流中心**、**大兴机场**、**杭州萧山机场**、**房山核设施**、**海南昌江核电厂** 与 **北京—通州铁路**，使用与故宫模型相同的 GBA LoD1 + 天地图影像流程：

1. 按 WGS84 BBox（深圳国际交流中心 10 × 10 km、大兴机场 20 × 20 km、萧山机场 10 × 10 km、核设施 10 × 10 km、昌江核电厂 10 × 10 km、铁路走廊约 32 × 11 km）抓取 GlobalBuildingAtlas LoD1 逐栋轮廓与高度；
2. 以片区中心为原点转换为局部横轴墨卡托（local_tmerc）米制坐标，使网格北方向与北向上的天地图影像一致；
3. 拉伸为 LoD1 体块，并叠加对应 BBox 的天地图 z15/z16 影像地面；
4. 生成 GLB 与元数据，页面按需加载。

## 范围

| 模型 | 中心 | BBox（WGS84） | 影像 |
| --- | --- | --- | --- |
| 大兴机场（10 km） | `116.4105, 39.5098` | `116.2941, 39.4198, 116.5269, 39.5998` | 484 张 z15 瓦片，2043 × 2048 |
| 杭州萧山机场（5 km） | `120.4344, 30.2295` | `120.3824, 30.1846, 120.4864, 30.2744` | 100 张 z15 瓦片，2048 × 2046 |
| 深圳国际交流中心（5 km） | `114.02412, 22.54741` | `113.9755, 22.5025, 114.0728, 22.5923` | 342 张 z16 瓦片，2048 × 2046 |
| 房山核设施（5 km） | `116.0397, 39.7276` | `115.9813, 39.6826, 116.0981, 39.7726` | 506 张 z16 瓦片，2045 × 2048 |
| 海南昌江核电厂（5 km） | `108.8960, 19.4590` | `108.8484, 19.4141, 108.9436, 19.5039` | 342 张 z16 瓦片，2048 × 2048 |
| 北京—通州铁路（5 km 走廊） | 北京站—通州（示意线） | `116.3691, 39.8550, 116.7460, 39.9535` | 455 张 z15 瓦片，4096 × 1395 |

> 北京没有商业核电站。房山场景以**中国原子能科学研究院（房山）核设施**的位置为中心；海南场景以**昌江核电厂**厂址（约 `108.8960, 19.4590`）为中心。若目标点不同，修改 `scripts/prepare_beijing_gba_model.py` 调用参数中的 `--center`/`--bbox` 后重跑即可。

## 数据与建模

- **建筑**：GlobalBuildingAtlas LoD1（TUM），WFS 图层 `global3D:lod1_global`，融合 3D-GloBFP 与 OpenStreetMap。过滤高度 < 3 m、> 300 m 或面积 < 20 m² 的要素；按 `(source, ogc_fid)` 去重并使用唯一 ID。
- **高度**：GBA LoD1 模型估计，不是实测；与源 SHP/CNBH 高度不一致。
- **地形**：与故宫模型一致，为**平面基底 + 天地图影像地面**，不含 DEM；绝对高程无意义。
- **影像**：天地图 WMTS `img_w`，大兴机场/杭州萧山机场/铁路走廊 z15，房山核设施/海南昌江核电厂 z16；影像按 BBox 裁剪，Web Mercator 影像贴到局部米制地面。拼接后按瓦片做亮度/曝光均衡（低分辨率增益场 + 低频校正，`--normalize`），减少不同拍摄时相造成的明暗块；云影/时相色差无法完全消除。
- **许可**：GBA 为 **CC BY-NC 4.0（非商业）**，署名：GlobalBuildingAtlas (TUM), 3D-GloBFP, © OpenStreetMap contributors；天地图影像受服务条款约束，仅用于演示/研究并保留署名。

## 本次结果

| 模型 | 建筑 | 高度范围 | GLB |
| --- | ---: | ---: | ---: |
| 大兴机场（10 km） | 14,286 | 3–81.43 m | 约 30.2 MB |
| 杭州萧山机场（5 km） | 25,316 | 3–39.58 m | 约 29.4 MB |
| 深圳国际交流中心（5 km） | 19,960 | 3–175.63 m | 约 30.9 MB |
| 房山核设施 | 20,780 | 3–45.6 m | 约 22.8 MB |
| 海南昌江核电厂（5 km） | 1,179 | 3–40.03 m | 约 1.5 MB |
| 北京—通州铁路走廊 | 114,564 | 3–158.36 m | 约 139.6 MB |

- 大兴机场 10 km GBA 合并后原始要素 18,735 个，过滤后 14,286 栋；机场航站楼以大型低层体块呈现，跑道由影像地面表达。
- 杭州萧山机场 5 km GBA 原始要素 47,574 个，过滤后 25,316 栋；航站楼按 2.2 km 内最大占地面积选择，跑道与周边路网由影像表达。
- 深圳国际交流中心 5 km GBA 原始要素 24,582 个，过滤后 19,960 栋；GBA 未覆盖 2025 年新建的会议中心，核心建筑使用按公开会址范围（OSM way 1080860977 / 项目公开资料）生成的 420 × 240 m、高 44.76 m 近似轮廓，并按天地图影像将中心校准到会址施工区（约 114.02385, 22.54610）；该轮廓仅用于定位与高亮，不代表真实建筑轮廓。
- 房山核设施 GBA 原始要素 34,834 个，过滤后 20,780 栋；覆盖房山新城及周边建筑，核设施本身在影像/GBA 中可能因分辨率或数据发布策略而细节有限。
- 海南昌江核电厂 5 km GBA 原始要素 1,748 个，过滤后 1,179 栋；厂址周边数据较稀疏，核心建筑按 1.8 km 内最大占地面积选择（推测），不代表真实反应堆位置。
- 核心建筑由 `coreBuilding` 记录并由主界面高光轮廓标出：大兴机场 = 航站楼；萧山机场 = 航站楼；深圳国际交流中心 = 会址近似轮廓（GBA 未覆盖）；故宫 = 太和殿；房山 = 房山核设施；昌江 = 昌江核电厂；铁路走廊 = 北京站。主界面“⌖ 核心建筑”按钮可快速定位，建筑名会显示在模型上方。
- 铁路走廊的 `metadata.route` 保存示意折线；主界面用青色线叠加显示铁路走向。路线是示意线，建筑与影像为真实数据。

## 生成

```bash
# Windows：一次生成两个片区（GBA + GLB + 天地图影像）
npm run prepare:sites:win
# POSIX
npm run prepare:sites
```

也可以单独生成：

```bash
npm run prepare:daxing:win      # 或 prepare:daxing
npm run prepare:nuclear:win     # 或 prepare:nuclear
npm run prepare:railway:win     # 或 prepare:railway
```

所有站点当前均使用 `--projection local`：以站点中心为原点的局部横轴墨卡托，避免 UTM 带边缘的旋转偏移导致建筑压到影像跑道上。杭州萧山机场与海南昌江核电厂使用同一组脚本生成；中心/BBox 见上表，GBA 抓取、体块导出和天地图影像命令与大兴/核设施示例一致。

输出：

- `public/data/sites/daxing/daxing-gba.json` / `.glb` / `-meta.json`
- `public/data/sites/daxing/daxing-imagery.jpg` / `.json`
- `public/data/sites/hangzhou/hangzhou-gba.json` / `.glb` / `-meta.json`
- `public/data/sites/hangzhou/hangzhou-imagery.jpg` / `.json`
- `public/data/sites/shenzhen/shenzhen-gba.json` / `.glb` / `-meta.json`
- `public/data/sites/shenzhen/shenzhen-imagery.jpg` / `.json`
- `public/data/sites/nuclear/nuclear-gba.json` / `.glb` / `-meta.json`
- `public/data/sites/nuclear/nuclear-imagery.jpg` / `.json`
- `public/data/sites/changjiang/changjiang-gba.json` / `.glb` / `-meta.json`
- `public/data/sites/changjiang/changjiang-imagery.jpg` / `.json`
- `public/data/sites/railway/railway-gba.json` / `.glb` / `-meta.json`
- `public/data/sites/railway/railway-imagery.jpg` / `.json`

原始 WFS 分块缓存位于 `artifacts/gba-daxing/`、`artifacts/gba-daxing-10km/`、`artifacts/gba-nuclear/`、`artifacts/gba-railway/`（不提交到 Git）。

## 页面与验证

- 主界面下拉选择深圳国际交流中心、大兴机场、杭州萧山机场、房山核设施、海南昌江核电厂或北京—通州铁路后，按需加载对应 GLB/影像；相机自动适配，可切换“全域视角 / 俯视平面”。
- 每个 GBA 模型的核心建筑用黄色高光轮廓标出，建筑名显示为可点击标签；“⌖ 核心建筑”按钮可快速定位。房山核设施和海南昌江核电厂还会高亮核心建筑周边 250 m 内建筑。
- 所有站点均支持感知装备建模、部署仿真推演和飞行演示：以站点核心建筑为防护目标，使用 GBA 建筑和站点平面地面构建分析场景；站点分析使用同一套 GBA 建筑适配器和局部米制坐标。
- `npm test` 会校验各站点的 JSON、GLB 头、唯一 ID、轮廓闭合、高度范围、核心建筑元数据与影像 BBox；若数据未生成则跳过。
- 浏览器验证：`npm run test:sites:browser`（需先启动开发服务器并安装 Chromium）；截图保存为 `artifacts/site-*.png`。

## 限制

- 所有 GBA 站点均为平面基底，不含 DEM 地形起伏；影像只是地面底图，不是测绘正射影像。
- 铁路走廊的走向是示意折线，不是精确线路中心线；铁路模型为沿线 5 km 范围的建筑与影像，GLB 约 140 MB，加载较慢。
- GBA 在机场/郊区/新建片区的建筑完整度和高度精度有限；深圳国际交流中心等 2025 年新建会场不在 GBA 中，核心轮廓为会址近似标记，不能用于量测。
- 核设施片区的敏感/附属建筑可能缺失或高度估计偏低。
- 影像为天地图 WMTS 拼接，受 tk 配额、服务条款和网络影响；道路/水体等以影像为准。不同拍摄时相/云影造成的残余色差无法完全消除。
- 模型只用于可视化对比，不用于测量、规划审批、核设施安全评估或真实部署。
