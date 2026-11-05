# 声学装备能力模型：方法、接口和边界

## 1. 定位与参数来源

这是从原合并项目分离出的独立声学项目 `acoustic_model`，无需加载 optical_model 或访问光电项目目录。没有声波时域求解器、波束形成算法、声音分类器、真实声源定位器或部署优化。数值可用于检查软件逻辑、表达假设条件下的相对变化，不能证明 CRY8500 真实精度。

设备配置 `config/acoustic_sensor.yaml` 取自《装备参数.doc》“四、声学”。资料给出0.01–500 m标称距离、110 cm阵列20 Hz–20 kHz频带、208个MEMS、28–132 dB声压级范围、最高40 dB动态范围等。设备资料是参考值而非本项目实测。“视场角94°×76°”未被解释为声学方向覆盖；28–132 dB未说明计权与参考条件，不作为最小可探测声压、灵敏度或自噪声。方位/俯仰精度与工作温度等在原文缺失。

状态 `provided`=资料给定，`assumed`=演示假设，`missing`=缺失，`calibrated`=调用方有依据的标定输入。输出 `derived` 仅表示几何/逻辑推导；`uncalibrated` 表示经验估计或相对指标，即使输入改成 calibrated，简化公式也不会自动成为已验证物理模型。配置中每项保留 value、unit、status、source；输出保存输入和配置快照。

`--assumed-angles` 才启用设备文件中2°/3°的示例基础方向误差尺度；默认输出的方向不确定性为空。这两个数既不是厂家精度，也不是标准差。所有传播和噪声经验系数独立放在 `config/acoustic_environment.yaml`，均为 assumed。`config/acoustic_demo.yaml` 的位置、1 m处100 dB_SPL、500–2000 Hz频带及城市噪声、气象也都是合成条件。

## 2. 调用流程和坐标

```python
from acoustic_model import (
    load_device, load_environment, AcousticSensor, AcousticScene,
    SensorPosition, SoundSource, NoiseComponent, AcousticConditions,
)
from acoustic_model.shared import BuildingScene

device = load_device("config/acoustic_sensor.yaml")
environment = load_environment("config/acoustic_environment.yaml")
scene = AcousticScene(BuildingScene(), vertical_datum="synthetic local z")
model = AcousticSensor(device, environment, scene)
result = model.evaluate(
    SensorPosition((0, 0, 5)),
    SoundSource((0, 200, 5), reference_level_db=100,
                reference_distance_m=1, band_hz=(500, 2000)),
    AcousticConditions(noise=(NoiseComponent("traffic", 60, (500, 2000)),)),
)
print(result["signal_noise_difference"])
print(result["relative_signal_quality"])
```

空 BuildingScene 是调用者**明确假设建筑集合为空**。不给 scene 则环境未知；不能用空场景冒充真实场地。修改配置文件后再次 load 并新建模型，模型构造时深拷贝配置。一个实例可多次 evaluate。温度、风速、雨量、频带、噪声、声源位置均在每次调用时独立输入。

位置为同一投影下的米制 xyz；z 为统一基准向上，不能混用楼顶相对高度和海拔。真实场景要求有效区域投影；拒绝经纬度、EPSG:3857及未知坐标系。使用本项目内置的 `load_buildings` 自动估计 UTM；本数据为 EPSG:32649。`transform_xy` 只变换水平坐标。sensor、target、scene 的 frame 和 vertical_datum 必须一致；标签一致并不证明现场坐标已正确测量。官方高度未知时示例明确使用合成共享 z 标签，并继续将建筑高度置为未知。

`geometric_direction` 是**从已知输入坐标算出的方向**（格网北0°，顺时针，向上俯仰为正），不是设备估计方向。垂直目标方位未定义，输出 null。姿态、光学视场和照度不参与声学模型。

## 3. 声源、噪声和气象分开输入

SoundSource.reference_level_db 表示声源在 reference_distance_m 处的频带积分声压级，单位 dB_SPL，参考20微帕，Z计权；不是声功率级。模型假设该频带声源各向同性、稳定、互不相干，没有实际无人机声纹。band_hz 必须给出上下界，不默认从设备总频带推测目标频谱。

NoiseComponent.level_db 是**传感器接收位置**的环境频带声压级，不是交通或施工源处声级。多源必须处在相同频带、相同参考声压、Z计权和同一平均时段，且贡献互不相干。代码检查频带与计权，平均时段和独立性由调用者确认；不支持直接把dBA、不同频段或相关信号相加。

`N = 10 log10(sum(10^(N_i/10)))`，实现先减最大值，避免大数溢出。例如60和60 dB叠加为63.0103 dB；0 dB是有限声压级，不代表没有声音。任一输入level缺失则总量未知；noise=null表示背景未知；noise=[]且无气象噪声时也不制造“0 dB背景”。

示例气象接收噪声：风速w>0时 `N_w = N_w1 + 20 log10(w/1m/s)`；雨强R>0时 `N_r = N_r1 + 10 log10(R/1mm/h)`。0风/0雨不增加对应声能，启用合成气象噪声时未知风雨使总噪声未知。两项参考值40 dB_SPL均为假设，沿用当前频带。用户如已测得包含风雨的总背景，应把 conditions.generate_weather_noise 设为 false，避免重复加入相同气象贡献；该开关只关闭噪声合成，风雨传播损失仍按输入气象计算。默认 true，使用实测噪声时需明确选择。

## 4. 接收声级与相对信号质量

三维距离 `d = ||target-sensor||`。示例传播范围为1–5000 m，且必须 d>=声源参考距离 r0。0.01–1 m虽然位于设备参考距离区间，但点声源远场近似未覆盖，返回 outside_model_scope，不外推。远场下限1 m也是示例，真正远场还依赖声源/阵列尺寸与频率，不由当前代码保证。

采用 `L_rx = L_ref - A_spread - A_air - A_weather - A_screen`：

- `A_spread = 20 log10(d/r0)`：球面扩散；不增加假定阵列增益。
- `A_air = alpha*(d-r0)`：单频带附加吸收占位项。alpha默认0.001 dB/m，不是ISO9613求解值。
- `A_weather = (k_w*w + k_r*R)*(d-r0)`：风/雨附加损失，默认k_w=0.0005 dB/m/(m/s)、k_r=0.0001 dB/m/(mm/h)，均未标定；不模拟风向、声速剖面、湿度或折射。
- `A_screen`：已知直达线无遮挡为0；已知被建筑挡住用整体附加损失12 dB；高度未知或场景缺失则为null。这个有限损失代表尚未解析的屏障/绕射影响，不随建筑数量机械叠加，不等于真实绕射路径计算。12 dB仅是合成系数。

`signal_noise_difference = L_rx - N`，仅指环境声压的信噪差。未知自噪声、灵敏度和检测器增益未进入，不能叫作设备内部检测信噪比。`relative_signal_quality = clip((SNR-snr_zero)/(snr_full-snr_zero),0,1)`，示例下/上界为−10/10 dB。它是显示相对条件的归一化指标，不是探测概率，也不是实际成功阈值。

当前选定阵列与设备频带的关联必须一致；选择30 cm却仍保留110 cm的频带时 frequency_supported=null。频率或已知工作温度越界使最终相对质量不可计算。工作温度范围未知时单独标记missing，仍可算理论链路条件，不表示整机已确认适用。标称距离内/外只做对照，**不直接控制相对指标或生成探测判决**。

## 5. 建筑、反射、绕射与街巷

本项目 acoustic_model.shared 保留原项目的 BuildingScene、STRtree、Shapefile校验及投影实现，算法保持一致；它作为本项目的内部组件打包，无需依赖光电项目。AcousticScene.describe_path 在直达线查询之外计算：

1. 水平路径两侧30 m缓冲区内，建筑轮廓**并集**面积/缓冲区面积（density）。重叠建筑不重复计面积。
2. 路径中点的垂直于路径的截线上，包含中点的自由线段长度（cross_section_free_width）；截线全长60 m。中点落在建筑或边界为0；竖直路径用东西向截线。该量不是沿程最窄街宽，也不是实测街道。
3. `confinement = 1-min(1,width/(2*radius))`；`multipath_proxy=min(1,density*(1+confinement))`。这只是复杂环境代理分数，无量纲，不是反射系数、反射声压或多径概率。

反射影响只用于增大示例方向不确定性，不伪造相位叠加、反射增益或精确反射路径。绕射影响以有限 A_screen 表达，声学建筑遮挡不会像光线遮挡一样直接使信号为零。频率相关绕射、屋顶/侧向路径、材料吸收、相干干涉、地面反射、植被与地形均未求解。若既有已知阻挡，又有相交轮廓缺高度，则仍无法确定总屏障损失，输出null。

所有几何统计只针对已加载轮廓。数据覆盖边缘、遗漏建筑、轮廓简化和高度未知都会影响它们；二维密度不能证明具有对应高度的实际声学围合。官方 high 虽有数值，但含义/单位/垂直基准未明确，禁止自动采用。首次真实高度接入应使用有依据的 HeightMapping（仅支持统一基底相对米高），或任务一 AcousticEnvironmentAdapter；起伏地面及绝对屋顶高程宜由任务一提供完整上下界。

## 6. 方向不确定性与测距边界

可选误差尺度为 `U_axis = base_axis + k_noise*max(0,snr_full-SNR) + k_multi*multipath_proxy + k_screen*blocked`。默认k_noise=0.3 deg/dB、k_multi=6 deg、k_screen=4 deg；base_axis默认缺失，显式演示才取2°/3°。

该加性尺度只为体现噪声和环境复杂度的趋势，没有统计分布、RMSE或置信度保证。不生成虚假的有符号方位偏差；源位置输入是已知测试真值。缺基础误差或路径/信号条件时尺度为空；尺度>=89°不再作几何投影。附加的 `d*tan(U_axis)` 是假想横向位移尺度，不是三维定位误差，也不是距离估计误差。

单台无源声学传感器没有时延测距、声源功率标定或额外约束时不能由声级可靠求距，故 range_error、estimated_target_position、estimated_effective_range、measured_detection_range、detection_probability 均返回null并说明原因。模型没有由标称500 m反推“检测概率曲线”。

## 7. 运行和输出解读

```powershell
python examples/run_acoustic_demo.py
python examples/run_acoustic_demo.py --assumed-angles --output outputs/acoustic_demo_assumed_angles.json
python -m pytest -q
```

默认输出 `outputs/acoustic_demo.json`，包含9个合成场景；默认角度精度为空。`--config/--environment/--scenarios` 分别选择设备、系数和输入文件；所有主要参数均可修改，重新运行即读取，输出保存实际配置快照。

`--buildings <官方shp绝对路径>` 追加第10个场景和 scene_audit，真实读取官方轮廓，但横穿第一栋楼的射线、声源、噪声仍是合成数据。缺高度场景信噪差/相对质量为空，不能将unknown解释为clear。每条结果包含inputs、configuration、distance、nominal_range、工作条件、building_environment、noise、losses、estimated_received_level、signal_noise_difference、relative_signal_quality、direction_uncertainty等；单位和来源均附在指标字典中。

状态relative_only表示相对公式得到有限值；insufficient_data表示缺参数；outside_model_scope表示传播距离不在模型范围；outside_device_conditions表示已知频带或温度不满足设备条件。数值0仅可能是归一化指标下界，不能作为“真实探测概率为0”。

测试以合成几何/声源/噪声核验公式、参数边界、序列化、未知高度处理、配置重新加载。分离时也独立验证了光电项目的原有测试。下一步优先确认high及垂直基准，取得声源频带实测声压和接收端噪声、阵列精度定义/灵敏度/自噪声，再用受控实验标定屏障及多路径影响；在此之前不把软件测试通过当成真实设备性能验证。
