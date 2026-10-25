"""Fetch OSM building footprints for a bbox from Overpass, in cached cells."""
from pathlib import Path
import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = 'https://overpass-api.de/api/interpreter'
HEADERS = {'User-Agent': 'UAV-Beijing-CNBH/1.0'}


def fetch_cell(bbox, retries=5):
    south, west, north, east = bbox
    query = (f'[out:json][timeout:180];'
             f'way["building"]({south},{west},{north},{east});out geom;')
    last = None
    for attempt in range(retries):
        try:
            response = requests.get(ENDPOINT, params={'data': query},
                                    headers=HEADERS, timeout=240)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as error:
            last = error
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'Overpass failed for {bbox}: {last}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bbox', type=float, nargs=4, required=True,
                        metavar=('WEST', 'SOUTH', 'EAST', 'NORTH'))
    parser.add_argument('--cell', type=float, default=0.02)
    parser.add_argument('--out', type=Path,
                        default=ROOT / 'artifacts/osm-beijing/raw.json')
    parser.add_argument('--cache-dir', type=Path,
                        default=ROOT / 'artifacts/osm-beijing/cells')
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    west, south, east, north = args.bbox
    nx = max(1, int((east - west) / args.cell) + 1)
    ny = max(1, int((north - south) / args.cell) + 1)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    def load_cell(i, j, cell, cache):
        if cache.exists() and not args.refresh:
            try:
                return json.loads(cache.read_text(encoding='utf-8'))
            except json.JSONDecodeError:
                pass
        payload = fetch_cell(cell)
        cache.write_text(json.dumps(payload, ensure_ascii=False,
                                    separators=(',', ':')), encoding='utf-8')
        return payload

    cells = []
    for i in range(nx):
        for j in range(ny):
            cell = (south + (north - south) * j / ny,
                    west + (east - west) * i / nx,
                    south + (north - south) * (j + 1) / ny,
                    west + (east - west) * (i + 1) / nx)
            cells.append((i, j, cell, args.cache_dir / f'cell-{i}-{j}.json'))

    elements, seen, failed = [], set(), []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {executor.submit(load_cell, i, j, cell, cache): (i, j)
                   for i, j, cell, cache in cells}
        for index, future in enumerate(as_completed(futures), 1):
            i, j = futures[future]
            try:
                payload = future.result()
            except Exception as error:
                failed.append((i, j, str(error)))
                print(f'  cell {i},{j} FAILED: {error}')
                continue
            for element in payload.get('elements', []):
                if element.get('type') != 'way' or element.get('id') in seen:
                    continue
                seen.add(element['id'])
                elements.append(element)
            print(f'  {index}/{len(cells)} cells; cell {i},{j}: '
                  f'{len(payload.get("elements", []))} elements')
    if failed:
        raise SystemExit(f'{len(failed)} cells failed; rerun to resume from cache')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({'elements': elements},
                                   ensure_ascii=False,
                                   separators=(',', ':')), encoding='utf-8')
    print(f'Wrote {len(elements)} OSM ways to {args.out}')


if __name__ == '__main__':
    main()
