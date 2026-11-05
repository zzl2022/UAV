# 任务三 · 模型选型对比报告

> 状态：待用户确认。本报告为任务三各环节（需求理解、白模/地形解析、候选方案生成与部署优化、覆盖/盲区仿真、威胁场景推演、电磁兼容校核）调研开源 SOTA 候选，每环节 ≥3 个，给出优劣、开源协议、部署成本，并推荐一个可拼接的组合方案。调研时间 2026-10；仓库链接经检索核实，标注"需核实"者引入前需再确认。

## 0. 结论先行（推荐组合）

**总体策略：自研为主 + 轻量库拼接。** 本项目子任务一（三维建模）、子任务二（四类装备物理模型）与部署优化贪心器已经成型且纯 JS 运行于 Web Worker；重型仿真引擎（Gazebo/AirSim/SPLAT!）与 Vite + Three.js 架构不匹配，只借鉴其模型参数与验证思路，不引入运行时。

| 环节 | 推荐 | 运行方式 |
| --- | --- | --- |
| 白模/地形解析与遮挡 | three-mesh-bvh（已在使用）+ Python 侧 GDAL/rasterio（已在使用） | 前端 JS（Web Worker）+ Python 离线预处理 |
| 部署优化 | 自研加权贪心集合覆盖（已有）+ **HiGHS（npm `highs`，WASM MIP）做对拍精解** | 前端 WASM |
| 覆盖/盲区仿真 | 自研物理模型（已有）+ **NTIA ITM** 与 **ITU-Rpy** 的参数/模型做对标校核 | Python 离线校核 |
| 威胁场景推演 | 自研运动学逐帧推演（复用 flight.js 模式）；蜂群航迹可用 **gym-pybullet-drones** 离线生成 JSON 校验 | 前端 JS |
| 电磁兼容校核 | 自研频段/功率规则引擎（依据装备参数.doc），以 GNU Radio / CloudRF Signal-Server 方法论为参照 | 前端 JS |
| （可选）ML 推理 | ONNX Runtime Web（WSIMD/WebGPU） | 前端 WASM/WebGPU |

本任务实现路径**不新增任何 npm 重型依赖**：HiGHS 与 ITM/ITU-Rpy 仅作离线对标与文档依据，不进入前端运行时。若用户希望在前端获得 MIP 精确解，可在后续迭代中加入 `highs`（WASM 单文件，MIT）。

## 1. 白模/地形解析与射线遮挡仿真

| 候选 | 协议 | 优劣 | 部署成本 |
| --- | --- | --- | --- |
| **three-mesh-bvh**（gkjohnson，~3.5k★，月级发版） | MIT | Three.js BVH 射线加速，支持批量射线/shapecast，纯 JS 可进 Worker；15,889 栋建筑遮挡计算的首选；**项目已集成** | 极低（已在依赖中） |
| GDAL / PDAL（OSGeo，长期活跃） | MIT/BSD | SHP/DEM 事实标准；已在 Python 数据准备侧使用；gdal3.js 有 WASM 构建但体积大，仅适合离线 | 低（已在使用） |
| CesiumJS（~13k★） | Apache-2.0 | 3D Tiles 城市级渲染成熟，但与现有 Three.js 栈并行渲染成本高、重复建设 | 高，不推荐 |
| Blender API | GPL | 建模能力强但 GPL 传染性、需桌面端，不符合浏览器架构 | 高，排除 |
| NVIDIA OptiX | 闭源 SDK | GPU 射线追踪，非开源、需 CUDA | 排除 |

## 2. 覆盖/盲区仿真（传播模型）

| 候选 | 协议 | 优劣 | 部署成本 |
| --- | --- | --- | --- |
| **NTIA/itm**（Longley-Rice ITM 官方实现，20MHz–20GHz，持续维护） | 公共领域/CC0 风格 | 标准化地形传播损耗；**仅考虑地形不考虑建筑**——正好与本项目三维射线遮挡互补；C++ 可编 WASM | 中（建议仅离线对标） |
| SPLAT! / CloudRF Signal-Server | GPLv2/GPL | 含 ITM+ITWOM，支持干扰与覆盖分析；C 代码可作离线引擎，活跃度需核实 | 中高 |
| **ITU-Rpy**（v0.4.0） | MIT | Python 实现 ITU-R P.618 雨衰、P.676 大气吸收等，适合数据侧链路预算校核 | 低（pip 安装，离线用） |
| RadarSimPy | 预编译+免费层限制 | 雷达射线仿真强，但非纯开源 | 仅作参考实现 |

本项目子任务二已按装备参数.doc 实现雨衰/多径/绕射（刀锋）/双径模型；引入 ITM 与 ITU-Rpy 的价值在于**提供标准化参数与对标曲线**，写入校核报告，不替换前端模型。

## 3. 候选方案生成与部署优化

| 候选 | 协议 | 优劣 | 部署成本 |
| --- | --- | --- | --- |
| **HiGHS + npm `highs`**（ERGO-Code，活跃） | MIT | LP/MIP/QP 精确求解，官方 WASM 构建可在浏览器/Node/Worker 直接运行；可把贪心集合覆盖升级为 MIP 精解或对拍 | 低（单 WASM 文件），与 Vite+Worker 完美契合 |
| **Google OR-Tools CP-SAT**（~12k★，活跃） | Apache-2.0 | 带约束选址最强开源求解器；Python 侧极易集成，官方 JS/WASM 为实验性 | 低（Python 离线）/中（前端实验构建） |
| **PySAL/spopt**（v0.8.0，2025 仍更新） | BSD | 内置 LSCP/MCLP/P-Median/P-Center，与地理数据天然对接，适合 Python 侧对标自研贪心 | 低（pip，离线） |
| pymoo（2025-11 仍发版） | Apache-2.0 | NSGA-II/III 多目标优化（覆盖 vs 成本 vs EMC）首选；DEAP（LGPL）偏老 | 低（pip，离线） |

**选择**：保持前端自研贪心（实时、可解释、零新依赖）；用 spopt/OR-Tools 在 Python 侧对拍验证贪心解质量；HiGHS WASM 作为可选增强写入报告但不默认引入。

## 4. 威胁场景推演（单机/多方向/蜂群）

| 候选 | 协议 | 优劣 | 部署成本 |
| --- | --- | --- | --- |
| **gym-pybullet-drones**（utiasDSL，活跃） | MIT | 轻量运动学+多机仿真，Python 生成蜂群航迹 JSON 供 Three.js 回放；与数据侧管线契合 | 低（离线） |
| ArduPilot SITL | GPLv3 | 真实飞控逻辑，可模拟多机蜂群；部署重，仅作验证数据源 | 高 |
| Flightmare / Colosseum(AirSim 后继) / Gazebo | MIT/Apache-2.0 | 动力学+渲染完整但需 UE/Unity/ROS，部署成本高；仅借鉴运动学模型 | 高，不引入运行时 |
| 自研（复用 src/planning/flight.js 插值+逐帧 evaluate） | — | 与既有报警/检出链路完全一致，帧级可追溯 | 极低 |

**选择**：自研逐帧推演为主线（三类场景：单机多方位航路、≥4 方向同步、蜂群超容量饱和），蜂群航迹可用 gym-pybullet-drones 离线生成对照样本。

## 5. 电磁兼容校核

| 候选 | 协议 | 优劣 | 部署成本 |
| --- | --- | --- | --- |
| **GNU Radio**（活跃） | GPLv3 | SDR 信号/干扰仿真事实标准，可生成 EMC 测试波形；不进前端 | 中（离线分析用） |
| **CloudRF Signal-Server / SPLAT!** | GPL | 多发射机同频干扰叠加分析，C 内核可作 EMC 计算引擎 | 中高 |
| **ITU-Rpy / NTIA 传播库** | MIT/公共领域 | P. 系列模型为 EMC 校核提供标准化衰减依据 | 低 |
| openEMS（FDTD 近场天线级） | GPL | 精细但明显过重 | 排除（仅作扩展选项） |

**现实结论**：该领域无"开箱即用 EMC 校核"开源件。工程做法 = **传播模型 + 链路预算 + 频率分配规则自研**：依据装备参数.doc 的频段（雷达 X≈9.4/Ku≈15GHz，无线电 100MHz–6GHz 与 0.9/1.2/2.4/5.2/5.8GHz 离散频点）、功率（03D≤1500W、02C≤400W）与间距，构建同频/邻频/前端阻塞三类冲突规则，输出冲突清单与"通过/降额/不通过"结论。上述开源工具的方法论（同频复用距离、邻道抑制）作为规则出处写入 EMC 报告。

## 6. 前端推理运行时（备用，当前不需要 ML）

| 候选 | 协议 | 说明 |
| --- | --- | --- |
| **ONNX Runtime Web** | MIT | WASM(SIMD/多线程)+WebGPU EP，支持 Worker，生态最广，首选 |
| TensorFlow.js | Apache-2.0 | 后端齐全但模型需转换，生态萎缩 |
| Transformers.js | Apache-2.0 | 基于 ORT-Web，若引入检测/分类小模型可加速 |

## 与现有架构的兼容性确认

- 推荐组合全部落在 **Vite 前端（JS/WASM，Web Worker）+ Python 离线脚本** 两条既有轨道上，无需新增服务端 API。
- 前端运行时零新增重依赖：three-mesh-bvh 已在 `package.json`；HiGHS/ORT-Web 为可选增强。
- Python 侧对标（spopt / ITU-Rpy / gym-pybullet-drones）仅用于生成校核数据与文档结论，不进交付运行时。

## 待确认事项

1. 是否同意"自研为主 + 轻量库拼接、前端零新增重依赖"的集成路线？
2. 是否需要在前端引入 HiGHS WASM 做 MIP 精解（会新增约 1–2 MB WASM 资源）？默认不引入，以贪心 + 多轮迭代为准。
