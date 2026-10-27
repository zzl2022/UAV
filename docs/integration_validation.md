# 本地接入验证记录

日期：2026-10-25。平台上游 main 提交：6097a2fbdaa71cd4c803396f7209e89ade755e5b。

## 已执行与通过

|检查|结果|
|---|---|
|仓库真实SHP、DEM、影像数据准备|15,889栋建筑，0排除，0修复；23次小范围DEM近邻补取，最大40.018 m|
|原始装备DOC核对|与本项目此前严格解码的原DOC逐字节一致|
|平台Node测试|58通过（原有55项 + 新增3项）|
|Python接入接口测试|19通过，覆盖真实HTTP请求、原点／轴向、缺失参数、非法输入、阵列差异、配置重读及模型副本SHA256|
|原光电完整测试|45通过|
|原声学完整测试|36通过|
|平台影像unittest|2通过|
|Vite生产构建|通过；仅原有大块JS体积提示|
|新增页面浏览器验证|通过：真实城市渲染、Python结果、参数调整、错误输入结果失效、目标拖动、地图选点、阵列切换、两组场景保存、JSON／HTML下载、离线报告打开、移动端宽度|
|老师原装备页面浏览器回归|通过：四类模型、拖动、导入／导出、空方案、鼠标查询、移动端|

原设备DOC SHA256：`12e731c84d9c24c0bb0af2acc889ee6d09c06d91cd934a4e05e39ea755c69cdc`。
源文件哈希和城市数据限制见 `public/data/report.json`；复制的原模型文件清单见 `equipment_models/source_manifest.json`。
测试未删除、未弱化。原模型源码、配置、测试、示例共31个文件已逐字节复制并校验。

## 运行证据

- `artifacts/platform-tests.txt`：平台58项测试的实际终端日志。
- `artifacts/student-browser-validation.json`：新增页面浏览器检查结果。
- `artifacts/student-platform-scenarios.json`：通过页面真实下载的两组场景结果。
- `artifacts/student-platform-report.html`：通过页面真实下载的离线中文报告。
- `artifacts/student-optical-desktop.png`、`student-acoustic-desktop.png`、`student-mobile.png`：实际运行截图，已目视检查。
- `artifacts/student-report-preview.png`：下载报告的浏览器预览。

## 本次验证环境

Node.js 24.19.0、Python 3.12.14、本机Edge无头浏览器。
本会话使用可访问的Python启动器，独立添加工作区 `work/uav_runtime` 依赖，并非替用户配置了系统Python或项目.venv。
主要验证依赖：NumPy 2.5.4、Shapely 2.2.0、PyProj 3.8.0、GeoPandas 1.2.0、PyYAML 6.0.3、pytest 9.1.1、Rasterio 1.5.2、pyshp 3.1.6。
这些是本会话测试版本；仓库原始GIS精确版本仍在 requirements.txt，标准安装命令见接入说明。
当前页面由Vite及独立Python服务运行；后续重新启动请按说明安装项目依赖，不依赖本会话验证路径。

软件测试通过不证明真实探测概率、识别精度、测角精度或高程准确性。
当前基础接入没有新增天气／噪声采集，没有把老师平台旧评分接入为Python模型真实概率，也没有重写部署优化。
