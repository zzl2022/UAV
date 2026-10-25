"""Build the Beijing 5 km per-building model from OSM footprints + CNBH heights.

OSM supplies footprints (ODbL); CNBH-10m supplies heights (CC BY 4.0).  This
is the per-building fallback used when the GBA WFS is rate-limited.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math

import numpy as np
import rasterio
from pyproj import Transformer
from shapely import contains_xy
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'artifacts/osm-beijing/raw.json'
CNBH = ROOT / 'artifacts/cnbh/cnbh_beijing.tif'
OUT = ROOT / 'public/data/beijing/beijing-osm.json'
CENTER = (116.3972, 39.9163)
BBOX = (116.33864, 39.87108, 116.45576, 39.96152)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tag_height(tags):
    value = tags.get('height')
    if value:
        try:
            return float(str(value).strip().lower().replace('m', ''))
        except ValueError:
            pass
    levels = tags.get('building:levels')
    if levels:
        try:
            return float(str(levels).strip()) * 3.0
        except ValueError:
            pass
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, default=RAW)
    parser.add_argument('--cnbh', type=Path, default=CNBH)
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--center', type=float, nargs=2, default=list(CENTER))
    parser.add_argument('--bbox', type=float, nargs=4, default=list(BBOX))
    parser.add_argument('--min-height', type=float, default=3)
    parser.add_argument('--max-height', type=float, default=400,
                        help='reject implausible tagged heights above this value')
    parser.add_argument('--min-area', type=float, default=20)
    parser.add_argument('--fallback-height', type=float, default=6,
                        help='height for footprints without CNBH/tag (approximation)')
    args = parser.parse_args()
    for path in (args.raw, args.cnbh):
        if not path.exists():
            raise SystemExit(f'Missing input: {path}')

    west, south, east, north = args.bbox
    to_utm = Transformer.from_crs(4326, 32650, always_xy=True)
    origin_x, origin_y = to_utm.transform(*args.center)
    west_x, south_y = to_utm.transform(west, south)
    east_x, _ = to_utm.transform(east, south)
    _, north_y = to_utm.transform(west, north)
    local_x0, local_x1 = west_x - origin_x, east_x - origin_x
    local_z0, local_z1 = -(north_y - origin_y), -(south_y - origin_y)

    with rasterio.open(args.cnbh) as ds:
        cnbh = ds.read(1).astype('float32')
        transform = ds.transform
        inv = ~transform
        height, width = cnbh.shape

        def sample_height(poly):
            minx, miny, maxx, maxy = poly.bounds
            c0, r0 = inv * (minx, maxy)
            c1, r1 = inv * (maxx, miny)
            c0 = max(0, math.floor(c0)); c1 = min(width - 1, math.ceil(c1))
            r0 = max(0, math.floor(r0)); r1 = min(height - 1, math.ceil(r1))
            if c1 < c0 or r1 < r0:
                return None
            cols = np.arange(c0, c1 + 1)
            rows = np.arange(r0, r1 + 1)
            cc, rr = np.meshgrid(cols, rows)
            xs, ys = transform * (cc + 0.5, rr + 0.5)
            inside = contains_xy(poly, xs, ys)
            values = cnbh[rr[inside], cc[inside]]
            values = values[np.isfinite(values) & (values > 0.5)]
            if values.size:
                return float(values.max())
            # Small/offset OSM footprints may fall between CNBH pixels.  Look
            # for the nearest valid 10 m building pixel within ~60 m.
            cx, cy = poly.centroid.x, poly.centroid.y
            col, row = inv * (cx, cy)
            col = int(round(col)); row = int(round(row))
            best = None; best_distance = math.inf
            for radius in range(1, 7):
                r0, r1 = max(0, row - radius), min(height - 1, row + radius)
                c0, c1 = max(0, col - radius), min(width - 1, col + radius)
                window = cnbh[r0:r1 + 1, c0:c1 + 1]
                valid_window = np.isfinite(window) & (window > 0.5)
                if not valid_window.any():
                    continue
                rr, cc = np.where(valid_window)
                rr = rr + r0; cc = cc + c0
                distances = (rr - row) ** 2 + (cc - col) ** 2
                index = int(np.argmin(distances))
                if distances[index] < best_distance:
                    best_distance = float(distances[index])
                    best = float(window[rr[index] - r0, cc[index] - c0])
            return best

    raw = json.loads(args.raw.read_text(encoding='utf-8'))
    buildings, skipped = [], {'geometry': 0, 'area': 0, 'height': 0,
                              'tall': 0, 'defaultHeight': 0}
    heights = []
    for element in raw.get('elements', []):
        tags = element.get('tags') or {}
        if not tags.get('building') or str(tags.get('building')).lower() == 'no':
            continue
        geometry = element.get('geometry') or []
        if len(geometry) < 3:
            skipped['geometry'] += 1
            continue
        ring = [(point['lon'], point['lat']) for point in geometry]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        # CNBH sampling is in absolute UTM (the raster CRS); the model frame is
        # local metres, so build both rings explicitly.
        ring_abs, ring_local = [], []
        for lon, lat in ring:
            x, y = to_utm.transform(lon, lat)
            ring_abs.append([x, y])
            ring_local.append([x - origin_x, y - origin_y])
        poly = Polygon(ring_abs)
        if not poly.is_valid or poly.area < args.min_area:
            skipped['area'] += 1
            continue
        cnbh_height = sample_height(poly)
        height_value = cnbh_height
        source = 'CNBH-10m'
        if height_value is None:
            height_value = tag_height(tags)
            source = 'OSM height tag'
        if height_value is None:
            height_value = args.fallback_height
            source = 'default 6 m (CNBH gap)'
            skipped['defaultHeight'] += 1
        if height_value is None or height_value < args.min_height:
            skipped['height'] += 1
            continue
        if height_value > args.max_height:
            skipped['tall'] += 1
            continue
        local_rings = [[[round(x, 2), 0.0, round(-y, 2)]
                        for x, y in ring_local]]
        buildings.append({
            'id': f"osm-{element.get('id')}",
            'sourceId': str(element.get('id')),
            'source': 'OpenStreetMap',
            'name': tags.get('name') or f"OSM {element.get('id')}",
            'height': round(float(height_value), 2),
            'heightSource': source,
            'ground': 0.0,
            'foundation': 0.0,
            'foundationDepth': 0.0,
            'rings': local_rings,
        })
        heights.append(float(height_value))

    if not buildings:
        raise SystemExit('No OSM buildings passed the filters')
    metadata = {
        'name': '北京 · 故宫 5 km · OSM + CNBH 逐栋',
        'source': 'OpenStreetMap footprints + CNBH-10m heights',
        'sourceUrl': 'https://www.openstreetmap.org/',
        'license': 'ODbL 1.0 (OSM footprints); CC BY 4.0 (CNBH-10m heights)',
        'attribution': '© OpenStreetMap contributors; CNBH-10m, Wu et al. (2023)',
        'center': list(args.center), 'radiusMeters': 5000,
        'bbox': list(args.bbox),
        'localBounds': [round(local_x0, 2), round(local_x1, 2),
                        round(local_z0, 2), round(local_z1, 2)],
        'buildingCount': len(buildings), 'blockCount': len(buildings),
        'minHeight': round(min(heights), 2),
        'maxHeight': round(max(heights), 2),
        'filters': {'minHeight': args.min_height,
                    'maxHeight': args.max_height,
                    'minAreaMeters2': args.min_area,
                    'fallbackHeight': args.fallback_height},
        'skipped': skipped,
        'heightSource': 'CNBH-10m max valid pixel in footprint; OSM height/levels or 6 m default fallback',
        'baseElevation': 0,
        'rawSha256': sha256(args.raw),
        'cnbhRasterSha256': sha256(args.cnbh),
        'coordinateSystem': 'local metric [east, up, -north]; origin at center',
        'limitations': [
            'OSM footprints are community data; completeness varies.',
            'Height is CNBH-10m model output, not a survey.',
            'Base is flat (no DEM); absolute elevations are not represented.',
            'OSM footprints are ODbL; CNBH heights are CC BY 4.0; attribution required.',
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps({'metadata': metadata, 'buildings': buildings},
                      ensure_ascii=False, separators=(',', ':'))
    args.out.write_text(text, encoding='utf-8')
    print(f'Wrote {len(buildings)} OSM buildings to {args.out} ({len(text):,} bytes)')
    print(f'Height range {metadata["minHeight"]}-{metadata["maxHeight"]} m; '
          f'skipped {skipped}')


if __name__ == '__main__':
    main()
