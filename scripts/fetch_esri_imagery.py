"""Fetch a clean Esri World Imagery basemap for a square site model.

The site models are built in a local transverse-Mercator frame centred on the
site.  This script takes the same centre and half-extent, derives the WGS84
bbox, stitches ArcGIS World Imagery tiles at one zoom level and crops the
mosaic exactly to that bbox.  The optional sidecar carries ``localBounds`` so
the viewer can place the texture without guessing.

World Imagery is a single globally colour-balanced mosaic, which avoids the
per-tile exposure seams of the previous 天地图 airport basemaps.  Use
``fetch_tianditu_imagery.py`` instead when a 天地图 tk is available.
"""
from pathlib import Path
import argparse
import io
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import requests
from PIL import Image
from pyproj import CRS, Transformer

ROOT = Path(__file__).resolve().parents[1]
TILE_SIZE = 256
TILE_URL = ('https://server.arcgisonline.com/ArcGIS/rest/services/'
            'World_Imagery/MapServer/tile/{zoom}/{y}/{x}')
HEADERS = {'User-Agent': 'Mozilla/5.0 UAV-CNBH/1.0'}


def pixel(lon, lat, zoom):
    n = TILE_SIZE * 2 ** zoom
    x = (lon + 180.0) / 360.0 * n
    rad = math.radians(lat)
    y = (1 - math.log(math.tan(rad) + 1 / math.cos(rad)) / math.pi) / 2 * n
    return x, y


def fetch_tile(zoom, x, y):
    url = TILE_URL.format(zoom=zoom, x=x, y=y)
    last = None
    for attempt in range(4):
        try:
            response = requests.get(url, timeout=30, headers=HEADERS)
            response.raise_for_status()
            return Image.open(io.BytesIO(response.content)).convert('RGB')
        except Exception as error:
            last = error
            time.sleep(0.8 + attempt)
    raise RuntimeError(f'tile {zoom}/{x}/{y}: {last}')


def metric_frame(center, half):
    crs = CRS.from_proj4(
        f'+proj=tmerc +lat_0={center[1]} +lon_0={center[0]} '
        f'+k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
    to_geo = Transformer.from_crs(crs, 4326, always_xy=True)
    west, south = to_geo.transform(-half, -half)
    east, north = to_geo.transform(half, half)
    return (west, south, east, north)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--center', type=float, nargs=2, required=True,
                        metavar=('LON', 'LAT'))
    parser.add_argument('--half', type=float, required=True,
                        help='half extent of the square basemap in metres')
    parser.add_argument('--zoom', type=int, default=15)
    parser.add_argument('--max-size', type=int, default=4096)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--meta', type=Path, required=True)
    parser.add_argument('--name', default=None)
    args = parser.parse_args()

    west, south, east, north = metric_frame(args.center, args.half)
    bbox = [round(west, 6), round(south, 6), round(east, 6), round(north, 6)]

    # Fetch the Web-Mercator tiles that cover the bbox corners, then resample
    # them on the site's local transverse-Mercator pixel grid.  A simple
    # Mercator crop stretched over the metric quad would drift by up to ~33 m
    # at the 11 km Daxing corners; sampling each output pixel through the
    # inverse TM transform removes that drift entirely.
    px0, py0 = pixel(west, north, args.zoom)
    px1, py1 = pixel(east, south, args.zoom)
    x0, y0 = math.floor(px0 / TILE_SIZE), math.floor(py0 / TILE_SIZE)
    x1, y1 = math.floor(px1 / TILE_SIZE), math.floor(py1 / TILE_SIZE)
    columns, rows = x1 - x0 + 1, y1 - y0 + 1
    print(f'{args.name or args.out.stem}: {columns}x{rows} = '
          f'{columns * rows} Esri tiles at z{args.zoom}')

    gallery = Image.new('RGB', (columns * TILE_SIZE, rows * TILE_SIZE),
                        (24, 34, 38))
    futures = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                futures[executor.submit(fetch_tile, args.zoom, x, y)] = (x, y)
        for index, future in enumerate(as_completed(futures), 1):
            x, y = futures[future]
            gallery.paste(future.result(), ((x - x0) * TILE_SIZE,
                                            (y - y0) * TILE_SIZE))
            if index % 64 == 0 or index == len(futures):
                print(f'  {index}/{len(futures)} tiles')

    gallery_array = np.asarray(gallery).astype(np.float32)
    gallery_h, gallery_w = gallery_array.shape[:2]

    crs = CRS.from_proj4(
        f'+proj=tmerc +lat_0={args.center[1]} +lon_0={args.center[0]} '
        f'+k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
    to_geo = Transformer.from_crs(crs, 4326, always_xy=True)

    size = int(args.max_size)
    half = float(args.half)
    out = np.zeros((size, size, 3), dtype=np.uint8)
    east_axis = -half + (np.arange(size) + 0.5) * (2 * half / size)
    n_pixels = TILE_SIZE * 2 ** args.zoom
    tile_offset_x = x0 * TILE_SIZE
    tile_offset_y = y0 * TILE_SIZE

    for row_start in range(0, size, 256):
        row_end = min(size, row_start + 256)
        north_axis = half - (np.arange(row_start, row_end) + 0.5) * (2 * half / size)
        xx, yy = np.meshgrid(east_axis, north_axis)
        lon, lat = to_geo.transform(xx, yy)
        merc_x = (lon + 180.0) / 360.0 * n_pixels
        merc_y = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n_pixels
        gx = np.clip(merc_x - tile_offset_x, 0, gallery_w - 2)
        gy = np.clip(merc_y - tile_offset_y, 0, gallery_h - 2)
        ix = np.floor(gx).astype(np.int32)
        iy = np.floor(gy).astype(np.int32)
        fx = (gx - ix)[..., None]
        fy = (gy - iy)[..., None]
        c00 = gallery_array[iy, ix]
        c10 = gallery_array[iy, ix + 1]
        c01 = gallery_array[iy + 1, ix]
        c11 = gallery_array[iy + 1, ix + 1]
        sampled = (c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy)
                   + c01 * (1 - fx) * fy + c11 * fx * fy)
        out[row_start:row_end] = np.clip(sampled, 0, 255).astype(np.uint8)
        if row_start % 1024 == 0:
            print(f'  resampled rows {row_start}-{row_end}/{size}')

    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out).save(args.out, quality=88, optimize=True, progressive=True)
    args.meta.write_text(json.dumps({
        'name': args.name,
        'source': 'Esri World Imagery (ArcGIS Online World_Imagery MapServer)',
        'license': ('Esri, Maxar, Earthstar Geographics, and the GIS User '
                    'Community; 仅用于演示/研究，保留署名'),
        'attribution': 'Esri World Imagery',
        'center': list(args.center),
        'halfMeters': args.half,
        'bbox': bbox,
        'zoom': args.zoom,
        'tileRange': [x0, y0, x1, y1],
        'tileCount': len(futures),
        'image': args.out.name,
        'width': size,
        'height': size,
        'localBounds': [-args.half, args.half, -args.half, args.half],
        'projection': 'local_tmerc',
        'reprojected': 'inverse TM pixel grid, bilinear Web Mercator sampling',
        'normalized': False,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Saved {size}x{size} imagery to {args.out}')


if __name__ == '__main__':
    main()
