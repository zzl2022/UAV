# 北京大兴机场 10 km / 房山核设施 5 km / 北京—通州铁路 5 km 走廊

主界面“场景模型”下拉中的 **大兴机场模型（10 km）**、**北京核电站（房山）模型** 与 **北京—通州铁路（5 km）**，使用与故宫模型相同的 GBA LoD1 + 天地图影像流程：

1. 按 WGS84 BBox（大兴机场 20 × 20 km、核设施 10 × 10 km、铁路走廊约 32 × 11 km）抓取 GlobalBuildingAtlas LoD1 逐栋轮廓与高度；
2. 以片区中心为原点转换为本地 UTM 50N 米制坐标；
3. 拉伸为 LoD1 体块，并叠加对应 BBox 的天地图 z15/z16 影像地面；
4. 生成 GLB 与元数据，页面按需加载。

## 范围

| 模型 | 中心 | BBox（WGS84） | 影像 |
| --- | --- | --- | --- |
| 大兴机场（10 km） | `116.4105, 39.5098` | `116.2941, 39.4198, 116.5269, 39.5998` | 484 张 z15 瓦片，2043 × 2048 |
| 北京核电站（房山，5 km） | `116.0397, 39.7276` | `115.9813, 39.6826, 116.0981, 39.7726` | 506 张 z16 瓦片，2045 × 2048 |
| 北京—通州铁路（5 km 走廊） | 北京站—通州（示意线） | `116.3691, 39.8550, 116.7460, 39.9535` | 455 张 z15 瓦片，4096 × 1395 |

> 北京没有商业核电站。这里以**中国原子能科学研究院（房山）核设施**的位置作为“北京核电站”中心；若目标点不同，修改 `scripts/prepare_beijing_gba_model.py` 调用参数中的 `--center`/`--bbox` 后重跑即可。

## 数据与建模

- **建筑**：GlobalBuildingAtlas LoD1（TUM），WFS 图层 `global3D:lod1_global`，融合 3D-GloBFP 与 OpenStreetMap。过滤高度 < 3 m、> 300 m 或面积 < 20 m² 的要素；按 `(source, ogc_fid)` 去重并使用唯一 ID。
- **高度**：GBA LoD1 模型估计，不是实测；与源 SHP/CNBH 高度不一致。
- **地形**：与故宫模型一致，为**平面基底 + 天地图影像地面**，不含 DEM；绝对高程无意义。
- **影像**：天地图 WMTS `img_w`，大兴机场/铁路走廊 z15、核设施 z16；影像按 BBox 裁剪，Web Mercator 影像贴到局部米制地面。拼接后按瓦片做亮度/曝光均衡（低分辨率增益场 + 低频校正，`--normalize`），减少不同拍摄时相造成的明暗块；云影/时相色差无法完全消除。
- **许可**：GBA 为 **CC BY-NC 4.0（非商业）**，署名：GlobalBuildingAtlas (TUM), 3D-GloBFP, © OpenStreetMap contributors；天地图影像受服务条款约束，仅用于演示/研究并保留署名。

## 本次结果

| 模型 | 建筑 | 高度范围 | GLB |
| --- | ---: | ---: | ---: |
| 大兴机场（10 km） | 14,286 | 3–81.43 m | 约 30.2 MB |
| 房山核设施 | 20,780 | 3–45.6 m | 约 22.8 MB |
| 北京—通州铁路走廊 | 114,564 | 3–158.36 m | 约 139.6 MB |

- 大兴机场 10 km GBA 合并后原始要素 18,735 个，过滤后 14,286 栋；机场航站楼以大型低层体块呈现，跑道由影像地面表达。
- 房山核设施 GBA 原始要素 34,834 个，过滤后 20,780 栋；覆盖房山新城及周边建筑，核设施本身在影像/GBA 中可能因分辨率或数据发布策略而细节有限。
- 核心建筑由 `coreBuilding` 记录并由主界面高光轮廓标出：大兴机场 = 航站楼；故宫 = 太和殿（目标点 116.3907,39.9165 附近最高建筑）；核设施 = 核心建筑（推测）；铁路走廊 = 北京站。主界面“⌖ 核心建筑”按钮可快速定位，建筑名会显示在模型上方。
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

输出：

- `public/data/sites/daxing/daxing-gba.json` / `.glb` / `-meta.json`
- `public/data/sites/daxing/daxing-imagery.jpg` / `.json`
- `public/data/sites/nuclear/nuclear-gba.json` / `.glb` / `-meta.json`
- `public/data/sites/nuclear/nuclear-imagery.jpg` / `.json`
- `public/data/sites/railway/railway-gba.json` / `.glb` / `-meta.json`
- `public/data/sites/railway/railway-imagery.jpg` / `.json`

原始 WFS 分块缓存位于 `artifacts/gba-daxing/`、`artifacts/gba-daxing-10km/`、`artifacts/gba-nuclear/`、`artifacts/gba-railway/`（不提交到 Git）。

## 页面与验证

- 主界面下拉选择“大兴机场模型（10 km）”“北京核电站（房山）模型”或“北京—通州铁路（5 km）”后，按需加载对应 GLB/影像；相机自动适配，可切换“全域视角 / 俯视平面”。
- 每个 GBA 模型的核心建筑用黄色高光轮廓标出，建筑名显示为可点击标签；“⌖ 核心建筑”按钮可快速定位。
- 非重建模型下，建筑属性、图层开关、装备建模、部署与飞行入口会隐藏或禁用，避免把郑州的传感器/规划数据套到北京片区。
- `npm test` 会校验两个片区的 JSON、GLB 头、唯一 ID、轮廓闭合、高度范围、核心建筑元数据与影像 BBox；若数据未生成则跳过。
- 浏览器验证：`npm run test:sites:browser`（需先启动开发服务器并安装 Chromium）；截图保存为 `artifacts/site-daxing-model.png`、`artifacts/site-nuclear-model.png`。

## 限制

- 平面基底，不含北京地形起伏；影像只是地面底图，不是测绘正射影像。
- 铁路走廊的走向是示意折线，不是精确线路中心线；铁路模型为沿线 5 km 范围的建筑与影像，GLB 约 140 MB，加载较慢。
- GBA 在机场/郊区的建筑完整度和高度精度有限；核设施片区的敏感/附属建筑可能缺失或高度估计偏低。
- 影像为天地图 WMTS 拼接，受 tk 配额、服务条款和网络影响；道路/水体等以影像为准。不同拍摄时相/云影造成的残余色差无法完全消除。
- 模型只用于可视化对比，不用于测量、规划审批、核设施安全评估或真实部署。
