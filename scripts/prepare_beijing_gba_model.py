"""Convert GlobalBuildingAtlas LoD1 features into a local metric frame.

Used for the Beijing sites (Forbidden City, Daxing Airport, Fangshan nuclear
facility).  GBA supplies per-building footprints and heights.  The base is
flat (no DEM), matching the imagery ground.  GBA is CC BY-NC 4.0; attribution
is included.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math

from pyproj import Transformer
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'artifacts/gba-beijing/raw.geojson'
OUT = ROOT / 'public/data/beijing/beijing-gba.json'
CENTER = (116.3972, 39.9163)
BBOX = (116.33864, 39.87108, 116.45576, 39.96152)
LICENSE = 'CC BY-NC 4.0'
ATTRIBUTION = ('GlobalBuildingAtlas (TUM), 3D-GloBFP, '
               '© OpenStreetMap contributors')
SITE_NAMES = {
    'daxing': '北京 · 大兴国际机场 10 km · GBA LoD1',
    'nuclear': '北京 · 房山核设施 5 km · GBA LoD1',
    'railway': '北京 · 北京—通州铁路 5 km 走廊 · GBA LoD1',
}
CORE_CONFIG = {
    'daxing': {'name': '大兴机场航站楼', 'short': '机场航站楼', 'radius': 1800},
    'nuclear': {'name': '核设施核心建筑（推测）', 'short': '核设施核心', 'radius': 800},
    'railway': {'name': '北京站', 'short': '北京站', 'radius': 5000,
                'target': (116.4271, 39.9029), 'target_radius': 300},
    'default': {'name': '太和殿', 'short': '太和殿', 'radius': 600,
                'target': (116.3907, 39.9165), 'target_radius': 150,
                'mode': 'height'},
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def coordinates(coords):
    """Yield (lon, lat) pairs from Polygon/MultiPolygon coordinate nesting."""
    if coords and isinstance(coords[0], (int, float)):
        yield coords[0], coords[1]
    else:
        for item in coords:
            yield from coordinates(item)


def ring_area(ring):
    """Signed shoelace area in the local [east, up, -north] frame."""
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][2]
               - ring[(i + 1) % len(ring)][0] * ring[i][2]
               for i in range(len(ring))) / 2


def polygon_area(rings):
    if not rings:
        return 0.0
    area = abs(ring_area(rings[0]))
    for hole in rings[1:]:
        area -= abs(ring_area(hole))
    return max(0.0, area)


def polygon_center(ring):
    xs = [point[0] for point in ring]
    zs = [point[2] for point in ring]
    return (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, default=RAW)
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--site', choices=('daxing', 'nuclear', 'railway'),
                        help='named Beijing site (avoids non-ASCII CLI arguments)')
    parser.add_argument('--name', default=None,
                        help='override the model display name')
    parser.add_argument('--radius', type=float, default=5000,
                        help='display radius in metres (5 km for site models)')
    parser.add_argument('--center', type=float, nargs=2, default=list(CENTER))
    parser.add_argument('--bbox', type=float, nargs=4, default=list(BBOX))
    parser.add_argument('--min-height', type=float, default=3)
    parser.add_argument('--max-height', type=float, default=300)
    parser.add_argument('--min-area', type=float, default=20)
    parser.add_argument('--core-radius', type=float, default=None,
                        help='search radius for the core building (metres)')
    parser.add_argument('--core-target', type=float, nargs=2, default=None,
                        metavar=('LON', 'LAT'),
                        help='WGS84 target for the core building')
    parser.add_argument('--core-target-radius', type=float, default=None,
                        help='search radius around --core-target in metres')
    parser.add_argument('--route', type=Path, default=None,
                        help='optional WGS84 polyline JSON for a corridor model')
    parser.add_argument('--core-name', default=None,
                        help='display name of the core building')
    parser.add_argument('--core-short', default=None,
                        help='short name used by the focus button')
    parser.add_argument('--core-mode', choices=('area', 'height'), default=None,
                        help='select the core building by footprint area or height')
    parser.add_argument('--coverage-tolerance', type=float, default=0.01,
                        help='max missing margin per bbox edge in degrees')
    parser.add_argument('--allow-partial', action='store_true',
                        help='accept a raw file that does not cover the bbox')
    args = parser.parse_args()
    if not args.raw.exists():
        raise SystemExit(f'GBA raw GeoJSON not found: {args.raw}')

    west, south, east, north = args.bbox
    to_utm = Transformer.from_crs(4326, 32650, always_xy=True)
    origin_x, origin_y = to_utm.transform(*args.center)
    west_x, south_y = to_utm.transform(west, south)
    east_x, _ = to_utm.transform(east, south)
    _, north_y = to_utm.transform(west, north)
    local_x0, local_x1 = west_x - origin_x, east_x - origin_x
    local_z0, local_z1 = -(north_y - origin_y), -(south_y - origin_y)

    payload = json.loads(args.raw.read_text(encoding='utf-8'))
    lons, lats = [], []
    for feature in payload.get('features', []):
        for lon, lat in coordinates(
                (feature.get('geometry') or {}).get('coordinates') or []):
            lons.append(lon)
            lats.append(lat)
    if not lons:
        raise SystemExit('GBA raw GeoJSON contains no coordinates')
    feature_bounds = [min(lons), min(lats), max(lons), max(lats)]
    coverage_margins = {
        'west': round(feature_bounds[0] - west, 6),
        'south': round(feature_bounds[1] - south, 6),
        'east': round(east - feature_bounds[2], 6),
        'north': round(north - feature_bounds[3], 6),
    }
    missing = {edge: round(max(0.0, margin), 6)
               for edge, margin in coverage_margins.items()}
    if not args.allow_partial and max(missing.values()) > args.coverage_tolerance:
        raise SystemExit(
            f'GBA raw data covers only part of the bbox (missing margins '
            f'{missing}); rerun fetch_gba_bbox.py to finish, or pass '
            f'--allow-partial')

    buildings, skipped = [], {'height': 0, 'area': 0, 'geometry': 0,
                              'duplicate': 0}
    heights, seen, source_counts = [], set(), {}
    for feature in payload.get('features', []):
        props = feature.get('properties') or {}
        source = props.get('source') or 'unknown'
        # WFS cell borders return the same feature twice; 3D-GloBFP rows also
        # reuse id=0, so ogc_fid is the only reliable identity.
        ogc_fid = props.get('ogc_fid')
        source_id = str(ogc_fid if ogc_fid is not None
                        else props.get('id') or len(buildings))
        geometry = feature.get('geometry') or {}
        key = (source, source_id)
        if key in seen:
            skipped['duplicate'] += 1
            continue
        seen.add(key)
        height = props.get('height')
        if (not isinstance(height, (int, float)) or not math.isfinite(height)
                or height < args.min_height or height > args.max_height):
            skipped['height'] += 1
            continue
        if geometry.get('type') == 'Polygon':
            polygons = [geometry.get('coordinates') or []]
        elif geometry.get('type') == 'MultiPolygon':
            polygons = geometry.get('coordinates') or []
        else:
            skipped['geometry'] += 1
            continue
        source_counts[source] = source_counts.get(source, 0) + 1
        for part, polygon in enumerate(polygons):
            rings_wgs84 = [ring for ring in polygon if len(ring) >= 4]
            if not rings_wgs84:
                skipped['geometry'] += 1
                continue
            rings_utm = []
            for ring in rings_wgs84:
                converted = []
                for lon, lat in ring:
                    x, y = to_utm.transform(lon, lat)
                    converted.append([x - origin_x, y - origin_y])
                rings_utm.append(converted)
            poly = Polygon(rings_utm[0], rings_utm[1:])
            if not poly.is_valid or poly.area < args.min_area:
                skipped['area'] += 1
                continue
            local_rings = [[[round(x, 2), 0.0, round(-y, 2)]
                            for x, y in ring] for ring in rings_utm]
            buildings.append({
                'id': f'gba-{source}-{source_id}-{part}',
                'sourceId': source_id,
                'source': source,
                'name': f'GBA {source_id}',
                'height': round(float(height), 2),
                'heightSource': 'GBA LoD1 (3D-GloBFP/OSM)',
                'ground': 0.0,
                'foundation': 0.0,
                'foundationDepth': 0.0,
                'rings': local_rings,
            })
            heights.append(float(height))

    if not buildings:
        raise SystemExit('No GBA buildings passed the filters')
    core_cfg = CORE_CONFIG.get(args.site, CORE_CONFIG['default'])
    core_radius = (args.core_radius if args.core_radius is not None
                   else core_cfg['radius'])
    core_name = args.core_name or core_cfg['name']
    core_short = args.core_short or core_cfg['short']
    target = args.core_target or core_cfg.get('target')
    target_radius = (args.core_target_radius
                     if args.core_target_radius is not None
                     else core_cfg.get('target_radius', 150))
    if target:
        target_x, target_y = to_utm.transform(*target)
        target_x -= origin_x
        target_z = -(target_y - origin_y)
        search_x, search_z, search_radius = target_x, target_z, target_radius
        search_label = f'target {target[0]:.6f},{target[1]:.6f}'
    else:
        search_x, search_z, search_radius = 0.0, 0.0, core_radius
        search_label = 'site center'
    candidates = []
    for building in buildings:
        cx, cz = polygon_center(building['rings'][0])
        distance = math.hypot(cx - search_x, cz - search_z)
        if distance <= search_radius:
            candidates.append((building, polygon_area(building['rings']),
                               cx, cz, distance))
    if not candidates:
        # Sparse site: keep a deterministic fallback instead of dropping the
        # highlight entirely.
        for building in buildings:
            cx, cz = polygon_center(building['rings'][0])
            candidates.append((building, polygon_area(building['rings']),
                               cx, cz, math.hypot(cx - search_x, cz - search_z)))
    core_building = None
    core_mode = args.core_mode or core_cfg.get('mode', 'area')
    if candidates:
        if core_mode == 'height':
            building, area, cx, cz, distance = max(
                candidates, key=lambda item: item[0]['height'])
        else:
            building, area, cx, cz, distance = max(
                candidates, key=lambda item: item[1])
        core_building = {
            'id': building['id'],
            'name': core_name,
            'shortName': core_short,
            'height': building['height'],
            'areaM2': round(area, 1),
            'center': [round(cx, 2), round(cz, 2)],
            'distanceFromCenterMeters': round(distance, 1),
            'rings': building['rings'],
            'selection': (
                ('largest footprint' if core_mode == 'area'
                 else 'tallest')
                + f' within {search_radius:g} m of {search_label}'),
        }
    route = None
    if args.route:
        route_payload = json.loads(args.route.read_text(encoding='utf-8'))
        route_points = []
        for lon, lat in route_payload.get('points', []):
            x, y = to_utm.transform(lon, lat)
            route_points.append([round(x - origin_x, 2),
                                 round(-(y - origin_y), 2)])
        route = {
            'name': route_payload.get('name', 'railway corridor'),
            'points': route_points,
            'source': 'user-defined schematic railway polyline',
        }
    metadata = {
        'name': args.name or SITE_NAMES.get(args.site, '北京 · 故宫 5 km · GBA LoD1'),
        'route': route,
        'source': 'GlobalBuildingAtlas LoD1 (per-building footprints + heights)',
        'sourceUrl': 'https://huggingface.co/datasets/zhu-xlab/GBA.LoD1',
        'license': LICENSE,
        'attribution': ATTRIBUTION,
        'center': list(args.center),
        'radiusMeters': args.radius,
        'bbox': list(args.bbox),
        'featureBounds': [round(value, 6) for value in feature_bounds],
        'coverageMargins': coverage_margins,
        'localBounds': [round(local_x0, 2), round(local_x1, 2),
                        round(local_z0, 2), round(local_z1, 2)],
        'buildingCount': len(buildings),
        'blockCount': len(buildings),
        'minHeight': round(min(heights), 2),
        'maxHeight': round(max(heights), 2),
        'filters': {'minHeight': args.min_height, 'maxHeight': args.max_height,
                    'minAreaMeters2': args.min_area},
        'skipped': skipped,
        'coreBuilding': core_building,
        'sourceCounts': source_counts,
        'heightSource': 'GBA LoD1 heights (3D-GloBFP/OSM fusion)',
        'baseElevation': 0,
        'rawSha256': sha256(args.raw),
        'coordinateSystem': 'local metric [east, up, -north]; origin at center',
        'limitations': [
            'GBA LoD1 is a model product; heights are not surveyed.',
            'License is CC BY-NC 4.0: non-commercial use with attribution.',
            'Base is flat (no DEM); absolute elevations are not represented.',
            'Low/tiny structures are filtered; roads are left to the imagery basemap.',
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps({'metadata': metadata, 'buildings': buildings},
                      ensure_ascii=False, separators=(',', ':'))
    args.out.write_text(text, encoding='utf-8')
    print(f'Wrote {len(buildings)} buildings to {args.out} ({len(text):,} bytes)')
    print(f'Height range {metadata["minHeight"]}-{metadata["maxHeight"]} m; '
          f'skipped {skipped}')


if __name__ == '__main__':
    main()
