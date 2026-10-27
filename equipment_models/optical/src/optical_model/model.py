from dataclasses import dataclass, asdict
from copy import deepcopy
from math import atan, degrees, radians, sin, cos, atan2, exp, tan, isfinite
import numpy as np
from .config import number, metric, derived_status, validate_device, validate_environment
from .buildings import xyz, EnvironmentAdapter

@dataclass(frozen=True)
class Pose:
    position: tuple[float,float,float]
    yaw_deg: float = 0.0
    pitch_deg: float = 0.0
    roll_deg: float = 0.0
    frame: str = "local_m"
    def __post_init__(self):
        xyz(self.position)
        for key in ["yaw_deg","pitch_deg","roll_deg"]:
            number(getattr(self,key),key)
        if not 0 <= self.yaw_deg <= 360 or not -90 <= self.pitch_deg <= 90:
            raise ValueError("yaw in [0,360], pitch in [-90,90] required")

@dataclass(frozen=True)
class Target:
    position: tuple[float,float,float]
    width_m: float | None = None
    height_m: float | None = None
    frame: str = "local_m"
    source: str = "caller supplied; not a measured equipment parameter"
    status: str = "assumed"
    def __post_init__(self):
        xyz(self.position)
        if self.status not in {"assumed","provided","calibrated"} or not self.source:
            raise ValueError("target provenance required")
        for name in ["width_m","height_m"]:
            v = getattr(self,name)
            if v is not None and number(v,name) <= 0:
                raise ValueError("target dimensions must be positive")

@dataclass(frozen=True)
class Conditions:
    period: str = "day"
    illuminance_lux: float | None = None
    visibility_m: float | None = None
    rain_mm_h: float = 0.0
    visible_contrast: float | None = None
    thermal_contrast: float | None = None
    temperature_c: float | None = None
    source: str = "caller supplied scenario conditions"
    status: str = "assumed"
    def __post_init__(self):
        if self.period not in {"day","night","twilight"} or self.status not in {"assumed","provided","calibrated"} or not self.source:
            raise ValueError("invalid period/provenance")
        for name in ["illuminance_lux","visibility_m","rain_mm_h","visible_contrast","thermal_contrast","temperature_c"]:
            value = getattr(self,name)
            if value is not None:
                number(value,name)
        if self.illuminance_lux is not None and self.illuminance_lux < 0 or self.rain_mm_h < 0:
            raise ValueError("negative illuminance/rain")
        if self.visibility_m is not None and self.visibility_m <= 0:
            raise ValueError("visibility must be positive; null means no fog term")
        for v in [self.visible_contrast,self.thermal_contrast]:
            if v is not None and not 0 <= v <= 1:
                raise ValueError("normalized contrast must be in [0,1]")

def camera_components(pose, target):
    delta = np.array(target)-np.array(pose.position)
    yaw, pitch, roll = map(radians,[pose.yaw_deg,pose.pitch_deg,pose.roll_deg])
    forward = np.array([sin(yaw)*cos(pitch),cos(yaw)*cos(pitch),sin(pitch)])
    right = np.array([cos(yaw),-sin(yaw),0])
    up = np.cross(right,forward)
    rotated_right = cos(roll)*right+sin(roll)*up
    rotated_up = -sin(roll)*right+cos(roll)*up
    return float(delta @ rotated_right),float(delta @ rotated_up),float(delta @ forward)

def field_of_view(channel, focal_mm=None):
    low, high = channel["focal_range"]["value"]
    f = low if focal_mm is None else number(focal_mm,"focal_mm")
    if not low <= f <= high:
        raise ValueError(f"focal length must be in [{low}, {high}] mm")
    size, direct = channel["sensor_size"],channel["direct_fov"]
    if size["value"] is not None:
        angles = [degrees(2*atan(v/(2*f))) for v in size["value"]]
        return metric(angles,"deg",derived_status(size,channel["focal_range"]),[size,channel["focal_range"]],method="pinhole",focal_mm=f)
    if direct["value"] is not None:
        return metric(list(direct["value"]),"deg",derived_status(direct),[direct],method="configured fixed FOV; independent of focal input",focal_mm=f)
    return metric(None,"deg","missing",[size,direct],method="unavailable",focal_mm=f,reason="sensor physical dimensions and direct FOV both absent")

class OpticalEquipment:
    def __init__(self, device, environment, scene: EnvironmentAdapter | None = None):
        self.device = deepcopy(validate_device(device))
        self.environment = deepcopy(validate_environment(environment))
        self.scene = scene

    def evaluate(self, pose: Pose, target: Target, conditions: Conditions, *, focal_mm=None):
        if pose.frame != target.frame or self.scene is not None and pose.frame != self.scene.frame:
            raise ValueError("sensor, target and environment coordinate frames must match")
        d = float(np.linalg.norm(np.array(target.position)-np.array(pose.position)))
        if not isfinite(d) or d <= 0:
            raise ValueError("sensor and target coincide or exceed supported finite regional coordinates")
        yaw_range = self.device["mechanical"]["yaw_range"]["value"]
        pitch_range = self.device["mechanical"]["pitch_range"]["value"]
        mechanical_ok = yaw_range[0] <= pose.yaw_deg <= yaw_range[1] and pitch_range[0] <= pose.pitch_deg <= pitch_range[1]
        los = self.scene.trace_los(pose.position,target.position) if self.scene is not None else {"state":"unknown","blocked":None,"unit":"boolean","status":"missing","source":"no environment adapter","reason":"building environment not loaded"}
        if los.get("state") not in {"clear","blocked","unknown"}:
            raise ValueError("environment adapter returned invalid LOS state")
        temp_range = self.device["mechanical"]["temperature_range"]["value"]
        operable = None if conditions.temperature_c is None else temp_range[0] <= conditions.temperature_c <= temp_range[1]
        result = {"device":self.device["device"],"coordinate_frame":pose.frame,
                  "distance":metric(d,"m","derived","Euclidean in shared regional metric frame"),
                  "inputs":{"pose":asdict(pose),"target":asdict(target),"conditions":asdict(conditions)},
                  "mechanical_orientation_valid":metric(mechanical_ok,"boolean","derived",self.device["mechanical"]),
                  "temperature_within_working_range":metric(operable,"boolean","missing" if operable is None else "derived",self.device["mechanical"]["temperature_range"]),
                  "line_of_sight":los,"channels":{},
                  "configuration":{"device":deepcopy(self.device),"environment":deepcopy(self.environment)},
                  "scope":"point target FOV, pinhole projected extent and relative uncalibrated quality; no recognition probability, no deployment optimization"}
        for name, ch in self.device["channels"].items():
            f = (focal_mm or {}).get(name)
            fov = field_of_view(ch,f)
            x,y,z = camera_components(pose,target.position)
            inside = None if fov["value"] is None else bool(z>0 and abs(degrees(atan2(x,z))) <= fov["value"][0]/2+1e-10 and abs(degrees(atan2(y,z))) <= fov["value"][1]/2+1e-10)
            coverage = metric(inside,"boolean",fov["status"],"rectangular camera frame point test",reason="target centre only")
            pixels = None
            if fov["value"] is not None and target.width_m is not None and target.height_m is not None and z>0:
                # Bounding extent assumed aligned to image axes and normal to optical axis.
                pixels = [n*v/(2*z*tan(radians(a/2))) for n,v,a in zip(ch["resolution"]["value"],[target.width_m,target.height_m],fov["value"])]
            projected = metric(pixels,"px","missing" if pixels is None else "assumed","pinhole apparent bounding size; assumes image-aligned front-facing target",reason="requires target dimensions, FOV and positive camera depth")
            threshold = ch["recognition_pixels"]["value"]
            criterion = None if pixels is None or threshold is None else min(pixels)>=threshold
            sampling = metric(criterion,"boolean","missing" if criterion is None else "assumed",ch["recognition_pixels"],reason="sampling criterion only; does not establish actual recognition")
            env = self._environment(name,ch,conditions,d)
            factors = env["quality_factors"]
            if inside is False or not mechanical_ok or los["state"]=="blocked" or operable is False:
                score, state = 0.0,"unavailable_view"
            elif inside is None or los["state"]=="unknown" or any(v["value"] is None for v in factors.values()):
                score,state = None,"insufficient_data"
            else:
                score = float(np.prod([v["value"] for v in factors.values()]))
                if threshold is not None and pixels is not None:
                    score *= min(1.,min(pixels)/threshold)
                state = "relative_only"
            result["channels"][name] = {"fov":fov,"target_in_fov":coverage,"projected_target_size":projected,
                "sampling_criterion_met":sampling,**env,
                "relative_recognition_index":metric(score,"1","uncalibrated","product of explicit example quality factors and optional sampling ratio",state=state,probability=False),
                "recognition_probability":metric(None,"1","missing","no labelled calibration data or validated classifier"),
                "effective_recognition_distance":metric(ch["effective_range"]["value"],"m",ch["effective_range"]["status"],ch["effective_range"]["source"],reason="configured reference only; no inferred range under current weather")}
        return result

    def _environment(self,name,ch,c,d):
        cfg = self.environment["channels"][name]
        rain = exp(-cfg["rain_coefficient"]["value"]*c.rain_mm_h*d/1000)
        fog = 1. if c.visibility_m is None else exp(-cfg["fog_coefficient"]["value"]*d/c.visibility_m)
        factors = {"fog":metric(fog,"1",derived_status(cfg["fog_coefficient"]),cfg["fog_coefficient"],interpretation="null visibility explicitly disables fog term"),
                   "rain":metric(rain,"1",derived_status(cfg["rain_coefficient"]),cfg["rain_coefficient"])}
        if name=="visible":
            ref = cfg["illumination_reference"]
            light = None if c.illuminance_lux is None else min(1.,c.illuminance_lux/ref["value"])**0.5
            minimum = ch["minimum_illuminance"]["value"]
            below = None if minimum is None or c.illuminance_lux is None else c.illuminance_lux<minimum
            if below:
                light=0.
            factors["illumination"] = metric(light,"1","missing" if light is None else derived_status(ref),ref)
            contrast = c.visible_contrast
        else:
            below=None
            contrast=c.thermal_contrast
        factors["contrast"] = metric(contrast,"1","missing" if contrast is None else c.status,c.source,interpretation="channel-specific normalized contrast; thermal uses thermal contrast, not visible illuminance")
        quality_values = [v["value"] for k,v in factors.items() if k != "contrast"]
        quality = None if any(v is None for v in quality_values) else float(np.prod(quality_values))
        degraded_contrast = None if contrast is None else contrast*fog*rain
        return {"quality_factors":factors,
                "relative_image_quality":metric(quality,"1","uncalibrated","example illumination (visible only) x fog x rain"),
                "relative_apparent_contrast":metric(degraded_contrast,"1","uncalibrated","input channel contrast x example fog x rain"),
                "below_minimum_illuminance":metric(below,"boolean","not_applicable" if name=="thermal" else "missing" if below is None else "derived",ch["minimum_illuminance"])}
