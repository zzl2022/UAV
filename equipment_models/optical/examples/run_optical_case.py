"""Run one editable optical scenario with the existing model API."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from optical_model import (BuildingScene, Conditions, OpticalEquipment, Pose,
                           Target, load_buildings, load_device, load_environment)


def load_case(path):
    case = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(case, dict):
        raise ValueError("case must be a JSON object")
    pose = Pose(**case["pose"])
    target = Target(**case["target"])
    conditions = Conditions(**case["conditions"])
    scene_spec = case.get("scene", {"kind": "none"})
    if not isinstance(scene_spec, dict):
        raise ValueError("scene must be an object")
    kind = scene_spec.get("kind")
    if kind == "none":
        scene = None
    elif kind == "synthetic_empty":
        scene = BuildingScene(provenance="explicit synthetic empty scene")
    elif kind == "shapefile":
        if not scene_spec.get("path"):
            raise ValueError("scene.path is required for shapefile")
        building_path = Path(scene_spec["path"])
        if not building_path.is_absolute():
            building_path = Path(path).resolve().parent / building_path
        scene = load_buildings(building_path)
    else:
        raise ValueError("scene.kind must be none, synthetic_empty or shapefile")
    focal = case.get("focal_mm")
    if focal is not None and (not isinstance(focal, dict) or set(focal) - {"visible", "thermal"}):
        raise ValueError("focal_mm must contain only visible/thermal values")
    return pose, target, conditions, focal, scene


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", type=Path, default=ROOT / "examples/optical_case.example.json")
    parser.add_argument("--device-config", type=Path, default=ROOT / "config/optical_nvt951.yaml")
    parser.add_argument("--environment-config", type=Path, default=ROOT / "config/environment.yaml")
    parser.add_argument("--assumed-optics", action="store_true", help="apply clearly marked demo_overrides")
    parser.add_argument("--output", type=Path, default=ROOT / "outputs/optical_case.json")
    args = parser.parse_args(argv)

    pose, target, conditions, focal, scene = load_case(args.case)
    device = load_device(args.device_config, assumed_optics=args.assumed_optics)
    environment = load_environment(args.environment_config)
    result = OpticalEquipment(device, environment, scene).evaluate(
        pose, target, conditions, focal_mm=focal)
    payload = {
        "case_file": str(args.case.resolve()),
        "device_config_file": str(args.device_config.resolve()),
        "environment_config_file": str(args.environment_config.resolve()),
        "assumed_optics_enabled": args.assumed_optics,
        "scene_audit": scene.audit if scene is not None else None,
        "result": result,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(f"Saved: {args.output}")
    print(f"LOS: {result['line_of_sight']['state']}")
    for name, channel in result["channels"].items():
        index = channel["relative_recognition_index"]
        print(f"{name}: FOV={channel['fov']['value']} deg; relative index={index['value']} ({index['state']})")
    return payload


if __name__ == "__main__":
    main()
