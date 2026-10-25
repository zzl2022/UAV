# UAV · 郑州三维城市地理建模

> 本地接入版本新增 **“我的光电／声学”** 入口，实际调用原有 Python 模块，默认仅用比赛资料做基础能力判断。
> Windows 安装、启动、场景对比及接口说明见 [光电声学接入说明](docs/student-capabilities-integration.md)。
> 老师原来的“装备建模”“部署与飞行”保留其原模型语义；新增入口的结果不参与原部署优化评分。

基于本仓库 **郑州市河南博物院片区** 的真实建筑 Shapefile 与 DEM，自动生成可浏览、可导出的三维城市模型。使用 Three.js 渲染，不需要地图服务 Token 或第三方在线底图。

## 启动

需要 Node.js ≥ 22.12（推荐 Node 24）、Python 3.12，以及支持 WebGL 的浏览器。在仓库根目录执行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run prepare:data
# 可选：拉取开源 GBA LoD1 白模（需联网；Windows 使用 prepare:open-model:win）
npm run prepare:open-model
npm run dev
```

浏览器打开开发服务器输出的地址。默认 Vite 端口 5173。若机器的默认 npm 缓存目录不可写，可给 npm 命令加 `npm_config_cache=/tmp/uav-npm-cache`；无需禁用 TLS 验证。

**Windows 一键启动：** 直接双击仓库根目录的 [start.bat](start.bat)。脚本会检查 Node.js/Python 版本、创建 `.venv`、安装 Python/Node 依赖、生成城市数据、尝试生成 GBA 白模，然后在新窗口启动开发服务器并打开浏览器。若缺少北京 GBA 模型，脚本会提示运行 `npm run prepare:beijing:all:win` 以启用主界面的“故宫模型”。只检查环境和数据、不启动服务可运行 `start.bat --check`。脚本输出为英文，避免 Windows 代码页导致中文批处理解析问题。

界面支持全域视角、俯视、建筑拾取、建筑/地形/影像/线框图层开关、模型下拉切换（**原白模 / 重建模型 / 故宫模型**）、侧栏隐藏，以及当前模型的三维 GLB 导出。原白模加载源 `NoLod_*.glb`；重建模型为 SHP 轮廓 + DEM + 正射影像；故宫模型为北京 GBA LoD1 + 天地图影像底图。GLB 导出按当前模型生成对应文件名；浏览器导出随“影像底图”开关包含或移除纹理。命令行导出仅包含几何，不内嵌影像。

## 使用的数据

源目录：`创意二文件/创意二数据集/区域数据/`。

| 数据 | 用途 |
| --- | --- |
| `building/zheng_apart.shp` 及配套文件 | 15,889 个建筑轮廓；原始坐标系 EPSG:3857 |
| `building/zheng_apart.dbf` 的 `high` | 实际建筑高度字段，3–136 米；不使用随机高度或默认层高 |
| `影像/raster.tif` | 用户提供的 WGS84 RGB 航拍影像，5259 × 2416 像元 |
| `dem/dem.tif` | EPSG:4326 地面高程，407 × 188 像元；有效高程 64–139 米 |
| `白模/zhengzhou1/tileset.json` | 地理定位原点及 ENU→ECEF 变换 |
| `白模/zhengzhou1/NoLod_*.glb` | 原始三维白模；主界面“场景模型 → 原白模”加载 |
| GlobalBuildingAtlas LoD1（在线 WFS） | 开源 LoD1 白模对比图层；CC BY-NC 4.0 |

源数据及原始说明文档保持不变。仓库已加入用户提供的正射影像。没有道路中心线文件，不会凭空生成道路矢量。街区空隙来自实际建筑轮廓。

## 建模方法与精度边界

1. 读取 SHP 的 `.prj`、`.cpg` 和 `high`，校验多边形并保留内环。若有无效几何，使用 Shapely 修复并计数；没有可用面时记录排除项。
2. 将建筑 EPSG:3857 转换到 WGS84，在 DEM 中按包含该位置的像元取地面高程。单栋建筑以轮廓顶点最高地面值作为屋顶起算面，向下延伸至最低样本形成基础；屋顶为平面，属于 LoD1 建模。
3. 使用 WGS84 三维坐标→ECEF→局部 ENU 的完整转换，复用原始 Tileset 变换。Three.js 坐标为 `[东, 上, -北]`，单位米。地理原点及 ECEF 变换保存在模型 metadata / GLB extras，导入 GIS 时需使用该变换；普通 GLB 查看器只显示局部坐标。
4. DEM 中 27,378 个 NoData 像元不生成地形三角面，保留真实覆盖边界和空缺。23 次建筑顶点采样落在 NoData 中，采用 100 米内最近有效像元，实际最远约 40.02 米；计数和距离写入报告。超过阈值或超出栅格范围时直接报错，避免无限外推。
5. 建筑按顶点颜色批量合并为单个网格，支持三角面到原始建筑的拾取；地形保留源像元中心采样，不伪造额外高分辨率细节。

**限制：** 源 DEM 未注明垂直基准，当前按原始高程作为 WGS84 三维高度输入，未做似大地水准面改正。成果不能据此宣称测绘级绝对高程精度。GBA LoD1 的高度是模型估计而非实测，且与源 SHP 高度/轮廓并不一致，只用于视觉对比，不承诺其与重建建筑屋顶完全重合。模型没有屋顶细节、建筑立面纹理、树木或街道语义；航拍影像仅作为地形底图。感知与部署模块的公式、验证方式和假设见下文。

## 开源白模（GBA LoD1）

主界面已改为“场景模型”下拉：**原白模**加载源 `NoLod_*.glb`；GBA LoD1 开源对照层不再作为主界面勾选项，但生成脚本、`public/data/open-lod1.*` 与说明保留。以下为 GBA LoD1 数据说明：

- 来源：GlobalBuildingAtlas LoD1（TUM），融合 3D-GloBFP 与 OpenStreetMap 建筑；WFS 图层 `global3D:lod1_global`。
- 许可：**CC BY-NC 4.0**，仅限非商业使用，必须署名。署名：GlobalBuildingAtlas (TUM), 3D-GloBFP, © OpenStreetMap contributors。
- 生成：`npm run prepare:open-model`（POSIX）或 `npm run prepare:open-model:win`（Windows）。脚本按项目 SHP 外包框拉取 GBA 要素，以 Tileset 变换转换到与重建城市相同的局部 ENU，按 DEM 顶点最高值确定基底，再拉伸为 LoD1。
- 默认过滤高度 < 2 m 的体块；落在 DEM 空缺或超出 100 m 最近有效像元范围的建筑不生成。
- 本次生成覆盖项目片区，输出 `public/data/open-lod1.json`、`open-lod1.glb` 与 `open-lod1-meta.json`；高度范围约 2–86 m，与源 SHP 的 3–136 m 不同，不能替代源数据或用于测量。
- 该图层（如单独使用）只用于显示对比，不参与子任务二/三的遮挡与感知计算；遮挡仍使用重建建筑与 DEM。完整说明见 [开源白模说明](public/open-model.md)。

## 天地图 + Sat3DGen 城市重建

独立页面 `sat3dgen.html` 保留，但主界面已移除“天地图 / 城市重建”入口链接：

- **天地图**负责底图与选址。需要浏览器端 tk：可写在本地 `.env.local` 的 `VITE_TIANDITU_TK`，也可在页面输入框填写。天地图使用 CGCS2000/WGS84，不需要 GCJ-02 纠偏。
- **Sat3DGen** 源码已放入 [third_party/Sat3DGen](third_party/Sat3DGen)（MIT）。它可从单张卫星影像生成 3D 网格、全景和街景渲染；本次交付以 **3D 网格**为主，街景/全景视频为可选输出，未生成。
- 输入裁剪与轨迹由 `scripts/prepare_sat3dgen_input.py` 生成：以河南博物院为中心裁 640×640 影像，并沿主干道生成 `w,h,angle` 轨迹。
- 当前已通过官方 HuggingFace Space 生成并导入 `public/data/sat3dgen/mesh.obj`（**256 体素分辨率**，约 23 MB，保留 OBJ 顶点颜色）。本地 CUDA 推理脚本保留在 `scripts/run_sat3dgen.py`，需要 Python 3.10 + CUDA PyTorch + 约 1.5 GB 权重。
- 另提供“全域概览”：`scripts/prepare_sat3dgen_input.py --full` 生成覆盖正射影像范围（含边缘填充）的 1024×1024 图，再由 `scripts/sat3dgen_space.py --full` 生成低精度全域网格；页面可在“重点区 Sat3DGen / 全域 Sat3DGen 概览 / 全域 GBA 白模”之间切换。单次 Sat3DGen 输入固定为 512，全域高精度需要本地分块推理。
- 页面提供“天地图 / 3D 模型 / 街景·全景”三个视图；3D 视图加载 Sat3DGen 网格，未生成结果时回退到当前 GBA 白模。
- 局限：Sat3DGen 是研究模型，几何误差约米级；网格位于卫星影像局部坐标系，未与天地图底图做地理配准；街景/全景为可选项，不是真实街景。完整说明见 [Sat3DGen 说明](public/sat3dgen.md)。

## CNBH-10m 全域重建（原白模范围）

页面“重建范围”默认提供 **全域 CNBH-10m 重建**，使用 Zenodo [7827315](https://zenodo.org/records/7827315) 的 CNBH-10m 建筑高度 + 仓库白模 SHP 轮廓 + DEM：

- 15,889 栋，10 m 高度，高度范围 3–110 m；248 栋 CNBH 无有效像元时回退到 SHP `high`。
- 覆盖原始白模 SHP 外包范围（约 9.8 × 5.7 km）；天地图底图上以青色多边形标出该范围。
- 3D 视图中 CNBH/GBA 全域模型下方加载仓库正射影像底图，与 DEM/模型同一局部 ENU；Sat3DGen 归一化网格不叠加该 ENU 底图。
- 生成：`npm run prepare:cnbh:win`（Windows）或 `npm run prepare:cnbh`。脚本用 GDAL `/vsicurl/` 只读取 CNBH 郑州窗口，不下载 170 MB 整幅瓦片。
- CNBH-10m 为 **CC BY 4.0**，署名：Wu et al. (2023), Remote Sensing of Environment 291:113578; Zenodo 10.5281/zenodo.7827315。
- 完整方法、统计与限制见 [CNBH 重建说明](public/cnbh-modeling.md)。

## 北京故宫 5 km 示例

主界面的“场景模型 → 故宫模型”直接加载 `beijing-gba.glb`；`beijing.html` 保留为独立详情页，但主界面已移除入口链接：

- 天地图影像底图 + **GBA LoD1 逐栋轮廓/高度**模型（默认）；可切换 **OSM 轮廓 + CNBH-10m 高度**逐栋模型与 CNBH-10m 20 m 体块对照。
- GBA 过滤：高度 ≥ 3 m 且 ≤ 300 m、面积 ≥ 20 m²；按 `ogc_fid` 去重并生成唯一建筑 ID，避免 WFS 分块边界重复与 `id=0` 冲突。
- OSM 逐栋：高度 ≥ 3 m、面积 ≥ 20 m²；高度取 footprint 内 CNBH 像元最大值，CNBH 无覆盖时才回退 OSM `height` 标签，最后才用 6 m 近似。
- CNBH 对比层：10 m 高度按 2 m 取整、20 m 聚合，平面基底。
- 3D 视图叠加 529 张天地图 z16 瓦片拼接的影像地面，道路留空以显示影像。
- 生成：`npm run prepare:beijing:win`（或 POSIX `npm run prepare:beijing`）；GBA 默认层另需 `npm run prepare:beijing:gba:win`（POSIX `prepare:beijing:gba`）；一次生成全部：`npm run prepare:beijing:all:win`（POSIX `prepare:beijing:all`）。
- GBA WFS 在 5 km 密集区会截断响应；抓取脚本按 0.01° 分块缓存，失败分块自动细分为 0.005°/0.0025° 并支持中断续跑。
- 天地图 tk 从 `.env.local` 读取；GBA 为 **CC BY-NC 4.0（非商业）**，OSM 为 ODbL，CNBH 为 CC BY 4.0。GBA 文件缺失时页面自动回退到 OSM + CNBH。
- 本次生成：GBA 74,083 栋（3–158.36 m，GLB 约 82 MB）；OSM + CNBH 20,798 栋（3–54 m）；CNBH 体块 56,237 个（6–40 m）。
- 详细方法与限制见 [北京故宫 5 km 说明](public/beijing-model.md)。

## 验证与导出

先执行 `npm run prepare:data`，再运行：

```bash
npm test
npm run test:imagery        # Windows: npm run test:imagery:win
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
# 开源白模测试前需先生成：npm run prepare:open-model（Windows: prepare:open-model:win）
npm run test:browser
npm run test:sat3dgen:browser
npm run test:beijing:browser
# 可使用 CHROMIUM_PATH 指定浏览器，APP_URL 指定已运行的服务器
```

测试覆盖真实数据渲染、**模型下拉（原白模 / 重建模型 / 故宫模型）**、侧栏隐藏、图层操作和浏览器 GLB 导出，同时验证影像开关并保存桌面/移动截图到 `artifacts/`。`test:sat3dgen:browser` 验证天地图/Sat3DGen 页面、结果清单、3D 回退视图和布局；`test:beijing:browser` 验证北京 5 km GBA / OSM+CNBH / CNBH 三种模型切换、天地图影像地面和地图范围。没有天地图 tk 时不会请求天地图 SDK。测试使用本机 Chromium，不自动下载浏览器。未生成开源白模时，`npm test` 中的对应测试会跳过；`test:sat3dgen:browser` 的 GBA 回退视图会受影响。

GitHub Actions 在推送或手动触发后自动准备真实数据、测试、构建并导出；GBA 白模步骤为可选，网络不可用时不会阻断构建。可从该运行的 Artifacts 下载 `zhengzhou-city-model`（包含静态站点、三维 GLB 与报告）。工作流不自动公开发布地理数据。

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

`artifacts/sensor-model-report.json` 包含真实城市上 7 种条件 × 4 类设备的 28 条计算结果。GitHub Actions 同步生成该报告供下载。子任务三的优化和动态飞行见下节。

### 地图操作

- 点击“定位河南博物院”查看源建筑数据标注的博物院主楼。
- 在装备建模中直接拖动设备/目标球；范围阴影随位置及参数更新。
- 鼠标悬停地图查看选中设备的信号估计；查询高度默认在表面上方 50 m，可调。
- “一键还原 · 清空所有设备”删除到 0 台；空方案仍可导入/导出、重新添加设备。

## 子任务三：全域采样部署优化与飞行报警

启动后点击顶部 **“部署与飞行”**，已内置基于当前仓库真实 GIS 数据计算的一套方案，直接点击 **“播放飞行”** 即可观看无人机从城区西侧经过河南博物院周边、飞往东侧的报警过程，无需先等待优化。

- 比较经济、均衡、增强三套方案，显示设备数、相对成本、各工况覆盖与残余盲点。
- 默认全城范围、500 m 网格、30/60/100 m 离地高度，并加入核心区建筑附近采样；采样覆盖不是连续空间无盲区证明。
- 可调整预算、设备上限、网格与相对成本，后台重新优化，支持进度显示与取消。
- 提供播放/暂停、倍速、拖动进度、回放、当前检出设备、首报/失联与进出核心区记录。
- 设备点悬停显示类型与型号，当前检出设备脉冲闪烁；地图常驻无人机经纬度、离地高度和模型高程，支持定位及可开关的中文语音报警。
- 可导出方案、覆盖矩阵、设备坐标和完整飞行报警报告，也可将方案送到装备面板继续调整。

```bash
npm run plan:build      # 用真实 GIS 重算，输出 artifacts/deployment-report.json
npm run plan:example    # 重算并更新仓库内 public/deployment-example.json 示例
npm test
# 已启动服务且本地有 Chromium：
npm run test:planning:browser
```

优化采用加权集合覆盖、冗余删除后补选、盲点邻近补点及工况/EMC 代理复核，不宣称数学全局最优。完整方法、示例结果及边界见 [部署与飞行说明](public/deployment-modeling.md)。
