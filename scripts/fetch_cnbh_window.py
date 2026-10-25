"""Fetch only the Zhengzhou window of the CNBH-10m GeoTIFF via GDAL /vsicurl/.

The full 2°x2° tile is ~170 MB and Zenodo is slow; a windowed remote read of
the tiled GeoTIFF fetches only the needed tiles (~1-2 MB).
"""
from pathlib import Path
import argparse
import math
import os
import sys
import time

# Configure GDAL before importing rasterio.
os.environ.setdefault('GDAL_HTTP_IPRESOLVE', 'IPv4')
os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
os.environ.setdefault('GDAL_HTTP_HEADERS',
                      'Referer: https://zenodo.org/records/7923866')

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from prepare_open_model import shp_bbox_wgs84

URL = ('https://zenodo.org/api/records/7923866/files/'
       'CNBH10m_X113Y35.tif/content?download=1')
OUT = ROOT / 'artifacts/cnbh/cnbh_zhengzhou.tif'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=URL)
    parser.add_argument('--tile',
                        help='CNBH tile id, e.g. X117Y39 (overrides --url)')
    parser.add_argument('--bbox', type=float, nargs=4,
                        metavar=('WEST', 'SOUTH', 'EAST', 'NORTH'),
                        help='WGS84 bbox; defaults to the repository SHP bbox')
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--margin', type=float, default=0.001)
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    if args.tile:
        args.url = ('https://zenodo.org/api/records/7923866/files/'
                    f'CNBH10m_{args.tile}.tif/content?download=1')
    if args.out.exists() and not args.refresh:
        print(f'Using existing {args.out}')
        return
    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.bbox:
        west, south, east, north = args.bbox
    else:
        west, south, east, north = shp_bbox_wgs84()
    west -= args.margin; south -= args.margin
    east += args.margin; north += args.margin
    remote = '/vsicurl/' + args.url
    last = None
    for attempt in range(4):
        try:
            with rasterio.open(remote) as ds:
                to_raster = Transformer.from_crs(4326, ds.crs, always_xy=True)
                xs, ys = to_raster.transform([west, east], [south, north])
                window = from_bounds(min(xs), min(ys), max(xs), max(ys),
                                     ds.transform).round_offsets().round_lengths()
                data = ds.read(1, window=window, masked=True)
                array = np.ma.filled(data, np.nan).astype('float32')
                profile = ds.profile.copy()
                profile.update(width=array.shape[1], height=array.shape[0],
                               transform=ds.window_transform(window), count=1,
                               dtype='float32', compress='deflate', nodata=np.nan)
                with rasterio.open(args.out, 'w', **profile) as dst:
                    dst.write(array, 1)
                print(f'Saved {array.shape[1]}x{array.shape[0]} window to {args.out}')
                return
        except Exception as error:
            last = error
            print(f'Attempt {attempt + 1} failed: {error}')
            time.sleep(3)
    raise SystemExit(f'CNBH window fetch failed: {last}')


if __name__ == '__main__':
    main()
