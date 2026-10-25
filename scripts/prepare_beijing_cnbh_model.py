"""Build a 10 m CNBH block model for a 5 km radius around the Forbidden City.

CNBH is a height raster without footprints, so this demo turns contiguous
10 m pixels with the same rounded height into rectangular LoD1 blocks.  The
base is flat (no DEM) and the result is for city-scale visualization, not
surveying.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math

import numpy as np
import rasterio
from affine import Affine
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CNBH = ROOT / 'artifacts/cnbh/cnbh_beijing.tif'
OUT = ROOT / 'public/data/beijing/beijing-cnbh.json'
CENTER = (116.3972, 39.9163)
LICENSE = 'CC BY 4.0'
ATTRIBUTION = ('Wu et al. (2023), CNBH-10m, Remote Sensing of Environment '
               '291:113578; Zenodo 10.5281/zenodo.7827315')


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cnbh', type=Path, default=DEFAULT_CNBH)
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--center', type=float, nargs=2, default=list(CENTER))
    parser.add_argument('--radius', type=float, default=5000)
    parser.add_argument('--height-step', type=float, default=2)
    parser.add_argument('--min-height', type=float, default=2)
    parser.add_argument('--cell-size', type=int, default=20,
                        help='output block size in metres (multiple of the 10 m source)')
    parser.add_argument('--min-coverage', type=float, default=0.5,
                        help='minimum valid 10 m cell fraction in an output block')
    args = parser.parse_args()
    if not args.cnbh.exists():
        raise SystemExit(f'CNBH Beijing window not found: {args.cnbh}')

    with rasterio.open(args.cnbh) as ds:
        array = ds.read(1).astype('float32')
        transform = ds.transform
        crs = ds.crs
        bounds = ds.bounds
        to_utm = Transformer.from_crs(4326, crs, always_xy=True)
        origin_x, origin_y = to_utm.transform(*args.center)
        source_cell = abs(transform.a)
        if abs(source_cell - 10) > 1e-6:
            raise SystemExit(f'Expected 10 m CNBH cells, got {source_cell} m')
        if args.cell_size < 10 or args.cell_size % 10:
            raise SystemExit('--cell-size must be a multiple of 10 m')
        cell = float(args.cell_size)
        factor = args.cell_size // 10

        # Quantize heights so similar adjacent cells can merge into one block.
        quantized = np.zeros_like(array, dtype='float32')
        valid = np.isfinite(array) & (array > args.min_height)
        quantized[valid] = np.maximum(
            args.height_step,
            np.round(array[valid] / args.height_step) * args.height_step)
        if factor > 1:
            rows = quantized.shape[0] // factor
            cols = quantized.shape[1] // factor
            coverage = valid[:rows * factor, :cols * factor].reshape(
                rows, factor, cols, factor).sum(axis=(1, 3))
            quantized = quantized[:rows * factor, :cols * factor].reshape(
                rows, factor, cols, factor).max(axis=(1, 3))
            # Do not turn a 2x2 window dominated by roads/empty pixels into a
            # block; this keeps streets and the imagery basemap visible.
            quantized[coverage < factor * factor * args.min_coverage] = 0
            transform = transform * Affine.scale(factor)

        buildings = []
        height_min, height_max = math.inf, 0.0
        # Greedy 2D rectangle merging: grow a same-height run downwards while
        # all cells in the rectangle remain equal and unused.  This cuts the
        # block count substantially compared with one box per row run.
        used = np.zeros_like(quantized, dtype=bool)
        height, width = quantized.shape
        for row in range(height):
            col = 0
            while col < width:
                value = quantized[row, col]
                if value <= 0 or used[row, col]:
                    col += 1
                    continue
                end_col = col + 1
                while (end_col < width and quantized[row, end_col] == value
                       and not used[row, end_col]):
                    end_col += 1
                end_row = row + 1
                while end_row < height:
                    strip = quantized[end_row, col:end_col]
                    if not np.all(strip == value) or used[end_row, col:end_col].any():
                        break
                    end_row += 1
                x0 = transform.c + col * cell - origin_x
                x1 = transform.c + end_col * cell - origin_x
                north0 = transform.f + row * transform.e - origin_y
                north1 = transform.f + end_row * transform.e - origin_y
                z0 = -north0
                z1 = -north1
                rings = [[[round(x0, 2), 0.0, round(z0, 2)],
                          [round(x1, 2), 0.0, round(z0, 2)],
                          [round(x1, 2), 0.0, round(z1, 2)],
                          [round(x0, 2), 0.0, round(z1, 2)],
                          [round(x0, 2), 0.0, round(z0, 2)]]]
                buildings.append({
                    'id': f'bj-{row}-{col}',
                    'name': 'CNBH 10 m block',
                    'height': round(float(value), 2),
                    'heightSource': 'CNBH-10m',
                    'ground': 0.0,
                    'foundation': 0.0,
                    'foundationDepth': 0.0,
                    'rings': rings,
                })
                used[row:end_row, col:end_col] = True
                height_min = min(height_min, float(value))
                height_max = max(height_max, float(value))
                col = end_col

    if not buildings:
        raise SystemExit('No CNBH blocks were generated')
    west, north = transform.c, transform.f
    east = west + quantized.shape[1] * cell
    south = north + quantized.shape[0] * transform.e
    local_x0, local_x1 = west - origin_x, east - origin_x
    local_z0, local_z1 = -(north - origin_y), -(south - origin_y)
    to_geo = Transformer.from_crs(crs, 4326, always_xy=True)
    bbox_west, bbox_south = to_geo.transform(west, south)
    bbox_east, bbox_north = to_geo.transform(east, north)
    metadata = {
        'name': '北京 · 故宫 5 km · CNBH-10m 体块',
        'source': 'CNBH-10m 10 m height raster (Wu et al. 2023)',
        'sourceUrl': 'https://zenodo.org/records/7827315',
        'license': LICENSE,
        'attribution': ATTRIBUTION,
        'center': list(args.center),
        'radiusMeters': args.radius,
        'bbox': [bbox_west, bbox_south, bbox_east, bbox_north],
        'localBounds': [round(local_x0, 2), round(local_x1, 2),
                        round(local_z0, 2), round(local_z1, 2)],
        'cellSizeMeters': cell,
        'sourceCellSizeMeters': source_cell,
        'heightStepMeters': args.height_step,
        'minCoverageFraction': args.min_coverage,
        'minHeightMeters': args.min_height,
        'blockCount': len(buildings),
        'buildingCount': len(buildings),
        'minHeight': round(height_min, 2),
        'maxHeight': round(height_max, 2),
        'baseElevation': 0,
        'heightSource': 'CNBH-10m; contiguous equal-height 10 m cells merged',
        'cnbhRaster': str(args.cnbh.relative_to(ROOT)),
        'cnbhRasterSha256': sha256(args.cnbh),
        'cnbhCrs': str(crs),
        'coordinateSystem': 'local metric [east, up, -north]; origin at center',
        'limitations': [
            'CNBH-10m is a 10 m machine-learning height raster; it has no building footprints.',
            'Each block is a run of contiguous 10 m pixels with the same rounded height; it is not a cadastral building.',
            'Base is flat (no DEM); Beijing terrain relief is not represented.',
            'Imagery basemap is 天地图 WMTS imagery, not a surveyed orthophoto.',
            'CNBH-10m is CC BY 4.0; retain attribution when redistributing.',
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps({'metadata': metadata, 'buildings': buildings},
                      ensure_ascii=False, separators=(',', ':'))
    args.out.write_text(text, encoding='utf-8')
    print(f'Wrote {len(buildings)} blocks to {args.out} ({len(text):,} bytes)')
    print(f'Height range {height_min}-{height_max} m; local bounds '
          f'{local_x0:.0f},{local_x1:.0f},{local_z0:.0f},{local_z1:.0f}')


if __name__ == '__main__':
    main()
