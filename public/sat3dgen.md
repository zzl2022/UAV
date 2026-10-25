# 天地图 + Sat3DGen 城市模型与街景

本页说明独立页面 `sat3dgen.html`：用天地图做底图/选址，用 Sat3DGen 从单张卫星影像生成 3D 城市网格；全景/街景视频为可选输出。

> 主界面已移除“天地图 / 城市重建”入口链接；可直接访问 `sat3dgen.html`。

> **当前交付**：页面默认展示 **CNBH-10m 全域重建**（`cnbh-model.glb`，覆盖原白模范围，15,889 栋，10 m 高度）；同时保留 Sat3DGen 重点区 256 体素网格（`mesh.obj`，约 23 MB，含顶点颜色）、Sat3DGen 全域概览（低精度）与 GBA 白模。体素越高越精细、文件也越大；Space 最高提供 256。街景/全景视频未生成，也不需要作为本次验收项；需要时可按下文本地 CUDA 流程生成。

## 天地图

- 页面使用天地图 JavaScript API 4.0：`https://api.tianditu.gov.cn/api?v=4.0&tk=...`。
- 需要浏览器端 tk。可写入本地 `.env.local`：

  ```text
  VITE_TIANDITU_TK=你的浏览器端 tk
  ```

  也可在页面输入框填写。tk 仅保存在本机，不写入仓库。
- 支持矢量、影像、地形三种底图，均为天地图 WMTS 瓦片；坐标系为 CGCS2000/WGS84，无需 GCJ-02/BD-09 纠偏。
- 页面默认定位河南博物院片区；点击地图可查看重建中心坐标。红色/黄色圆表示 Sat3DGen 输入影像的大致范围。
- 天地图公开开发者文档没有独立的街景/全景 API；本页的街景和全景来自 Sat3DGen 生成结果，不是天地图实景。

## Sat3DGen

源码已放入 `third_party/Sat3DGen`（MIT）。它使用单张卫星影像生成：

- `mesh.obj`：3D 城市网格
- `panorama_video.mp4`：沿轨迹的全景视频
- `streetview_video.mp4`：4 视角街景视频
- `mesh_orbit_video.mp4`：网格环绕视频
- `demo_video.mp4`：组合演示视频

### 环境

上游要求 CUDA + Python 3.10：

```bash
conda create -n sat3dgen python=3.10
conda activate sat3dgen
# 按本机 CUDA 选择 PyTorch 轮子；本项目在 RTX 4070 上使用 cu124
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -r third_party/Sat3DGen/requirements.txt
pip install open3d trimesh einops
```

首次推理会从 HuggingFace 自动下载约 1.5 GB 权重到 `~/.cache/huggingface/`。还需要 `ffmpeg` 才能输出 MP4；缺少 ffmpeg 时仍会写出网格和帧目录。

### 准备输入

```bash
# 默认以河南博物院为中心裁 640×640，并生成 w,h,angle 轨迹
.venv/Scripts/python.exe scripts/prepare_sat3dgen_input.py
```

输入写入 `artifacts/sat3dgen/input/`：

- `zhengzhou_museum.png`
- `trajectory.csv`

也可以修改脚本中的 `--lon/--lat/--size`，或用自己的卫星影像和 `w,h,angle` 轨迹 CSV。

### 运行

```bash
python scripts/run_sat3dgen.py
```

脚本会：

1. 通过 conda 环境 `sat3dgen` 运行 `third_party/Sat3DGen/inference/demo_inference.py`；
2. 读取上一步的影像、轨迹和默认天空全景；
3. 把 `mesh.obj`、街景/全景/环绕视频导入 `public/data/sat3dgen/`；
4. 写入 `manifest.json`。

常用参数：

```bash
python scripts/run_sat3dgen.py --gpu 0 --mesh-resolution 256
python scripts/run_sat3dgen.py --image path/to/sat.png --trajectory path/to/trajectory.csv
python scripts/run_sat3dgen.py --skip-import
```

`--mesh-resolution` 越大，网格越细、文件越大。当前默认使用 **256** 体素；若显存/内存不足可降到 192 或 128。

### 没有 CUDA 时的 Space 回退

也可以调用官方 HuggingFace Space（CPU，排队/较慢，需要联网）：

```bash
.venv/Scripts/python.exe -m pip install gradio_client
.venv/Scripts/python.exe scripts/sat3dgen_space.py --mode mesh
# 或同时生成组合视频（可能很慢）
.venv/Scripts/python.exe scripts/sat3dgen_space.py --mode both
```

结果写入 `artifacts/sat3dgen/space/`，再用 `scripts/import_sat3dgen_output.py` 导入。Space 返回的是一个组合演示视频，不是分开的街景/全景文件。

### 页面

启动 `npm run dev` 后直接打开 `sat3dgen.html`（主界面入口已移除）：

- **天地图**：底图、图层切换、重建中心。
- **3D 模型**：加载 `public/data/sat3dgen/mesh.obj`；未生成结果时加载当前 GBA 白模作参照。
- **街景 / 全景**：播放 Sat3DGen 的 `streetview_video.mp4`、`panorama_video.mp4`、`mesh_orbit_video.mp4`。

没有 Sat3DGen 结果时页面仍可打开，`manifest.json` 为 `pending` 状态。

## 全域概览（覆盖原白模范围）

Sat3DGen 的单图输入会被缩放到 512×512，因此“全域”和“高精度”不能同时由一次推理得到。本项目提供两级结果：

- **重点区精细**：640×640 河南博物院裁剪，256/512 体素，保留局部建筑细节。
- **全域概览**：把整幅正射影像缩放到 1024×1024 并上下填充，覆盖原白模/正射影像范围；Sat3DGen 仍按 512 输入生成，因此只能得到低精度概览。页面通过“重建范围”下拉切换。
- **全域 GBA 白模**：如果 Sat3DGen 全域概览尚未生成，页面仍可切换到 `open-lod1.glb`，覆盖完整片区；它不是 Sat3DGen 结果，只作为范围/参照底模。

生成全域概览：

```bash
.venv/Scripts/python.exe scripts/prepare_sat3dgen_input.py --full
.venv/Scripts/python.exe scripts/sat3dgen_space.py --full --mode mesh --resolution 256
```

输出 `mesh_full.obj` 与 manifest `.fullMesh`。页面会显示“全域概览（低精度）”。

> 若要“全域 + 高精度”，必须把正射影像切成大量小图并逐块本地推理，再拼接网格（上游 `big_image_slice_inference.py` 目前只处理 1000×1000 中心裁剪，需要改造）；这需要 CUDA GPU，且计算量远高于单张图。

## CNBH-10m 全域重建（默认）

页面“重建范围”默认选中 **全域 CNBH-10m 重建**。它使用 Zenodo CNBH-10m 高度 + 仓库 SHP 轮廓 + DEM，覆盖原始白模范围：

- 数据：CNBH-10m，10 m，2020，CC BY 4.0；Zenodo [7827315](https://zenodo.org/records/7827315)
- 结果：`public/data/sat3dgen/cnbh-model.glb`，15,889 栋，高度 3–110 m
- 3D 视图在 CNBH/GBA 全域模型下方加载仓库正射影像底图（`terrain-imagery.png`），与 DEM/模型同一局部 ENU；Sat3DGen 归一化网格使用自身顶点颜色，不叠加该底图。
- 生成：`npm run prepare:cnbh:win`（或 POSIX `npm run prepare:cnbh`）
- 方法、统计与限制见 [CNBH 重建说明](cnbh-modeling.md)

天地图底图上同时用青色多边形标出原始白模 SHP 外包范围。

## 局限与许可

- Sat3DGen 是研究模型，论文报告的几何 RMSE 约 5.2 m；不能当作测绘成果或真实街景。
- 街景/全景由模型生成，可能包含伪影、错误的立面或纹理，不代表现场。
- 生成的网格位于卫星影像裁剪的局部坐标系，未与天地图底图做地理配准；页面把它放在独立 3D 视图中，不叠加到地图上。
- 输入影像使用仓库自带正射影像；若改用天地图影像瓦片，需遵守天地图服务条款和配额。
- Sat3DGen 代码为 MIT；模型权重和数据集有各自的许可/使用条款。输出仅用于研究与演示。
- 天地图 tk、配额、域名白名单由使用者自行配置；不要把服务端 tk 暴露到浏览器。

## 相关文件

- `sat3dgen.html` / `src/sat3dgen.js` / `src/sat3dgen.css`
- `scripts/prepare_sat3dgen_input.py`
- `scripts/run_sat3dgen.py`
- `scripts/import_sat3dgen_output.py`
- `third_party/Sat3DGen/`
- `public/data/sat3dgen/`
