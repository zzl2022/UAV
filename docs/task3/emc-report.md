# 任务三 · 电磁兼容性校核报告

依据装备参数.doc 频段/功率参数（雷达 X≈9.4 / Ku≈15 GHz 收发；无线电 100MHz–6GHz 或 0.9/1.2/2.4/5.2/5.8GHz 无源接收；光电/声学无射频）执行设备对级校核。规则为工程代理（同频 <0.1GHz 且 <600m、邻频 <0.5GHz 且 <300m、发射落入接收频段、≥1000W 发射距接收机 <50m、同点位 <10m），**不是频谱合规认证**。数据来源：`run-20261024-095721-7rap2`。

| 方案 | 结论 | 严重冲突 | 提示 |
| --- | --- | ---: | ---: |
| 经济型 · 雷达+无线电 | 降额 | 0 | 4 |
| 均衡型 · 全类型（推荐） | 降额 | 0 | 6 |
| 冗余增强型 · 全类型+核心双覆盖 | 不通过 | 2 | 34 |

## 冲突清单

| 方案 | 设备对 | 类型 | 严重度 | 距离/m | 频差/GHz | 附加损耗/dB | 建议 |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| economy | task3-2-radio-tdoa-0 ↔ task3-2-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| economy | task3-26-radio-tdoa-0 ↔ task3-26-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| economy | task3-31-radio-tdoa-0 ↔ task3-31-radar-02c-0 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| economy | task3-2-radar-02c--15 ↔ task3-3-radar-02c--15 | adjacent-channel | warning | 52 | 0.150 | — | 拉距 ≥300 m 或换频 |
| balanced | task3-2-radar-03d--15 ↔ task3-2-radio-tdoa-0 | frontend-block | warning | 0 | — | — | 大功率雷达与无源接收机间距 ≥50 m |
| balanced | task3-2-radio-tdoa-0 ↔ task3-2-radar-03d--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| balanced | task3-26-radio-tdoa-0 ↔ task3-26-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| balanced | task3-44-acoustic-cry-0 ↔ task3-44-radar-02c-0 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| balanced | task3-26-acoustic-cry-0 ↔ task3-26-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| balanced | task3-22-acoustic-cry-0 ↔ task3-22-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-2-radar-03d--15 ↔ task3-2-radio-tdoa-0 | frontend-block | warning | 0 | — | — | 大功率雷达与无源接收机间距 ≥50 m |
| enhanced | task3-2-radio-tdoa-0 ↔ task3-2-radar-03d--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-2-radio-tdoa-0 ↔ task3-2-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-13-radar-02c--15 ↔ task3-13-radar-03d--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-13-radar-02c--15 ↔ task3-13-radar-02c--30 | adjacent-channel | warning | 0 | 0.150 | — | 拉距 ≥300 m 或换频 |
| enhanced | task3-13-radar-02c--15 ↔ task3-13-radar-02c--30 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-10-radar-02c--15 ↔ task3-10-radar-02c--30 | adjacent-channel | warning | 0 | 0.450 | — | 拉距 ≥300 m 或换频 |
| enhanced | task3-10-radar-02c--15 ↔ task3-10-radar-02c--30 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-26-radio-tdoa-0 ↔ task3-26-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-26-radio-tdoa-0 ↔ task3-26-radar-02c--30 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-44-acoustic-cry-0 ↔ task3-44-radar-02c-0 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-44-acoustic-cry-0 ↔ task3-44-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-12-radio-tdoa-0 ↔ task3-12-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-31-radio-tdoa-0 ↔ task3-31-radar-02c-0 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-26-acoustic-cry-0 ↔ task3-26-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-26-acoustic-cry-0 ↔ task3-26-radar-02c--30 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-22-acoustic-cry-0 ↔ task3-22-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-2-radar-03d--15 ↔ task3-2-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-6-radar-03d--15 ↔ task3-6-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-41-radio-tdoa-0 ↔ task3-41-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-3-radar-02c--15 ↔ task3-3-radio-tdoa-0 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-3-radar-02c--15 ↔ task3-2-radar-02c--15 | adjacent-channel | warning | 52 | 0.150 | — | 拉距 ≥300 m 或换频 |
| enhanced | task3-3-radar-02c--15 ↔ task3-3-radar-02c--30 | co-channel | fail | 0 | 0.000 | 6.0 | 换频（错开 ≥0.1 GHz）或拉距至 ≥600 m |
| enhanced | task3-3-radar-02c--15 ↔ task3-3-radar-02c--30 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-26-radar-02c--15 ↔ task3-26-radio-mini-0 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-26-radar-02c--15 ↔ task3-26-radar-02c--30 | co-channel | fail | 0 | 0.000 | 6.0 | 换频（错开 ≥0.1 GHz）或拉距至 ≥600 m |
| enhanced | task3-26-radar-02c--15 ↔ task3-26-radar-02c--30 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-44-radar-02c-0 ↔ task3-44-radar-02c--15 | adjacent-channel | warning | 0 | 0.300 | — | 拉距 ≥300 m 或换频 |
| enhanced | task3-44-radar-02c-0 ↔ task3-44-radar-02c--15 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-13-radar-03d--15 ↔ task3-13-radar-02c--30 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-3-radio-tdoa-0 ↔ task3-3-radar-02c--30 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-12-radar-02c--15 ↔ task3-12-acoustic-cry-0 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-31-radio-mini-0 ↔ task3-31-radar-02c-0 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-2-radar-02c--15 ↔ task3-3-radar-02c--30 | adjacent-channel | warning | 52 | 0.150 | — | 拉距 ≥300 m 或换频 |
| enhanced | task3-41-radar-02c--15 ↔ task3-41-radio-mini-0 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |
| enhanced | task3-26-radio-mini-0 ↔ task3-26-radar-02c--30 | co-site | warning | 0 | — | — | 错开安装点位 ≥10 m |

## 结论

电磁兼容校核降额：发现 6 项冲突（严重 0、提示 6），首要处置建议：大功率雷达与无源接收机间距 ≥50 m。

EMC 结论已回写方案择优（fail 每例得分 ×0.85 下限 0.7，degraded ×0.97）。
