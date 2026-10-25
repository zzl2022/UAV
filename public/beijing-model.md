# 北京故宫 5 km · GBA / OSM / CNBH + 天地图

本页说明 `beijing.html`：以**天地图影像**为底图，默认用 **GlobalBuildingAtlas (GBA) LoD1 逐栋轮廓与高度**重建故宫周边约 10 × 10 km；可切换 **OSM 轮廓 + CNBH-10m 高度**逐栋模型与 **CNBH-10m 20 m 体块**对照。

> 主界面的“场景模型 → 故宫模型”直接加载本页的 `beijing-gba.glb`；`beijing.html` 保留为独立详情页。

> GBA 是默认的优化层，提供逐栋轮廓与高度；许可为 **CC BY-NC 4.0（仅限非商业）**，必须署名。需要可商用数据时请使用 OSM + CNBH，或向数据提供方取得授权。GBA 文件缺失时页面自动回退到 OSM + CNBH。

## 范围与数据

- 中心：北京故宫 `116.3972°E, 39.9163°N`
- 范围：BBox `116.33864, 39.87108, 116.45576, 39.96152`（WGS84，约 10 × 10 km；页面同时绘制 5 km 半径圈）
- 默认逐栋：**GlobalBuildingAtlas LoD1**（TUM），WFS 图层 `global3D:lod1_global`，融合 3D-GloBFP 与 OpenStreetMap；高度为模型估计，不是实测
- 对照逐栋：**OpenStreetMap** building footprint（ODbL 1.0）
- 对照高度：**CNBH-10m** `CNBH10m_X117Y39.tif`（2020，10 m，CC BY 4.0）
- 对照体块：CNBH 10 m 高度按 2 m 取整、20 m 聚合
- 底图：天地图 WMTS `img_w` 影像，zoom 16，共 529 张 256 px 瓦片
- 天地图 tk 从 `.env.local` 的 `VITE_TIANDITU_TK` 读取，不写入源码

## 建模方法

1. **GBA 抓取（默认层）**：按 0.01° 分块请求 WFS 并缓存。截断或失败的分块自动细分为 0.005°、0.0025° 子块；全部分块成功后才写出 `raw.geojson`，支持中断续跑。
2. **GBA 转换**：按 `(source, ogc_fid)` 去重，避免 WFS 分块边界重复；使用 `ogc_fid` 生成唯一建筑 ID（3D-GloBFP 的 `id` 恒为 0，不能作为主键）。过滤高度 < 3 m、> 300 m 或面积 < 20 m² 的要素，再转换到以故宫为中心的 UTM 50N 局部米制坐标。
3. **OSM 逐栋**：Overpass 按 4 km 分块抓取建筑 footprint；过滤面积 < 20 m²。footprint 与 CNBH 栅格统一到 **UTM 50N 绝对坐标**后取覆盖像元最大高度；footprint 内无有效像元时查找约 60 m 内最近建筑像元，仍无覆盖才回退 OSM `height`/`building:levels`，最后用 6 m 近似。
4. **CNBH 对照层**：只读取 CNBH 北京瓦片的 10 km 窗口；10 m 高度按 2 m 取整、20 m 聚合，至少 75% 子像元有效才生成体块。
5. 三种模型都以故宫中心为原点的本地米制坐标；底图为**平面**（不含 DEM）。3D 视图叠加天地图影像地面；GBA/OSM 为不透明白模，CNBH 体块为半透明。
6. 生成 `beijing-gba.glb` / `beijing-osm.glb` / `beijing-cnbh.glb` 与 `beijing-imagery.jpg`，由页面切换加载。

## 本次结果

| 项 | GBA（默认） | OSM + CNBH | CNBH 体块 |
| --- | ---: | ---: | ---: |
| 建筑物/体块 | 74,083 | 20,798 | 56,237 |
| 高度范围 | 3–158.36 m | 3–54 m | 6–40 m |
| 高度来源 | GBA LoD1（3D-GloBFP/OSM） | CNBH-10m footprint 最大值 | CNBH-10m 2 m 量化 |
| GLB | 约 81.6 MB | 约 28.5 MB | 约 49 MB |
| 许可 | CC BY-NC 4.0（非商业） | ODbL + CC BY 4.0 | CC BY 4.0 |

- CNBH 窗口：1,008 × 997（10 m），有效像元 648,009 / 1,004,976。
- 天地图影像：2,034 × 2,048，529 瓦片。
- GBA 抓取覆盖检查：`metadata.coverageMargins` 记录 BBox 四边缺失边距；任一超过 0.01° 时转换脚本拒绝写出模型，防止把半个城区当成完整成果。
- GBA 原始要素 112,104 个（`raw.geojson` 约 49 MB）；最终 74,083 栋，跳过高度缺失/超出 3–300 m 23,521 个、面积 < 20 m² 14,500 个、分块边界重复 0 个。
- GBA 来源构成：3dglobfp 57,157 栋、OSM 16,926 栋（最终模型）；`featureBounds` 略超出 BBox，四边覆盖边距均为负值。

## 生成

```bash
# Windows：一次生成 OSM+CNBH+影像 与 GBA 默认层
npm run prepare:beijing:all:win
# POSIX
npm run prepare:beijing:all
```

也可以分开执行：

```bash
# 1) OSM + CNBH + 天地图影像
npm run prepare:beijing:win
# 2) GBA 默认逐栋层（可中断后续跑）
npm run prepare:beijing:gba:win
```

等价的核心命令：

```bash
.venv/Scripts/python.exe scripts/fetch_gba_bbox.py \
  --bbox 116.33864 39.87108 116.45576 39.96152 --workers 2 --delay 0.6
.venv/Scripts/python.exe scripts/prepare_beijing_gba_model.py
node scripts/export_beijing_gba_model.js

.venv/Scripts/python.exe scripts/fetch_cnbh_window.py --tile X117Y39 \
  --bbox 116.33864 39.87108 116.45576 39.96152 --margin 0 \
  --out artifacts/cnbh/cnbh_beijing.tif
.venv/Scripts/python.exe scripts/prepare_beijing_cnbh_model.py --cell-size 20 --min-coverage 0.75
node scripts/export_beijing_model.js
.venv/Scripts/python.exe scripts/fetch_osm_bbox.py \
  --bbox 116.33864 39.87108 116.45576 39.96152 --cell 0.04 --workers 2
.venv/Scripts/python.exe scripts/prepare_beijing_osm_model.py
node scripts/export_beijing_osm_model.js
.venv/Scripts/python.exe scripts/fetch_tianditu_imagery.py \
  --bbox 116.33864 39.87108 116.45576 39.96152 --zoom 16
```

## 页面

`beijing.html`：

- 天地图视图：影像/矢量/地形底图切换，青色框为 BBox，黄圈为 5 km 半径，标记为故宫。
- 3D 模型视图：默认加载 GBA 逐栋 LoD1；下拉框可切换 OSM + CNBH 逐栋与 CNBH-10m 20 m 体块；“聚焦故宫 / 全域”切换视角。
- 截图：`artifacts/beijing-gba-model.png`（默认）、`artifacts/beijing-osm-model.png`、`artifacts/beijing-cnbh-model.png`、`artifacts/beijing-model.png`（默认视图）、`artifacts/beijing-map.png`。
- 浏览器烟雾测试：`npm run test:beijing:browser`，会依次加载三种模型并验证天地图影像地面。

## 限制

- GBA LoD1 高度是卫星影像/机器学习与 OSM 融合的模型估计，不是实测；与 OSM/CNBH 的高度和轮廓并不一致，只用于可视化对比。
- GBA 许可为 **CC BY-NC 4.0**，仅限非商业使用并须署名（GlobalBuildingAtlas (TUM), 3D-GloBFP, © OpenStreetMap contributors）。
- OSM 轮廓是社区数据，完整度/几何质量不一；大型 multipolygon 关系可能未被抓到。
- CNBH-10m 是 10 m 机器学习高度（RMSE 约 6 m），不是实测；高度取 footprint 内有效像元最大值，10 m 分辨率会让密集建筑互相“借高”。
- CNBH-10m 对超高层明显低估：本次窗口最高值约 40 m，而 BBox 东缘 OSM 标注的国贸三期 A 为 330 m。OSM + CNBH 层按 CNBH 取高，因此该层高塔会偏低；默认 GBA 层最高 158.36 m，更接近高层分布，但同样不是实测。
- 平面基底，不含北京地形起伏；绝对高程无意义。
- 天地图影像是 WMTS 底图，不是测绘正射影像；受 tk 配额和服务条款约束。
- 数据许可：GBA **CC BY-NC 4.0**；OSM **ODbL 1.0**；CNBH-10m **CC BY 4.0**。署名：GlobalBuildingAtlas (TUM), 3D-GloBFP, © OpenStreetMap contributors; Wu et al. (2023), *Remote Sensing of Environment* 291:113578; Zenodo 10.5281/zenodo.7827315。
- 模型与影像只用于可视化，不用于测量、规划审批或真实部署。
