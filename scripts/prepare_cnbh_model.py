"""Rebuild the original white-model extent from CNBH-10m heights.

Footprints: the repository SHP (the original white-model source).
Heights: CNBH-10m 10 m raster, sampled at 10 m pixels inside each footprint.
Base: repository DEM, same policy as prepare_data.py.

CNBH source: Wu et al. (2023), Remote Sensing of Environment 291:113578,
Zenodo 10.5281/zenodo.7827315, CC BY 4.0.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import sys

import numpy as np
import rasterio
import shapefile
from pyproj import CRS, Transformer
from shapely import contains_xy, make_valid
from shapely.geometry import Polygon, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_open_model import Dem, load_transform, shp_bbox_wgs84, _closed

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '创意二文件/创意二数据集/区域数据'
SHP = SOURCE / 'building/zheng_apart.shp'
CNBH = ROOT / 'artifacts/cnbh/cnbh_zhengzhou.tif'
OUT = ROOT / 'public/data/sat3dgen'
LICENSE = 'CC BY 4.0'
SOURCE_URL = 'https://zenodo.org/records/7827315'
ATTRIBUTION = ('Wu et al. (2023), CNBH-10m, Remote Sensing of Environment '
               '291:113578; Zenodo 10.5281/zenodo.7827315')


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cnbh', type=Path, default=CNBH)
    parser.add_argument('--out', type=Path, default=OUT / 'cnbh-model.json')
    parser.add_argument('--min-cnbh', type=float, default=0.5)
    args = parser.parse_args()
    if not args.cnbh.exists():
        raise SystemExit(f'CNBH window raster not found: {args.cnbh}')

    shp_crs = CRS.from_wkt(SHP.with_suffix('.prj').read_text(encoding='utf-8'))
    to_geo = Transformer.from_crs(shp_crs, 4326, always_xy=True)
    encoding = SHP.with_suffix('.cpg').read_text(encoding='utf-8').strip()
    reader = shapefile.Reader(str(SHP), encoding=encoding)
    local, origin, tile_data = load_transform()
    dem = Dem()

    with rasterio.open(args.cnbh) as ds:
        cnbh = ds.read(1).astype('float32')
        cnbh_transform = ds.transform
        cnbh_inv = ~cnbh_transform
        cnbh_crs = ds.crs
        cnbh_bounds = list(ds.bounds)
        to_cnbh = Transformer.from_crs(4326, cnbh_crs, always_xy=True)
        height, width = cnbh.shape

        def sample_height(rings_wgs84):
            rings = [[to_cnbh.transform(lon, lat) for lon, lat in ring]
                     for ring in rings_wgs84]
            poly = Polygon(rings[0], rings[1:])
            minx, miny, maxx, maxy = poly.bounds
            c0, r0 = cnbh_inv * (minx, maxy)
            c1, r1 = cnbh_inv * (maxx, miny)
            c0 = max(0, math.floor(c0)); c1 = min(width - 1, math.ceil(c1))
            r0 = max(0, math.floor(r0)); r1 = min(height - 1, math.ceil(r1))
            if c1 < c0 or r1 < r0:
                return None, 0
            cols = np.arange(c0, c1 + 1)
            rows = np.arange(r0, r1 + 1)
            cc, rr = np.meshgrid(cols, rows)
            xs, ys = cnbh_transform * (cc + 0.5, rr + 0.5)
            inside = contains_xy(poly, xs, ys)
            values = cnbh[rr[inside], cc[inside]]
            values = values[np.isfinite(values) & (values > args.min_cnbh)]
            if values.size:
                return float(values.max()), int(values.size)
            # Fall back to the nearest pixel at the centroid for very small
            # footprints that fall between pixel centres.
            cx, cy = poly.centroid.x, poly.centroid.y
            col, row = cnbh_inv * (cx, cy)
            col = min(width - 1, max(0, int(round(col))))
            row = min(height - 1, max(0, int(round(row))))
            value = cnbh[row, col]
            if math.isfinite(float(value)) and value > args.min_cnbh:
                return float(value), 1
            return None, 0

    buildings, skipped = [], {'lowHeight': 0, 'noDem': 0, 'invalid': 0,
                              'fallback': 0}
    cnbh_max = 0.0
    for index, record in enumerate(reader.iterShapeRecords()):
        props = record.record.as_dict()
        source_height = float(props.get('high'))
        if not math.isfinite(source_height) or source_height <= 0:
            skipped['invalid'] += 1
            continue
        geom = shape(record.shape.__geo_interface__)
        if not geom.is_valid:
            geom = make_valid(geom)
        polygons = ([geom] if geom.geom_type == 'Polygon'
                    else [g for g in getattr(geom, 'geoms', [])
                          if g.geom_type == 'Polygon'])
        if not polygons:
            skipped['invalid'] += 1
            continue
        for part, poly in enumerate(polygons):
            rings_wgs84 = []
            for ring in [poly.exterior, *poly.interiors]:
                rings_wgs84.append(_closed([list(to_geo.transform(x, y))
                                            for x, y, *_ in ring.coords]))
            grounds = [dem.sample(lon, lat) for ring in rings_wgs84
                       for lon, lat in ring]
            if any(value is None for value in grounds):
                skipped['noDem'] += 1
                continue
            base, foundation = max(grounds), min(grounds)
            height_cnbh, pixels = sample_height(rings_wgs84)
            if height_cnbh is None:
                height_cnbh = source_height
                skipped['fallback'] += 1
            if height_cnbh < 1:
                skipped['lowHeight'] += 1
                continue
            cnbh_max = max(cnbh_max, height_cnbh)
            local_rings = [[local(lon, lat, base) for lon, lat in ring]
                           for ring in rings_wgs84]
            source_id = str(props.get('ID') or index)
            buildings.append({
                'id': f'cnbh-{source_id}-{index}-{part}',
                'sourceId': source_id,
                'name': props.get('NAME') or f'建筑 {index + 1}',
                'height': round(height_cnbh, 2),
                'heightSource': ('CNBH-10m' if pixels else 'SHP.high (CNBH gap)'),
                'cnbhPixels': pixels,
                'ground': round(base, 2),
                'foundation': round(foundation, 2),
                'foundationDepth': round(base - foundation, 2),
                'rings': local_rings,
            })

    if not buildings:
        raise SystemExit('No CNBH buildings were converted')
    heights = [b['height'] for b in buildings]
    bbox = list(shp_bbox_wgs84())
    metadata = {
        'name': '郑州 · CNBH-10m 全域重建',
        'source': 'CNBH-10m (2020) + repository SHP footprints + DEM',
        'sourceUrl': SOURCE_URL,
        'license': LICENSE,
        'attribution': ATTRIBUTION,
        'citation': ATTRIBUTION,
        'coordinateSystem': 'Local ENU mapped to Three.js [east, up, -north], meters',
        'origin': list(origin),
        'ecefTransform': tile_data['root']['transform'],
        'bbox': bbox,
        'buildingCount': len(buildings),
        'heightSource': 'CNBH-10m; SHP.high fallback for gaps',
        'minHeight': min(heights),
        'maxHeight': max(heights),
        'cnbhResolutionMeters': 10,
        'cnbhRaster': str(args.cnbh.relative_to(ROOT)),
        'cnbhRasterSha256': sha256(args.cnbh),
        'cnbhWindowBounds': cnbh_bounds,
        'cnbhCrs': str(cnbh_crs),
        'skipped': skipped,
        'demBackend': dem.backend,
        'demNearestSamples': dem.nearest_samples,
        'demMaxNearestDistanceMeters': round(dem.max_nearest_distance, 3),
        'groundSampling': 'maximum DEM value at footprint vertices; foundation to minimum',
        'limitations': [
            'CNBH-10m is a 10 m machine-learning height raster, not a surveyed building height.',
            'Height is the maximum valid CNBH pixel inside each footprint; small buildings may fall between pixels.',
            'Footprints are the repository SHP; the original white model geometry may differ.',
            'Missing CNBH pixels fall back to the SHP high field and are counted.',
            'DEM vertical datum is unspecified; absolute elevations are not survey-grade.',
            'CNBH-10m is CC BY 4.0; retain attribution when redistributing.',
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps({'metadata': metadata, 'buildings': buildings},
                      ensure_ascii=False, separators=(',', ':'))
    args.out.write_text(text, encoding='utf-8')
    print(f'Wrote {len(buildings)} buildings to {args.out} ({len(text):,} bytes)')
    print(f'Height range: {metadata["minHeight"]}-{metadata["maxHeight"]} m; '
          f'skipped {skipped}')


if __name__ == '__main__':
    main()
