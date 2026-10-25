"""Generic validation primitives carried from the original project."""

from pathlib import Path
from math import isfinite
import yaml

STATUSES = {"provided", "assumed", "missing", "calibrated"}

class ConfigError(ValueError):
    pass

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

def metric(value, unit, status, source, **extra):
    return {"value": value, "unit": unit, "status": status, "source": source, **extra}

def derived_status(*items):
    return "assumed" if any(i["status"] == "assumed" for i in items) else "derived"
