# 无人机型号库与导入

核对日期：2026-11-05（首批 5 款官方参数）；型号库更新：2026-11-25。

在「三维环境建模 → 侦测目标」点击「模板」右侧的「无人机设备库导入」即可打开设备库。内置 100 款机型、11 个品牌，覆盖航拍、跟拍、穿越、巡检、测绘、农业作业、物流和教育。卡片支持按品牌、型号或用途搜索，也可按品牌筛选，点击卡片查看规格。

点击「导入到推演平台」后立即载入等效可见尺寸、成像水平尺寸、成像垂直尺寸和速度并生效。等效尺寸取长、宽中的较大值，另外两项取原规格宽度和高度；尺寸以米保存，各型号的展开与含桨口径见记录。速度采用厂商注明的飞行条件，作为可编辑的仿真初值。位置、雷达截面积、声学、热对比和无线电参数沿用当前场景，不随型号变化。

缩略图随平台部署，可离线浏览，包含厂商公开图片和生成的同类无人机示意图。[厂商图片清单](../src/sensors/assets/drone-catalog/photo-sources.json)

## 整库 JSON

「导入」按钮同时接受单个目标参数和整库 JSON。整库文件顶层包含 `schemaVersion`（当前为 `1`）和 `models`；每条记录包括唯一的 `id`、`brand`、`name`、`type`、`dimensions`（长、宽、高，单位 m）、`speed`（m/s）、`dimensionsNote`、`speedNote` 和 `source`（HTTPS 链接）。整个文件通过校验后才会追加，界面显示读取数、新增数和库内总数；重复导入按型号编号去重，已有型号不覆盖。内置型号库见 [drone-target-catalog.json](../src/sensors/drone-target-catalog.json)。

## 单目标 JSON

「模板」下载单个目标参数示例。「导入」接受原始对象或 `{ "target": { ... } }`（也支持平台导出的完整方案中的 target）。支持现有目标字段，以及 `capability.width_m`、`height_m`、`check_band`、`band_hz`，也可使用表单字段 `width_m`、`height_m`、`check_band`、`bandLow`、`bandHigh`。按当前草稿合并部分参数，保留未提供的字段。文件大小上限 1 MB，失败不修改草稿或已应用目标；导入不会改变位置。未知字段或非法范围、类型、频带顺序会被拒绝。成功导入后立即应用。

示例文件：`public/examples/detection-target.json`。文件中数据为自定义场景示例。

## 首批核对机型

| 型号 | 长 × 宽 × 高 / mm | 尺寸口径 | 预填速度 / m/s | 官方来源 |
| --- | --- | --- | --- | --- |
| DJI Mini 4 Pro | 298 × 373 × 101 | 展开、含桨 | 16，运动模式 | https://www.dji.com/mini-4-pro/specs |
| DJI Air 3S | 266.11 × 325.47 × 106 | 展开、不含桨 | 21，海平面无风，非欧盟版本 | https://www.dji.com/air-3s/specs |
| DJI Avata 2 | 185 × 212 × 64 | 机身尺寸 | 27，手动模式，非欧盟版本 | https://www.dji.com/avata-2/specs |
| DJI Mavic 3E | 347.5 × 283 × 107.7 | 展开、不含桨 | 21，运动模式前飞，海平面无风，非 EU C1 电池配置 | https://enterprise.dji.com/mavic-3-enterprise/specs |
| DJI Matrice 350 RTK | 810 × 670 × 430 | 展开、不含桨 | 23，最大水平速度 | https://enterprise.dji.com/matrice-350-rtk/specs |

机型速度采用官方最大水平速度作为仿真初始值，可以手动调整；它不是典型巡航速度。各机型含桨口径不同，不能作为统一的旋翼外廓比较。型号预设仅填充尺寸和速度；RCS、声压、声频、热对比、无线电等参数保留当前仿真值，不声称是型号实测数据。
