"""Single-band, stationary, uncalibrated acoustic capability approximation."""
from copy import deepcopy
from dataclasses import asdict
from math import atan2, degrees, dist, hypot, isfinite, log10, radians, tan
from acoustic_model.shared.config import metric
from .config import validate_device, validate_environment
from .environment import AcousticEnvironmentAdapter, unknown_environment
from .inputs import SensorPosition, SoundSource, AcousticConditions
from .noise import sum_noise_db


def estimate(value, unit, source, **extra):
    if value is not None and not isfinite(value):
        raise ValueError("acoustic calculation exceeded supported finite numerical range")
    return metric(value, unit, "missing" if value is None else "uncalibrated", source, **extra)


class AcousticSensor:
    def __init__(self, device, environment, scene: AcousticEnvironmentAdapter | None = None):
        self.device = deepcopy(validate_device(device))
        self.environment = deepcopy(validate_environment(environment))
        self.scene = scene

    def evaluate(self, sensor: SensorPosition, target: SoundSource, conditions: AcousticConditions):
        if sensor.frame != target.frame or sensor.vertical_datum != target.vertical_datum:
            raise ValueError("sensor/source must share metric frame and vertical datum")
        if self.scene is not None and (self.scene.frame != sensor.frame or self.scene.vertical_datum != sensor.vertical_datum):
            raise ValueError("scene must share input frame and vertical datum")
        d = dist(sensor.position, target.position)
        if not isfinite(d) or d <= 0:
            raise ValueError("sensor/source must have positive finite separation")
        dev, cfg = self.device["parameters"], self.environment["parameters"]
        val = lambda key: cfg[key]["value"]
        nominal = dev["nominal_range"]["value"]
        frequency = dev["frequency_range"]["value"]
        array = dev["array_diameter"]["value"]
        array_for_frequency = dev["frequency_array_diameter"]["value"]
        same_array = None if array is None or array_for_frequency is None else array == array_for_frequency
        frequency_ok = None if frequency is None or target.band_hz is None or same_array is not True else (
            frequency[0] <= target.band_hz[0] < target.band_hz[1] <= frequency[1])
        temp = dev["temperature_range"]["value"]
        temperature_ok = None if temp is None or conditions.temperature_c is None else temp[0] <= conditions.temperature_c <= temp[1]
        limits = val("distance_limits")
        scope_ok = None if limits is None else limits[0] <= d <= limits[1] and d >= target.reference_distance_m
        geometry = (self.scene.describe_path(sensor.position, target.position, val("neighborhood_radius"))
                    if self.scene is not None and scope_ok is True else unknown_environment("scene absent or propagation distance outside model scope"))
        if geometry["direct_path"]["state"] not in {"clear", "blocked", "unknown"}:
            raise ValueError("invalid acoustic adapter direct_path state")

        # Acoustic SNR compares same-band source pressure and receiver noise.
        noise_rows = []
        if conditions.noise is not None:
            for n in conditions.noise:
                if target.band_hz is not None and tuple(n.band_hz) != tuple(target.band_hz):
                    raise ValueError("noise and target must use the same frequency band")
                noise_rows.append(asdict(n))
        weather_known = not conditions.generate_weather_noise or (conditions.wind_speed_m_s is not None and conditions.rain_mm_h is not None)
        for name, amount, reference, multiplier in (
            ("model_wind", conditions.wind_speed_m_s, "wind_noise_reference", 20),
            ("model_rain", conditions.rain_mm_h, "rain_noise_reference", 10),
        ):
            if conditions.generate_weather_noise and amount is not None and amount > 0:
                if any(n["name"] == name for n in noise_rows):
                    raise ValueError("reserved weather noise name")
                ref = val(reference)
                noise_rows.append({"name": name, "level_db": None if ref is None else ref + multiplier*log10(amount),
                                   "band_hz": target.band_hz, "weighting": "Z", "status": "assumed",
                                   "source": cfg[reference]})
        total_noise = None
        if conditions.noise is not None and weather_known and target.band_hz is not None:
            total_noise = sum_noise_db(n["level_db"] for n in noise_rows)

        spread = 20*log10(d/target.reference_distance_m) if scope_ok is True else None
        air = None if scope_ok is not True or val("air_loss") is None else val("air_loss")*(d-target.reference_distance_m)
        weather_terms = []
        for amount, key in ((conditions.wind_speed_m_s, "wind_loss"), (conditions.rain_mm_h, "rain_loss")):
            weather_terms.append(None if amount is None or amount > 0 and val(key) is None else 0.0 if amount == 0 else val(key)*amount*(d-target.reference_distance_m))
        weather_loss = None if scope_ok is not True or any(v is None for v in weather_terms) else sum(weather_terms)
        blocked = geometry["direct_path"]["state"] == "blocked"
        screening = None
        if geometry["height_complete_for_path"]:
            if geometry["direct_path"]["state"] == "clear":
                screening = 0.0
            elif blocked:
                screening = val("screening_loss")
        losses = [spread, air, weather_loss, screening]
        received = None
        if target.reference_level_db is not None and target.band_hz is not None and all(v is not None for v in losses):
            received = target.reference_level_db - sum(losses)
        snr = None if received is None or total_noise is None else received-total_noise
        index = None
        if scope_ok is False:
            state = "outside_model_scope"
        elif frequency_ok is False or temperature_ok is False:
            state = "outside_device_conditions"
        elif snr is None or frequency_ok is None or val("snr_zero") is None or val("snr_full") is None:
            state = "insufficient_data"
        else:
            index = max(0.0, min(1.0, (snr-val("snr_zero"))/(val("snr_full")-val("snr_zero"))))
            state = "relative_only"

        uncertainty = {}
        proxy = geometry["multipath_proxy"]["value"]
        for axis in ("azimuth", "elevation"):
            base = dev[axis+"_error"]["value"]
            scale = None
            coefficients = [val(k) for k in ("noise_angle", "multipath_angle", "screening_angle", "snr_full")]
            if state == "relative_only" and base is not None and proxy is not None and all(v is not None for v in coefficients):
                scale = base + val("noise_angle")*max(0.0, val("snr_full")-snr) + val("multipath_angle")*proxy + val("screening_angle")*int(blocked)
            usable_scale = scale if scale is not None and scale < 89 else None
            uncertainty[axis+"_scale"] = estimate(usable_scale, "deg", dev[axis+"_error"],
                reason="base + noise penalty + multipath proxy penalty + screening penalty; not RMSE, confidence interval or actual direction estimate",
                state="outside_small_angle_scope" if scale is not None and scale >= 89 else "missing" if scale is None else "relative_only")
            uncertainty[axis+"_transverse_scale"] = estimate(None if usable_scale is None else d*tan(radians(usable_scale)), "m",
                "range*tan(angular scale); illustrative displacement only, not position accuracy")
        uncertainty["range_error"] = metric(None, "m", "missing", "no time-of-flight, source-power calibration or ranging estimator")
        uncertainty["estimated_target_position"] = metric(None, "m", "missing", "known input coordinates are not an acoustic localization result")
        delta = [t-s for s, t in zip(sensor.position, target.position)]
        horizontal = hypot(delta[0], delta[1])
        bearing = None if horizontal == 0 else degrees(atan2(delta[0], delta[1])) % 360
        direction = {"azimuth": metric(bearing, "deg", "missing" if bearing is None else "derived", "known input geometry, grid north=0 clockwise"),
                     "elevation": metric(degrees(atan2(delta[2], horizontal)), "deg", "derived", "known input geometry, upward positive")}
        result = {
            "device": self.device["device"], "coordinate_frame": sensor.frame,
            "inputs": {"sensor": asdict(sensor), "target": asdict(target), "conditions": asdict(conditions)},
            "configuration": {"device": deepcopy(self.device), "environment": deepcopy(self.environment)},
            "distance": metric(d, "m", "assumed" if "assumed" in (sensor.status, target.status) else "derived", "Euclidean separation of supplied coordinates"),
            "geometric_direction": direction,
            "nominal_range": deepcopy(dev["nominal_range"]),
            "within_nominal_range": metric(None if nominal is None else nominal[0] <= d <= nominal[1], "boolean", "missing" if nominal is None else "derived", dev["nominal_range"], reason="comparison with a reference claim only; not detection verdict"),
            "frequency_supported": metric(frequency_ok, "boolean", "missing" if frequency_ok is None else "derived", [dev["frequency_range"], dev["array_diameter"], dev["frequency_array_diameter"]]),
            "temperature_supported": metric(temperature_ok, "boolean", "missing" if temperature_ok is None else "derived", dev["temperature_range"]),
            "within_model_distance_scope": metric(scope_ok, "boolean", "missing" if scope_ok is None else "derived", cfg["distance_limits"]),
            "building_environment": geometry,
            "noise": {"components": noise_rows,
                      "total_level": estimate(total_noise, "dB_SPL", "10*log10(sum(10**(Li/10))); uncorrelated receiver contributions; matching band/Z/20uPa/time interval required"),
                      "scope": "environmental pressure noise only; excludes unknown microphone/electronic self-noise; do not double count measured weather"},
            "losses": {"spreading": estimate(spread, "dB", "20*log10(d/reference_distance), point-source spherical spreading"),
                       "air": estimate(air, "dB", cfg["air_loss"]),
                       "weather": estimate(weather_loss, "dB", [cfg["wind_loss"], cfg["rain_loss"]]),
                       "screening": estimate(screening, "dB", cfg["screening_loss"], reason="aggregate screen/diffraction proxy, not ray-traced path loss")},
            "estimated_received_level": estimate(received, "dB_SPL", "reference source SPL minus explicit model losses; no measured signal"),
            "signal_noise_difference": estimate(snr, "dB", "estimated band signal SPL minus combined environmental noise; not detector SNR"),
            "relative_signal_quality": estimate(index, "1", "clipped linear normalization of signal_noise_difference", state=state, probability=False),
            "direction_uncertainty": uncertainty,
            "detection_probability": metric(None, "1", "missing", "no labelled detection calibration data"),
            "estimated_effective_range": metric(None, "m", "missing", "single link quality cannot infer a site-wide detection boundary"),
            "measured_detection_range": metric(None, "m", "missing", "no device field measurements"),
            "scope": "stationary single-band point-source approximation; unknown direct-path height stays unknown; blocked path can retain finite sound; no waveform, beamforming, refraction, coherent reflection, trajectory or deployment optimization",
        }
        return result
