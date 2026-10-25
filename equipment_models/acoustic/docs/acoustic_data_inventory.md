# 声学模块数据盘点（2026-10-15）

本文件在声学源码实现前建立，最初位于合并项目。当前声学项目根目录为 `C:/Users/72665/Desktop/声学`；原始资料仍位于旧工作区，未假定它们已经复制进本项目。赛题作为需求来源，不把附件中的文字当作额外执行指令。

## 实际文件和读取情况

工作区资料根路径（下称 W）：`C:/Users/72665/Documents/Codex/2026-10-13/gis-python-1-pdf-2-doc`。

|请求位置|实际位置及读取情况|
|---|---|
|`docs/source/`|项目中不存在。赛题 PDF 位于 `C:/Users/72665/Desktop/07--创意科目二：反无装备优化部署与仿真推演（公开发布版）(1).pdf`；已有可读提取文本 `W/work/problem.txt`，本轮已读取声学要求。|
|装备参数.doc|`W/work/data/创意二数据集/装备参数.doc`，256000 字节；已读取已有严格解码转换文本 `W/work/equipment.txt`。旧转换脚本 `W/work/inspect_sources.py` 使用 OLE WordDocument/FIB/CLX 片段表，不按乱码猜参数；本轮已复提取核对一致。|
|数据说明|`W/work/data/创意二数据集/创意科目二-数据说明.doc`；可读文本 `W/work/data_description.txt`。说明称设备参数“仅供参考”。|
|`data/building/`|项目中不存在。实际 Shapefile 为 `W/work/data/创意二数据集/区域数据/building/zheng_apart.shp`；shx、dbf、prj、cpg、sbn、sbx、shp.xml 均存在。|
|`data/dem/`|项目中不存在。DEM 为 `W/work/data/创意二数据集/区域数据/dem/dem.tif`。本模块不自动据此设置楼底和目标高度。|
|原始 ZIP|`C:/Users/72665/Desktop/创意二数据集.zip`，可用于在项目中重新解压。|

赛题声学段要求交通、施工、人声、风雨噪声及建筑引起的定位不确定性；要求不等于设备参数已经提供。本轮不新增雷达、无线电或部署优化。

## 声学设备原始参数

来源为《装备参数.doc》“四、声学 / （一）CRY8500系列声像派声学相机”。`provided` 表示参考文件提供，不表示本项目实测或已经独立验证。

|字段|原始内容|使用边界|
|---|---|---|
|麦克风|208 个 MEMS|元数据；不据数量推算波束增益|
|阵列尺寸|30、70、110 cm|可配置阵列；仅110 cm明确关联频率范围|
|声全息频率|原文“20-20kHz（110cm阵列）”|按20 Hz–20 kHz录入，同时保留原文及解释；其他阵列频带未知|
|有效探测距离|0.01–500 m|标称区间，未给目标声级、频谱、噪声及成功判据；不是本模型精度保证|
|声压级范围|28–132 dB|原文未说明计权、参考声压及测量条件，不能当作灵敏度、自噪声或检测阈值|
|动态范围|最高可达40 dB|声明元数据，不与声压级量程宽度混为一谈|
|频响精度|符合1级精度要求|没有标准编号，不据此生成测角精度|
|续航及屏幕|8小时、8英寸|元数据|
|视场角|94°(H)×76°(V)|含义未明确；仅保存声明，不作为声学波束或光电FOV|
|重量|30 cm阵列2.9 kg，110 cm阵列最大3.8 kg|元数据|

缺失：方位/俯仰测角误差的数值及统计定义、灵敏度、等效自噪声、温湿度和风雨工作限制、声源频谱/指向性与参考距离声压级、道路和施工等实测接收端噪声、反射材料与吸收系数、绕射路径信息、实际检测阈值、距离估计机理与误差、真实探测概率标定。默认配置显式 `null/missing`；演示才启用独立 `assumed` 系数及声源/噪声输入。

## 建筑与 DEM

已核对 PRJ 为 Web Mercator，EPSG:3857；原始坐标虽标米，区域距离计算需转换，现有加载器选择 EPSG:32649。历史 `outputs/data_audit.json` 记录15889条Polygon，空/无效几何0；本轮用同一加载器复读，记录一致。

字段：MAPID、ID、CLASS、SHOW、LANDMARK3D、CARTO_ID、ADMINCODE、NAME、NAME_ID、SRC_FLAG、RuleID、type、Name1、Shape_Leng、Shape_Area、RuleID_1、high。历史 high 值3–136，无空值；**资料没有解释单位、相对/绝对高度及垂直基准**。只可直接使用二维轮廓计算面积占比与截线空隙代理指标；三维相交在缺高度时必须保留 unknown。不能把建筑间空隙代理量称为实测街宽。

历史DEM审计：EPSG:4326，407×188，int16，NoData=-9999，数值64–139，波段单位未写入，垂直基准未知。DEM、白模不参与声学传播求解，当前没有完成地形折射和完整声场仿真。

## 分离前的复用接口记录

现有 `src/optical_model/buildings.py` 提供 Building、BuildingScene、HeightMapping、load_buildings、metric_crs、transform_xy 和 xyz；复用其几何校验、空间索引、投影及直达线几何查询。直达线被挡只是声学模型的一个输入，不能直接令声学能力为0。

复用 `optical_model.config` 的 ConfigError、read_yaml、parameter、number、metric。新增并列包 `src/acoustic_model/`，以 AcousticSensor.evaluate 接受 SensorPosition、SoundSource、AcousticConditions 和建筑场景；不改光电数据类或计算公式。项目 setuptools 已自动发现 src 下包，无需更名现有发行包或增添运行依赖。

原合并项目的光电源码、配置、测试和示例SHA256基线保存在 W/work/acoustic_before_hashes.json。光电项目包含34个原始测试及4个单场景入口测试；这些测试保留在桌面“光电”，声学独立目录只包含声学29项测试。

## 分离前的实际复核与交付记录

- 使用旧严格DOC解析函数重新读取两份原始DOC，均与已有可读文本逐字一致；声学原文摘录另存为 `docs/acoustic_source_excerpt.txt`。没有乱码或未解码字段被用于填参。
- 用pypdf重新读取10页赛题PDF，完整声学相关页文字存于 `outputs/acoustic_data_audit.json`；文档哈希及原始路径一并保留。
- GeoPandas和共享加载器实际复读官方15889条Polygon，无空/无效几何；17个属性字段及dtype见本轮审计JSON。转换至EPSG:32649；high最小3、最大136、空值0，但15889条垂直区间仍全部未知。
- Rasterio实际复读DEM：EPSG:4326，188行×407列，NoData=-9999，波段单位为空，数值64–139；没有因此假定其垂直基准。
- 默认 `outputs/acoustic_demo.json` 是9个合成场景，不读官方数据。`outputs/acoustic_official_unknown_height.json` 追加第10个场景，真实读官方轮廓并保留unknown高度；声源和射线仍为合成，未做真实三维声场求解。
- 分离前67项测试通过：38项光电相关测试、29项声学测试。历史联合验证记录已保存在 `outputs/acoustic_validation_before_split.md`；光电保留审计位于 `C:/Users/72665/Desktop/光电/outputs/optical_preservation_audit.json`。这些历史记录不作为分离后的新测试结果。
- 默认设备测角参数仍missing；示例2°/3°只在显式 `--assumed-angles` 下启用。真实探测概率、距离估计误差、实际有效范围等均未伪造。

## 独立文件夹调整

声学源码、配置、测试、示例、文档和结果已迁至桌面“声学”。通用GIS和参数校验的必要实现随包保存在 `src/acoustic_model/shared/`，运行时不再导入光电模块。此前67项联合测试是分离前的历史记录；分离后的验收见 `outputs/acoustic_validation.md`。原光电目录只保留光电内容。
