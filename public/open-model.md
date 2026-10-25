# 开源白模：GlobalBuildingAtlas LoD1

本页说明 GlobalBuildingAtlas LoD1 开源白模的数据来源、生成方法、许可与限制。主界面现在通过“场景模型”下拉切换：**原白模**（源 `NoLod_*.glb`）、**重建模型**、**故宫模型**；GBA LoD1 不再作为主界面勾选图层，但生成脚本与 `public/data/open-lod1.*` 保留，可用于独立对比。原始 `NoLod_*.glb` 仍保留在 `创意二文件/创意二数据集/区域数据/白模/`。

## 数据来源

- 数据集：**GlobalBuildingAtlas LoD1**（TUM，2025）
- 访问方式：TUM 公开 WFS，图层 `global3D:lod1_global`
- 上游构成：`3D-GloBFP` 与 `OpenStreetMap` 建筑融合；本次片区拉取的要素中两者均有出现
- 许可：**CC BY-NC 4.0**（署名、非商业）
- 署名：`GlobalBuildingAtlas (TUM), 3D-GloBFP, © OpenStreetMap contributors`
- 引用：Zhu et al. (2025), *GlobalBuildingAtlas: an open global and complete dataset of building polygons, heights and LoD1 3D models*, Earth System Science Data, <https://doi.org/10.5194/essd-17-6647-2025>
- 数据集主页：<https://huggingface.co/datasets/zhu-xlab/GBA.LoD1>

> 该数据不是高德、百度、腾讯或天地图的开放数据。这些厂商的三维建筑只在其客户端渲染，官方不提供可导出的模型或开放许可；抓取其瓦片不符合服务条款。

## 生成方法

脚本：`scripts/prepare_open_model.py`，导出脚本：`scripts/export_open_model.js`。

1. 读取 `building/zheng_apart.shp` 文件头的外包框（EPSG:3857），转换为 WGS84，并向四周扩展约 0.001°。
2. 通过 GBA 公开 WFS 按 6 × 3 子块拉取 `lod1_global` 要素；每个子块缓存到 `artifacts/open-lod1-cells/`，合并后缓存为 `artifacts/open-lod1-raw.geojson`。
3. 读取 `白模/zhengzhou1/tileset.json` 的 ENU→ECEF 变换，将 WGS84 经纬度与 DEM 高程转换为与重建城市一致的 Three.js 局部坐标 `[东, 上, -北]`，单位米。
4. 对每个建筑轮廓的所有顶点在 `dem/dem.tif` 中采样地面高程：
   - 基底取顶点高程最大值；
   - 基础深度取最大值与最小值之差，用于封闭底面；
   - DEM 空缺像元使用 100 m 内最近有效像元，并记录次数与最大距离。
5. 默认过滤 GBA 高度小于 2 m 的体块；无法获得 DEM 支撑的轮廓不生成。
6. 使用与重建城市相同的挤出与三角化代码（`buildCityGeometry`）生成单一网格，删除按高度着色的顶点色，使用中性灰白材质，导出 `public/data/open-lod1.glb`。
7. 同时输出 `public/data/open-lod1.json`（本地 ENU 轮廓与元数据）和 `public/data/open-lod1-meta.json`（来源、许可、哈希、网格统计）。

## 本次生成结果

| 项 | 数值 |
| --- | ---: |
| WFS 原始要素 | 35,840 |
| 生成建筑体块 | 25,960 |
| 过滤（高度 < 2 m） | 3,620 |
| 无 DEM 支撑的部件 | 6,260 |
| 高度范围 | 2.0–86.2 m |
| GLB 大小 | 约 34 MB |
| 局部 ENU 原点 | 113.66217° E / 34.78890° N / -3.51 m |

原始 GBA 要素数多于仓库 SHP 的 15,889 栋，包含更多小型/附属建筑；GBA 的最高高度（86.2 m）明显低于源 SHP 的 136 m。这是两个独立产品的差异，不代表源 SHP 错误。

## 限制

- **高度是模型估计**，不是实测值；GBA 的高度来自卫星影像/机器学习与 OSM 融合，论文报告的误差量级约为米级，不能用于测绘、结构设计或精确日照分析。
- 轮廓与高度均与仓库 SHP 不完全一致；本图层仅用于视觉对比，不可用于替换子任务一的真实建筑数据。
- 该图层**不参与**装备感知、遮挡或部署优化的计算；这些计算始终使用子任务一的重建建筑与 DEM。
- 模型没有立面纹理、屋顶细节、树木或街道语义；材质为单一灰白，仅表达体块。
- 源 DEM 的垂直基准未注明；绝对高程不是测绘级海拔。
- 许可为 CC BY-NC 4.0：**不得用于商业用途**，转载/展示必须保留署名与许可说明。若项目需要商业使用，应改用 OSM/Overture 等许可更宽松的数据，并重新评估高度缺失问题。
- WFS 是公开的在线浏览服务，存在限流/会话过期；脚本按子块重试并缓存，但不保证长期可用。重新生成需要网络。本项目只拉取一个城市片区；大批量使用请改用官方 HuggingFace/mediaTUM 数据集，不要对 WFS 做批量抓取。

## 复现

```bash
# POSIX
npm run prepare:open-model
# Windows
npm run prepare:open-model:win
```

默认复用 `artifacts/open-lod1-raw.geojson` 与 `artifacts/open-lod1-cells/`，离线即可重跑；加 `--refresh` 强制重新拉取。也可以直接指定已下载的原始要素：

```bash
.venv/Scripts/python.exe scripts/prepare_open_model.py --input artifacts/open-lod1-raw.geojson
node scripts/export_open_model.js
```

相关文件：

- `scripts/prepare_open_model.py`：WFS 拉取、ENU/DEM 转换、JSON 输出
- `scripts/export_open_model.js`：GLB 导出与元数据哈希
- `public/data/open-lod1.json`：本地 ENU 建筑轮廓
- `public/data/open-lod1.glb`：浏览器加载的白模
- `public/data/open-lod1-meta.json`：来源、许可、统计与哈希

城市重建与街景演示使用独立页面 `sat3dgen.html`，说明见 [Sat3DGen 说明](sat3dgen.md)。
