# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

反无人机（低空防御）部署仿真平台，基于上游 `zzl2022/UAV`（提交 `f684c3b9feac`）的本地整合版本。核心能力分三层：

1. **三维城市场景**：用郑州河南博物院片区真实建筑 Shapefile + DEM + 正射影像生成可浏览、可导出的 Three.js 城市模型（LoD1），另内置 4 个北京 GBA 站点模型。
2. **感知装备建模（子任务二）**：雷达 / 光电 / 无线电 / 声学 / 5G-A / 静电六类设备的能力特性建模。
3. **部署优化与飞行报警（子任务三）**：全域采样部署优化、多威胁验证、电磁兼容、盲区消除与无人机飞行推演。

关键认知：**光电/声学的“装备建模”统一入口走 Python 后端；雷达/无线电及任务三仍走浏览器内 JavaScript 仿真链路。** 两套链路并存，模式在界面与导出字段中区分。

## 架构

### 双引擎（前端 JS + 后端 Python）

- **前端**：`index.html` → `src/main.js`（入口）。`main.js` 初始化 Three.js 场景，并挂载三个 UI 子系统：
  - `src/sensors/` — 设备建模面板与 JS 物理仿真（雷达/无线电/光电/声学的“假设参数·环境仿真”模式），含体场渲染、热力图、场景遮挡查询（`createSceneQuery.trace`）。
  - `src/planning/` — “部署与飞行”：覆盖优化、飞行推演、遥测、语音报警（`optimizer.js`/`flight.js`/`worker.js`）。
  - `src/task3/` — “综合推演”：盲区、EMC、多威胁验证、部署文档生成等（动态 import 挂载）。
  - `src/student-capabilities/` — 装备建模统一入口的 API 客户端，通过 `/api/capabilities` 调 Python。
  - `src/workspace.js` — 基于 `<dialog>` 的浮动窗口管理（拖动/缩放/收起）。
- **后端**：`backend/server.py` 是仅回环（127.0.0.1:8765）的标准库 HTTP 服务，`backend/capabilities.py` 的 `CapabilityService` 加载 `equipment_models/` 下的两套 Python 模型包，提供 `dataset_only` 模式的资料基础评估。Vite 在开发态把 `/api/capabilities` 代理到 8765（见 `vite.config.js`）。

### 装备模型包（`equipment_models/`）

- `optical/` → `optical_model` 包（NVT-951 光电），`acoustic/` → `acoustic_model` 包（CRY8500 声学）。
- 每个包结构一致：`config/`（设备/环境 YAML，运行时每次评估重新读取）、`src/`、`tests/`、`examples/`、`docs/`。
- 两包是 `requirements-integration.txt` 里的可编辑安装（`-e ./equipment_models/optical[test]`）。`source_manifest.json` 记录从原低空项目拷贝来的文件哈希，用于核对来源。

### 坐标系与数据流

- Three.js 用 `[东, 上, -北]`（米）；Python 模型用 `[东, 北, 上]`。转换集中在 `backend/capabilities.py::to_enu`。
- 数据管线：`scripts/prepare_data.py` 读取 `创意二文件/创意二数据集/区域数据/`（SHP 建筑轮廓、DEM、影像、白模），产出 `public/data/`（`city.json`、`terrain.json`、`buildings.geojson`、`report.json` 等）。
- `public/data/`、`dist/`、`artifacts/` 是可再生产物，**不提交到 Git**；`创意二文件/` 是比赛原始数据，也不打包进仓库。

### 其他目录

- `radar/`、`rf/`：MATLAB 雷达 / 射频仿真（与 Web 平台分离，各自 `run_all.m` + `config/core/environment/sim`）。
- `scripts/`：数据准备（Python）、模型导出（Node）、浏览器冒烟测试、任务三文档生成脚本。
- `tests/`：Node 单测（`node --test`），另有一个 `test_imagery.py`。

## 常用命令

环境要求：Node.js ≥ 22.12（推荐 24）、Python 3.12、支持 WebGL 的浏览器。以下为 Windows（本机主环境）写法，Unix 把 `.venv\Scripts\python.exe` 换成 `.venv/bin/python`、`npm.cmd` 换成 `npm`。

### 首次安装

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-integration.txt
npm.cmd ci
.\.venv\Scripts\python.exe scripts/prepare_data.py
```

> 注意：`package.json` 里的 `prepare:data` 脚本写的是 Unix 路径 `.venv/bin/python`，Windows 上请直接运行上面的 Python 命令，不要 `npm run prepare:data`。

### 运行

```powershell
# 一体化启动（同时起 5173 页面 + 8765 Python 服务），推荐
.\.venv\Scripts\python.exe scripts/start_integrated.py
# 或双击仓库根目录的“启动装备建模平台.cmd”

# 仅前端（光电/声学的资料基础评估不可用）
npm.cmd run dev
```

浏览器打开 `http://127.0.0.1:5173/`。页面和 Python 服务都要运行才能做光电/声学评估；静态部署 `dist/` 时需另配 `/api/capabilities` 反向代理到 Python 服务。

### 测试

```powershell
npm.cmd test                                      # 全部 JS 单测（node --test tests/*.test.js）
node --test tests/sensors.test.js                 # 跑单个 JS 测试
.\.venv\Scripts\python.exe -m pytest backend/test_capabilities.py -q
.\.venv\Scripts\python.exe -m pytest equipment_models/optical/tests -q
.\.venv\Scripts\python.exe -m pytest equipment_models/acoustic/tests -q
npm.cmd run build                                 # 产出可静态部署的 dist/
```

> 三组 Python 测试必须**分开运行**——两套模型包里有同名测试文件，一起跑会导入冲突。

浏览器冒烟测试需先起服务并安装 Chromium/Edge（用 `CHROMIUM_PATH` 指定，`APP_URL` 指定已运行的服务器）：

```powershell
npm.cmd run test:equipment:browser                 # 装备建模统一入口
npm.cmd run test:browser                           # 城市模型渲染/导出
npm.cmd run test:planning:browser                  # 任务三部署
```

## 关键约束与约定

- **资料基础评估（dataset_only）不注入任何外界环境/天气/噪声**，也不虚构设备能力；无标定数据时输出 `not_evaluated`/`missing`，而不是编造数值。修改设备能力时保持这一“证据优先、不伪造”的边界。
- 修改 `equipment_models/*/config/*.yaml` 后，前端点“刷新设备资料”即可生效（每次评估重新读 YAML，并用配置哈希核对版本）。
- 光电/声学评估失败时前端会清空结果并禁止保存/导出，**不回退**到 JS 假设结果。
- 建筑遮挡只表示直达路径受影响，不能据此把声学/光电能力判为零。
- 界面文案、报告、文档均为中文；新增界面与导出字段需与既有中文口径一致。
