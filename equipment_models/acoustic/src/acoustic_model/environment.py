"""Acoustic geometry descriptors, independent of optical FOV and irradiance."""
from math import hypot
from typing import Protocol
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
from acoustic_model.shared.buildings import BuildingScene, xyz
from acoustic_model.shared.config import metric, number


class AcousticEnvironmentAdapter(Protocol):
    frame: str
    vertical_datum: str

    def describe_path(self, sensor, target, radius_m) -> dict: ...


def unknown_environment(reason="no acoustic environment adapter"):
    return {
        "direct_path": {"state": "unknown", "blocked": None, "status": "missing", "source": reason},
        "density": metric(None, "1", "missing", reason),
        "cross_section_free_width": metric(None, "m", "missing", reason),
        "multipath_proxy": metric(None, "1", "missing", reason),
        "height_complete_for_path": False,
        "scope": "no building conclusion is available",
    }


class AcousticScene:
    """Wrap the existing GIS scene. Never treats blocked light as zero sound."""
    def __init__(self, scene: BuildingScene, *, vertical_datum: str):
        if not isinstance(scene, BuildingScene):
            raise ValueError("AcousticScene requires the shared BuildingScene")
        if not isinstance(vertical_datum, str) or not vertical_datum.strip():
            raise ValueError("vertical_datum label required")
        known = scene.audit.get("vertical_datum")
        if known not in {None, "unknown", vertical_datum}:
            raise ValueError("building vertical datum does not match acoustic scene")
        self.scene, self.frame, self.vertical_datum = scene, scene.frame, vertical_datum

    def describe_path(self, sensor, target, radius_m):
        s, t = xyz(sensor), xyz(target)
        direct = self.scene.trace_los(s, t)
        complete = direct["state"] != "unknown" and not direct.get("unknown_height_candidates")
        if radius_m is None:
            result = unknown_environment("missing neighborhood radius")
            result.update(direct_path=direct, height_complete_for_path=complete)
            return result
        if number(radius_m, "neighborhood radius") <= 0:
            raise ValueError("neighborhood radius must be positive")
        dx, dy = t[0] - s[0], t[1] - s[1]
        length = hypot(dx, dy)
        ray = LineString([s[:2], t[:2]]) if length > 0 else Point(s[:2])
        window = ray.buffer(radius_m)
        indexes = self.scene.tree.query(window, predicate="intersects")
        footprints = [self.scene.buildings[int(i)].footprint for i in indexes]
        union = unary_union(footprints)
        density = min(1.0, max(0.0, union.intersection(window).area / window.area))
        mx, my = (s[0]+t[0])/2, (s[1]+t[1])/2
        # Perpendicular cut at the path midpoint. Vertical paths use the east axis.
        ux, uy = (-dy/length, dx/length) if length else (1.0, 0.0)
        cut = LineString([(mx-radius_m*ux, my-radius_m*uy), (mx+radius_m*ux, my+radius_m*uy)])
        centre = Point(mx, my)
        width = 0.0
        if not union.intersects(centre):
            free = cut.difference(union)
            parts = list(free.geoms) if hasattr(free, "geoms") else [free]
            width = max((g.length for g in parts if g.distance(centre) < 1e-8), default=0.0)
        confinement = 1.0 - min(1.0, width / (2*radius_m))
        proxy = min(1.0, density*(1+confinement))
        status = "assumed" if self.frame == "local_m" or any(self.scene.buildings[int(i)].status == "assumed" for i in indexes) else "derived"
        return {
            "direct_path": direct,
            "height_complete_for_path": complete,
            "density": metric(density, "1", status, self.scene.provenance,
                              definition="union footprint area / buffered horizontal path area"),
            "cross_section_free_width": metric(width, "m", status, self.scene.provenance,
                              definition="free interval through midpoint on perpendicular cut; capped at 2*radius; not surveyed street width"),
            "multipath_proxy": metric(proxy, "1", "uncalibrated", "min(1,density*(1+confinement)); no actual reflected ray"),
            "candidate_count": len(indexes),
            "neighborhood_radius_m": radius_m,
            "scope": "loaded footprints only; 2D statistics ignore height/material; boundary clipping and missing buildings can bias them",
        }
