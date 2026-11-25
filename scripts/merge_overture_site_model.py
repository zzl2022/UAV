"""Merge Overture Maps building footprints into a GBA site model.

GBA LoD1 is accurate where it has a footprint but sparse in many Chinese
cities.  Overture's East Asian Buildings layer (CC BY 4.0, derived from
high-resolution imagery) is much denser and aligns with the same basemap.

Strategy:
  * Wuxi: prefer individual OSM and Overture building footprints to the
    broad GBA machine-derived outlines. Resolve conflicting footprints before
    extrusion and preserve the OSM civic centre.
  * Daxing: keep GBA buildings and use Overture to fill coverage gaps.
  * additions inherit heights from Overture levels when available, otherwise
    from nearby matched GBA buildings (distance-weighted), with small
    structures capped to plausible shed/jet-bridge heights.

The output stays in the GBA site JSON shape, so the normal GLB exporter and
the runtime site loader keep working unchanged.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
from collections import Counter

import numpy as np
from PIL import Image
from pyproj import CRS, Transformer
from shapely import make_valid
from shapely.geometry import Point, Polygon, shape
from shapely.strtree import STRtree
from wuxi_footprints import conflate_wuxi, polygon_from_building, polygon_parts

ROOT = Path(__file__).resolve().parents[1]
MIN_AREA = 20.0


def log(*args):
    print(*args)


def load_geojson(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def project_polygons(features, to_metric, half):
    """Return (polygon, props) pairs in local metres, clipped to the site."""
    out = []
    limit = half + 150.0
    for feature in features:
        props = feature.get('properties') or {}
        geometry = shape(feature['geometry'])
        for part in polygon_parts(geometry):
            holes = [
                [to_metric.transform(x, y) for x, y, *_ in ring.coords]
                for ring in part.interiors
            ]
            poly = Polygon([to_metric.transform(x, y) for x, y, *_ in part.exterior.coords], holes)
            for q in polygon_parts(poly if poly.is_valid else make_valid(poly)):
                if q.area < MIN_AREA:
                    continue
                if (q.bounds[0] < -limit or q.bounds[2] > limit
                        or q.bounds[1] < -limit or q.bounds[3] > limit):
                    continue
                out.append((q, props))
    return out


def gba_polygons(payload):
    polygons = []
    for building in payload['buildings']:
        q = polygon_from_building(building)
        if not q.is_valid:
            q = q.buffer(0)
        polygons.append(q)
    return polygons


def containment(a, b):
    """Intersection over the smaller area; robust to containment/shape drift."""
    inter = a.intersection(b).area
    return inter / max(1.0, min(a.area, b.area))


def interior_color(q, image, half):
    """Mean interior colour from a 5x5 grid (used to spot bare-field boxes)."""
    height, width = image.shape[:2]
    minx, miny, maxx, maxy = q.bounds
    samples = []
    for i in range(5):
        for j in range(5):
            x = minx + (i + 0.5) / 5 * (maxx - minx)
            y = miny + (j + 0.5) / 5 * (maxy - miny)
            if not q.contains(Point(x, y)):
                continue
            px = int((x + half) * width / (2 * half))
            py = int((half - y) * height / (2 * half))
            patch = image[max(0, py - 2):py + 3, max(0, px - 2):px + 3]
            if patch.size:
                samples.append(patch.reshape(-1, 3).mean(axis=0))
    return np.mean(samples, axis=0) if samples else np.array([0.0, 0.0, 0.0])


def vegetation_fraction(q, image, half):
    """Fraction of interior sample points that look like vegetation/water.

    Large Overture polygons occasionally trace sports fields, ponds or tree
    clusters.  A centroid sample is not enough (a legitimate courtyard
    building can have a green centre), so sample a 7x7 grid inside the
    footprint and require a strong majority before rejecting it.
    """
    height, width = image.shape[:2]
    minx, miny, maxx, maxy = q.bounds
    hit = total = 0
    for i in range(7):
        for j in range(7):
            x = minx + (i + 0.5) / 7 * (maxx - minx)
            y = miny + (j + 0.5) / 7 * (maxy - miny)
            if not q.contains(Point(x, y)):
                continue
            total += 1
            px = int((x + half) * width / (2 * half))
            py = int((half - y) * height / (2 * half))
            patch = image[max(0, py - 2):py + 3, max(0, px - 2):px + 3]
            if patch.size == 0:
                continue
            r, g, b = patch.reshape(-1, 3).mean(axis=0)
            if (g - (r + b) / 2) > 14 or (b - (r + g) / 2) > 18:
                hit += 1
    return hit / max(1, total)


def dedupe_overture(overture):
    """Drop smaller copies of overlapping Overture footprints (rare)."""
    tree = STRtree([q for q, _ in overture])
    drop = set()
    for i, (q, _) in enumerate(overture):
        if i in drop:
            continue
        for j in tree.query(q.buffer(0.5)):
            j = int(j)
            if j <= i or j in drop:
                continue
            other = overture[j][0]
            if containment(q, other) > 0.5:
                # Keep the larger footprint.
                drop.add(j if q.area >= other.area else i)
                if i in drop:
                    break
    return [item for index, item in enumerate(overture) if index not in drop]


def height_for_addition(q, gba_height_tree, gba_points, gba_areas, gba_heights,
                        global_median, max_height):
    area = q.area
    if area < 60:
        return round(min(4.0, max_height), 2)
    if area < 150:
        return round(min(6.0, max_height), 2)
    # Find nearby GBA buildings and prefer similar footprint sizes.
    idx = gba_height_tree.query(q.buffer(250))
    rows = []
    for j in idx:
        j = int(j)
        d = math.hypot(q.centroid.x - gba_points[j][0],
                       q.centroid.y - gba_points[j][1])
        if d > 250:
            continue
        ratio = area / max(1.0, gba_areas[j])
        if ratio < 0.3 or ratio > 3.3:
            continue
        rows.append((d, gba_heights[j]))
    if not rows:
        return round(min(global_median, max_height), 2)
    rows.sort()
    rows = rows[:20]
    weights = np.array([1.0 / (d + 10.0) for d, _ in rows])
    heights = np.array([h for _, h in rows], dtype=float)
    order = np.argsort(heights)
    cumulative = np.cumsum(weights[order])
    median = float(heights[order][np.searchsorted(cumulative, cumulative[-1] / 2)])
    return round(max(3.0, min(median, max_height)), 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', required=True, choices=('wuxi', 'daxing'))
    parser.add_argument('--overture', type=Path, required=True,
                        help='Overture building GeoJSON for the site bbox')
    parser.add_argument('--data', type=Path, default=None,
                        help='site model JSON (default public/data/sites/<site>/<site>-gba.json)')
    parser.add_argument('--out', type=Path, default=None)
    parser.add_argument('--imagery', type=Path, default=None,
                        help='basemap JPEG used to reject vegetation/water footprints')
    args = parser.parse_args()

    site = args.site
    data_path = args.data or ROOT / f'public/data/sites/{site}/{site}-gba.json'
    out_path = args.out or data_path
    payload = load_geojson(data_path)
    meta = payload['metadata']
    if (meta.get('sourceCounts') or {}).get('overture_added'):
        raise SystemExit(
            'input already contains Overture additions; rerun from the freshly '
            'prepared GBA JSON so buildings are not added twice')
    center = meta['center']
    crs = CRS.from_proj4(
        f'+proj=tmerc +lat_0={center[1]} +lon_0={center[0]} '
        f'+k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs')
    to_metric = Transformer.from_crs(4326, crs, always_xy=True)

    overture_raw = project_polygons(
        load_geojson(args.overture)['features'], to_metric,
        float(meta['localBounds'][1]))
    overture = overture_raw if site == 'wuxi' else dedupe_overture(overture_raw)
    log(f'{site}: {len(overture)} Overture candidates')

    gba_polygons_list = gba_polygons(payload)

    imagery = None
    imagery_half = float(meta['localBounds'][1])
    imagery_path = args.imagery or ROOT / f'public/data/sites/{site}/{site}-imagery.jpg'
    imagery_meta_path = imagery_path.with_suffix('.json')
    if imagery_path.exists():
        imagery = np.asarray(Image.open(imagery_path).convert('RGB')).astype(float)
        if imagery_meta_path.exists():
            sidecar = json.loads(imagery_meta_path.read_text(encoding='utf-8'))
            bounds = sidecar.get('localBounds')
            if bounds:
                imagery_half = max(abs(bounds[0]), abs(bounds[1]))

    # 3D-GloBFP occasionally puts rectangles on bare fields in farmland.  A
    # GBA footprint with no Overture counterpart and a tan, field-like
    # interior is dropped; village houses and greenhouses (roof-like or
    # matched) are kept, as is the core building.
    overture_tree = STRtree([q for q, _ in overture])
    core_id = (meta.get('coreBuilding') or {}).get('id')
    kept_buildings, kept_polygons = [], []
    dropped = 0
    for building, q in zip(payload['buildings'], gba_polygons_list):
        if building.get('id') == core_id:
            kept_buildings.append(building)
            kept_polygons.append(q)
            continue
        matched = False
        for j in overture_tree.query(q.buffer(30)):
            other = overture[int(j)][0]
            if (containment(q, other) > 0.2
                    or (q.centroid.distance(other.centroid) < 30
                        and 0.1 < other.area / max(1.0, q.area) < 10)):
                matched = True
                break
        if not matched and imagery is not None and q.area > 200:
            r, g, b = interior_color(q, imagery, imagery_half)
            if (r - b) > 25 and (g - b) > 8:
                dropped += 1
                continue
        kept_buildings.append(building)
        kept_polygons.append(q)
    payload['buildings'] = kept_buildings
    gba_polygons_list = kept_polygons
    gba_tree = STRtree(gba_polygons_list) if site != 'wuxi' else None
    log(f'{site}: dropped {dropped} bare-field GBA footprints; '
        f'{len(kept_buildings)} GBA buildings kept')

    additions = []
    skipped = 0
    vegetation = 0
    for q, props in overture:
        if gba_tree is not None and any(
                containment(q, gba_polygons_list[j]) > 0.5 for j in gba_tree.query(q)):
            skipped += 1
            continue
        community_footprint = site == 'wuxi' and props.get('source') == 'OpenStreetMap'
        if (imagery is not None and q.area >= 600 and not community_footprint
                and vegetation_fraction(q, imagery, imagery_half) > 0.55):
            vegetation += 1
            continue
        additions.append((q, props))
    log(f'{site}: {len(additions)} Overture additions, {skipped} already '
        f'represented by GBA, {vegetation} rejected as vegetation/water')

    gba_points, gba_areas, gba_heights = [], [], []
    for building, q in zip(payload['buildings'], gba_polygons_list):
        gba_points.append((q.centroid.x, q.centroid.y))
        gba_areas.append(max(1.0, q.area))
        gba_heights.append(float(building['height']))
    gba_height_tree = STRtree(gba_polygons_list)
    global_median = float(np.median(gba_heights)) if gba_heights else 12.0
    max_height = float(meta.get('maxHeight') or 100.0)
    max_height = min(max_height, 300.0)

    buildings = list(payload['buildings'])
    used_ids = {b['id'] for b in buildings}
    for q, props in additions:
        height = None
        if props.get('height') is not None:
            try:
                height = float(props['height'])
            except (TypeError, ValueError):
                height = None
        height_source = 'Overture height'
        if height is None and props.get('num_floors') is not None:
            try:
                height = float(props['num_floors']) * 3.2
                height_source = 'Overture floor count'
            except (TypeError, ValueError):
                height = None
        if height is None:
            height_source = 'local GBA neighbourhood estimate'
            height = height_for_addition(
                q, gba_height_tree, gba_points, gba_areas, gba_heights,
                global_median, max_height)
        height = round(max(3.0, min(height, max_height)), 2)
        rings = [[[round(x, 2), 0.0, round(-y, 2)] for x, y in ring.coords]
                 for ring in [q.exterior, *q.interiors]]
        digest = hashlib.sha1(
            f'{Polygon(q.exterior).wkb_hex}|{props.get("id")}'.encode('ascii')).hexdigest()[:12]
        building_id = f'ov-{digest}'
        while building_id in used_ids:
            building_id += 'x'
        used_ids.add(building_id)
        buildings.append({
            'id': building_id,
            'sourceId': props.get('id'),
            'source': 'overture',
            'sourceDataset': props.get('source'),
            'name': 'Overture building',
            'height': height,
            'heightSource': height_source,
            'ground': 0.0,
            'foundation': 0.0,
            'foundationDepth': 0.0,
            'rings': rings,
        })

    if site == 'wuxi':
        buildings, stats = conflate_wuxi(buildings, core_id, MIN_AREA)
        meta['footprintConflation'] = stats
        stats['overtureInputSha256'] = hashlib.sha256(args.overture.read_bytes()).hexdigest()
        log(f'{site}: footprint conflation {stats}')
    payload['buildings'] = buildings
    heights = [float(b['height']) for b in buildings]
    meta['source'] = ('GlobalBuildingAtlas LoD1 + Overture Maps '
                      'East Asian Buildings')
    meta['license'] = ('GBA CC BY-NC 4.0; Overture East Asian Buildings '
                       'CC BY 4.0; OpenStreetMap ODbL')
    meta['attribution'] = (meta.get('attribution', '') +
                           '; East Asian Buildings (Shi et al., '
                           'doi:10.5281/zenodo.8174931); Overture Maps')
    meta['buildingCount'] = len(buildings)
    meta['blockCount'] = len(buildings)
    meta['minHeight'] = round(min(heights), 2)
    meta['maxHeight'] = round(max(heights), 2)
    meta['sourceCounts'] = {
        **dict(Counter(str(b.get('source') or 'unknown') for b in buildings)),
        'overture_added': sum(b.get('source') == 'overture' for b in buildings),
    }
    meta['filters'] = {
        **(meta.get('filters') or {}),
        'overtureMinAreaMeters2': MIN_AREA,
        **({'overtureContainmentDedupe': 0.5, 'overtureAddIfNoGbaOverlap': 0.5}
           if site != 'wuxi' else {}),
    }
    meta.setdefault('limitations', []).extend([
        'Overture additions are CC BY 4.0 footprints; heights without source '
        'data are transferred from nearby GBA buildings and are indicative.',
        'Overture and GBA captures may differ in date; recent demolitions or '
        'new construction can still differ from the basemap.',
    ])
    if 'glb' in meta:
        meta.pop('glb')
    if 'mesh' in meta:
        meta.pop('mesh')

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                        encoding='utf-8')
    log(f"{site}: wrote {len(buildings)} buildings to {out_path} "
        f"(Overture {meta['sourceCounts']['overture_added']})")


if __name__ == '__main__':
    main()
