# Checklist

- [x] `docs/task3/model-selection.md` 覆盖各环节 ≥3 个开源候选，含许可/优劣/部署成本，推荐组合已给出（用户确认事项已在文内标注）
- [x] 新增代码全部位于 `src/task3/` 等独立目录；未删除/重命名任何现有文件；`src/main.js` 仅追加入口行（git diff 证实 +2 行）
- [x] 默认推演范围为河南博物院周边 2.4×2.4 km，核心权重区 700 m（pipeline 默认 `scope:'core'`，UI 与报告注明范围来源）
- [x] 网页以河南博物院场景为输入可输出 ≥3 套候选方案并自动择优，四指标对比表可见（E2E：3 套差异化方案 19/21/40 台，自动推荐 balanced，截图 artifacts/task3/panel-plans.png）
- [x] 四类盲区（楼栋夹缝/围墙边角/低空贴楼/建筑背面阴影区）分类结果在三维场景可视化，可筛选、可查看成因（E2E 验证 legend 开关与成因列表，截图 artifacts/task3/blindspots.png）
- [x] 盲区面积占比、覆盖完整性指标与覆盖矩阵数据一致（tests/task3_pipeline.test.js 断言 stats 与矩阵一致；planning 测试断言覆盖率口径）
- [x] 成本指标使用相对成本单位并在界面/报告显著标注"非人民币报价"（UI 对比表脚注 + plans-comparison.md 声明）
- [x] 三类威胁场景推演可运行，蜂群场景如实报告容量溢出与漏探（E2E：swarm 42 架、溢出架次 >0；threats-validation.md 记录）
- [x] EMC 校核按装备参数.doc 频段参数执行，输出冲突清单与明确结论（通过/降额/不通过）（emc.js 五规则 + emc-report.md；tests/task3_emc.test.js 8/8）
- [x] `docs/task3/deployment-rules.md` 含 5 条规则（R1 夹缝 45m/13m、R2 低空 5.5×/559m、R3 声学制高点 1.2×、R4 静默 −5.6pp、R5 同频 600m/0.1GHz），全部阈值追溯到 artifacts/task3/runs/ 6 轮仿真（runId 逐条标注）
- [x] 候选生成→覆盖推演→择优→威胁验证→EMC 校核在网页一键自动串联，进度可视（E2E 验证五阶段进度与完成态）
- [x] 多轮仿真过程数据完整保存于 `artifacts/task3/runs/`（6 轮 runId 齐全，schema task3-run/1.0 可校验）
- [x] 每阶段回归：`npm test` 84/84、`report:sensors`、`plan:build`、`build`、browser/sensor/detection 冒烟均通过；`test:planning:browser` 存在**仓库既有**失败（已 stash 验证 main 分支原样复现：committed example 基线覆盖率 97.76% vs 断言 100%，与本次改动无关，按约束未改动基本盘文件）
- [x] 交付文档五份（模型选型/方案对比/威胁验证/EMC/布设规则）+ 使用说明齐全（docs/task3/）
- [ ] 新分支提交、commit 信息规范、PR 已提交且未直推 main；大体积数据文件未入库 —— 分支 `feat/task3-optimization-pipeline` + commit 5fbd867 已就绪、未推 main、数据文件未入库；**push/PR 受本机网络与凭据限制未完成**（github.com:443 连接被重置、无 gh CLI），待用户本机执行 push 后提 PR
