# 光电与声学接入老师的三维平台

## 交付位置和来源

本地项目位于 `UAV-platform`，来自 `https://github.com/zzl2022/UAV` 的 main，
读取的上游提交为 `6097a2fbdaa71cd4c803396f7209e89ade755e5b`（2026-10-23）。
GitHub 下载受本机 Schannel 限制，实际通过 GitHub 官方 ZIP 获取源码，在本地 Git 中保存原始快照供比较。
本地新增文件和改动没有推送到老师仓库。

原模型的最终位置是桌面 `低空/光电`、`低空/声学`。本次从这两个目录复制模型到：

- `equipment_models/optical/`：原光电源码、YAML、测试、示例和文档。
- `equipment_models/acoustic/`：原声学源码、YAML、测试、示例和文档。

原目录没有修改；复制文件的 SHA-256 记录见 `equipment_models/source_manifest.json`。
修改平台内的这两份配置即可改变平台计算，桌面原项目配置不会自动同步。

## Windows 首次安装

安装 Python 3.12 和 Node.js 22.12+（推荐24）。在本文件所在项目的根目录打开 PowerShell：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-integration.txt
npm.cmd ci
.\.venv\Scripts\python.exe scripts/prepare_data.py
.\.venv\Scripts\python.exe scripts/start_integrated.py
```

浏览器打开 `http://127.0.0.1:5173/`，点击顶部 **“我的光电／声学”**。
本地交付已经生成 `public/data/`；只要未修改或删除源资料与生成数据，就不必每次重做数据准备。
再次运行只需双击 `启动光电声学平台.cmd`，或执行最后一条命令。Ctrl+C 停止服务。
普通 Python 已安装所需依赖时，也可直接 `python scripts/start_integrated.py`。

两个服务分别是：Vite 页面5173端口、Python本地服务8765端口。
也可分开打开两个终端：`python backend/server.py` 和 `npm.cmd run dev -- --host 127.0.0.1`。
页面通过同源 `/api/capabilities` 代理访问Python。若提示连接失败，先检查服务终端。
静态 `dist/` 本身不能执行Python；生产部署需另运行Python服务并代理此路径。

## 如何展示和对比

1. 点击“我的光电／声学”，选择NVT-951或CRY8500。黄色球为光电，绿色球为声学，红色球为目标。
2. 地图选点或拖动球，设备和目标位置与真实建筑／DEM网格共享坐标。也可填写东、北、上坐标。
3. 光电可切换可见光／热成像、调整焦距和朝向；“朝向当前目标”根据用户设定位置计算云台方向。
4. 声学可选30／70／110 cm阵列。目标频带可在目标属性中设置；默认未知。110 cm才有资料确认的频段。
5. 查看中文结果：范围条件、视场缺失、平台几何遮挡和来源状态。未提供的项目显示未知，不等同于零。
6. 输入场景名，点击“保存当前两台设备结果”。调整目标或工作设置后再保存，即可对比。
7. 导出JSON供程序调用，或导出中文HTML报告供老师查看。HTML可离线打开，并打印成PDF。

场景对比是用户设定条件的比较；默认点位不是推荐部署方案。记录仅在本次会话保存，刷新前请导出。
项目 `artifacts/student-platform-report.html`、`student-platform-scenarios.json` 是本次页面操作实际下载的示例。

## 原模型的实际调用

`backend/capabilities.py` 重新读取两个原始YAML：光电 `optical_nvt951.yaml`、声学 `acoustic_sensor.yaml`。
光电复用原模型 `field_of_view`、`camera_components`、`Pose`、`Target` 及配置校验。
它没有强行调用需要外界环境输入的整套相对评分。声学实际调用原 `AcousticSensor.evaluate`，
将所有环境系数、噪声和天气显式设为缺失，返回资料和几何基础指标。
两个模块的原始完整环境演示仍在 `equipment_models/*/examples`，本入口不自动启用。

平台坐标是 `[东, 上, -北]`，Python原模型使用 `[东, 北, 上]`，适配为 `(x,-z,y)`。
双方共享同一局部ENU原点及模型高度；没有把ENU误当UTM，也没有把局部上坐标当海拔。
请求校验城市原点及city.json哈希，错误原点或场景版本会被拒绝。

几何查询复用老师的 `createSceneQuery.trace`，由浏览器对真实建筑／DEM网格进行相交查询，
将结果传给服务并保留来源。Python没有重新建另一套GIS场景，也没有对浏览器几何结果做独立重算。
平台原图层开关不禁用几何查询。遇到DEM缺口且无已知挡体，结果保持未知。

## 参数边界

- NVT-951：资料分辨率、焦距和云台范围保留。资料未给传感器尺寸／光学视场，默认FOV及投影像素为空；
  不启用历史 `--assumed-optics`。可选手填固定水平／垂直视场，结果明确标记“用户假设”，不会随焦距自动变化。
- CRY8500：资料0.01–500 m仅用于标称范围比较；208个MEMS和其他属性保留在参数说明。
  94°×76°的物理含义未确认，不作为声学波束。28–132 dB未给计权及测试条件，不用作检测门限。
  其他阵列不能自动继承110 cm的频段。方位／俯仰误差默认缺失。
- 比赛没给的天气、照度、背景噪声和目标声级，本入口不收集、不填默认实际值，不生成信噪差、识别率、探测概率或定位精度。
- 用户补充的目标宽高、频带、焦距和位置属于场景设置，不是实测参数。

## 与老师平台的高度解释差异

老师平台使用DBF的 `high` 作为相对米高度、DEM作为楼底，并重建LoD1网格。
比赛文字未明确high含义及DEM垂直基准。本次继续使用老师既有场景，所有遮挡都标注为
**按平台高度解释的几何结果**。读取真实数据不等于证明该解释或绝对高程正确。
声学路径被挡不推导探测必为零；光电视线被挡也不生成虚假的真实识别概率。

## 接口

- `GET /api/capabilities/health`：本地服务状态。
- `GET /api/capabilities/catalog`：完整原配置、城市原点／哈希、配置路径及哈希。
- `POST /api/capabilities/evaluate`：请求 `version=student-capabilities-1`、`mode=dataset_only`、
  `origin`、`scene_hash`、`devices`、`target`。位置采用平台原始坐标。
  设备 `type` 为optical或acoustic；字段样例见实际导出JSON的 `results[*].inputs`。
  返回中文metrics、原始计算、参数来源和限制。`environment` 为非空时拒绝。

未支持的设备类型、错误坐标、重复ID、无效焦距和不完整视场／频带均返回HTTP400。
配置每次重读；文件修改后点击“连接／重读配置”刷新。城市数据修改后需重启Python服务并刷新页面。
输入变化会使旧结果失效，在新结果返回前禁止保存，避免将旧计算误当成新场景。

## 重跑验证

```powershell
npm.cmd test
.\.venv\Scripts\python.exe -m pytest backend/test_capabilities.py -q -p no:cacheprovider --basetemp=artifacts/test-api-temp
.\.venv\Scripts\python.exe -m pytest equipment_models/optical/tests -q -p no:cacheprovider --basetemp=artifacts/test-optical-temp
.\.venv\Scripts\python.exe -m pytest equipment_models/acoustic/tests -q -p no:cacheprovider --basetemp=artifacts/test-acoustic-temp
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'
npm.cmd run build
# 两个服务已启动时；Windows默认使用Edge，其他系统请指定CHROMIUM_PATH
npm.cmd run test:student:browser
```

临时目录若曾因旧权限不可写，请指定新的目录。未删除或降低原有测试。
测试通过验证软件实现和数据对接，不证明真实设备实测精度。
