"""Run Sat3DGen inference on the prepared Zhengzhou crop and import outputs.

Prerequisites: a CUDA PyTorch environment named `sat3dgen` (or set
SAT3DGEN_PYTHON), ffmpeg for videos, and ~1.5 GB model weights (auto-download
on first run).  See third_party/Sat3DGen/README.md.
"""
from pathlib import Path
import argparse
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SAT3D = ROOT / 'third_party/Sat3DGen'
DEFAULT_IMAGE = ROOT / 'artifacts/sat3dgen/input/zhengzhou_museum.png'
DEFAULT_TRAJECTORY = ROOT / 'artifacts/sat3dgen/input/trajectory.csv'
DEFAULT_SKY = SAT3D / 'demo_images/panorama/default_panorama.jpg'
DEFAULT_WORK = ROOT / 'artifacts/sat3dgen/results'


def python_command(conda_env):
    explicit = os.environ.get('SAT3DGEN_PYTHON')
    if explicit:
        return [explicit]
    conda = shutil.which('conda')
    if conda:
        return [conda, 'run', '--no-capture-output', '-n', conda_env, 'python']
    return [sys.executable]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, default=DEFAULT_IMAGE)
    parser.add_argument('--trajectory', type=Path, default=DEFAULT_TRAJECTORY)
    parser.add_argument('--sky', type=Path, default=DEFAULT_SKY)
    parser.add_argument('--work-dir', type=Path, default=DEFAULT_WORK)
    parser.add_argument('--mesh-resolution', type=int, default=256)
    parser.add_argument('--gpu', default='0')
    parser.add_argument('--conda-env', default='sat3dgen')
    parser.add_argument('--skip-import', action='store_true')
    args = parser.parse_args()

    for path in (args.image, args.trajectory, args.sky):
        if not path.exists():
            raise SystemExit(f'Missing Sat3DGen input: {path}')
    if not (SAT3D / 'inference/demo_inference.py').exists():
        raise SystemExit(f'Sat3DGen source not found at {SAT3D}')
    args.work_dir.mkdir(parents=True, exist_ok=True)

    command = python_command(args.conda_env) + [
        'inference/demo_inference.py',
        '--sat_img_path', str(args.image.resolve()),
        '--trajectory_path', str(args.trajectory.resolve()),
        '--sky_path', str(args.sky.resolve()),
        '--work_dir', str(args.work_dir.resolve()),
        '--mesh_resolution', str(args.mesh_resolution),
    ]
    env = {**os.environ, 'CUDA_VISIBLE_DEVICES': str(args.gpu)}
    print('Running:', ' '.join(command))
    result = subprocess.run(command, cwd=SAT3D, env=env)
    if result.returncode != 0:
        raise SystemExit(f'Sat3DGen inference failed with code {result.returncode}')

    output = args.work_dir / args.image.stem
    if not args.skip_import:
        importer = ROOT / 'scripts/import_sat3dgen_output.py'
        subprocess.run([sys.executable, str(importer), '--input', str(output),
                        '--satellite', str(args.image),
                        '--resolution', str(args.mesh_resolution)], check=True)
    print(f'Sat3DGen output: {output}')


if __name__ == '__main__':
    main()
