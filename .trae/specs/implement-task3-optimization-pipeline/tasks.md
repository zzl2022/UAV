# Tasks

实施分 9 个阶段，每阶段完成后向用户汇报可验证结果（运行截图/测试数据），确认后进入下一阶段；每阶段结束执行回归验证（`npm test` + `npm run report:sensors` + `npm run plan:build`）。

- [x] Task 0: 模型选型对比报告（阶段零）
  - [x] 0.1 调研需求理解/白模解析、部署优化、覆盖/盲区仿真、威胁推演、EMC 校核各环节的开源 SOTA 候选（每环节 ≥3 个，含许可、优劣、部署成本）
  - [x] 0.2 输出 `docs/task3/model-selection.md`，推荐组合方案与运行方式（前端 WASM/ONNX 或后端 API，兼容 Vite + Python）
  - [x] 0.3 推荐组合已随 spec 批准生效（自研为主+轻量库拼接；报告中标注待确认事项）
- [x] Task 1: 任务三基线与过程数据存档
  - [x] 1.1 新建 `src/task3/` 独立目录与 `artifacts/task3/` 过程数据目录；`src/main.js` 仅追加任务三入口挂载行
  - [x] 1.2 默认评估范围固化为河南博物院周边 2.4×2.4 km（复用 `boundsFor` core 分支），核心权重区 700 m
  - [x] 1.3 定义多轮仿真过程数据 schema（批次号、设置、候选、覆盖矩阵、指标、时间戳），写入 `artifacts/task3/runs/`
  - [x] 1.4 回归验证：既有测试全绿，截图存档
- [x] Task 2: 覆盖推演与四类盲区分类
  - [x] 2.1 `src/task3/blindspots.js`：对盲点逐一分类（楼栋夹缝/围墙边角/低空贴楼/建筑背面阴影区/其他），记录成因数据
  - [x] 2.2 分类阈值（夹缝宽度、贴楼距离等）初值来自几何计算，后续由阶段六仿真数据校订
  - [x] 2.3 `src/task3/ui.js` 盲区分布视图：按类别着色、筛选、点击查看成因
  - [x] 2.4 `tests/task3_blindspots.test.js` + 浏览器验证；回归验证
- [x] Task 3: 多方案生成与四指标综合择优
  - [x] 3.1 `src/task3/metrics.js`：覆盖完整性、盲区面积占比、相对成本（显著标注非人民币报价）、施工可行性代理（重量/尺寸/架设方式/安装高度，参数源自装备参数.doc）归一化加权
  - [x] 3.2 生成 ≥3 套差异化候选方案（点位/类型组合/安装高度/覆盖角度不同），自动推荐最优
  - [x] 3.3 界面四指标对比表与推荐依据展开；导出 `docs/task3/plans-comparison.md` 数据
  - [x] 3.4 测试 + 回归验证
- [x] Task 4: 三类威胁场景鲁棒性验证
  - [x] 4.1 `src/task3/threats.js`：单机单点（多方位航路）、多方向同步（≥4 方向）、蜂群饱和（超并发容量）三类场景生成与逐帧推演
  - [x] 4.2 指标输出：首报时间、持续检出率、漏报帧、容量溢出/漏探统计；蜂群场景如实报告溢出
  - [x] 4.3 推演过程可视化（多目标轨迹与检出状态回放）；导出 `docs/task3/threats-validation.md`
  - [x] 4.4 测试 + 回归验证
- [x] Task 5: 电磁兼容校核
  - [x] 5.1 `src/task3/emc.js`：按装备参数.doc 频段参数构建设备对干扰矩阵（同频/邻频/互扰），量化附加损耗
  - [x] 5.2 输出冲突清单与"通过/降额/不通过"结论及规避建议；导出 `docs/task3/emc-report.md`
  - [x] 5.3 EMC 结论回写方案评估（冲突方案降权或自动规避）
  - [x] 5.4 测试 + 回归验证
- [x] Task 6: 标准化布设规则提炼
  - [x] 6.1 `src/task3/rules.js`：对 `artifacts/task3/runs/` 多轮过程数据做统计分析，提取阈值（间距/高度差/盲区半径增量等）
  - [x] 6.2 输出 `docs/task3/deployment-rules.md`：≥5 条规则，每条注明仿真批次来源与统计口径
  - [x] 6.3 测试 + 回归验证
- [x] Task 7: 自动化流水线串联与网页集成
  - [x] 7.1 `src/task3/pipeline.js`：一键串联 候选生成→覆盖推演→择优→威胁验证→EMC 校核，进度可视、可取消
  - [x] 7.2 任务三面板：白模/装备类型/预算/网格输入，点位与类型、方案覆盖对比、盲区分布、威胁推演过程可视化
  - [x] 7.3 `scripts/task3_report.js`：命令行重算并输出 `artifacts/task3/` 全套报告
  - [x] 7.4 浏览器端到端验证 + 回归验证
- [ ] Task 8: 交付文档与 PR
  - [x] 8.1 `docs/task3/usage.md` 使用说明；整理 plans-comparison / threats-validation / emc-report / deployment-rules / model-selection 五份交付文档
  - [x] 8.2 数据集等大体积文件不入库，文档中说明获取方式
  - [x] 8.3a 新分支 feat/task3-optimization-pipeline 已建，规范 commit 5fbd867 已提交（未推 main）
  - [ ] 8.3b 【环境阻塞】push 到 origin（Jacky007-dot/UAV）被网络重置（github.com:443），且无 gh CLI/凭据；需用户本机执行 `git push -u origin feat/task3-optimization-pipeline` 后向 zzl2022/UAV 提 PR

# Task Dependencies

- Task 0 阻塞 Task 1–7 的集成选型（自研兜底除外）
- Task 1 阻塞 Task 2–7（目录、范围、存档 schema 为公共基础）
- Task 2 → Task 3（盲区分类是盲区占比指标的输入）
- Task 3 → Task 4、Task 5（最优方案是威胁验证与 EMC 校核对象）
- Task 2–5 → Task 6（规则提炼依赖多轮过程数据积累）
- Task 2–6 → Task 7（流水线串联各环节）
- Task 7 → Task 8
