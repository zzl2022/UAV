"""Download Overture Maps building footprints for a WGS84 bbox.

Used by ``merge_overture_site_model.py`` to fill buildings that GBA LoD1
misses.  Overture's China coverage comes mostly from the East Asian Buildings
layer (CC BY 4.0) plus OpenStreetMap (ODbL); both are in WGS84 and align with
the Esri basemap.

Requires DuckDB with the httpfs extension (``pip install duckdb``).  The
query reads only the parquet row groups whose bbox statistics overlap the
requested area, so a city-sized bbox takes tens of seconds.
"""
from pathlib import Path
import argparse
import json
import time

import duckdb
from shapely import from_wkb
from shapely.geometry import mapping

DEFAULT_RELEASE = '2026-10-21.0'
BUCKET = 's3://overturemaps-us-west-2'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bbox', type=float, nargs=4, required=True,
                        metavar=('WEST', 'SOUTH', 'EAST', 'NORTH'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--release', default=DEFAULT_RELEASE)
    args = parser.parse_args()
    west, south, east, north = args.bbox

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    glob = (f'{BUCKET}/release/{args.release}/theme=buildings/'
            'type=building/*.parquet')
    query = f'''SELECT id, height, num_floors, class, subtype, sources, geometry
FROM read_parquet('{glob}', hive_partitioning=1)
WHERE bbox.xmin < {east} AND bbox.xmax > {west}
  AND bbox.ymin < {north} AND bbox.ymax > {south}'''
    started = time.time()
    rows = con.execute(query).fetchall()
    print(f'{len(rows)} Overture buildings in bbox '
          f'({round(time.time() - started, 1)} s)')

    features = []
    for id_, height, floors, cls, subtype, sources, wkb in rows:
        geometry = from_wkb(bytes(wkb))
        if geometry.is_empty:
            continue
        features.append({
            'type': 'Feature',
            'properties': {
                'id': id_, 'height': height, 'num_floors': floors,
                'class': cls, 'subtype': subtype,
                'source': sources[0].get('dataset') if sources else None,
            },
            'geometry': mapping(geometry),
        })
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(
        {'type': 'FeatureCollection', 'features': features},
        ensure_ascii=False), encoding='utf-8')
    print(f'Saved {len(features)} features to {args.out}')


if __name__ == '__main__':
    main()
