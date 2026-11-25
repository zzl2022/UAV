"""Scenario inputs. SPL is band-integrated, unweighted, referenced to 20 uPa."""
from dataclasses import dataclass
from pyproj.exceptions import CRSError
from acoustic_model.shared.buildings import xyz, metric_crs
from acoustic_model.shared.config import number


def provenance(status, source):
    if status not in {"provided", "assumed", "calibrated"} or not isinstance(source, str) or not source.strip():
        raise ValueError("explicit input status and source are required")


def band(value):
    if value is not None:
        if not isinstance(value, (tuple, list)) or len(value) != 2:
            raise ValueError("band_hz must contain two endpoints")
        low, high = [number(v, "frequency") for v in value]
        if not 0 < low < high:
            raise ValueError("band_hz must be positive and increasing")


def level(value):
    if value is not None and not -300 <= number(value, "level_db") <= 300:
        raise ValueError("level_db outside supported numerical interval [-300,300]")


def location(position, frame, vertical_datum):
    xyz(position)
    if frame != "local_m":
        try:
            metric_crs(frame)
        except CRSError as exc:
            raise ValueError("unknown or invalid metric coordinate frame") from exc
    if not isinstance(vertical_datum, str) or not vertical_datum.strip():
        raise ValueError("a shared vertical datum label is required")


@dataclass(frozen=True)
class SensorPosition:
    position: tuple[float, float, float]
    frame: str = "local_m"
    vertical_datum: str = "synthetic local z"
    status: str = "assumed"
    source: str = "synthetic sensor position"

    def __post_init__(self):
        location(self.position, self.frame, self.vertical_datum)
        provenance(self.status, self.source)


@dataclass(frozen=True)
class SoundSource:
    position: tuple[float, float, float]
    reference_level_db: float | None = None
    reference_distance_m: float = 1.0
    band_hz: tuple[float, float] | None = None
    weighting: str = "Z"
    frame: str = "local_m"
    vertical_datum: str = "synthetic local z"
    status: str = "assumed"
    source: str = "caller supplied source; no measured UAV signature"

    def __post_init__(self):
        location(self.position, self.frame, self.vertical_datum)
        provenance(self.status, self.source)
        level(self.reference_level_db)
        if number(self.reference_distance_m, "reference_distance_m") <= 0:
            raise ValueError("reference distance must be positive")
        band(self.band_hz)
        if self.weighting != "Z":
            raise ValueError("only unweighted Z band SPL is supported; no dBA conversion")


@dataclass(frozen=True)
class NoiseComponent:
    name: str
    level_db: float | None
    band_hz: tuple[float, float]
    weighting: str = "Z"
    status: str = "assumed"
    source: str = "synthetic receiver noise, not a source emission level"

    def __post_init__(self):
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("noise name is required")
        band(self.band_hz)
        if self.band_hz is None or self.weighting != "Z":
            raise ValueError("noise requires a known band and Z weighting")
        level(self.level_db)
        provenance(self.status, self.source)


@dataclass(frozen=True)
class AcousticConditions:
    noise: tuple[NoiseComponent, ...] | None = None
    wind_speed_m_s: float | None = 0.0
    rain_mm_h: float | None = 0.0
    temperature_c: float | None = None
    status: str = "assumed"
    source: str = "synthetic conditions; null noise means unknown background"
    generate_weather_noise: bool = True

    def __post_init__(self):
        provenance(self.status, self.source)
        if not isinstance(self.generate_weather_noise, bool):
            raise ValueError("generate_weather_noise must be boolean")
        for name in ("wind_speed_m_s", "rain_mm_h"):
            v = getattr(self, name)
            if v is not None and number(v, name) < 0:
                raise ValueError(f"{name} must be nonnegative")
        if self.temperature_c is not None:
            number(self.temperature_c, "temperature_c")
        if self.noise is not None:
            if not isinstance(self.noise, (tuple, list)) or any(not isinstance(n, NoiseComponent) for n in self.noise):
                raise ValueError("noise must be a sequence of NoiseComponent or null")
            names = [n.name for n in self.noise]
            if len(set(names)) != len(names):
                raise ValueError("noise component names must be unique")
