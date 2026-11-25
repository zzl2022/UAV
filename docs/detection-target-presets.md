# 侦测目标型号及导入

核对日期：2026-11-05。在城市建模 → 侦测目标中，导入 JSON 或选择型号只更新草稿，点击“应用”后生效。型号选择框位于“导入”右侧。目标位置始终保留；侦测目标页不再提供恢复默认。

| 型号 | 长 × 宽 × 高 / mm | 尺寸口径 | 预填速度 / m/s | 官方来源 |
| --- | --- | --- | --- | --- |
| DJI Mini 4 Pro | 298 × 373 × 101 | 展开、含桨 | 16，运动模式 | https://www.dji.com/mini-4-pro/specs |
| DJI Air 3S | 266.11 × 325.47 × 106 | 展开、不含桨 | 21，海平面无风，非欧盟版本 | https://www.dji.com/air-3s/specs |
| DJI Avata 2 | 185 × 212 × 64 | 机身尺寸 | 27，手动模式，非欧盟版本 | https://www.dji.com/avata-2/specs |
| DJI Mavic 3E | 347.5 × 283 × 107.7 | 展开、不含桨 | 21，运动模式前飞，非 EU C1 电池配置 | https://enterprise.dji.com/mavic-3-enterprise/specs |
| DJI Matrice 350 RTK | 810 × 670 × 430 | 展开、不含桨 | 23，最大水平速度 | https://enterprise.dji.com/matrice-350-rtk/specs |

机型速度采用官方最大水平速度作为仿真初始值，可以手动调整；它不是典型巡航速度。尺寸转换为米，宽度和高度直接对应原表，可见尺寸用长宽较大值近似。各机型含桨口径不同，不能作为统一的旋翼外廓比较。型号预设仅填充这四项；RCS、声压、声频、热对比、无线电等参数保留当前仿真值，不声称是型号实测数据。界面提供对应官方链接和口径说明。

导入接受原始对象或 `{ "target": { ... } }`（也支持平台导出的完整方案中的 target）。支持现有目标字段，以及 `capability.width_m`、`height_m`、`check_band`、`band_hz`，也可使用表单字段 `width_m`、`height_m`、`check_band`、`bandLow`、`bandHigh`。按当前草稿合并部分参数，保留未提供的字段。文件大小上限 1 MB，失败不修改草稿或已应用目标；导入不会改变位置。未知字段或非法范围、类型、频带顺序会被拒绝。

示例文件：`public/examples/detection-target.json`。文件中数据为自定义场景示例。
