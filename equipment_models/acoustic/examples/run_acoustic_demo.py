"""Configurable acoustic scenarios; run from any cwd with explicit paths."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from shapely.geometry import box
from acoustic_model.shared import Building, BuildingScene, load_buildings
from acoustic_model.shared.config import read_yaml
from acoustic_model import (AcousticSensor, AcousticScene, SensorPosition, SoundSource,
                            AcousticConditions, NoiseComponent, load_device, load_environment)


def synthetic_scene(kind):
    if kind == "none":
        return None
    if kind == "empty":
        buildings = []
    elif kind == "blocked":
        buildings = [Building(box(-5, 80, 5, 100), 0, 20, "synthetic_screen")]
    elif kind == "unknown_height":
        buildings = [Building(box(-5, 80, 5, 100), None, None, "unknown_screen", "missing", "synthetic missing height fixture")]
    elif kind == "corridor":
        buildings = [Building(box(-30, -10, -5, 210), 0, 20, "left"),
                     Building(box(5, -10, 30, 210), 0, 20, "right")]
    else:
        raise ValueError("scene must be empty, blocked, unknown_height, corridor or none")
    return AcousticScene(BuildingScene(buildings), vertical_datum="synthetic local z")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "config/acoustic_sensor.yaml")
    parser.add_argument("--environment", type=Path, default=ROOT / "config/acoustic_environment.yaml")
    parser.add_argument("--scenarios", type=Path, default=ROOT / "config/acoustic_demo.yaml")
    parser.add_argument("--assumed-angles", action="store_true", help="explicitly use example angular scales, not device accuracy")
    parser.add_argument("--buildings", type=Path, help="optional Shapefile, height semantics remain unknown")
    parser.add_argument("--output", type=Path, default=ROOT / "outputs/acoustic_demo.json")
    args = parser.parse_args(argv)
    device = load_device(args.config, assumed_angles=args.assumed_angles)
    environment = load_environment(args.environment)
    scenarios = read_yaml(args.scenarios)
    rows = []
    for case in scenarios["scenarios"]:
        sensor = SensorPosition(**{**scenarios["sensor"], **case.get("sensor", {})})
        target = SoundSource(**{**scenarios["target"], **case.get("target", {})})
        raw = {**scenarios["conditions"], **case.get("conditions", {})}
        if raw.get("noise") is not None:
            raw["noise"] = tuple(NoiseComponent(**n) for n in raw["noise"])
        conditions = AcousticConditions(**raw)
        scene = synthetic_scene(case["scene"])
        result = AcousticSensor(device, environment, scene).evaluate(sensor, target, conditions)
        rows.append({"scenario": case["name"], "result": result})
    audit = None
    if args.buildings:
        shared_scene = load_buildings(args.buildings)
        audit = shared_scene.audit
        # Deliberately crosses first footprint; not a measured installation.
        p = shared_scene.buildings[0].footprint.representative_point()
        sensor = SensorPosition((p.x, p.y-100, 5), frame=shared_scene.frame,
                                vertical_datum="synthetic shared z on official footprints")
        target = SoundSource((p.x, p.y+100, 5), 100, band_hz=(500, 2000), frame=shared_scene.frame,
                             vertical_datum=sensor.vertical_datum,
                             source="synthetic ray through official footprint; source SPL is assumed")
        conditions = AcousticConditions((NoiseComponent("background", 40, (500, 2000)),))
        model = AcousticSensor(device, environment, AcousticScene(shared_scene, vertical_datum=sensor.vertical_datum))
        rows.append({"scenario": "official_footprints_unknown_height", "result": model.evaluate(sensor, target, conditions)})
    payload = {
        "warning": "合成声源/噪声/假设环境系数；未标定，不是实测探测概率、定位精度或声场仿真",
        "assumed_angles_enabled": args.assumed_angles,
        "configuration_files": {"device": str(args.config.resolve()), "environment": str(args.environment.resolve()), "scenarios": str(args.scenarios.resolve())},
        "official_buildings_file": str(args.buildings.resolve()) if args.buildings else None,
        "scene_audit": audit, "scenarios": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    from acoustic_model.report import write_report
    report_path = args.output.with_name(args.output.stem + "_report.html")
    write_report(payload, report_path, "acoustic", str(args.output.resolve()))
    print(f"中文报告已生成：{report_path}")
    print(f"Saved {len(rows)} scenarios: {args.output}")
    for row in rows:
        r = row["result"]
        print(row["scenario"], "direct_path="+r["building_environment"]["direct_path"]["state"],
              "SNR_dB="+str(r["signal_noise_difference"]["value"]),
              r["relative_signal_quality"]["state"])
    return payload


if __name__ == "__main__":
    main()
