"""Call the public Sat3DGen HuggingFace Space (fallback for machines without CUDA).

The Space runs Sat3DGen on its own hardware.  This script uploads the Zhengzhou
crop, generates a mesh (and optionally the demo video), and copies the results
to artifacts/sat3dgen/space for import into public/data/sat3dgen.
"""
from pathlib import Path
import argparse
import shutil
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[1]
SAT3D = ROOT / 'third_party/Sat3DGen'
DEFAULT_IMAGE = ROOT / 'artifacts/sat3dgen/input/zhengzhou_museum.png'
DEFAULT_FULL_IMAGE = ROOT / 'artifacts/sat3dgen/input/zhengzhou_full.png'
DEFAULT_SKY = SAT3D / 'demo_images/panorama/default_panorama.jpg'
DEFAULT_OUT = ROOT / 'artifacts/sat3dgen/space'


def local_path(value):
    if isinstance(value, str):
        return Path(value)
    if isinstance(value, dict):
        for key in ('path', 'name', 'value'):
            if value.get(key):
                return Path(value[key])
    if isinstance(value, (list, tuple)):
        for item in value:
            path = local_path(item)
            if path:
                return path
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path)
    parser.add_argument('--sky', type=Path, default=DEFAULT_SKY)
    parser.add_argument('--resolution', type=int, choices=[128, 192, 256, 384, 512], default=256)
    parser.add_argument('--mode', choices=['mesh', 'video', 'both'], default='mesh')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    parser.add_argument('--space', default='qian43/Sat3DGen')
    parser.add_argument('--full', action='store_true',
                        help='use the full-extent overview image and import as mesh_full.obj')
    parser.add_argument('--skip-import', action='store_true')
    args = parser.parse_args()
    if args.image is None:
        args.image = DEFAULT_FULL_IMAGE if args.full else DEFAULT_IMAGE

    try:
        from gradio_client import Client, handle_file
    except ImportError:
        raise SystemExit('Install gradio_client first: pip install gradio_client')
    for path in (args.image, args.sky if args.mode != 'mesh' else args.image):
        if not path.exists():
            raise SystemExit(f'Missing input: {path}')
    args.out.mkdir(parents=True, exist_ok=True)

    client = Client(args.space, verbose=True)
    print('Calling Sat3DGen Space:', args.space)

    if args.mode in ('mesh', 'both'):
        print('Generating mesh (this can take several minutes on the public CPU Space)...')
        result = client.predict(handle_file(str(args.image)), args.resolution,
                                api_name='/generate_mesh_cpu')
        print('mesh result:', result)
        state = result[-1] if isinstance(result, (list, tuple)) else result
        download = client.predict(state, api_name='/download_mesh')
        source = local_path(download)
        if not source or not source.exists():
            raise SystemExit(f'Could not resolve the downloaded mesh: {download!r}')
        target = args.out / 'mesh.obj'
        shutil.copy2(source, target)
        print(f'Mesh saved to {target}')

    if args.mode in ('video', 'both'):
        print('Preparing trajectory...')
        upload = client.predict(handle_file(str(args.image)), api_name='/on_sat_upload')
        print('upload result:', upload)
        state = upload[0] if isinstance(upload, (list, tuple)) else upload
        if not state or (isinstance(state, str) and 'trajectory .csv' in state):
            raise SystemExit(
                'The public Space cannot render a video for a custom upload without '
                'a same-name trajectory CSV on its server. Use scripts/run_sat3dgen.py '
                'with a local CUDA environment, or use one of the Space demo images.')
        print('Rendering video (CPU Space; may take a long time)...')
        video = client.predict(handle_file(str(args.image)), state,
                               handle_file(str(args.sky)), api_name='/render_video_cpu')
        source = local_path(video)
        if not source or not source.exists():
            raise SystemExit(f'Could not resolve the rendered video: {video!r}')
        target = args.out / 'space_video.mp4'
        shutil.copy2(source, target)
        print(f'Video saved to {target}')

    if not args.skip_import and args.mode in ('mesh', 'both') and (args.out / 'mesh.obj').exists():
        import subprocess
        importer = ROOT / 'scripts/import_sat3dgen_output.py'
        command = [sys.executable, str(importer), '--input', str(args.out),
                   '--satellite', str(args.image), '--resolution', str(args.resolution)]
        if args.full:
            command.append('--full')
        subprocess.run(command, check=True)


if __name__ == '__main__':
    main()
