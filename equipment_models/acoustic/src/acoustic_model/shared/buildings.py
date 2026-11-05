"""Prismatic building LOS; no implicit building height or ground elevation."""
from dataclasses import dataclass
from math import isfinite
from pathlib import Path
from typing import Protocol
import numpy as np
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree
from pyproj import CRS, Transformer
from .config import number

def xyz(point):
    if len(point) != 3:
        raise ValueError("coordinates must be three finite metres")
    return tuple(number(x, "coordinate") for x in point)

def metric_crs(crs):
    c = CRS.from_user_input(crs)
    if not c.is_projected or c.to_epsg() == 3857 or len(c.axis_info) < 2 or any(abs(a.unit_conversion_factor-1) > 1e-10 for a in c.axis_info[:2]):
        raise ValueError("scene CRS must be projected in metres; reproject Web Mercator first")
    return c

class EnvironmentAdapter(Protocol):
    """Task-one adapters must use the same horizontal frame and vertical datum."""
    frame: str
    def trace_los(self, sensor, target) -> dict: ...

@dataclass(frozen=True)
class Building:
    footprint: object
    base_m: float | None
    top_m: float | None
    identifier: str = "building"
    status: str = "assumed"
    source: str = "synthetic test building"

    def __post_init__(self):
        g = self.footprint
        if g is None or g.is_empty or g.geom_type not in {"Polygon", "MultiPolygon"} or not g.is_valid or not all(isfinite(x) for x in g.bounds):
            raise ValueError("building footprint must be a valid nonempty Polygon/MultiPolygon")
        if not self.source or self.status not in {"assumed", "provided", "calibrated", "missing"}:
            raise ValueError("building provenance required")
        if self.base_m is None or self.top_m is None:
            if self.base_m is not None or self.top_m is not None or self.status != "missing":
                raise ValueError("unknown vertical extent must have two nulls and missing status")
        elif number(self.top_m, "top") <= number(self.base_m, "base") or self.status == "missing":
            raise ValueError("building top must exceed base")

class BuildingScene:
    def __init__(self, buildings=(), *, frame="local_m", provenance="explicit synthetic scene", audit=None):
        if frame != "local_m":
            metric_crs(frame)
        self.frame = frame
        self.buildings = tuple(buildings)
        self.provenance = provenance
        self.audit = audit or {}
        self.tree = STRtree([b.footprint for b in self.buildings])

    def trace_los(self, sensor, target):
        s, t = np.array(xyz(sensor)), np.array(xyz(target))
        if np.linalg.norm(t-s) == 0:
            raise ValueError("sensor and target coincide")
        delta_xy = t[:2]-s[:2]
        length2 = float(delta_xy @ delta_xy)
        ray = LineString([s[:2], t[:2]]) if length2 > 0 else Point(s[:2])
        unknown, blocked, checked = [], [], []
        for idx in self.tree.query(ray, predicate="intersects"):
            b = self.buildings[int(idx)]
            checked.append({"id":b.identifier,"status":b.status,"source":b.source})
            if b.base_m is None:
                unknown.append(b.identifier)
                continue
            intersection = ray.intersection(b.footprint)
            parts = []
            def collect(g):
                if g.is_empty:
                    return
                if hasattr(g, "geoms"):
                    for part in g.geoms:
                        collect(part)
                else:
                    parts.append(g)
            collect(intersection)
            for part in parts:
                if length2 == 0:
                    lo, hi = 0., 1.
                else:
                    params = [float((np.array(p[:2])-s[:2]) @ delta_xy / length2) for p in part.coords]
                    lo, hi = max(0., min(params)), min(1., max(params))
                z1, z2 = s[2]+lo*(t[2]-s[2]), s[2]+hi*(t[2]-s[2])
                if min(z1,z2) <= b.top_m+1e-9 and max(z1,z2) >= b.base_m-1e-9:
                    blocked.append({"id":b.identifier,"status":b.status,"source":b.source,"segment_fraction":[lo,hi]})
                    break
        state = "blocked" if blocked else "unknown" if unknown else "clear"
        return {"state": state, "blocked": True if blocked else None if unknown else False,
                "unit":"boolean", "status":"missing" if state=="unknown" else "assumed" if any(b["status"]=="assumed" for b in checked) else "derived",
                "source":self.provenance, "blockers":blocked, "unknown_height_candidates":unknown,
                "checked_buildings":checked, "vertical_datum":self.audit.get("vertical_datum","scene caller-defined shared datum"),
                "scope":"opaque closed prisms only; touching boundaries blocks; no terrain/vegetation occlusion"}

@dataclass(frozen=True)
class HeightMapping:
    """Explicit declaration, never inferred from a field name.

    base is constant in a named shared vertical datum. Only relative metres
    are currently supported. For real terrain use a task-one adapter.
    """
    field: str
    base_m: float
    source: str
    status: str = "assumed"
    interpretation: str = "relative_height_m"
    vertical_datum: str = "assumed flat ground z=0"

    def __post_init__(self):
        number(self.base_m,"base_m")
        if self.interpretation != "relative_height_m" or self.status not in {"assumed","calibrated","provided"} or not self.source or not self.vertical_datum:
            raise ValueError("explicit relative-height metres, source and vertical datum required")

def load_buildings(path, *, target_crs=None, height_mapping=None):
    """Without a mapping footprints load but vertical intersections are unknown.

    Invalid geometry is rejected rather than silently repaired or discarded.
    """
    import geopandas as gpd
    gdf = gpd.read_file(Path(path))
    if gdf.empty or gdf.crs is None:
        raise ValueError("building data must be nonempty and have a CRS")
    invalid = int((gdf.geometry.isna() | gdf.geometry.is_empty | ~gdf.geometry.is_valid).sum())
    if invalid:
        raise ValueError(f"{invalid} invalid/empty geometries; explicit upstream repair required")
    if not gdf.geom_type.isin(["Polygon","MultiPolygon"]).all():
        raise ValueError("unsupported nonpolygon geometry")
    output_crs = metric_crs(target_crs or gdf.estimate_utm_crs())
    wgs_bounds = gdf.to_crs(4326).total_bounds.tolist()
    # Regional planar model: refuse extremely broad scenes.
    if wgs_bounds[2]-wgs_bounds[0] > 6 or wgs_bounds[3]-wgs_bounds[1] > 6:
        raise ValueError("scene too broad for this regional planar model")
    if output_crs.area_of_use:
        area = output_crs.area_of_use
        if not (area.west <= wgs_bounds[0] <= wgs_bounds[2] <= area.east and area.south <= wgs_bounds[1] <= wgs_bounds[3] <= area.north):
            raise ValueError("target CRS area of use does not cover scene")
    audit = {"count":len(gdf),"source_crs":gdf.crs.to_string(),"target_crs":output_crs.to_string(),
             "fields":{c:str(gdf[c].dtype) for c in gdf.columns if c != gdf.geometry.name},
             "geometry_types":gdf.geom_type.value_counts().to_dict(),"invalid_geometries":invalid,
             "source_bounds":gdf.total_bounds.tolist(),"wgs84_bounds":wgs_bounds,
             "height_mapping":vars(height_mapping) if height_mapping else None}
    if height_mapping and height_mapping.field not in gdf:
        raise ValueError(f"height field {height_mapping.field} absent")
    projected = gdf.to_crs(output_crs)
    records = []
    missing_heights = 0
    for i, row in projected.iterrows():
        base = top = None
        status, source = "missing", "no verified height semantics / base elevation"
        if height_mapping:
            h = row[height_mapping.field]
            if h is not None and not np.isnan(float(h)):
                height = number(float(h), "building height")
                if height <= 0:
                    raise ValueError("nonpositive building height")
                base, top = height_mapping.base_m, height_mapping.base_m+height
                status, source = height_mapping.status, height_mapping.source
        if base is None:
            missing_heights += 1
        records.append(Building(row.geometry,base,top,str(i),status,source))
    audit["missing_vertical_extent"] = missing_heights
    audit["vertical_datum"] = height_mapping.vertical_datum if height_mapping else "unknown"
    return BuildingScene(records,frame=output_crs.to_string(),provenance=str(Path(path)),audit=audit)

def transform_xy(x, y, source_crs, target_crs):
    """Transforms horizontal axes only; never transforms an unknown vertical datum."""
    number(x,"x"); number(y,"y")
    out = Transformer.from_crs(source_crs,target_crs,always_xy=True).transform(x,y,errcheck=True)
    if not all(isfinite(v) for v in out):
        raise ValueError("coordinate transform failed")
    return tuple(out)
