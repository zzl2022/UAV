# UAV 归档（2026-11-15）

本目录保存原 `UAV` 工作副本中、当前平台（`UAV-main`）没有或不再使用的文件。
`UAV` 目录已于 2026-11-15 删除，其 Git 历史（`feat/task3-optimization-pipeline`，24 条提交）
迁移到本仓库继续保留，因此 **旧版本文件的完整历史仍可用 `git log -- <path>` 追溯**；
这里归档的是「仅存在于旧工作树、且不在当前主线」的文件，方便日后查阅。

## 内容

| 路径 | 说明 |
| --- | --- |
| `deliverables/` | 旧版根目录交付物：任务三电磁兼容优化与验证.html、任务三盲区消除与效果验证.html、任务三多方案优化与最优部署技术方案报告.docx、task3-standard-deployment.html |
| `scripts/` | 旧版独有的 18 个脚本：任务三 Word 报告生成（`task3_word_*`、`task3_chapter_*`、`task3_gray_assets.py`）、调试脚本（`task3_debug_*`）、站点/边界切换测试、`inspect_ref.py` |
| `public/examples/detection-target.json` | 旧版侦测目标导入模板示例 |
| `NoLod_0.glb` / `NoLod_1.glb` | 旧版「原始白模对比」用的仓库白模（**本地保留，不提交**） |
| `创意二资料/` | 赛题 PDF + 平台说明 docx（**本地保留，不提交**） |

## 未归档的内容

- `artifacts/`：联调过程产物，可重新生成。
- `.venv/`、`node_modules/`、`dist/`、`.trae*`、`.screenshots/`：本地工具产物。
- `public/data/`：模型数据，当前平台有更新版本。

## 仍可从 Git 历史取回的能力

旧版 `UAV` 独有的两项功能代码不在本目录，但可从历史提交取回：

- GLB 导出（`GLTFExporter`）与建筑属性拾取：`git show 798ef69:src/main.js`
- 原始白模对比：`git show 798ef69:src/main.js`（配合上面的 `NoLod_*.glb`）
