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

界面支持全域视角、俯视、建筑拾取、建筑/地形图层开关、线框显示、原始 GLB 白模对比，影像底图开关，以及三维 GLB 和二维 WGS84 GeoJSON 下载。原始白模和重建建筑互斥显示，避免叠加误读。GLB 导出始终包含完整重建建筑和 DEM，不受建筑/地形图层可见性影响，不包含对比白模；浏览器导出随“影像底图”开关包含或移除纹理。命令行导出仅包含几何，不内嵌影像。

## 使用的数据

源目录：`创意二文件/创意二数据集/区域数据/`。

| 数据 | 用途 |
| --- | --- |
| `building/zheng_apart.shp` 及配套文件 | 15,889 个建筑轮廓；原始坐标系 EPSG:3857 |
| `building/zheng_apart.dbf` 的 `high` | 实际建筑高度字段，3–136 米；不使用随机高度或默认层高 |
| `影像/raster.tif` | 用户提供的 WGS84 RGB 航拍影像，5259 × 2416 像元 |
| `dem/dem.tif` | EPSG:4326 地面高程，407 × 188 像元；有效高程 64–139 米 |
| `白模/zhengzhou1/tileset.json` | 地理定位原点及 ENU→ECEF 变换 |
| `白模/zhengzhou1/NoLod_*.glb` | 原始三维白模对比图层 |

源数据及原始说明文档保持不变。仓库已加入用户提供的正射影像。没有道路中心线文件，不会凭空生成道路矢量。街区空隙来自实际建筑轮廓。

## 建模方法与精度边界

1. 读取 SHP 的 `.prj`、`.cpg` 和 `high`，校验多边形并保留内环。若有无效几何，使用 Shapely 修复并计数；没有可用面时记录排除项。
2. 将建筑 EPSG:3857 转换到 WGS84，在 DEM 中按包含该位置的像元取地面高程。单栋建筑以轮廓顶点最高地面值作为屋顶起算面，向下延伸至最低样本形成基础；屋顶为平面，属于 LoD1 建模。
3. 使用 WGS84 三维坐标→ECEF→局部 ENU 的完整转换，复用原始 Tileset 变换。Three.js 坐标为 `[东, 上, -北]`，单位米。地理原点及 ECEF 变换保存在模型 metadata / GLB extras，导入 GIS 时需使用该变换；普通 GLB 查看器只显示局部坐标。
4. DEM 中 27,378 个 NoData 像元不生成地形三角面，保留真实覆盖边界和空缺。23 次建筑顶点采样落在 NoData 中，采用 100 米内最近有效像元，实际最远约 40.02 米；计数和距离写入报告。超过阈值或超出栅格范围时直接报错，避免无限外推。
5. 建筑按顶点颜色批量合并为单个网格，支持三角面到原始建筑的拾取；地形保留源像元中心采样，不伪造额外高分辨率细节。

**限制：** 源 DEM 未注明垂直基准，当前按原始高程作为 WGS84 三维高度输入，未做似大地水准面改正。成果不能据此宣称测绘级绝对高程精度。原始白模的高度语义也未注明，因此单独提供对比，不承诺其与重建建筑屋顶完全一致。模型没有屋顶细节、建筑立面纹理、树木或街道语义；航拍影像仅作为地形底图。本实现聚焦三维环境建模，不包含装备建模、传播分析或部署优化。

## 验证与导出

先执行 `npm run prepare:data`，再运行：

```bash
npm test
npm run test:imagery
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

测试覆盖真实数据渲染、图层操作、原始白模加载和浏览器 GLB 导出，同时验证影像开关并保存桌面/移动截图到 `artifacts/`。测试使用本机 Chromium，不自动下载浏览器。

GitHub Actions 在推送或手动触发后自动准备真实数据、测试、构建并导出；可从该运行的 Artifacts 下载 `zhengzhou-city-model`（包含静态站点、三维 GLB 与报告）。工作流不自动公开发布地理数据。

## 加入或替换航拍影像（Mac）

本分支已经包含本次提供的 `raster.tif`。更新现有 Git 克隆：

```bash
cd ~/UAV
git pull --ff-only origin feat/zhengzhou-city-model
npm ci
npm run prepare:data
npm run dev
```

若通过 ZIP 下载项目，下载本功能分支的最新 ZIP 并重新解压；在新文件夹中按“启动”步骤安装、准备数据。不要覆盖旧文件夹中的个人改动。

以后替换影像时，将带 CRS 的三波段 uint8 RGB GeoTIFF 命名为 `raster.tif`，放入：

```text
创意二文件/创意二数据集/区域数据/影像/raster.tif
```

停止服务（Control+C），执行 `npm run prepare:data`，再运行 `npm run dev` 并刷新网页。页面“影像底图”默认启用。影像按地理坐标重投影到 DEM 范围，最长宽度 4096 像素，使用双线性重采样；NoData 和未覆盖区域显示深色地形背景。贴图 UV 来自每个地形顶点的地理坐标，保持北向上。分辨率被适度降低以控制显存，但原始 TIFF 保持不变，源/目标尺寸与文件哈希会写入报告。纹理是 `public/data/terrain-imagery.png`，无需添加 Pillow 等新依赖。

影像不会改变建筑高度、地面高程或重建几何。若删除源影像并重新准备数据，程序会删除旧纹理，页面禁用影像开关；没有坐标系、不重叠或非 RGB uint8 数据会明确报错。

## 子任务二：多元感知装备能力特性建模

更新代码并执行 `npm ci` 后，启动页面，点击顶部 **“装备建模”**。默认提供雷达、光电、无线电、声学各一台，可从七款文档设备预设中添加/删除，动态调整设备参数、位置/朝向、目标与环境，并导出/导入参数及预算报告。地图点选使用真实建筑/地形表面；遮挡计算不受图层显示开关影响。

- 雷达：距离/RCS/SNR、盲区/视场、建筑地形截断、雨云雾/杂波/底噪/干扰、地面双径与虚拟回波指标。
- 光电：宽/窄/热成像视场、目标像素与对比度、最低照度、雨雾和实体遮挡。
- 无线电：连续/离散频段、静默失效、穿透/绕射/双径、干扰和测向/站网误差指标；不把单站当作完整 TDOA 网络。
- 声学：声压传播、各类噪声能量叠加、反射/绕射/折射近似、声速/时延和测角/位置滞后指标。

文档参数、派生值与假设在界面分列。输出为**未标定工程近似**，不能宣称实测探测概率或识别准确率。半透明阴影显示标称范围/视场，不是有效覆盖区域。

完整公式、参数来源与限制见 [感知模型说明](public/sensors-modeling.md)。

```bash
npm test
npm run report:sensors
# 已启动 npm run dev 且已安装 Chromium 时：
npm run test:sensors:browser
```

`artifacts/sensor-model-report.json` 包含真实城市上 7 种条件 × 4 类设备的 28 条计算结果。GitHub Actions 同步生成该报告供下载。子任务三的自动部署优化不在本模块范围内。

### 地图操作

- 点击“定位河南博物院”查看源建筑数据标注的博物院主楼。
- 在装备建模中直接拖动设备/目标球；范围阴影随位置及参数更新。
- 鼠标悬停地图查看选中设备的信号估计；查询高度默认在表面上方 50 m，可调。
- “一键还原 · 清空所有设备”删除到 0 台；空方案仍可导入/导出、重新添加设备。
