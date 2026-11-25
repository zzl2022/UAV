# 声学装备能力模型（独立项目）

项目路径：`C:/Users/72665/Desktop/声学`。在 VS Code 中使用“文件 → 打开文件夹”选择此目录。

目录包含源码 `src/`、参数 `config/`、测试 `tests/`、示例 `examples/`、资料说明 `docs/` 和结果 `outputs/`。这是可单独安装的项目，不需要先安装或运行“光电”。原始官方建筑数据仍从你提供的文件路径读取，默认合成示例不依赖该数据。

如需为声学创建独立Python环境，可在此目录执行 `python -m venv .venv`，再运行 `.venv\Scripts\Activate.ps1`，之后执行下方安装与运行命令；无需复制光电项目的虚拟环境。

## 运行与配置


声学模块位于 `src/acoustic_model/`；建筑读取、投影和配置校验组件已包含在 `src/acoustic_model/shared/`，无需光电文件夹或 optical_model 包。声学设备为资料中的 CRY8500 系列声学相机，默认配置选择110 cm阵列；声源和噪声演示不代表真实无人机或现场测量。依赖由本项目 pyproject.toml 独立管理。

在项目根目录，使用已安装依赖的 Python 环境执行：

```powershell
cd "C:\Users\72665\Desktop\声学"
python -m pip install -e ".[test]"
python examples/run_acoustic_demo.py
python examples/run_acoustic_demo.py --assumed-angles --output outputs/acoustic_demo_assumed_angles.json
python -m pytest -q
```

第三条生成 `outputs/acoustic_demo.json`，含9个合成场景。第四条生成 `outputs/acoustic_demo_assumed_angles.json`，额外使用**假设的2°/3°基础方向误差尺度**；默认不启用，因为设备资料没有给测角精度。最后一条运行本项目的29项声学测试，也可用 `python -m pytest tests/test_acoustic.py -q`。

配置修改方法：

|文件|改什么|
|---|---|
|`config/acoustic_sensor.yaml`|设备标称距离、阵列和频带、缺失精度等；不要把假设改标为真实数据|
|`config/acoustic_environment.yaml`|传播附加损失、合成风雨噪声、屏障损失和方向不确定性系数；全部待标定|
|`config/acoustic_demo.yaml`|位置、参考距离声源声级、接收点交通/施工/人声噪声、风速和雨强；scenarios可覆盖默认输入|

修改后重新运行即可；输出 `result.configuration` 保留实际读取的设备与环境参数，`result.inputs` 保留各场景实际输入。也可以指定其他配置文件：

```powershell
python examples/run_acoustic_demo.py --config config/acoustic_sensor.yaml --environment config/acoustic_environment.yaml --scenarios config/acoustic_demo.yaml --output outputs/acoustic_demo_custom.json
```

噪声 `level_db` 是**传感器处**同一频带、Z计权、参考20微帕的声压级；不能输入施工设备出厂声功率或把dBA直接混进来。多源按声能叠加：60 dB + 60 dB约等于63 dB。若输入已包含风雨的实测总噪声，应在conditions中设 `generate_weather_noise: false`，避免叠加合成风雨噪声。

## 如何读声学结果

打开 `outputs/acoustic_demo.json` 是文字与数字，不会自动生成图表。每个 `scenarios[].result` 中重点看：

|字段|大白话解释|
|---|---|
|`distance`、`within_nominal_range`|相距多远、是否在资料写的0.01–500 m范围内；范围内不保证能探测|
|`building_environment.direct_path.state`|直线传播路径是否被建筑挡住；blocked不等于声音消失，unknown表示资料不足|
|`noise.total_level`|同频带环境噪声合成后的声压级|
|`losses`、`estimated_received_level`|在假设传播公式下，各项衰减和目标到达接收点的估计声级|
|`signal_noise_difference`|模型声级比环境噪声高或低多少dB，未包含设备自身噪声|
|`relative_signal_quality`|0–1的未标定相对信号质量，不是探测概率；看state解释为空的原因|
|`direction_uncertainty`|仅在参数足够时返回假设方向误差尺度；不是实测定位精度|
|`detection_probability`、`estimated_effective_range`|当前返回null，缺真实检测标定和完整环境数据|

数据不足时 `null` 不等于0。模型把声学遮挡处理成有限的附加损失；不会沿用光电“被挡就完全看不到”的结论。街巷密度和空隙只是二维几何代理量，不是精确声场或建筑反射/绕射求解。

## 声学官方建筑接入

本机原始数据位于先前工作区，而非桌面项目的 `data/building`。以下命令会实际读取官方轮廓，追加一个横穿建筑的合成射线场景并记录CRS、字段、有效性和高度缺失审计，输出位置独立于默认演示：

```powershell
python examples/run_acoustic_demo.py --buildings "C:/Users/72665/Documents/Codex/2026-10-13/gis-python-1-pdf-2-doc/work/data/创意二数据集/区域数据/building/zheng_apart.shp" --output outputs/acoustic_official_unknown_height.json
```

换电脑时请改成自己的Shapefile路径，并保留shx/dbf/prj等配套文件。官方high字段的单位、语义与垂直基准未获确认，所以新增场景的直达路径、传播衰减和信号质量保留未知；二维建筑密度仍可计算。没有用high数值伪造真实三维建筑，也没有将DEM当成已核实的垂直基准。

详细公式、最小Python调用、状态含义和局限见 `docs/acoustic_model_method.md`；资料来源和实际路径见 `docs/acoustic_data_inventory.md`。实际验证结果及输出说明见 `outputs/acoustic_validation.md`。测试通过只支持软件逻辑符合模型假设，不表示真实探测距离或定位精度已经验证。


## 中文结果说明和场景对比

在本项目文件夹中打开终端，运行：

```powershell
python examples/run_acoustic_demo.py
Start-Process outputs/acoustic_demo_report.html
```

演示现在同时生成原有 `outputs/acoustic_demo.json` 和中文报告
`outputs/acoustic_demo_report.html`。报告可离线打开，包含场景对比表、输入条件、
逐场景解释、来源状态及可展开的原始数据；浏览器打印可另存为 PDF。
报告仅展示计算结果，不作真实探测或识别成功率判断。

若已有 JSON，只想生成报告（此步骤仅需 Python 标准库，不需要安装 GIS 依赖）：

```powershell
python examples/report_acoustic_results.py
python examples/report_acoustic_results.py --input outputs/acoustic_demo.json --output outputs/中文对比报告.html
```

自定义结果文件可通过 `--input` 指定；必须是演示程序输出的、包含 `scenarios` 的 JSON。
自定义演示 `--output outputs/my_case.json` 时，会同时生成 `outputs/my_case_report.html`。
修改配置后先重新运行演示，再刷新报告；仅刷新网页不会重新计算。

向老师展示建议：先说明这些是合成场景，再查看场景对比，展开一个场景说明输入和影响因素，
最后说明未标定、缺失值以及真实建筑数据使用情况。不同场景多个条件同时改变时，不能把所有差异归因于一个变量。
0～1 的相对指标不是概率，缺失值也不是零。HTML 不需要联网，不上传数据。

保留所有原有测试，新增报告测试。若旧测试缓存权限异常，可使用全新的临时目录：

```powershell
$testTemp = Join-Path $env:TEMP ("acoustic-tests-" + [guid]::NewGuid().ToString("N"))
python -m pytest -q -p no:cacheprovider --basetemp="$testTemp"
```
