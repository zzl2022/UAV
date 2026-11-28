# 跨地图部署研究留存

研究对象为平台现有九张独立地图，每图28组配置、每组完整求解经济型/均衡型/增强型三套方案。原始设备依据来自“创意二文件”中的参数表、区域数据说明和原始任务说明。研究说明、规则库、复现脚本及对抗域适应实验的验收记录随本功能分支提交。下列 artifacts 链接对应本机原始过程文件，按仓库忽略规则保存在本地。

主要入口：

- [标准化布设规则与完整研究说明](./标准化布设规则.md)
- [机器可读规则库](../../public/data/cross-map-deployment-rules.json)
- [本地交互分析页](../../artifacts/cross-map-study/跨地图部署分析.html)
- [参数字典](../../artifacts/cross-map-study/parameter-dictionary.json)
- [运行索引与全部输入](../../artifacts/cross-map-study/run-index.json)
- [逐方案结果](../../artifacts/cross-map-study/all-plan-results.jsonl)
- [最终完整性与约束校验](../../artifacts/cross-map-study/validation-report.json)

完整原始记录位于 `artifacts/cross-map-study/runs/<mapId>/<caseId>.json.gz`，252份压缩记录约900MB。每份包含完整参数、原始输入指纹、实际工况、设备坐标与有效参数、三方案优化过程、电磁处置、三类动态威胁逐帧结果，以及统一独立验证网格上的实际覆盖。原始资料与代码指纹位于 `manifest.json`；额外链路对照与单节点容量试验另行归档，不混计为优化轮次。

深圳的核心元数据为示意定位框，原始标识没有对应的真实楼栋。禁部署实验使用该框与实际建筑外包框相交的单元作保守研究映射，保留首次失败记录及修正依据。两个编排版本的结果只在计算模块、完整配置和真实输入均一致时复用；每份记录保留自身原始版本指纹。

本地复现命令：

```powershell
node scripts/cross-map-study/run.js --workers=3
node scripts/cross-map-study/capacity-check.js
python -X utf8 scripts/cross-map-study/analyze.py
node scripts/cross-map-study/render.js
python -X utf8 scripts/cross-map-study/plot.py
node scripts/cross-map-study/verify-browser.js
```

计算阶段只依赖项目Node依赖；统计分析使用本机Python的NumPy、SciPy，静态图使用Matplotlib，浏览器验收使用Playwright及本机Chrome/Edge。当前数据已计算完成，单纯查阅无需重新运行。

优化网格变化与最终验证网格分开。各配置的固定验证范围为核心周边2400×2400米、300米间距、0.37格偏移、20/45/90米AGL；每轮自身训练范围与网格结果也分别保留。静态覆盖与动态并发容量分开统计，模型覆盖不等于现场检出概率。其他八图使用平面地表代理，未验证道路、建筑材料、权限和屋顶施工条件。

后续调用规则时，应读取带 `cross-map-deployment-rules/1` 模式标记的JSON。规则包含明确条件、结论、结构化触发条件、支持与反例地图、逐地图数值、运行ID、原始记录路径和适用边界。历史一图一轮规则保持原样，不与本轮跨地图结果混用。
