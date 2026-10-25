# Vendored Sat3DGen

- Upstream: <https://github.com/qianmingduowan/Sat3DGen>
- Paper: [Sat3DGen: Comprehensive Street-Level 3D Scene Generation from Single Satellite Image](https://arxiv.org/abs/2605.14984), ICLR 2026
- Vendored: 2026-10-24, upstream `main`
- License: MIT (see `LICENSE`; keep the notice when redistributing)
- Weights: <https://huggingface.co/qian43/Sat3DGen> (~1.5 GB, downloaded on first inference)
- Dataset/supplements: <https://huggingface.co/datasets/qian43/VIGOR_SAT3DGEN_add_skymask_DSM_satdepth>

## Included

- `source/`, `inference/`, `configs/`, `docs/`, `metrics/`, `my_datasets/`, `DSM_processing/`
- `requirements.txt`, `inference.sh`, `run_inference_video.sh`, `app.py`, `train.py`, `demo_train.sh`
- `demo_images/panorama/default_panorama.jpg` and `demo_images/pano_sky_mask/default_panorama.png`
- One satellite demo image and its trajectory CSV for smoke testing

## Excluded

- `assets/promo.gif`, `assets/promo.mp4`, `src/teaser.png`
- Most demo images/videos, to keep the repository small

## Extra dependencies not in upstream requirements.txt

The upstream inference scripts also import `open3d`, `trimesh`, and `einops`.
Install them in the Sat3DGen environment:

```bash
pip install open3d trimesh einops
```

`ffmpeg` is required for MP4 output; without it the mesh and frames are still
written.

## Integration

The project wrappers are:

- `scripts/prepare_sat3dgen_input.py` — crop the repository orthophoto and create a trajectory CSV
- `scripts/run_sat3dgen.py` — run `inference/demo_inference.py` in the `sat3dgen` conda env
- `scripts/sat3dgen_space.py` — call the public HuggingFace Space when no local CUDA is available
- `scripts/import_sat3dgen_output.py` — copy outputs and write `public/data/sat3dgen/manifest.json`

We did not modify the vendored Sat3DGen source.
