from copy import deepcopy
from pathlib import Path
from math import isfinite
import yaml

class ConfigError(ValueError):
    pass

STATUSES = {"provided", "assumed", "missing", "calibrated"}

def number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value):
        raise ConfigError(f"{name}: expected a finite number")
    return float(value)

def parameter(item, unit, name, *, pair=False, positive=False, optional=False, ordered=False, integer=False):
    if not isinstance(item, dict) or item.get("unit") != unit or item.get("status") not in STATUSES or not item.get("source"):
        raise ConfigError(f"{name}: expected value/unit={unit}/status/source")
    value = item.get("value")
    if value is None:
        if not optional or item["status"] != "missing":
            raise ConfigError(f"{name}: missing value must be explicitly missing")
        return
    if item["status"] == "missing":
        raise ConfigError(f"{name}: missing status cannot contain a value")
    if pair and (not isinstance(value, list) or len(value) != 2):
        raise ConfigError(f"{name}: expected two values")
    vals = value if pair else [value]
    for v in vals:
        x = number(v, name)
        if positive and x <= 0 or integer and x != int(x):
            raise ConfigError(f"{name}: invalid positive/integer value")
    if ordered and vals[0] > vals[1]:
        raise ConfigError(f"{name}: range reversed")

def read_yaml(path):
    try:
        value = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except (yaml.YAMLError, OSError) as exc:
        raise ConfigError(str(exc)) from exc
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise ConfigError("schema_version must be 1")
    return value

def validate_device(data):
    try:
        if not isinstance(data["device"], str) or not data["device"]:
            raise ConfigError("device is required")
        for key, unit in [("yaw_range", "deg"), ("pitch_range", "deg"), ("temperature_range", "degC")]:
            parameter(data["mechanical"][key], unit, key, pair=True, ordered=True)
        yaw = data["mechanical"]["yaw_range"]["value"]
        pitch = data["mechanical"]["pitch_range"]["value"]
        if not 0 <= yaw[0] <= yaw[1] <= 360 or not -90 <= pitch[0] <= pitch[1] <= 90:
            raise ConfigError("mechanical ranges outside supported conventions")
        if set(data["channels"]) != {"visible", "thermal"}:
            raise ConfigError("visible and thermal channels are required")
        for name, ch in data["channels"].items():
            parameter(ch["resolution"], "px", name+".resolution", pair=True, positive=True, integer=True)
            parameter(ch["focal_range"], "mm", name+".focal_range", pair=True, positive=True, ordered=True)
            for key, unit, pair in [("sensor_size", "mm", True), ("direct_fov", "deg", True), ("minimum_illuminance", "lux", False), ("recognition_pixels", "px", False), ("effective_range", "m", False)]:
                parameter(ch[key], unit, name+"."+key, pair=pair, positive=True, optional=True)
            if ch["direct_fov"]["value"] is not None and any(x >= 180 for x in ch["direct_fov"]["value"]):
                raise ConfigError("pinhole FOV must be below 180 degrees")
    except (KeyError, TypeError) as exc:
        raise ConfigError(f"incomplete device configuration: {exc}") from exc
    return data

def load_device(path, *, assumed_optics=False):
    data = read_yaml(path)
    if assumed_optics:
        try:
            for name, updates in data["demo_overrides"].items():
                data["channels"][name].update(deepcopy(updates))
        except (KeyError, TypeError, AttributeError) as exc:
            raise ConfigError("invalid demo_overrides") from exc
    return validate_device(data)

def validate_environment(data):
    try:
        for name in ["visible", "thermal"]:
            for key, unit in [("fog_coefficient", "1"), ("rain_coefficient", "h/mm/km")]:
                item = data["channels"][name][key]
                parameter(item, unit, name+"."+key)
                if item["value"] < 0:
                    raise ConfigError("attenuation coefficients must be nonnegative")
        parameter(data["channels"]["visible"]["illumination_reference"], "lux", "illumination_reference", positive=True)
    except (KeyError, TypeError) as exc:
        raise ConfigError(f"incomplete environment configuration: {exc}") from exc
    return data

def load_environment(path):
    return validate_environment(read_yaml(path))

def metric(value, unit, status, source, **extra):
    return {"value": value, "unit": unit, "status": status, "source": source, **extra}

def derived_status(*items):
    return "assumed" if any(i["status"] == "assumed" for i in items) else "derived"
