import importlib.util
import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import box
import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("run_optical_case", ROOT / "examples/run_optical_case.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def test_case_uses_selected_config_and_serializes_result(tmp_path):
    original = ROOT / "config/environment.yaml"
    changed = yaml.safe_load(original.read_text(encoding="utf-8"))
    changed["channels"]["visible"]["illumination_reference"]["value"] = 10000
    changed_path = tmp_path / "environment.yaml"
    changed_path.write_text(yaml.safe_dump(changed, allow_unicode=True), encoding="utf-8")
    output = tmp_path / "result.json"
    payload = runner.main(["--assumed-optics", "--environment-config", str(changed_path),
                           "--output", str(output)])
    saved = json.loads(output.read_text(encoding="utf-8"))
    assert saved == payload
    assert saved["result"]["line_of_sight"]["state"] == "clear"
    assert saved["result"]["channels"]["visible"]["relative_recognition_index"]["value"] < 0.8
    assert saved["result"]["channels"]["thermal"]["relative_recognition_index"]["value"] == pytest.approx(0.7)
    assert saved["result"]["configuration"]["environment"]["channels"]["visible"]["illumination_reference"]["value"] == 10000
    assert saved["environment_config_file"] == str(changed_path.resolve())


def test_case_uses_modified_device_optics(tmp_path):
    original = ROOT / "config/optical_nvt951.yaml"
    changed = yaml.safe_load(original.read_text(encoding="utf-8"))
    changed["demo_overrides"]["visible"]["sensor_size"]["value"] = [3.2, 1.8]
    device_path = tmp_path / "device.yaml"
    device_path.write_text(yaml.safe_dump(changed, allow_unicode=True), encoding="utf-8")
    output = tmp_path / "device_result.json"
    result = runner.main(["--assumed-optics", "--device-config", str(device_path),
                          "--output", str(output)])
    visible = result["result"]["channels"]["visible"]
    assert visible["fov"]["value"][0] < 7.3239
    assert result["result"]["configuration"]["device"]["channels"]["visible"]["sensor_size"]["value"] == [3.2, 1.8]
    assert result["device_config_file"] == str(device_path.resolve())


def test_missing_scene_and_shapefile_height_are_explicit(tmp_path):
    case = json.loads((ROOT / "examples/optical_case.example.json").read_text(encoding="utf-8"))
    case["scene"] = {"kind": "none"}
    case_path = tmp_path / "case.json"
    case_path.write_text(json.dumps(case), encoding="utf-8")
    result = runner.main(["--case", str(case_path), "--output", str(tmp_path / "none.json")])
    assert result["result"]["line_of_sight"]["state"] == "unknown"
    assert result["result"]["channels"]["visible"]["fov"]["value"] is None
    assert result["result"]["channels"]["visible"]["recognition_probability"]["value"] is None

    shp = tmp_path / "building.shp"
    gpd.GeoDataFrame({"high": [20.0]}, geometry=[box(12650000, 4138000, 12650010, 4138010)], crs=3857).to_file(shp)
    building = gpd.read_file(shp).to_crs(32649).geometry.iloc[0].representative_point()
    case["pose"]["position"] = [building.x, building.y - 10, 5]
    case["pose"]["frame"] = "EPSG:32649"
    case["target"]["position"] = [building.x, building.y + 10, 5]
    case["target"]["frame"] = "EPSG:32649"
    case["scene"] = {"kind": "shapefile", "path": "building.shp"}
    case_path.write_text(json.dumps(case), encoding="utf-8")
    result = runner.main(["--case", str(case_path), "--output", str(tmp_path / "shp.json")])
    assert result["scene_audit"]["count"] == 1
    assert result["scene_audit"]["missing_vertical_extent"] == 1
    assert result["result"]["line_of_sight"]["state"] == "unknown"


def test_case_rejects_missing_shapefile_path(tmp_path):
    case = json.loads((ROOT / "examples/optical_case.example.json").read_text(encoding="utf-8"))
    case["scene"] = {"kind": "shapefile"}
    path = tmp_path / "bad_case.json"
    path.write_text(json.dumps(case), encoding="utf-8")
    with pytest.raises(ValueError, match="scene.path"):
        runner.load_case(path)
