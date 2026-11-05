"""Fetch GlobalBuildingAtlas LoD1 features for a WGS84 bbox.

The public GBA WFS requires a viewer cookie/session; requests are split into
small cells and cached so a 5 km city bbox is practical.
"""
from pathlib import Path
import argparse
import http.client
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://tubvsig-so2sat-vm1.srv.mwn.de'
LAYER = 'global3D:lod1_global'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                  'AppleWebKit/537.36 Chrome/130 Safari/537.36',
    'Referer': BASE + '/',
}


def open_session():
    session = requests.Session()
    session.headers.update(HEADERS)
    session.get(BASE + '/', timeout=60).raise_for_status()
    return session


def viewer_session(session):
    response = session.get(BASE + '/viewer-session', timeout=60)
    response.raise_for_status()
    return response.json()['viewerSession']


def fetch_cell(bbox, retries=8):
    """Fetch one WFS cell, retrying truncation/connection failures."""
    last = None
    for attempt in range(retries):
        try:
            # The public GBA WFS closes reused chunked connections; use a
            # fresh cookie/session for every attempt.
            session = open_session()
            token = viewer_session(session)
            params = {
                'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature',
                'typeNames': LAYER, 'outputFormat': 'application/json',
                'srsName': 'EPSG:4326',
                'bbox': ','.join(f'{value:.6f}' for value in bbox) + ',EPSG:4326',
                'viewerSession': token,
            }
            response = session.get(BASE + '/geoserver/ows', params=params,
                                   timeout=240)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError, http.client.IncompleteRead,
                ConnectionError, OSError) as error:
            last = error
            time.sleep(min(20, 2 * (attempt + 1)))
    raise RuntimeError(f'GBA WFS failed for {bbox}: {last}')


def split_cell(bbox):
    """Split a WGS84 bbox into four quadrants (SW, SE, NW, NE)."""
    west, south, east, north = bbox
    mid_x, mid_y = (west + east) / 2, (south + north) / 2
    return [(west, south, mid_x, mid_y), (mid_x, south, east, mid_y),
            (west, mid_y, mid_x, north), (mid_x, mid_y, east, north)]


def feature_key(feature):
    """Stable dedup key; 3D-GloBFP rows use id=0 for every feature."""
    props = feature.get('properties') or {}
    ogc_fid = props.get('ogc_fid')
    if ogc_fid is not None:
        return props.get('source'), ogc_fid
    return (props.get('source'), props.get('id'),
            json.dumps(feature.get('geometry'), sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bbox', type=float, nargs=4, required=True,
                        metavar=('WEST', 'SOUTH', 'EAST', 'NORTH'))
    parser.add_argument('--cell', type=float, default=0.01,
                        help='cell size in degrees (default 0.01)')
    parser.add_argument('--out', type=Path,
                        default=ROOT / 'artifacts/gba-beijing/raw.geojson')
    parser.add_argument('--cache-dir', type=Path,
                        default=ROOT / 'artifacts/gba-beijing/cells-01')
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--workers', type=int, default=1)
    parser.add_argument('--delay', type=float, default=1.5)
    parser.add_argument('--retries', type=int, default=5,
                        help='attempts per WFS request (default 5)')
    parser.add_argument('--min-cell', type=float, default=0.0025,
                        help='stop subdividing a failing cell below this size')
    parser.add_argument('--max-depth', type=int, default=2,
                        help='maximum recursive splits of a failing cell')
    args = parser.parse_args()
    west, south, east, north = args.bbox
    nx = max(1, int((east - west) / args.cell) + 1)
    ny = max(1, int((north - south) / args.cell) + 1)
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    cells = []
    for i in range(nx):
        for j in range(ny):
            cell = (west + (east - west) * i / nx,
                    south + (north - south) * j / ny,
                    west + (east - west) * (i + 1) / nx,
                    south + (north - south) * (j + 1) / ny)
            cells.append((i, j, cell, args.cache_dir / f'cell-{i}-{j}.json'))

    def load_cell(cell, cache, depth=0):
        if cache.exists() and not args.refresh:
            try:
                return json.loads(cache.read_text(encoding='utf-8'))
            except json.JSONDecodeError:
                pass
        try:
            payload = fetch_cell(cell, retries=args.retries)
        except Exception:
            span = max(cell[2] - cell[0], cell[3] - cell[1])
            if depth >= args.max_depth or span <= args.min_cell:
                raise
            # Dense central blocks can return truncated responses; smaller
            # quadrants are more reliable and are cached independently.
            features = []
            for index, sub in enumerate(split_cell(cell)):
                sub_cache = cache.with_name(
                    f'{cache.stem}-s{index}{cache.suffix}')
                features.extend(
                    load_cell(sub, sub_cache, depth + 1).get('features', []))
                time.sleep(args.delay)
            payload = {'type': 'FeatureCollection', 'features': features}
            print(f'  split {cache.name} into 4 sub-cells at depth {depth + 1}')
        cache.write_text(json.dumps(payload, ensure_ascii=False,
                                    separators=(',', ':')), encoding='utf-8')
        time.sleep(args.delay)
        return payload

    features, seen, failed = [], set(), []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(load_cell, cell, cache): (i, j)
                   for i, j, cell, cache in cells}
        for index, future in enumerate(as_completed(futures), 1):
            i, j = futures[future]
            try:
                payload = future.result()
            except Exception as error:
                failed.append((i, j, str(error)))
                print(f'  cell {i},{j} FAILED: {error}')
                continue
            for feature in payload.get('features', []):
                key = feature_key(feature)
                if key in seen:
                    continue
                seen.add(key)
                features.append(feature)
            print(f'  {index}/{len(cells)} cells; '
                  f'cell {i},{j}: {len(payload.get("features", []))} features')
    if failed:
        raise SystemExit(f'{len(failed)} cells failed; rerun to resume from cache')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        'type': 'FeatureCollection', 'features': features,
        'bbox': args.bbox,
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Wrote {len(features)} unique features to {args.out}')


if __name__ == '__main__':
    main()
