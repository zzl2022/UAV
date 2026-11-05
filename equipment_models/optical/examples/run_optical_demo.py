"""From project root: python examples/run_optical_demo.py --assumed-optics."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"src"))
from shapely.geometry import box
from optical_model import (load_device, load_environment, OpticalEquipment, Pose,
                           Target, Conditions, Building, BuildingScene, HeightMapping, load_buildings)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config",type=Path,default=ROOT/"config/optical_nvt951.yaml")
    p.add_argument("--environment",type=Path,default=ROOT/"config/environment.yaml")
    p.add_argument("--assumed-optics",action="store_true",help="explicitly enable synthetic sensor size / sampling thresholds")
    p.add_argument("--buildings",type=Path,help="official shp; without height declaration intersections remain unknown")
    p.add_argument("--assume-high-relative-m",action="store_true",help="explicitly assume high=relative height m, flat base=0; not verified official semantics")
    p.add_argument("--output",type=Path,default=ROOT/"outputs/optical_demo.json")
    args = p.parse_args()
    if args.assume_high_relative_m and not args.buildings:
        p.error("--assume-high-relative-m requires --buildings")
    device = load_device(args.config,assumed_optics=args.assumed_optics)
    environment = load_environment(args.environment)
    if args.buildings:
        mapping = HeightMapping("high",0,"user enabled example assumption high=relative metres, base=0") if args.assume_high_relative_m else None
        scene = load_buildings(args.buildings,height_mapping=mapping)
        # Cross the first footprint interior: geometric fixture in official horizontal frame.
        # z=5 and target dimensions remain synthetic, not a real installation proposal.
        b = scene.buildings[0].footprint
        point = b.representative_point()
        x, y = point.x, point.y
        pose = Pose((x,y-200,5),frame=scene.frame)
        target = Target((x,y+200,5),0.35,0.35,frame=scene.frame,source="synthetic target on line through first official footprint")
        scenes = [("official_footprints_synthetic_ray",scene)]
    else:
        pose = Pose((0,0,5))
        target = Target((0,200,5),0.35,0.35,source="synthetic example target, not measured UAV")
        wall = Building(box(-5,80,5,100),0,20,"synthetic_blocker")
        scenes = [("clear",BuildingScene()),("blocked",BuildingScene([wall]))]
    conditions = [
        ("day_clear",Conditions(illuminance_lux=1000,visible_contrast=.8,thermal_contrast=.7,temperature_c=20)),
        ("night_clear",Conditions(period="night",illuminance_lux=1,visible_contrast=.8,thermal_contrast=.7,temperature_c=20)),
        ("day_fog_rain",Conditions(illuminance_lux=1000,visibility_m=500,rain_mm_h=10,visible_contrast=.8,thermal_contrast=.7,temperature_c=20))]
    results = []
    for scene_name, scene in scenes:
        model = OpticalEquipment(device,environment,scene)
        for cond_name, cond in conditions:
            result = model.evaluate(pose,target,cond,focal_mm={"visible":50,"thermal":75})
            results.append({"scenario":scene_name+"/"+cond_name,"result":result})
    payload = {"warning":"合成场景/假设环境系数；结果不是识别概率、实测精度或部署方案",
               "assumed_optics_enabled":args.assumed_optics,"assumed_official_heights_enabled":args.assume_high_relative_m,
               "scene_audit":scenes[0][1].audit,"scenarios":results}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(payload,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf-8")
    from optical_model.report import write_report
    report_path = args.output.with_name(args.output.stem + "_report.html")
    write_report(payload, report_path, "optical", str(args.output.resolve()))
    print(f"中文报告已生成：{report_path}")
    print(f"Saved {len(results)} scenarios: {args.output}")
    for row in results:
        r=row["result"]
        print(row["scenario"],r["line_of_sight"]["state"],{n:c["relative_recognition_index"]["value"] for n,c in r["channels"].items()})

if __name__ == "__main__":
    main()
