# 装备建模统一接入验证记录

日期：2026-10-29。基于本机 `UAV-platform`，上游基础为 `zzl2022/UAV@f684c3b9feac`，包含本地整合改动，未推送远程。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 98 passed，0 failed；包含原88项和新增10项 |
| `pytest backend/test_capabilities.py` | 21 passed |
| `pytest equipment_models/optical/tests` | 45 passed |
| `pytest equipment_models/acoustic/tests` | 36 passed |
| `npm run build` | 成功；保留Vite原有包体积提示 |
| 统一装备浏览器检查 | 通过，页面错误为0 |
| 原装备面板浏览器回归 | 通过 |
| 任务三完整浏览器推演 | 通过 |

Python三个测试目标分别运行。光电和声学各有 `test_chinese_report.py`，默认导入模式下不要合并到同一条pytest收集命令；上述独立运行方式保留所有测试。

## 实际验证范围

- 同一“装备建模”入口，页面不挂载原独立面板；原Python模型副本、配置及测试保留，来源清单哈希检查通过。
- 实际Python请求使用装备面板的设备ID、设备和目标坐标、朝向及通道／阵列设置。
- 可见光与热成像切换正确读取各自的资料分辨率和焦距。切换时关闭前一通道的自定义视场。
- 有效的“否”和零值保留；空值、不完整数组及未评估字段不列入中文界面或报告，原JSON状态不变。
- 显式开启固定视场后进行视场判断和投影计算；默认不注入假设视场。
- 非法输入立即清除旧评估并禁止保存；较早请求迟到时不能覆盖新结果。
- 设备／目标真实鼠标拖动、地图表面选点、坐标更新、相机控制恢复、鼠标位置查询。
- 不同阵列规格的频带适用条件；30 cm阵列不显示110 cm阵列的频带核对结果。
- 两个场景的快照隔离、JSON及中文HTML导出、HTML离线显示、方案导入后重新计算。
- 服务失败不回退为假设计算结果。资料基础模式不绘制假设识别距离形成的覆盖体。
- 原装备面板的无线电静默、TDOA站数门槛、增删／清空设备、空方案导入导出、拖动取消、移动端宽度均回归通过。
- 任务三产出至少三套差异方案与推荐方案，四类盲区、三类威胁、42目标蜂群容量溢出、EMC、播放／定位进度、导出、取消及原部署面板均通过。

## 复核材料

统一装备检查由 `scripts/equipment_browser_smoke.js` 生成 `artifacts/equipment-unified/`：

- `validation.json`：检查项与页面错误。
- `scenarios.json`：页面实际下载的两组输入与资料评估快照。
- `equipment.json`：统一方案JSON，含基础评估结果及仿真结果的独立字段。
- `report.html`、`report.png`：实际导出的离线中文报告及预览。
- `optical.png`、`acoustic.png`、`optical-details.png`、`acoustic-details.png`、`mobile.png`：实际界面截图。

任务三浏览器脚本为 `scripts/task3_browser_smoke.js`，本机使用Edge与软件WebGL运行。原装备脚本为 `scripts/sensor_browser_smoke.js`。运行方法见 [统一使用说明](equipment-unification.md)。

本记录验证软件流程和数据对接，不提供实测检出率、识别精度或绝对高程精度证明。任务三仍使用JavaScript仿真链路，Python资料基础结果未自动进入优化评分。
