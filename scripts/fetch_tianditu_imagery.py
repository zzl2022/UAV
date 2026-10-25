"""Fetch 天地图 WMTS imagery for a WGS84 bbox and stitch a texture.

Reads the browser tk from TIANDITU_TK/VITE_TIANDITU_TK or local .env.local.
The stitched JPEG is used as the 3D ground basemap; it is not a survey product.
"""
from pathlib import Path
import argparse
import io
import json
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/data/beijing/beijing-imagery.jpg'
META = ROOT / 'public/data/beijing/beijing-imagery.json'
LAYER = 'img'
TILE_SIZE = 256


def get_tk():
    tk = os.environ.get('TIANDITU_TK') or os.environ.get('VITE_TIANDITU_TK')
    if tk:
        return tk
    env = ROOT / '.env.local'
    if env.exists():
        match = re.search(r'VITE_TIANDITU_TK=([^\s#]+)',
                          env.read_text(encoding='utf-8'))
        if match:
            return match.group(1)
    raise SystemExit('Set TIANDITU_TK or VITE_TIANDITU_TK in .env.local')


def pixel(lon, lat, zoom):
    n = TILE_SIZE * 2 ** zoom
    x = (lon + 180.0) / 360.0 * n
    rad = math.radians(lat)
    y = (1 - math.log(math.tan(rad) + 1 / math.cos(rad)) / math.pi) / 2 * n
    return x, y


def fetch_tile(tk, zoom, x, y):
    url = (f'https://t{x % 8}.tianditu.gov.cn/{LAYER}_w/wmts?'
           f'SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER={LAYER}'
           f'&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles'
           f'&TILEMATRIX={zoom}&TILEROW={y}&TILECOL={x}&tk={tk}')
    last = None
    for attempt in range(3):
        try:
            response = requests.get(url, timeout=30, headers={
                'User-Agent': 'Mozilla/5.0 UAV-CNBH/1.0'})
            response.raise_for_status()
            return Image.open(io.BytesIO(response.content)).convert('RGB')
        except Exception as error:
            last = error
            time.sleep(1 + attempt)
    raise RuntimeError(f'tile {zoom}/{x}/{y}: {last}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bbox', type=float, nargs=4, required=True,
                        metavar=('WEST', 'SOUTH', 'EAST', 'NORTH'))
    parser.add_argument('--zoom', type=int, default=16)
    parser.add_argument('--max-size', type=int, default=2048)
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--meta', type=Path, default=META)
    args = parser.parse_args()
    tk = get_tk()
    west, south, east, north = args.bbox
    px0, py0 = pixel(west, north, args.zoom)
    px1, py1 = pixel(east, south, args.zoom)
    x0, y0 = math.floor(px0 / TILE_SIZE), math.floor(py0 / TILE_SIZE)
    x1, y1 = math.floor(px1 / TILE_SIZE), math.floor(py1 / TILE_SIZE)
    columns, rows = x1 - x0 + 1, y1 - y0 + 1
    print(f'Fetching {columns}x{rows} = {columns * rows} 天地图 tiles at z{args.zoom}')
    gallery = Image.new('RGB', (columns * TILE_SIZE, rows * TILE_SIZE),
                        (36, 61, 70))
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {
            executor.submit(fetch_tile, tk, args.zoom, x, y): (x, y)
            for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)
        }
        for index, future in enumerate(as_completed(futures), 1):
            x, y = futures[future]
            gallery.paste(future.result(), ((x - x0) * TILE_SIZE,
                                            (y - y0) * TILE_SIZE))
            if index % 50 == 0 or index == len(futures):
                print(f'  {index}/{len(futures)} tiles')
    crop = gallery.crop((
        round(px0 - x0 * TILE_SIZE), round(py0 - y0 * TILE_SIZE),
        round(px1 - x0 * TILE_SIZE), round(py1 - y0 * TILE_SIZE),
    ))
    if max(crop.size) > args.max_size:
        scale = args.max_size / max(crop.size)
        crop = crop.resize((max(1, round(crop.width * scale)),
                            max(1, round(crop.height * scale))),
                           Image.LANCZOS)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    crop.save(args.out, quality=88, optimize=True)
    args.meta.write_text(json.dumps({
        'source': '天地图 WMTS imagery (img_w)',
        'license': '天地图服务条款；仅用于演示/研究，保留署名',
        'bbox': args.bbox, 'zoom': args.zoom,
        'tileRange': [x0, y0, x1, y1], 'tileCount': len(futures),
        'image': args.out.name, 'width': crop.width, 'height': crop.height,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Saved {crop.width}x{crop.height} imagery to {args.out}')


if __name__ == '__main__':
    main()
