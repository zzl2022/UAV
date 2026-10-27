"""Acoustic configuration; reuse bundled generic validation primitives."""
from copy import deepcopy
from acoustic_model.shared.config import ConfigError, parameter, read_yaml

DEVICE_FIELDS = {
    "nominal_range": ("m", True, True),
    "array_diameter": ("m", False, True),
    "frequency_range": ("Hz", True, True),
    "frequency_array_diameter": ("m", False, True),
    "azimuth_error": ("deg", False, True),
    "elevation_error": ("deg", False, True),
    "sensitivity": ("dBV/Pa", False, False),
    "self_noise": ("dB_SPL", False, False),
    "temperature_range": ("degC", True, False),
}
ENV_UNITS = {
    "distance_limits": "m", "neighborhood_radius": "m",
    "air_loss": "dB/m", "wind_loss": "dB/m/(m/s)",
    "rain_loss": "dB/m/(mm/h)", "wind_noise_reference": "dB_SPL",
    "rain_noise_reference": "dB_SPL", "screening_loss": "dB",
    "snr_zero": "dB", "snr_full": "dB", "noise_angle": "deg/dB",
    "multipath_angle": "deg", "screening_angle": "deg",
}


def validate_device(data):
    try:
        if data.get("schema_version") != 1 or not isinstance(data["device"], str) or not data["device"]:
            raise ConfigError("schema_version=1 and device name are required")
        for name, (unit, pair, positive) in DEVICE_FIELDS.items():
            item = data["parameters"][name]
            parameter(item, unit, name, pair=pair, ordered=pair, positive=positive, optional=True)
            if name in {"azimuth_error", "elevation_error"} and item["value"] is not None and item["value"] >= 89:
                raise ConfigError("angular scale must be less than 89 degrees")
    except (KeyError, TypeError, AttributeError) as exc:
        raise ConfigError(f"incomplete acoustic device: {exc}") from exc
    return data


def load_device(path, *, assumed_angles=False):
    data = read_yaml(path)
    if assumed_angles:
        try:
            overrides = data["demo_overrides"]
            if set(overrides) != {"azimuth_error", "elevation_error"}:
                raise ConfigError("only two angular demo overrides are supported")
            if any(item["status"] != "assumed" for item in overrides.values()):
                raise ConfigError("demo angles must be marked assumed")
            data["parameters"].update(deepcopy(overrides))
        except (KeyError, TypeError, AttributeError) as exc:
            raise ConfigError("invalid acoustic demo overrides") from exc
    return validate_device(data)


def validate_environment(data):
    try:
        if data.get("schema_version") != 1:
            raise ConfigError("schema_version must be 1")
        for key, unit in ENV_UNITS.items():
            item = data["parameters"][key]
            parameter(item, unit, key, pair=key == "distance_limits",
                      ordered=key == "distance_limits", optional=True,
                      positive=key in {"distance_limits", "neighborhood_radius"})
            if item["value"] is not None and key.endswith(("_loss", "_angle")) and item["value"] < 0:
                raise ConfigError(f"{key} must be nonnegative")
        low, high = [data["parameters"][key]["value"] for key in ("snr_zero", "snr_full")]
        if low is not None and high is not None and low >= high:
            raise ConfigError("snr_zero must be smaller than snr_full")
    except (KeyError, TypeError, AttributeError) as exc:
        raise ConfigError(f"incomplete acoustic environment: {exc}") from exc
    return data


def load_environment(path):
    return validate_environment(read_yaml(path))
