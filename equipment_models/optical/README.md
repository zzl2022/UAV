# NVT-951 光电装备能力特性模型

独立 Python 子模块，提供双通道视场、简化建筑遮挡、光照雨雾相对影响、可解释 JSON。范围为竞赛任务二光电模型。默认严格使用已给资料，缺失设备参数返回null；合成示例必须显式开启。项目结构和公式详见 `docs/optical_model_method.md`，原始数据字段和来源详见 `docs/data_inventory.md`。

## 安装（Python 3.10+）

在项目根目录执行：

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e ".[test,dem]"
.venv\Scripts\python.exe -m pytest -q
```

Linux/macOS 使用 `.venv/bin/python` 替代 `.venv\Scripts\python.exe`。DEM不参与基础模型，未使用数据审计时可只安装 `.[test]`。不需要前端、Word、GPU。`outputs/requirements-tested.txt` 记录本次实际通过测试的包版本；在另一台相同 Python/平台上可先安装该文件，再 `pip install -e . --no-deps`。版本锁定的包不等于光学精度保证。

## 直接执行示例

```powershell
# 原始配置：视场等缺失，展示明确不可计算状态
.venv\Scripts\python.exe examples/run_optical_demo.py --output outputs/optical_original_config.json
# 显式假设传感器尺寸及像素阈值，输出6个合成场景（无遮挡/有遮挡 × 日间/夜间/雨雾）
.venv\Scripts\python.exe examples/run_optical_demo.py --assumed-optics --output outputs/optical_demo.json
```

默认示例建筑/目标/照度均是合成数据；设备焦距范围和分辨率来自原始资料。示例解读见 `outputs/example_explanation.md`。

## 单场景实际调用

`examples/optical_case.example.json` 是可编辑输入，包含 `pose`（传感器米制坐标、yaw/pitch/roll、frame）、`target`（坐标、尺寸及来源）、`conditions`（照度、可见度、雨强、双通道对比度、温度及来源）、`focal_mm`（各通道焦距）和 `scene`。当前文件是**合成示例**，其中 `synthetic_empty` 明确声明建筑集合为空，不能代表实际街区无遮挡。将 `scene.kind` 改为 `none` 时不加载环境，LOS 为 `unknown`。实际录入的目标、气象条件须将 `source/status` 改为相应来源，不应把假设输入标成实测。

在项目根目录、已安装依赖的 Python 环境中运行：

```powershell
# 原始设备配置：实际视场参数缺失，相关结果返回 null/missing
python examples/run_optical_case.py --output outputs/optical_case_original.json
# 启用明确标记的演示镜头尺寸和像素阈值
python examples/run_optical_case.py --assumed-optics --output outputs/optical_case.json
# 指定自己修改过的设备、环境及场景配置
python examples/run_optical_case.py --case examples/optical_case.example.json --device-config config/optical_nvt951.yaml --environment-config config/environment.yaml --assumed-optics --output outputs/optical_case_changed.json
python -m pytest -q
```

前三条命令分别生成 `outputs/optical_case_original.json`、`outputs/optical_case.json`、`outputs/optical_case_changed.json`；最后一条在终端显示测试结果。默认原始配置的 FOV 为 `null/missing`，显式启用假设光学参数后合成空场景的 LOS 为 `clear`，相对指标可计算但仍为 `uncalibrated`。修改两个 YAML 中的 `value` 后重新运行；输出的 `result.configuration` 是此次实际加载的配置快照，顶层另记录所用配置文件绝对路径。修改 `illumination_reference` 只影响可见光照度因子，不影响热成像；修改 `demo_overrides.visible.sensor_size` 只在指定 `--assumed-optics` 时生效。`--assumed-optics` 不会把假设参数升级成真实设备参数。JSON 输出可查看 `result.inputs`、`result.line_of_sight`、`result.channels.visible/thermal`；每项 `value/unit/status/source` 区分数值、单位和来源，`relative_recognition_index.state` 区分相对值、视线不可用和资料不足。

场景中的 `scene` 还支持 `{"kind":"shapefile","path":".../zheng_apart.shp"}`；相对路径以场景 JSON 所在目录为基准。官方文件需同时有配套 `.shx/.dbf/.prj` 等文件。脚本会审查 CRS、字段、几何有效性并转换到区域米制投影，输出 `scene_audit`；请把 `pose.frame` 和 `target.frame` 设为审计所得目标 CRS，并将水平位置输入为该 CRS 下的米制坐标。脚本不替 `high` 猜单位、基底和垂直基准，轮廓相交时 LOS 返回 `unknown`。当前项目目录只有官方数据审计结果，没有随代码附带 Shapefile；需提供原始数据包才能重跑此模式。

Python 中最小调用为 `load_device(...)`、`load_environment(...)`、`OpticalEquipment(device, env, scene).evaluate(Pose(...), Target(...), Conditions(...), focal_mm={...})`，可见下方示例和 `examples/run_optical_case.py`。重新读取配置并新建模型即可应用修改；已有模型在构造时保存配置快照，不会受外部字典后续改动影响。

## 官方数据检查及接入

项目当前只附带数据审计 JSON，未附带原始 Shapefile。取得官方 ZIP 后，可在项目根目录解压并执行：

```powershell
python -m zipfile -e "C:/Users/72665/Desktop/创意二数据集.zip" work/data
.venv\Scripts\python.exe scripts/audit_data.py "work/data/创意二数据集" --output outputs/data_audit.json
.venv\Scripts\python.exe examples/run_optical_demo.py --assumed-optics --buildings "work/data/创意二数据集/区域数据/building/zheng_apart.shp" --output outputs/official_unknown_height_demo.json
```

第三条命令使用官方轮廓和自动选取的第一栋建筑横穿射线，射线高度/目标大小仍是假设；high含义未知，所以相交建筑的LOS会返回unknown。可仅用于检查数据通路。

如需**显式演示高度假设**，在第三条命令增加 `--assume-high-relative-m`。这会将high暂当相对米高度、平地base=0，输出标为assumed；不能用来证明真实遮挡精度。正式计算优先确认字段和垂直基准，或实现任务一 `EnvironmentAdapter`。

## Python 接口

```python
from optical_model import *
device = load_device("config/optical_nvt951.yaml", assumed_optics=True)
env = load_environment("config/environment.yaml")
model = OpticalEquipment(device, env, BuildingScene())  # 显式合成空场景
result = model.evaluate(
    Pose((0, 0, 5), yaw_deg=0, pitch_deg=0),
    Target((0, 200, 5), width_m=0.35, height_m=0.35),
    Conditions(illuminance_lux=1000, visible_contrast=0.8, thermal_contrast=0.7),
    focal_mm={"visible": 50, "thermal": 75},
)
```

机械水平角0–360°不是相机FOV。所有位置必须在同一米制平面与垂直基准；Pose/Target.frame与scene.frame必须一致。`local_m`用于合成场景。未加载场景时LOS为unknown。通过 `load_buildings` 加载真实数据会转换Web Mercator至区域UTM，但不会擅自确定high语义。

修改 `config/optical_nvt951.yaml` 中value/unit/status/source后重新运行；真实传感器宽高或直接FOV齐全后，默认模式即可计算。两者同时配置时物理宽高计算优先；直接FOV固定不随焦距自动变化。修改 `config/environment.yaml` 可以改变雨雾与光照参考系数，须保留真实来源状态，不要将假设改名为实测。

## 交付与限制

- `src/optical_model/`：配置、光学/双通道统一计算、建筑与环境适配接口。
- `config/`、`tests/`、`examples/`、`scripts/`、`docs/`：可调配置、测试、运行示例、数据审计和方法。
- `outputs/`：测试日志、原始缺失配置输出、合成输出、官方轮廓示例、数据审计、解读及可移植源代码包。

识别概率、实际有效识别距离、实际最低照度和真实FOV尚不能从给定资料可靠推导。环境公式为经验示例；棱柱不含地形/树木/透射或白模细节；目标投影假设正对镜头。下一步应先核实high及垂直基准，再补齐光学尺寸/FOV并做识别性能标定。

声学模型已独立放在桌面 “声学” 文件夹（C:/Users/72665/Desktop/声学），本目录仅保留光电模型。


## 中文结果说明和场景对比

在本项目文件夹中打开终端，运行：

```powershell
python examples/run_optical_demo.py --assumed-optics
Start-Process outputs/optical_demo_report.html
```

演示现在同时生成原有 `outputs/optical_demo.json` 和中文报告
`outputs/optical_demo_report.html`。报告可离线打开，包含场景对比表、输入条件、
逐场景解释、来源状态及可展开的原始数据；浏览器打印可另存为 PDF。
报告仅展示计算结果，不作真实探测或识别成功率判断。

若已有 JSON，只想生成报告（此步骤仅需 Python 标准库，不需要安装 GIS 依赖）：

```powershell
python examples/report_optical_results.py
python examples/report_optical_results.py --input outputs/optical_demo.json --output outputs/中文对比报告.html
```

自定义结果文件可通过 `--input` 指定；必须是演示程序输出的、包含 `scenarios` 的 JSON。
自定义演示 `--output outputs/my_case.json` 时，会同时生成 `outputs/my_case_report.html`。
修改配置后先重新运行演示，再刷新报告；仅刷新网页不会重新计算。

向老师展示建议：先说明这些是合成场景，再查看场景对比，展开一个场景说明输入和影响因素，
最后说明未标定、缺失值以及真实建筑数据使用情况。不同场景多个条件同时改变时，不能把所有差异归因于一个变量。
0～1 的相对指标不是概率，缺失值也不是零。HTML 不需要联网，不上传数据。

保留所有原有测试，新增报告测试。若旧测试缓存权限异常，可使用全新的临时目录：

```powershell
$testTemp = Join-Path $env:TEMP ("optical-tests-" + [guid]::NewGuid().ToString("N"))
python -m pytest -q -p no:cacheprovider --basetemp="$testTemp"
```
