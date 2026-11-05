"""Synthetic software checks, not CRY8500 field accuracy validation."""
from copy import deepcopy
from dataclasses import replace
import importlib.util
import json
from math import log10
from pathlib import Path

import geopandas as gpd
import pytest
import yaml
from shapely.geometry import box, Polygon
from acoustic_model.shared import Building, BuildingScene, HeightMapping, load_buildings
from acoustic_model import (AcousticSensor, AcousticScene, SensorPosition, SoundSource,
                            NoiseComponent, AcousticConditions, load_device, load_environment,
                            sum_noise_db, ConfigError)

ROOT = Path(__file__).resolve().parents[1]
BAND = (500, 2000)


@pytest.fixture
def device():
    return load_device(ROOT / "config/acoustic_sensor.yaml")


@pytest.fixture
def env():
    return load_environment(ROOT / "config/acoustic_environment.yaml")


def run(device, env, *, distance=200, noise=40, buildings=(), conditions=None, target=None, scene=True):
    adapter = AcousticScene(BuildingScene(buildings), vertical_datum="synthetic local z") if scene else None
    return AcousticSensor(device, env, adapter).evaluate(
        SensorPosition((0, 0, 5)), target or SoundSource((0, distance, 5), 100, band_hz=BAND),
        conditions or AcousticConditions((NoiseComponent("background", noise, BAND),)))


def test_device_parameters_are_claims_and_missing_accuracy(device):
    assert device["parameters"]["nominal_range"]["value"] == [0.01, 500]
    assert device["parameters"]["frequency_range"]["value"] == [20, 20000]
    assert device["parameters"]["frequency_range"]["unit"] == "Hz"
    assert device["parameters"]["azimuth_error"]["status"] == "missing"
    assert device["reported_claims"]["microphone_count"]["value"] == 208
    demo = load_device(ROOT / "config/acoustic_sensor.yaml", assumed_angles=True)
    assert demo["parameters"]["azimuth_error"]["status"] == "assumed"


@pytest.mark.parametrize("field,change", [
    ("nominal_range", {"value": [500, 1]}),
    ("frequency_range", {"unit": "kHz"}),
    ("azimuth_error", {"value": 2}),
    ("nominal_range", {"value": [False, 500]}),
    ("sensitivity", {"value": float("nan"), "status": "provided"}),
])
def test_invalid_device_fields(device, env, field, change):
    device["parameters"][field].update(change)
    with pytest.raises(ConfigError):
        AcousticSensor(device, env)


@pytest.mark.parametrize("key,value", [("screening_loss", -1), ("neighborhood_radius", 0), ("snr_zero", 10)])
def test_invalid_environment(device, env, key, value):
    env["parameters"][key]["value"] = value
    with pytest.raises(ConfigError):
        AcousticSensor(device, env)


def test_distance_spreading_and_nominal_not_a_detection_gate(device, env):
    env["parameters"]["air_loss"]["value"] = 0
    near, far = run(device, env, distance=100), run(device, env, distance=200)
    assert near["estimated_received_level"]["value"] - far["estimated_received_level"]["value"] == pytest.approx(20*log10(2))
    beyond = run(device, env, distance=600)
    assert beyond["within_nominal_range"]["value"] is False
    assert beyond["estimated_received_level"]["value"] is not None
    assert beyond["detection_probability"]["value"] is None
    assert beyond["estimated_effective_range"]["value"] is None


def test_noise_sum_uses_energy_and_zero_db_is_not_silence():
    assert sum_noise_db([60, 60]) == pytest.approx(63.0102999566)
    assert sum_noise_db([0, 0]) == pytest.approx(3.0102999566)
    assert sum_noise_db([300, -300]) == pytest.approx(300)
    assert sum_noise_db([40, None]) is None
    assert sum_noise_db([]) is None


def test_more_noise_lowers_relative_quality(device, env):
    quiet, noisy = run(device, env), run(device, env, noise=60)
    assert noisy["estimated_received_level"] == quiet["estimated_received_level"]
    assert noisy["signal_noise_difference"]["value"] < quiet["signal_noise_difference"]["value"]
    assert noisy["relative_signal_quality"]["value"] < quiet["relative_signal_quality"]["value"]
    conditions = AcousticConditions(tuple(NoiseComponent(name, 60, BAND) for name in ("traffic", "construction", "speech")))
    mixed = run(device, env, conditions=conditions)
    assert mixed["noise"]["total_level"]["value"] == pytest.approx(60+10*log10(3))


def test_weather_noise_and_loss(device, env):
    clear = run(device, env)
    weather = run(device, env, conditions=AcousticConditions((NoiseComponent("background", 40, BAND),), wind_speed_m_s=5, rain_mm_h=10))
    assert weather["noise"]["total_level"]["value"] > clear["noise"]["total_level"]["value"]
    assert weather["estimated_received_level"]["value"] < clear["estimated_received_level"]["value"]
    assert {n["name"] for n in weather["noise"]["components"]} == {"background", "model_wind", "model_rain"}


def test_measured_weather_noise_can_disable_synthetic_double_counting(device, env):
    c = AcousticConditions((NoiseComponent("total_receiver_noise", 55, BAND),),
                           wind_speed_m_s=5, rain_mm_h=10, generate_weather_noise=False)
    result = run(device, env, conditions=c)
    assert result["noise"]["total_level"]["value"] == pytest.approx(55)
    assert len(result["noise"]["components"]) == 1
    assert result["losses"]["weather"]["value"] > 0


def test_screening_keeps_finite_signal_and_removal_restores(device, env):
    clear = run(device, env)
    blocked = run(device, env, buildings=[Building(box(-5, 80, 5, 100), 0, 20)])
    assert blocked["building_environment"]["direct_path"]["state"] == "blocked"
    assert blocked["estimated_received_level"]["value"] == pytest.approx(clear["estimated_received_level"]["value"]-12)
    assert 0 < blocked["relative_signal_quality"]["value"] < clear["relative_signal_quality"]["value"]
    assert run(device, env)["estimated_received_level"] == clear["estimated_received_level"]
    env["parameters"]["screening_loss"]["value"] = 6
    changed = run(device, env, buildings=[Building(box(-5, 80, 5, 100), 0, 20)])
    assert changed["estimated_received_level"]["value"] == pytest.approx(blocked["estimated_received_level"]["value"]+6)


def test_missing_height_does_not_fabricate_path_loss(device, env):
    unknown = Building(box(-5, 80, 5, 100), None, None, status="missing")
    result = run(device, env, buildings=[unknown])
    assert result["building_environment"]["direct_path"]["state"] == "unknown"
    assert result["building_environment"]["density"]["value"] > 0
    assert result["losses"]["screening"]["value"] is None
    assert result["relative_signal_quality"]["state"] == "insufficient_data"
    # Known blocker cannot hide another footprint with unknown vertical extent.
    mixed = run(device, env, buildings=[unknown, Building(box(-5, 120, 5, 130), 0, 20)])
    assert mixed["building_environment"]["direct_path"]["state"] == "blocked"
    assert mixed["losses"]["screening"]["value"] is None


def test_density_uses_union_and_corridor_proxy(device, env):
    device = load_device(ROOT / "config/acoustic_sensor.yaml", assumed_angles=True)
    walls = [Building(box(-30, -10, -5, 210), 0, 20), Building(box(5, -10, 30, 210), 0, 20)]
    corridor = run(device, env, buildings=walls)
    clear = run(device, env)
    assert corridor["building_environment"]["direct_path"]["state"] == "clear"
    assert corridor["building_environment"]["cross_section_free_width"]["value"] == pytest.approx(10)
    assert corridor["direction_uncertainty"]["azimuth_scale"]["value"] > clear["direction_uncertainty"]["azimuth_scale"]["value"]
    repeated = run(device, env, buildings=walls+walls)
    assert repeated["building_environment"]["density"]["value"] == pytest.approx(corridor["building_environment"]["density"]["value"])
    assert corridor["direction_uncertainty"]["range_error"]["value"] is None


def test_no_assumed_accuracy_without_opt_in(device, env):
    result = run(device, env)
    assert result["relative_signal_quality"]["state"] == "relative_only"
    assert result["direction_uncertainty"]["azimuth_scale"]["value"] is None
    assert result["direction_uncertainty"]["elevation_scale"]["value"] is None


def test_missing_source_noise_scene_and_coefficients(device, env):
    source = SoundSource((0, 200, 5), band_hz=BAND)
    assert run(device, env, target=source)["estimated_received_level"]["value"] is None
    assert run(device, env, conditions=AcousticConditions())["noise"]["total_level"]["value"] is None
    assert run(device, env, scene=False)["relative_signal_quality"]["value"] is None
    env["parameters"]["air_loss"].update(value=None, status="missing")
    assert run(device, env)["estimated_received_level"]["value"] is None


def test_band_and_weighting_must_match(device, env):
    with pytest.raises(ValueError, match="frequency band"):
        run(device, env, conditions=AcousticConditions((NoiseComponent("traffic", 50, (100, 200)),)))
    with pytest.raises(ValueError):
        NoiseComponent("traffic", 50, BAND, weighting="A")
    with pytest.raises(ValueError):
        SoundSource((0, 200, 5), 100, band_hz=(2000, 500))


def test_frequency_array_and_working_temperature(device, env):
    out = run(device, env, target=SoundSource((0, 200, 5), 100, band_hz=(25000, 30000)),
              conditions=AcousticConditions((NoiseComponent("background", 40, (25000, 30000)),)))
    assert out["frequency_supported"]["value"] is False
    assert out["relative_signal_quality"]["state"] == "outside_device_conditions"
    device["parameters"]["array_diameter"]["value"] = 0.3
    assert run(device, env)["frequency_supported"]["value"] is None
    device["parameters"]["temperature_range"].update(value=[-10, 40], status="assumed")
    out = run(device, env, conditions=AcousticConditions((NoiseComponent("background", 40, BAND),), temperature_c=45))
    assert out["temperature_supported"]["value"] is False


def test_near_field_and_unsupported_distance_are_not_extrapolated(device, env):
    for distance in (0.1, 6000):
        result = run(device, env, distance=distance)
        assert result["relative_signal_quality"]["state"] == "outside_model_scope"
        assert result["estimated_received_level"]["value"] is None


@pytest.mark.parametrize("position", [(0, 0, float("nan")), (0, 0, float("inf")), (0, 0)])
def test_invalid_coordinates(position):
    with pytest.raises(ValueError):
        SensorPosition(position)


def test_frame_datum_invalid_geometry_and_duplicate_noise(device, env):
    for frame in ("EPSG:4326", "EPSG:3857", "unknown_crs"):
        with pytest.raises(ValueError):
            SensorPosition((0, 0, 5), frame=frame)
    with pytest.raises(ValueError):
        run(device, env, target=SoundSource((0, 200, 5), vertical_datum="other"))
    with pytest.raises(ValueError):
        run(device, env, target=SoundSource((0, 0, 5)))
    with pytest.raises(ValueError):
        Building(Polygon([(0, 0), (1, 1), (1, 0), (0, 1)]), 0, 20)
    with pytest.raises(ValueError):
        AcousticConditions((NoiseComponent("same", 40, BAND), NoiseComponent("same", 50, BAND)))


def test_shared_shapefile_loader_without_height_and_with_declared_height(tmp_path, device, env):
    path = tmp_path / "buildings.shp"
    gpd.GeoDataFrame({"high": [20.]}, geometry=[box(12650000, 4138000, 12650010, 4138010)], crs=3857).to_file(path)
    shared = load_buildings(path)
    point = shared.buildings[0].footprint.representative_point()
    sensor = SensorPosition((point.x, point.y-100, 5), frame=shared.frame, vertical_datum="synthetic z")
    target = SoundSource((point.x, point.y+100, 5), 100, band_hz=BAND, frame=shared.frame, vertical_datum="synthetic z")
    conditions = AcousticConditions((NoiseComponent("background", 40, BAND),))
    r = AcousticSensor(device, env, AcousticScene(shared, vertical_datum="synthetic z")).evaluate(sensor, target, conditions)
    assert shared.frame == "EPSG:32649"
    assert r["building_environment"]["direct_path"]["state"] == "unknown"
    mapping = HeightMapping("high", 0, "synthetic test mapping", vertical_datum="synthetic z")
    declared = load_buildings(path, height_mapping=mapping)
    r = AcousticSensor(device, env, AcousticScene(declared, vertical_datum="synthetic z")).evaluate(sensor, target, conditions)
    assert r["building_environment"]["direct_path"]["state"] == "blocked"
    assert r["estimated_received_level"]["value"] is not None
    with pytest.raises(ValueError):
        AcousticScene(declared, vertical_datum="wrong datum")
    path.with_suffix(".prj").unlink()
    with pytest.raises(ValueError, match="CRS"):
        load_buildings(path)


def test_json_snapshot_and_configuration_reload(tmp_path, device, env):
    result = run(device, env)
    json.dumps(result, allow_nan=False)
    assert result["distance"]["unit"] == "m"
    assert result["relative_signal_quality"]["probability"] is False
    changed = deepcopy(env)
    changed["parameters"]["air_loss"]["value"] = 0.1
    path = tmp_path / "environment.yaml"
    path.write_text(yaml.safe_dump(changed), encoding="utf-8")
    updated = run(device, load_environment(path))
    assert updated["estimated_received_level"]["value"] < result["estimated_received_level"]["value"]
    model = AcousticSensor(device, env)
    device["device"] = "mutated"
    assert model.device["device"] != "mutated"


def test_demo_runs_and_writes_actual_json(tmp_path):
    spec = importlib.util.spec_from_file_location("acoustic_demo", ROOT / "examples/run_acoustic_demo.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    path = tmp_path / "demo.json"
    result = runner.main(["--output", str(path), "--assumed-angles"])
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert len(saved["scenarios"]) == 9
    assert saved["official_buildings_file"] is None
    assert saved["scenarios"][0]["result"]["direction_uncertainty"]["azimuth_scale"]["value"] is not None
    assert saved["scenarios"][7]["result"]["relative_signal_quality"]["value"] is None
