"""Crop a square satellite image and a simple trajectory for Sat3DGen.

The repository orthophoto is WGS84.  Sat3DGen expects a single satellite
image; this script cuts a square around the museum and writes the w,h,angle
trajectory CSV used by its demo inference.
"""
from pathlib import Path
import argparse
import csv
import math
import shutil

import numpy as np
import rasterio
from rasterio.enums import Resampling

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '创意二文件/创意二数据集/区域数据/影像/raster.tif'
OUT = ROOT / 'artifacts/sat3dgen/input'
PUBLIC = ROOT / 'public/data/sat3dgen/input'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lon', type=float, default=113.66613626120788)
    parser.add_argument('--lat', type=float, default=34.789408907490646)
    parser.add_argument('--size', type=int, default=640)
    parser.add_argument('--out', type=Path, default=OUT / 'zhengzhou_museum.png')
    parser.add_argument('--trajectory', type=Path,
                        default=OUT / 'trajectory.csv')
    parser.add_argument('--points', type=int, default=48)
    parser.add_argument('--full', action='store_true',
                        help='write a padded full-extent overview image instead of a square crop')
    args = parser.parse_args()

    if args.full:
        size = 1024
        with rasterio.open(SOURCE) as raster:
            strip = max(1, round(size * raster.height / raster.width))
            data = raster.read([1, 2, 3], out_shape=(strip, size),
                               resampling=Resampling.bilinear, masked=True)
            mask = np.ma.getmaskarray(data)
            rgb = np.ma.filled(data, 0).astype(np.uint8)
            strip_rgb = np.transpose(rgb, (1, 2, 0))
            invalid = mask.any(axis=0) if mask.ndim == 3 else mask
            # The source RGB has white/nodata corners; use the same dark
            # backdrop as the padding so Sat3DGen does not hallucinate sky there.
            invalid |= (strip_rgb > 250).all(axis=2)
            strip_rgb[invalid] = (36, 61, 70)
            canvas = np.full((size, size, 3), (36, 61, 70), dtype=np.uint8)
            top = (size - strip) // 2
            canvas[top:top + strip] = strip_rgb
            out = OUT / 'zhengzhou_full.png'
            profile = {'driver': 'PNG', 'width': size, 'height': size,
                       'count': 3, 'dtype': 'uint8'}
            with rasterio.open(out, 'w', **profile) as dst:
                dst.write(np.transpose(canvas, (2, 0, 1)))
            PUBLIC.mkdir(parents=True, exist_ok=True)
            shutil.copy2(out, PUBLIC / out.name)
            print(f'Wrote full-extent overview {size}x{size} '
                  f'(city strip {size}x{strip}) to {out}')
            return

    with rasterio.open(SOURCE) as raster:
        west, south, east, north = raster.bounds
        col = int((args.lon - west) / (east - west) * raster.width)
        row = int((north - args.lat) / (north - south) * raster.height)
        half = args.size // 2
        c0 = max(0, min(raster.width - args.size, col - half))
        r0 = max(0, min(raster.height - args.size, row - half))
        window = rasterio.windows.Window(c0, r0, args.size, args.size)
        data = raster.read([1, 2, 3], window=window)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        profile = {'driver': 'PNG', 'width': args.size, 'height': args.size,
                   'count': 3, 'dtype': 'uint8'}
        with rasterio.open(args.out, 'w', **profile) as dst:
            dst.write(data)
        print(f'Cropped {args.size}x{args.size} at pixel ({c0},{r0}) '
              f'to {args.out}')

    # A simple pedestrian/vehicle path across the crop.  Sat3DGen normalizes
    # pixel coordinates with the image width, so this stays valid for any size.
    args.trajectory.parent.mkdir(parents=True, exist_ok=True)
    y = args.size * 0.60
    with args.trajectory.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['w', 'h', 'angle'])
        for index in range(args.points):
            x = args.size * (0.12 + 0.76 * index / max(1, args.points - 1))
            writer.writerow([f'{x:.2f}', f'{y:.2f}', '0'])
    print(f'Wrote {args.points} trajectory points to {args.trajectory}')
    PUBLIC.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.out, PUBLIC / args.out.name)
    shutil.copy2(args.trajectory, PUBLIC / args.trajectory.name)
    print(f'Published input preview to {PUBLIC}')


if __name__ == '__main__':
    main()
