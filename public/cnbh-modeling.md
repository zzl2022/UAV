# CNBH-10m 全域重建（原白模范围）

本页说明如何用 **CNBH-10m 建筑高度** + 仓库白模 SHP 轮廓 + DEM，重建原始白模覆盖的完整片区。

## 数据来源

- 数据集：**CNBH-10m**，中国 10 m 分辨率建筑高度（2020）
- 作者/论文：Wu et al. (2023), *A first Chinese building height estimate at 10 m resolution (CNBH-10m)*, Remote Sensing of Environment 291:113578
- Zenodo：<https://zenodo.org/records/7827315>（更新版 <https://zenodo.org/records/7923866>）
- 许可：**CC BY 4.0**，必须署名
- 使用瓦片：`CNBH10m_X113Y35.tif`（2°×2°，EPSG:32649，10 m）
- 本项目只通过 GDAL `/vsicurl/` 读取郑州窗口（988×605），不下载 170 MB 整幅瓦片

## 生成方法

1. 读取仓库 `building/zheng_apart.shp` 的 15,889 个白模轮廓，保持原始多边形与内环。
2. 将轮廓从 WGS84 转换到 CNBH 的 UTM 49N 坐标系。
3. 在轮廓内取所有 10 m 像元中心，读取 CNBH 高度；建筑高度取**轮廓内有效像元最大值**。
4. CNBH 无有效像元时，回退到 SHP `high` 字段并计数（本次 248 栋）。
5. 地面基底仍使用仓库 DEM：取轮廓顶点最高地面值，基础向下延伸到最低值。
6. 使用与主城市模型相同的 WGS84→ECEF→局部 ENU 变换，输出 LoD1 体块。
7. 导出 `public/data/sat3dgen/cnbh-model.glb`，并写入 manifest 的 `cnbhMesh` / `cnbhBuildingCount` 等字段。

## 命令

```bash
# Windows
npm run prepare:cnbh:win
# POSIX
npm run prepare:cnbh
```

等价于：

```bash
.venv/Scripts/python.exe scripts/fetch_cnbh_window.py
.venv/Scripts/python.exe scripts/prepare_cnbh_model.py
node scripts/export_cnbh_model.js
```

`fetch_cnbh_window.py` 使用 GDAL `/vsicurl/` 只读取项目 bbox 对应的窗口；需要联网，Zenodo 偶发限流时会重试。

## 本次结果

| 项 | 数值 |
| --- | ---: |
| 建筑轮廓 | 15,889 |
| CNBH 有效高度 | 15,641 |
| SHP `high` 回退 | 248 |
| 高度范围 | 3.0–110.0 m |
| 分辨率 | 10 m |
| GLB | 约 30 MB |
| 覆盖范围 | 原始 SHP/白模外包范围（约 9.8 × 5.7 km） |

## 页面

`sat3dgen.html` 的“重建范围”默认选中 **全域 CNBH-10m 重建**；天地图底图上用青色多边形标出同一范围。3D 视图在 CNBH/GBA 全域模型下方加载仓库正射影像底图（`terrain-imagery.png`，与 DEM/模型同一局部 ENU）；Sat3DGen 归一化网格使用自身顶点颜色，不叠加该 ENU 底图。可切换：

- 重点区 Sat3DGen（256 体素）
- 全域 CNBH-10m 重建（默认，覆盖原白模范围）
- 全域 GBA 白模
- 全域 Sat3DGen 概览（低精度）

## 局限

- CNBH-10m 是 10 m 机器学习高度栅格，RMSE 约 6 m，不是实测建筑高度。
- 高度取轮廓内像元最大值；小于一个像元的建筑可能取不到有效值而回退。
- 使用的轮廓是仓库 SHP，和原始白模 GLB 的几何可能不完全一致。
- 模型仍是 LoD1 平屋顶体块，无立面纹理、屋顶细节、树木或街道语义。
- 网格位于局部 ENU 坐标系，尚未与天地图底图做地理配准；页面在独立 3D 视图中展示。
- DEM 垂直基准未注明，绝对高程不是测绘级。
- CNBH-10m 为 CC BY 4.0；转载/展示必须保留署名。
