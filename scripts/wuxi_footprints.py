"""Conflate Wuxi LoD1 footprints without joining neighboring buildings."""

from collections import Counter

from shapely import STRtree, difference, make_valid, set_precision, union_all
from shapely.geometry import Polygon


GRID_METRES = 0.01


def polygon_parts(geometry):
    if geometry.geom_type == 'Polygon':
        if not geometry.is_empty:
            yield geometry
    elif geometry.geom_type in ('MultiPolygon', 'GeometryCollection'):
        for part in geometry.geoms:
            yield from polygon_parts(part)


def polygon_from_building(building):
    outer, *holes = [[(x, -z) for x, _, z in ring] for ring in building['rings']]
    return Polygon(outer, holes)


def _priority(building, core_id):
    if building['id'] == core_id:
        return 0
    if building['source'] == 'osm':
        return 1
    if building.get('sourceDataset') == 'OpenStreetMap':
        return 2
    return 3 if building['source'] == 'overture' else 4


def _rings(polygon, base_elevation):
    return [[[round(x, 2), base_elevation, round(-y, 2)] for x, y in ring.coords]
            for ring in [polygon.exterior, *polygon.interiors]]


def conflate_wuxi(buildings, core_id, min_area):
    # The supplied imagery shows many broad GBA ML outlines cover multiple
    # distinct roofs. Process identified OSM buildings and individual Overture
    # roofs first. A GBA ML outline is only a fallback where evidence is sparse.
    originals = [polygon_from_building(building) for building in buildings]
    polygons = [
        set_precision(p if p.is_valid else union_all(list(polygon_parts(make_valid(p)))), GRID_METRES)
        for p in originals
    ]
    ranks = [_priority(building, core_id) for building in buildings]
    order = sorted(range(len(buildings)), key=lambda i: (
        ranks[i], polygons[i].area, buildings[i]['id']))
    tree = STRtree(polygons)
    accepted_geometry = {}
    accepted_buildings = {}
    dropped, trimmed = Counter(), Counter()
    for i in order:
        building, footprint = buildings[i], polygons[i]
        source = building['source']
        conflicts = []
        for j in sorted(tree.query(footprint, predicate='intersects')):
            other = accepted_geometry.get(j)
            if other is None:
                continue
            area = footprint.intersection(other).area
            if area > 0:
                conflicts.append((other, area))

        duplicate_ratio = 0.25 if ranks[i] == 4 else 0.50
        # Substantial overlap indicates an alternate footprint. A broad GBA
        # outline that intrudes into several separate roofs is also redundant.
        duplicate = any(area >= 2 and area >= duplicate_ratio * min(footprint.area, other.area)
                        for other, area in conflicts)
        spans_roofs = ranks[i] == 4 and sum(area >= 8 for _, area in conflicts) >= 2
        if duplicate or spans_roofs:
            dropped[source] += 1
            continue

        result = footprint
        if conflicts:
            blocked = union_all([p for p, _ in conflicts], grid_size=GRID_METRES)
            result = difference(footprint, blocked, grid_size=GRID_METRES)
        parts = sorted((p for p in polygon_parts(result) if p.area >= min_area),
                       key=lambda p: (-p.area, p.bounds))
        if not parts:
            dropped[source] += 1
            continue
        accepted_geometry[i] = union_all(parts)
        if not conflicts and len(parts) == 1 and originals[i].is_valid and abs(parts[0].area - originals[i].area) < 1e-6:
            accepted_buildings[i] = [building]
            continue

        trimmed[source] += 1
        base = building['rings'][0][0][1]
        accepted_buildings[i] = [
            {**building, 'id': f"{building['id']}-part-{part_index+1}" if part_index else building['id'],
             'rings': _rings(part, base)}
            for part_index, part in enumerate(parts)
        ]

    return ([b for i in sorted(accepted_buildings) for b in accepted_buildings[i]], {
        'inputCount': len(buildings),
        'droppedBySource': dict(dropped),
        'trimmedBySource': dict(trimmed),
        'method': 'OSM and detailed Overture roofs before GBA ML outlines; reject alternate outlines and trim minor edge overlaps.',
    })
