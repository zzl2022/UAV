# 光电装备能力特性模型技术审查

审查日期：2026-10-14。审查对象：任务二 NVT-951 光电模型的 `src/`、`config/`、`tests/`、`examples/` 及 `outputs/optical_demo.json`。本报告只审查现有实现，未修改模型、配置或测试。桌面 `光电` 目录与当前项目中的上述核心文件及演示 JSON 的 SHA-256 一致；以下行号以这份一致的源码为准。

## 审查结论与修改建议

现有程序已经形成可配置的双通道计算链路。机械转角与相机视场分开处理；没有有效传感器尺寸时默认不制造真实视场；建筑高度语义不明时返回 `unknown`；热成像不沿用可见光照度因子。这些处理方向合理。`outputs/test_summary.txt` 记录原有 **34 passed**，合成示例的数值也与当前公式相符。该测试结论只说明程序在所列场景下符合既定假设，不构成设备实测精度验证。

审查发现按优先级列出。以下均为建议，**本轮未改动代码或删除测试**。

### 1 缺少目标尺寸时仍可能输出非空识别指标  P2

位置：`src/optical_model/model.py:123`、`:127`、`:137` 至 `:143`。

当 `Target.width_m` 或 `height_m` 缺失，`projected_target_size` 和 `sampling_criterion_met` 均为 `null`；但若视场、LOS 和环境因子已知，代码跳过采样因子，仍输出 `relative_recognition_index = L × C × Tf × Tr`，状态为 `uncalibrated / relative_only`。这实际是环境相对品质，不含目标采样能力；“识别”字段名容易被误读成目标识别能力。现有六个演示场景均提供了0.35 m宽高和假设像素阈值，因此没有触发此问题。建议将未具备目标尺寸/判据的值仅输出为 `relative_image_quality` 或类似环境指标；若保留“识别”名称，应返回 `null` 或显式记录 `sampling_omitted=true` 和缺失原因。增加目标尺寸缺失、判据缺失的测试，断言状态与解释一致。

### 2 可见光夜间的表观对比度输出不随照度变化  P2

位置：`src/optical_model/model.py:155` 至 `:172`；结果：`outputs/optical_demo.json` 的 `clear/night_clear`。

可见光照度因子 `L=sqrt(min(1,E/Eref))` 参与 `relative_image_quality` 与最终相对指标，但 `relative_apparent_contrast` 只算 `C × Tf × Tr`。因此同样输入对比度0.8时，日间1000 lux与夜间1 lux的可见光“表观对比度”都为0.8，而图像质量因子分别为1和0.1。由于 `C` 目前本就是用户提供的归一化场景输入，不能自动断言真实物理对比度一定降低；问题在于字段名称与赛题要求的暗光对比度影响容易让人误解。建议在文档/输出中把它明确称作“天气衰减后的输入对比度”，或增加单独且标定过的照度到有效对比度映射。增加夜间输出语义的回归测试，不从示例系数推断真实传感器对比度。

### 3 米制投影校验仍可能接纳距离失真的投影  P2

位置：`src/optical_model/buildings.py:17` 至 `:21`、`:134` 至 `:142`。

`metric_crs` 只检查投影、单位为米，并特别排除EPSG:3857；其他以米为单位的全球墨卡托等投影仍可能通过，`area_of_use` 对全球投影也不能保证本地距离精度。默认 `estimate_utm_crs()` 已为郑州选到EPSG:32649，此问题主要影响调用者显式传入 `target_crs` 的情况。建议为区域投影加入可量化的尺度/变形阈值或限定适用投影集合，并测试非3857的全球米制投影；不需要更改官方数据默认UTM路径。

### 4 工作温度越界被直接解释为零能力  P2

位置：`src/optical_model/model.py:106` 至 `:107`、`:132` 至 `:133`。

若用户输入温度高于60°C或低于−35°C，两个通道的相对指标强制为0。原始参数只给出工作温度范围，没有给出越界时立即停机或识别能力为零的曲线。当前处理适合作为“超出标称使用范围，不作可靠性能承诺”的保守状态，但把数值定为0会被读成已证实的失效。建议把 `temperature_within_working_range=false` 与可计算性的状态分开，越界时返回 `out_of_spec / unvalidated` 和 `null`，除非未来获得停机或性能实测证据。现有 `tests/test_optical.py:162` 至 `:171` 明确断言0；如采纳建议，应更新而非删除该测试，改断言新的语义。

### 5 直接视场角配置不随变焦变化  P3

位置：`src/optical_model/model.py:80` 至 `:86`；`tests/test_optical.py:43` 至 `:51`。

当物理尺寸缺失而配置 `direct_fov` 时，该对角度在全部焦距上固定；测试也明确要求6.5 mm与312 mm下数值相同。这作为**单一工作焦距的固定视场参数**是可理解的，但不能代表整段48倍可见光变焦。建议给直接视场增加参考焦距、宽窄端测量值或经过标定的焦距—视场曲线；在此之前报告中不要声称“仅凭直接视场配置就模拟了变焦”。设备的48倍数字与6.5–312 mm范围来自原文，不能据此独立推导传感器尺寸。

### 6 验证覆盖仍以合成数据为主  P3

位置：`tests/test_optical.py:68` 至 `:195`；`examples/run_optical_demo.py:26` 至 `:45`。

遮挡单元测试覆盖了插入/移除建筑、孔洞、多部件、垂直射线、未知高度和简化Shapefile重投影，但 `test_shapefile_loader_explicit_height_and_reprojection` 只创建一栋合成建筑。没有持续运行的官方15,889栋数据回归测试，也没有将简化棱柱与独立三维真值、现场可见性或影像识别数据对比。建议在确认高度字段/垂直基准后添加抽样建筑的几何与遮挡核验；保留全部合成单元测试，再增加可选的官方数据集成测试。即使完成集成测试，也不等于验证识别概率。

## 一 现有计算流程

1. `config/optical_nvt951.yaml` 的每个主要参数带 `value/unit/status/source`；`config/environment.yaml` 独立保存全部假设环境系数。`load_device`、`load_environment` 在 `src/optical_model/config.py:36` 至 `:92` 读取 YAML、检查单位、类型及范围；`--assumed-optics` 才把 `demo_overrides` 的示例传感器尺寸和像素阈值叠加到设备配置。
2. `examples/run_optical_demo.py:37` 至 `:45` 创建传感器、目标、清晰/雨雾/夜间条件与人工建筑。若传入 `--buildings`，才转入官方或其他Shapefile读取路径。统一接口 `OpticalEquipment.evaluate(Pose,Target,Conditions,focal_mm=...)` 在 `src/optical_model/model.py:94` 开始计算。
3. 先验证传感器、目标、场景的 `frame` 相同，计算三维欧氏距离、云台角是否在机械范围、工作温度是否在资料给定区间，并调用场景的 `trace_los`。本地合成坐标 `local_m` 的x向东、y向北、z向上；真实场景须统一水平坐标和垂直基准。相同 `frame` 字符串并不能自动证明垂直基准一致。
4. 可见光和热成像分别调用 `field_of_view`：有效物理宽高已知时计算 `2 atan(尺寸/(2焦距))`；否则使用直接配置视场；两者皆无则返回 `null/missing`。可见光变焦6.5–312 mm，热成像固定75 mm。`camera_components` 依据yaw、pitch、roll将目标相对向量投到相机右、上、前方向；要求前向深度为正且两轴夹角分别处于半视场内，判断的是**目标中心点**，并非整个目标轮廓。
5. 有目标宽高且在镜头前方时，以针孔投影估算宽高像素数，并与假设像素阈值比较。该投影假设目标正对镜头、尺寸沿图像轴，缺少姿态、畸变与真实有效像元的校核。
6. 建筑遮挡采用 `BuildingScene` 的二维STRtree候选筛选，求目标视线与建筑轮廓的交线及其z区间，和假定平顶不透明棱柱的 `[base_m,top_m]` 比较。已确认相交且高度足够返回 `blocked`；轮廓相交但缺高度返回 `unknown`；未在已加载场景中相交返回 `clear`。不包含地形、植被、玻璃透射或白模细节。
7. 环境模型以距离 `d`、可见度 `V`、雨强 `R` 计算 `Tf=exp(-kf*d/V)` 与 `Tr=exp(-kr*R*d/1000)`。可见光另计算照度因子 `L=sqrt(min(1,lux/100))`，热成像不使用lux阈值；两通道分别输入归一化对比度。`relative_recognition_index` 是这些因子及可用时像素采样因子的乘积，受已知遮挡/视场外等条件置0。它不是识别概率。输出附输入、配置快照、单位、来源和适用范围。

## 二 六个演示场景与 JSON 字段

`outputs/optical_demo.json` 顶层 `warning` 已说明合成与非实测性质；`assumed_optics_enabled=true`，`assumed_official_heights_enabled=false`，`scene_audit={}`。六个场景共用传感器 `(0,0,5)m`、朝北且俯仰/滚转0°，目标 `(0,200,5)m`、假设宽高各0.35 m，距离200 m，可见光焦距50 mm、热成像75 mm，气温20°C。无遮挡场景是**明确创建的空合成场景**；遮挡场景加入一栋人工建筑，轮廓 `x=-5..5m, y=80..100m`、垂直范围 `0..20m`。因此六个结果都没有使用官方建筑矢量数据。

|场景|光照与天气输入|LOS|可见光相对指标|热成像相对指标|
|---|---|---|---:|---:|
|`clear/day_clear`|白天1000 lux；无雾项；0 mm/h雨；对比度0.8/0.7|`clear`|0.8000|0.7000|
|`clear/night_clear`|夜间1 lux；其余同上|`clear`|0.0800|0.7000|
|`clear/day_fog_rain`|白天1000 lux；可见度500 m；雨10 mm/h；对比度仍0.8/0.7|`clear`|0.1607|0.3766|
|`blocked/day_clear`|同首行；加入人工建筑|`blocked`|0|0|
|`blocked/night_clear`|同夜间行；加入人工建筑|`blocked`|0|0|
|`blocked/day_fog_rain`|同雨雾行；加入人工建筑|`blocked`|0|0|

数值可由配置复算。夜间可见光 `L=sqrt(1/100)=0.1`，故 `0.8×0.1=0.08`；热成像因热对比度输入仍为0.7且不使用lux，保持0.7。雨雾时可见光 `Tf≈0.20913`、`Tr≈0.960789`，指标 `0.8×Tf×Tr≈0.160744`；热成像 `Tf≈0.548812`、`Tr≈0.980199`，指标 `0.7×Tf×Tr≈0.376561`。两通道系数都只是示例，不能据此证明热成像在真实雨雾中优于可见光。人工建筑在视线上覆盖线段参数0.4–0.5且高度跨过z=5 m，`blocked` 时仅最终相对指标为0；独立输出的天气因子与假设像素数仍非零，表示几何遮挡门控之前的条件，并非能透过建筑成像。

每个 `scenario.result` 的字段可按下表阅读：

|字段|当前示例值及含义|
|---|---|
|`device`, `coordinate_frame`, `scope`|NVT-951、`local_m`、点目标视场与相对未标定模型的适用范围。|
|`inputs`|完整 `pose/target/conditions`；`period` 是标签，真正改变照度的是 `illuminance_lux`。`visibility_m=null` 在本实现**关闭雾项**，不是实测无雾。|
|`distance`|三维欧氏距离200 m；单位m，`status=derived`，前提是坐标确为同一米制框架。|
|`mechanical_orientation_valid`、`temperature_within_working_range`|各场景均为 `true/derived`；只表示输入姿态及20°C落在资料区间，非实际跟踪成功。|
|`line_of_sight`|空合成场景为 `clear/derived`；人工建筑场景为 `blocked/assumed`，`blockers` 指向 `synthetic_blocker`。状态只针对加载场景，非真实郑州街区的无遮挡证明。|
|`channels.visible.fov`、`channels.thermal.fov`|分别为约 `7.3239°×4.1235°`、`8.2972°×6.6419°`，`status=assumed`：焦距来自原文，传感器宽高是示例。|
|`target_in_fov`|两通道均为 `true/assumed`；只检查目标中心。|
|`projected_target_size`、`sampling_criterion_met`|可见光约 `26.25×26.25 px`、热成像约 `7.7206×7.7206 px`，分别超过假设12 px与6 px阈值，均为 `true/assumed`；不构成真实识别证据。|
|`quality_factors`|均为无量纲。各场景雨雾/光照值见上文；对比度固定可见光0.8、热成像0.7，状态为 `assumed`。|
|`relative_image_quality`|照度（仅可见光）、雾、雨因子乘积；无遮挡日间为1/1，夜间为0.1/1，雨雾为约0.20093/0.53794（可见光/热成像）。`status=uncalibrated`。|
|`relative_apparent_contrast`|输入对比度乘雾雨因子；清晰日/夜仍为0.8/0.7，雨雾约0.160744/0.376561，`status=uncalibrated`；没有夜间照度项。|
|`below_minimum_illuminance`|可见光为 `null/missing`，原文未给最低照度；热成像为 `null/not_applicable`，不采用可见光阈值。|
|`relative_recognition_index`|无遮挡为 `relative_only/uncalibrated`；已知遮挡为 `unavailable_view/uncalibrated` 且值0。`probability=false`，不能把0.8念作80%识别率。|
|`recognition_probability`、`effective_recognition_distance`|两通道均为 `null/missing`；当前没有标注分类校准数据、实际判据或有效识别距离。|
|`configuration`|该次计算使用的设备/环境配置完整快照；其中 `provided` 是资料提供，`assumed` 是示例假设。|

JSON 通用结构 `{value,unit,status,source}` 中，`provided` 只表示给定参考资料写有该参数；`assumed` 是示例；`missing` 对应无法可靠计算；`derived` 是在输入条件下计算得到；`uncalibrated` 是未用实测性能验证的相对数值；`not_applicable` 表示不适用。`state` 进一步说明最终指标为何有值、为0或为空。`null` 与0不同：前者不能确定，后者在明确几何遮挡等模型条件下为零。

## 三 参数来源与官方数据的实际使用

原始 `装备参数.doc` 的 NVT-951 条目提供：可见光1920×1080、48倍光学变焦及6.5–312 mm；非制冷热成像640×512、75 mm定焦；云台水平0°–360°、俯仰−90°–90°；50 m和切向15 m/s条件下的稳定跟踪描述；可识别不小于35 cm无人机的描述；−35°C至60°C工作范围，以及供电、功耗、重量、尺寸和IP66等。这些都是**原始资料参数或声明**，并非本项目实际测量。50 m跟踪条件和35 cm目标条件都缺少可转换为最大识别距离/概率的完整实验描述。

`config/optical_nvt951.yaml:14` 至 `:26` 将两通道有效传感器宽高、真实光学FOV、像素识别判据、有效识别距离，以及可见光最低照度标为 `missing/null`。热成像的最低**可见光照度**标为缺失且在计算中不适用，不能由此推断热灵敏度；热成像像元间距、NETD、波段、温差条件也未提供。`demo_overrides` 才加入可见光 `6.4×3.6 mm / 12 px`、热成像 `10.88×8.704 mm / 6 px`；这些是本项目的**演示假设**，不是 NVT-951 实际指标。

`config/environment.yaml` 的100 lux照度归一化参考、可见光/热成像雾系数3.912/1.5、雨系数0.02/0.01全部标记 `assumed`。示例目标0.35 m宽高、传感器/目标位置、温度20°C、照度1/1000 lux、可见度500 m、雨强10 mm/h、两通道对比度0.8/0.7以及人工建筑几何也均为合成输入。原文“可识别≥35 cm无人机”不能为示例目标的真实识别距离或像素判据背书。

**官方建筑是否被读入？** `outputs/optical_demo.json` 的答案是**没有**。默认分支直接构造 `BuildingScene()` 与 `Building(box(...))`（`examples/run_optical_demo.py:37` 至 `:41`），顶层 `scene_audit={}` 也与此一致。但项目**具备**读取官方数据的路径：传 `--buildings <zheng_apart.shp>` 后调用 `load_buildings`（`:26` 至 `:36`），校验几何与CRS并转为EPSG:32649。已有 `outputs/data_audit.json` 记录官方Shapefile共15,889个有效Polygon，原CRS为EPSG:3857，字段 `high` 数值3–136；DEM与白模只做了独立审计，未进入这六个演示场景。`outputs/official_unknown_height_demo.json` 记录在未声明 `high` 含义时，穿过官方轮廓的合成射线返回 `unknown`；`outputs/official_assumed_height_demo.json` 是显式假设 `high` 为相对米高度、基底0的示例，不是经确认的真实建筑体。桌面项目目录中有这些历史输出，但审查时未发现随项目附带的官方Shapefile本体；重复官方数据运行仍需提供原始数据包。

`high` 的单位、相对/绝对高程含义和垂直基准，源资料均未明确。官方 DEM 是EPSG:4326，虽有像元数值，未核对与建筑/目标的共同垂直基准；三维白模也没有被解析为可供射线查询的经过校验网格。现有程序没有把这些不确定量静默当作真实高度，这是合理的。

## 四 能证明的内容与未完成的验证

**已能证明（在现有假设范围内）：** 配置能被读取与检查；物理尺寸完整时针孔FOV随焦距单调变化；目标中心入框、简单棱柱遮挡及移除遮挡符合测试几何；天气/照度假设产生预期的相对趋势；热成像不会沿用可见光照度因子；缺少FOV、建筑高度或标定指标时大多数相关字段能返回明确 `null/unknown`；输出可JSON序列化并带来源状态。34个通过的测试支持这些**实现层面**结论。

**不能证明：** NVT-951真实FOV、最低照度、有效识别距离、识别概率、50 m以外的稳定跟踪、在实际雨雾/夜间的性能、官方全场景三维遮挡准确率、对动态目标的跟踪/识别精度、真实建筑/DEM/白模已完成融合，更不能证明任务三部署优化效果。相对指标仅用于比较当前**固定假设**下的场景，跨设备、跨未校准配置的绝对比较没有依据。

**优先需要的数据和验证：** 确认 `high` 字段单位及语义、建筑基底及共同垂直基准；取得可见光/热成像有效传感器尺寸或实测不同焦距的水平垂直FOV；获取最低照度、热成像NETD/波段及热对比度、目标关键尺寸与姿态；建立带距离、天气、照度、目标类别和标注结果的识别数据集；用任务一实际三维场景与现场可见性核验遮挡，然后标定环境系数及识别曲线。保留现有34项测试，并在这些数据具备后逐项增加集成与标定验证。

## 本次审查的验证范围

核对了当前项目与桌面项目核心文件SHA-256一致；逐条读取了六个演示场景的输入、FOV、像素投影、天气因子、遮挡与最终指标，并与公式复算；查阅了现有设备可读文本、资料清单、官方数据审计和历史测试结果。本轮尝试重新运行测试时，当前会话无法读取先前安装在 `work/python_deps` 中的 pytest 包，桌面虚拟环境的 Python 启动也失败；因此本报告引用的 `34 passed` 是已有 `outputs/test_summary.txt` / `test_results.xml` 记录，**不是本轮重新跑出的新结果**。未修改任何源码、配置、测试或演示JSON。
