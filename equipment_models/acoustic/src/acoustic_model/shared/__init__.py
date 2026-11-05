"""Self-contained geometry/configuration helpers; no optical dependency."""
from .buildings import Building, BuildingScene, HeightMapping, load_buildings

__all__ = ["Building", "BuildingScene", "HeightMapping", "load_buildings"]
