# UAV · 郑州三维城市地理建模

基于本仓库 **郑州市河南博物院片区** 的真实建筑 Shapefile 与 DEM，自动生成可浏览、可导出的三维城市模型。使用 Three.js 渲染，不需要地图服务 Token 或第三方在线底图。

## 启动

需要 Node.js ≥ 22.12（推荐 Node 24）、Python 3.12，以及支持 WebGL 的浏览器。在仓库根目录执行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run prepare:data
npm run dev
```

浏览器打开开发服务器输出的地址。默认 Vite 端口 5173。若机器的默认 npm 缓存目录不可写，可给 npm 命令加 `npm_config_cache=/tmp/uav-npm-cache`；无需禁用 TLS 验证。

界面支持全域视角、俯视、建筑拾取、建筑/地形图层开关、线框显示、原始 GLB 白模对比，以及三维 GLB 和二维 WGS84 GeoJSON 下载。原始白模和重建建筑互斥显示，避免叠加误读。GLB 导出始终包含完整重建建筑和 DEM，不受图层可见性影响，不包含对比白模。

## 使用的数据

源目录：`创意二文件/创意二数据集/区域数据/`。

| 数据 | 用途 |
| --- | --- |
| `building/zheng_apart.shp` 及配套文件 | 15,889 个建筑轮廓；原始坐标系 EPSG:3857 |
| `building/zheng_apart.dbf` 的 `high` | 实际建筑高度字段，3–136 米；不使用随机高度或默认层高 |
| `dem/dem.tif` | EPSG:4326 地面高程，407 × 188 像元；有效高程 64–139 米 |
| `白模/zhengzhou1/tileset.json` | 地理定位原点及 ENU→ECEF 变换 |
| `白模/zhengzhou1/NoLod_*.glb` | 原始三维白模对比图层 |

源数据及原始说明文档保持不变。当前仓库没有正射影像文件、道路中心线文件，不会凭空生成道路或影像。街区空隙来自实际建筑轮廓。

## 建模方法与精度边界

1. 读取 SHP 的 `.prj`、`.cpg` 和 `high`，校验多边形并保留内环。若有无效几何，使用 Shapely 修复并计数；没有可用面时记录排除项。
2. 将建筑 EPSG:3857 转换到 WGS84，在 DEM 中按包含该位置的像元取地面高程。单栋建筑以轮廓顶点最高地面值作为屋顶起算面，向下延伸至最低样本形成基础；屋顶为平面，属于 LoD1 建模。
3. 使用 WGS84 三维坐标→ECEF→局部 ENU 的完整转换，复用原始 Tileset 变换。Three.js 坐标为 `[东, 上, -北]`，单位米。地理原点及 ECEF 变换保存在模型 metadata / GLB extras，导入 GIS 时需使用该变换；普通 GLB 查看器只显示局部坐标。
4. DEM 中 27,378 个 NoData 像元不生成地形三角面，保留真实覆盖边界和空缺。23 次建筑顶点采样落在 NoData 中，采用 100 米内最近有效像元，实际最远约 40.02 米；计数和距离写入报告。超过阈值或超出栅格范围时直接报错，避免无限外推。
5. 建筑按顶点颜色批量合并为单个网格，支持三角面到原始建筑的拾取；地形保留源像元中心采样，不伪造额外高分辨率细节。

**限制：** 源 DEM 未注明垂直基准，当前按原始高程作为 WGS84 三维高度输入，未做似大地水准面改正。成果不能据此宣称测绘级绝对高程精度。原始白模的高度语义也未注明，因此单独提供对比，不承诺其与重建建筑屋顶完全一致。模型没有屋顶细节、纹理、树木或街道语义。本实现聚焦三维环境建模，不包含装备建模、传播分析或部署优化。

## 验证与导出

先执行 `npm run prepare:data`，再运行：

```bash
npm test
npm run build
npm run export:model
```

- `npm test`：验证真实要素完整性、源高度范围、内院保留、建筑几何、地形 NoData 处理及法线。
- `npm run build`：输出可静态部署的 `dist/`，支持子路径部署。
- `npm run export:model`：输出 `artifacts/zhengzhou-city-enu.glb`（建筑 + DEM，约 48 MB）。
- `public/data/buildings.geojson`：WGS84 建筑轮廓、`height`、源索引与地面高程属性。
- `public/data/report.json`：源文件 SHA-256、坐标变换、要素计数及采样限制。

GeoJSON 是二维轮廓加属性；完整三维几何请使用 GLB。`public/data/`、`dist/`、`artifacts/` 为可再生产物，不提交到 Git。

浏览器烟雾测试需先启动开发服务器，并安装 Chromium：

```bash
npm run dev
# 另一个终端；默认使用 /usr/bin/chromium
npm run test:browser
# 可使用 CHROMIUM_PATH 指定浏览器，APP_URL 指定已运行的服务器
```

测试覆盖真实数据渲染、图层操作、原始白模加载和浏览器 GLB 导出，同时保存桌面/移动截图到 `artifacts/`。测试使用本机 Chromium，不自动下载浏览器。

GitHub Actions 在推送或手动触发后自动准备真实数据、测试、构建并导出；可从该运行的 Artifacts 下载 `zhengzhou-city-model`（包含静态站点、三维 GLB 与报告）。工作流不自动公开发布地理数据。
