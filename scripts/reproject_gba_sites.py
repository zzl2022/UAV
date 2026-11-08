"""Reproject existing GBA site JSON from EPSG:32650 to a local TM frame.

The original Beijing-area site files were generated with a fixed UTM 50N
frame.  At the eastern edge of the zone, grid north is rotated against the
north-up Tianditu imagery, so footprints can drift onto runways/taxiways.
This script keeps the same buildings and core selection but moves all local
coordinates into a transverse Mercator centred on each site, matching the
`--projection local` mode of prepare_beijing_gba_model.py.
"""
from pathlib import Path
import json
import math

from pyproj import CRS, Transformer

ROOT = Path(__file__).resolve().parents[1]
OLD_EPSG = 32650

SITES = [
    ('beijing', ROOT / 'public/data/beijing/beijing-gba.json'),
    ('daxing', ROOT / 'public/data/sites/daxing/daxing-gba.json'),
    ('nuclear', ROOT / 'public/data/sites/nuclear/nuclear-gba.json'),
    ('railway', ROOT / 'public/data/sites/railway/railway-gba.json'),
]


def local_crs(center):
    return CRS.from_proj4(
        f'+proj=tmerc +lat_0={center[1]} +lon_0={center[0]} '
        f'+k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')


def main():
    for name, path in SITES:
        data = json.loads(path.read_text(encoding='utf-8'))
        meta = data['metadata']
        center = meta['center']
        bbox = meta['bbox']
        old_to_new = Transformer.from_crs(OLD_EPSG, local_crs(center),
                                          always_xy=True)
        to_new = Transformer.from_crs(4326, local_crs(center), always_xy=True)
        to_old = Transformer.from_crs(4326, OLD_EPSG, always_xy=True)
        old_origin = to_old.transform(*center)
        new_origin = to_new.transform(*center)

        def point(x, z):
            east, north = old_to_new.transform(x + old_origin[0],
                                               -z + old_origin[1])
            return [round(east - new_origin[0], 2),
                    round(-(north - new_origin[1]), 2)]

        def ring(points):
            xs = [p[0] + old_origin[0] for p in points]
            ns = [-p[2] + old_origin[1] for p in points]
            east, north = old_to_new.transform(xs, ns)
            return [[round(e - new_origin[0], 2), p[1],
                     round(-(n - new_origin[1]), 2)]
                    for e, n, p in zip(east, north, points)]

        for building in data['buildings']:
            building['rings'] = [ring(r) for r in building['rings']]

        core = meta.get('coreBuilding')
        if core:
            core['rings'] = [ring(r) for r in core.get('rings', [])]
            core['center'] = point(*core['center'])
            core['distanceFromCenterMeters'] = round(
                math.hypot(*core['center']), 1)

        route = meta.get('route')
        if route and route.get('points'):
            route['points'] = [point(*p) for p in route['points']]

        west, south, east, north = bbox
        west_x, south_y = to_new.transform(west, south)
        east_x, _ = to_new.transform(east, south)
        _, north_y = to_new.transform(west, north)
        meta['localBounds'] = [
            round(west_x - new_origin[0], 2),
            round(east_x - new_origin[0], 2),
            round(-(north_y - new_origin[1]), 2),
            round(-(south_y - new_origin[1]), 2),
        ]
        meta['metricProjection'] = 'local_tmerc'
        meta['coordinateSystem'] = ('local metric [east, up, -north]; '
                                    'origin at center; local_tmerc')
        path.write_text(json.dumps(data, ensure_ascii=False,
                                   separators=(',', ':')), encoding='utf-8')
        print(f'{name}: {len(data["buildings"])} buildings; '
              f'bounds {meta["localBounds"]}')


if __name__ == '__main__':
    main()
