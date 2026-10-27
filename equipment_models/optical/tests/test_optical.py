import json
from copy import deepcopy
from pathlib import Path
import math
import pytest
from shapely.geometry import box, Polygon, MultiPolygon
from optical_model import *
from optical_model.model import field_of_view
from optical_model.buildings import metric_crs, transform_xy

ROOT=Path(__file__).resolve().parents[1]

@pytest.fixture
def device():
    return load_device(ROOT/"config/optical_nvt951.yaml",assumed_optics=True)

@pytest.fixture
def env():
    return load_environment(ROOT/"config/environment.yaml")

def run(device,env,*,scene=None,pose=None,target=None,conditions=None,focal=None):
    return OpticalEquipment(device,env,scene if scene is not None else BuildingScene()).evaluate(
        pose or Pose((0,0,5)),target or Target((0,200,5),.35,.35),
        conditions or Conditions(illuminance_lux=1000,visible_contrast=.8,thermal_contrast=.7),focal_mm=focal)

def test_config_sources_units_and_types():
    d=load_device(ROOT/"config/optical_nvt951.yaml")
    assert d["channels"]["visible"]["resolution"]["value"]==[1920,1080]
    assert all(type(x) is int for x in d["channels"]["visible"]["resolution"]["value"])
    assert d["channels"]["visible"]["focal_range"]["unit"]=="mm"
    assert d["channels"]["thermal"]["focal_range"]["value"]==[75,75]
    assert d["channels"]["visible"]["sensor_size"]["status"]=="missing"

def test_focal_monotonic_and_known_formula(device):
    ch=device["channels"]["visible"]
    wide=field_of_view(ch,6.5); narrow=field_of_view(ch,312)
    assert wide["value"][0]>narrow["value"][0]
    assert wide["value"][0]==pytest.approx(math.degrees(2*math.atan(6.4/13)))
    assert wide["status"]=="assumed"
    with pytest.raises(ValueError): field_of_view(ch,400)
    with pytest.raises(ValueError): field_of_view(device["channels"]["thermal"],74)

def test_direct_fov_parameterization(device,env):
    ch=device["channels"]["visible"]
    ch["sensor_size"]={"value":None,"unit":"mm","status":"missing","source":"test"}
    ch["direct_fov"]={"value":[10,10],"unit":"deg","status":"assumed","source":"synthetic"}
    t=Target((20,100,5))
    assert run(device,env,target=t)["channels"]["visible"]["target_in_fov"]["value"] is False
    ch["direct_fov"]["value"]=[40,20]
    assert run(device,env,target=t)["channels"]["visible"]["target_in_fov"]["value"] is True
    assert field_of_view(ch,6.5)["value"]==field_of_view(ch,312)["value"]

@pytest.mark.parametrize("position,inside",[((0,100,5),True),((100,100,5),False),((0,-100,5),False),((0,100,105),False)])
def test_fov_in_out(device,env,position,inside):
    r=run(device,env,target=Target(position),focal={"visible":50})
    assert r["channels"]["visible"]["target_in_fov"]["value"] is inside

def test_yaw_pitch_roll_and_wrap(device,env):
    assert run(device,env,pose=Pose((0,0,5),90),target=Target((100,0,5)))["channels"]["visible"]["target_in_fov"]["value"]
    assert run(device,env,pose=Pose((0,0,5),360))["channels"]["visible"]["target_in_fov"]["value"]
    assert run(device,env,pose=Pose((0,0,5),0,90),target=Target((0,0,100)))["channels"]["visible"]["target_in_fov"]["value"]
    ch=device["channels"]["visible"]
    ch["direct_fov"]={"value":[40,10],"unit":"deg","status":"assumed","source":"test"}
    ch["sensor_size"]={"value":None,"unit":"mm","status":"missing","source":"test"}
    assert run(device,env,target=Target((20,100,5)))["channels"]["visible"]["target_in_fov"]["value"]
    assert not run(device,env,pose=Pose((0,0,5),roll_deg=90),target=Target((20,100,5)))["channels"]["visible"]["target_in_fov"]["value"]

def test_building_block_remove_and_above():
    b=Building(box(-5,80,5,100),0,20)
    s=BuildingScene([b])
    assert s.trace_los((0,0,5),(0,200,5))["state"]=="blocked"
    assert BuildingScene().trace_los((0,0,5),(0,200,5))["state"]=="clear"
    assert s.trace_los((0,0,30),(0,200,30))["state"]=="clear"
    assert s.trace_los((0,0,5),(0,200,100))["state"]=="clear"
    assert s.trace_los((0,0,5),(0,200,30))["state"]=="blocked"
    assert s.trace_los((0,90,-10),(0,90,30))["state"]=="blocked"
    assert s.trace_los((0,90,30),(0,90,40))["state"]=="clear"

def test_holes_multipart_and_touching():
    g=Polygon([(-10,50),(10,50),(10,100),(-10,100)],holes=[[(-5,55),(-5,95),(5,95),(5,55)]])
    s=BuildingScene([Building(g,0,20)])
    assert s.trace_los((0,60,5),(0,90,5))["state"]=="clear"
    assert s.trace_los((0,0,20),(0,200,20))["state"]=="blocked"
    s=BuildingScene([Building(MultiPolygon([box(-10,50,-5,60),box(-2,80,2,90)]),0,20)])
    assert s.trace_los((0,0,5),(0,200,5))["state"]=="blocked"

def test_unknown_heights_and_known_blocker():
    unknown=Building(box(-5,80,5,100),None,None,status="missing")
    s=BuildingScene([unknown])
    assert s.trace_los((0,0,5),(0,200,5))["state"]=="unknown"
    assert s.trace_los((50,0,5),(50,200,5))["state"]=="clear"
    s=BuildingScene([unknown,Building(box(-5,120,5,130),0,20)])
    assert s.trace_los((0,0,5),(0,200,5))["state"]=="blocked"

def test_day_night_weather_and_channel_difference(device,env):
    day=run(device,env)
    night=run(device,env,conditions=Conditions(period="night",illuminance_lux=1,visible_contrast=.8,thermal_contrast=.7))
    bad=run(device,env,conditions=Conditions(illuminance_lux=1000,visibility_m=500,rain_mm_h=10,visible_contrast=.8,thermal_contrast=.7))
    for n in ["visible","thermal"]:
        assert bad["channels"][n]["relative_recognition_index"]["value"]<day["channels"][n]["relative_recognition_index"]["value"]
    assert night["channels"]["visible"]["relative_recognition_index"]["value"]<day["channels"]["visible"]["relative_recognition_index"]["value"]
    assert night["channels"]["thermal"]["relative_recognition_index"]["value"]==day["channels"]["thermal"]["relative_recognition_index"]["value"]
    assert "illumination" not in night["channels"]["thermal"]["quality_factors"]
    assert day["channels"]["thermal"]["below_minimum_illuminance"]["status"]=="not_applicable"

def test_config_change_and_minimum_illuminance(device,env):
    c=Conditions(illuminance_lux=10,visibility_m=500,visible_contrast=.8,thermal_contrast=.7)
    old=run(device,env,conditions=c)
    env["channels"]["visible"]["fog_coefficient"]["value"]*=2
    new=run(device,env,conditions=c)
    assert new["channels"]["visible"]["quality_factors"]["fog"]["value"]<old["channels"]["visible"]["quality_factors"]["fog"]["value"]
    device["channels"]["visible"]["minimum_illuminance"]={"value":20,"unit":"lux","status":"assumed","source":"test"}
    r=run(device,env,conditions=c)
    assert r["channels"]["visible"]["relative_recognition_index"]["value"]==0
    assert r["channels"]["thermal"]["relative_recognition_index"]["value"]>0

def test_missing_parameters_no_false_precision(env):
    d=load_device(ROOT/"config/optical_nvt951.yaml")
    r=run(d,env)
    for ch in r["channels"].values():
        assert ch["fov"]["value"] is None
        assert ch["target_in_fov"]["value"] is None
        assert ch["relative_recognition_index"]["value"] is None
        assert ch["recognition_probability"]["value"] is None
        assert ch["effective_recognition_distance"]["value"] is None

def test_missing_conditions_and_missing_scene(device,env):
    r=run(device,env,conditions=Conditions())
    assert r["channels"]["visible"]["relative_recognition_index"]["value"] is None
    r=OpticalEquipment(device,env).evaluate(Pose((0,0,5)),Target((0,200,5)),Conditions(illuminance_lux=1000,visible_contrast=.8,thermal_contrast=.7))
    assert r["line_of_sight"]["state"]=="unknown"
    assert r["channels"]["thermal"]["relative_recognition_index"]["value"] is None

def test_json_and_blocked_score(device,env):
    r=run(device,env,scene=BuildingScene([Building(box(-5,80,5,100),0,20)]))
    json.dumps(r,allow_nan=False)
    assert all(c["relative_recognition_index"]["value"]==0 for c in r["channels"].values())

@pytest.mark.parametrize("key,value",[("sensor_size",[-1,2]),("resolution",[1920.5,1080]),("direct_fov",[180,20]),("focal_range",[100,50])])
def test_illegal_parameter(device,env,key,value):
    device["channels"]["visible"][key]["value"]=value
    device["channels"]["visible"][key]["status"]="assumed"
    with pytest.raises(ConfigError): OpticalEquipment(device,env)

def test_illegal_units_yaml_and_status(tmp_path,device,env):
    device["channels"]["visible"]["sensor_size"]["unit"]="m"
    with pytest.raises(ConfigError): OpticalEquipment(device,env)
    p=tmp_path/"bad.yaml"; p.write_text("schema_version: [",encoding="utf-8")
    with pytest.raises(ConfigError): load_device(p)
    env["channels"]["visible"]["rain_coefficient"]["value"]=-1
    with pytest.raises(ConfigError): OpticalEquipment(load_device(ROOT/"config/optical_nvt951.yaml"),env)

@pytest.mark.parametrize("position",[(0,0,float("nan")),(0,float("inf"),5),(0,5)])
def test_invalid_coordinates(position):
    with pytest.raises(ValueError): Pose(position)

def test_invalid_geometry():
    with pytest.raises(ValueError): Building(Polygon([(0,0),(1,1),(1,0),(0,1)]),0,20)
    with pytest.raises(ValueError): Building(box(0,0,1,1),20,0)
    with pytest.raises(ValueError): Building(box(0,0,1,1),None,None)

def test_frame_validation_and_operating_range(device,env):
    with pytest.raises(ValueError): run(device,env,target=Target((0,100,5),frame="EPSG:32650"))
    with pytest.raises(ValueError): run(device,env,target=Target((0,0,5)))
    with pytest.raises(ValueError): metric_crs(3857)
    with pytest.raises(ValueError): metric_crs(4326)
    x,y=transform_xy(113.6,34.8,4326,32649)
    assert math.isfinite(x) and math.isfinite(y)
    r=run(device,env,conditions=Conditions(illuminance_lux=1000,visible_contrast=.8,thermal_contrast=.7,temperature_c=61))
    assert r["temperature_within_working_range"]["value"] is False
    assert r["channels"]["visible"]["relative_recognition_index"]["value"]==0

@pytest.mark.parametrize("kwargs",[{"illuminance_lux":-1},{"visibility_m":0},{"rain_mm_h":-1},{"visible_contrast":2},{"thermal_contrast":float("nan")},{"period":"unknown"}])
def test_invalid_conditions(kwargs):
    with pytest.raises(ValueError): Conditions(**kwargs)

def test_shapefile_loader_explicit_height_and_reprojection(tmp_path):
    import geopandas as gpd
    path=tmp_path/"buildings.shp"
    gpd.GeoDataFrame({"high":[20.]},geometry=[box(12650000,4138000,12650010,4138010)],crs=3857).to_file(path)
    s=load_buildings(path)
    assert s.frame=="EPSG:32649"
    assert s.buildings[0].base_m is None
    p=s.buildings[0].footprint.representative_point()
    assert s.trace_los((p.x,p.y,5),(p.x,p.y,10))["state"]=="unknown"
    s=load_buildings(path,height_mapping=HeightMapping("high",0,"synthetic declared mapping"))
    assert s.trace_los((p.x,p.y,5),(p.x,p.y,10))["state"]=="blocked"
    with pytest.raises(ValueError): load_buildings(path,height_mapping=HeightMapping("absent",0,"test"))

def test_external_environment_adapter(device,env):
    class Adapter:
        frame="local_m"
        def trace_los(self,s,t):
            return {"state":"blocked","blocked":True,"unit":"boolean","status":"derived","source":"task one fixture"}
    r=run(device,env,scene=Adapter())
    assert r["channels"]["thermal"]["relative_recognition_index"]["value"]==0
