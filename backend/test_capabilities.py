import copy
import hashlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import threading
import pytest
from backend.capabilities import CapabilityService, VERSION, to_enu
from backend.server import make_handler

@pytest.fixture
def service():
    return CapabilityService()

@pytest.fixture
def scenario(service):
    return {'version':VERSION,'mode':'dataset_only','origin':service.metadata['origin'],
            'scene_hash':service.scene_hash,
            'devices':[{'id':'o','type':'optical','position':[0,5,0],'focal_mm':50,'heading_deg':0,'pitch_deg':0},
                       {'id':'a','type':'acoustic','position':[0,5,0],'array_diameter_m':1.1}],
            'target':{'position':[0,5,-200],'band_hz':[500,2000],'width_m':.35,'height_m':.35}}

def test_axis_mapping_and_distance(service,scenario):
    assert to_enu([10,20,-30]) == (10,30,20)
    results = service.evaluate(scenario)['results']
    assert all(r['raw_result']['distance']['value']==200 for r in results)
    assert results[1]['raw_result']['geometric_direction']['azimuth']['value']==0
    scenario['target']['position']=[200,5,0]
    assert service.evaluate(scenario)['results'][1]['raw_result']['geometric_direction']['azimuth']['value']==90

def test_missing_optics_and_signal_remain_unknown(service,scenario):
    o,a=service.evaluate(scenario)['results']
    assert o['raw_result']['fov']['value'] is None
    assert o['raw_result']['target_in_fov']['value'] is None
    assert a['raw_result']['signal_noise_difference']['value'] is None
    assert a['raw_result']['detection_probability']['value'] is None
    assert a['raw_result']['direction_uncertainty']['azimuth_scale']['value'] is None

def test_explicit_optical_fov_and_orientation(service,scenario):
    scenario['devices'][0]['direct_fov_deg']=[10,6]
    o=service.evaluate(scenario)['results'][0]['raw_result']
    assert o['target_in_fov']['value'] is True and o['fov']['status']=='assumed'
    scenario['devices'][0]['heading_deg']=90
    assert service.evaluate(scenario)['results'][0]['raw_result']['target_in_fov']['value'] is False

def test_nominal_range_not_detection(service,scenario):
    assert service.evaluate(scenario)['results'][1]['raw_result']['within_nominal_range']['value'] is True
    scenario['target']['position']=[0,5,-600]
    r=service.evaluate(scenario)['results'][1]['raw_result']
    assert r['within_nominal_range']['value'] is False
    assert r['detection_probability']['value'] is None

def test_other_array_frequency_unknown(service,scenario):
    assert service.evaluate(scenario)['results'][1]['raw_result']['frequency_supported']['value'] is True
    scenario['devices'][1]['array_diameter_m']=.3
    assert service.evaluate(scenario)['results'][1]['raw_result']['frequency_supported']['value'] is None

def test_platform_blockage_does_not_zero_acoustics(service,scenario):
    scenario['devices'][1]['context']={'known':True,'blocked':True,'buildingCount':1}
    r=service.evaluate(scenario)['results'][1]
    assert r['geometry']['state']=='blocked'
    assert r['raw_result']['relative_signal_quality']['value'] is None
    assert any('不判定声学能力为零' in n for n in r['notes'])

def test_unknown_terrain_not_clear(service,scenario):
    scenario['devices'][0]['context']={'known':False,'blocked':False,'buildingCount':0}
    assert service.evaluate(scenario)['results'][0]['geometry']['state']=='unknown'

@pytest.mark.parametrize('mutation',[
    lambda r:r.update(origin=[0,0,0]),
    lambda r:r.update(scene_hash='wrong'),
    lambda r:r.update(environment={'illuminance':1000}),
    lambda r:r['target'].update(position=[0,float('nan'),0]),
    lambda r:r['devices'][0].update(focal_mm=1000),
    lambda r:r['devices'][0].update(direct_fov_deg=[10,None]),
    lambda r:r['devices'][1].update(array_diameter_m=.5),
    lambda r:r['devices'][1].update(id='o'),
])
def test_invalid_requests(service,scenario,mutation):
    mutation(scenario)
    with pytest.raises((ValueError,TypeError)):
        service.evaluate(scenario)

def test_config_reread_without_assumed_overrides(service,scenario,tmp_path):
    p=tmp_path/'optical.yaml'
    original=service.paths['optical'].read_text(encoding='utf-8')
    p.write_text(original.replace('1920, 1080','1280, 720'),encoding='utf-8')
    service.paths['optical']=p
    assert service.evaluate(scenario)['results'][0]['configuration']['channels']['visible']['resolution']['value']==[1280,720]
    assert service.evaluate(scenario)['results'][0]['raw_result']['fov']['value'] is None

def test_json_serializable_and_inputs_preserved(service,scenario):
    before=copy.deepcopy(scenario)
    json.dumps(service.evaluate(scenario),allow_nan=False,ensure_ascii=False)
    assert scenario==before

def test_geometric_angles_are_derived_and_notes_are_neutral(service,scenario):
    optical=service.evaluate(scenario)['results'][0]
    assert optical['raw_result']['geometric_azimuth']['value']==0
    assert optical['raw_result']['geometric_elevation']['value']==0
    text=json.dumps(optical,ensure_ascii=False)
    for word in ('老师平台','已复用原 Python','field_of_view','camera_components'):
        assert word not in text

def test_full_equipment_capacity_and_configuration_hashes(service,scenario):
    base=copy.deepcopy(scenario['devices'][0])
    scenario['devices']=[dict(copy.deepcopy(base),id=f'optical-{i}') for i in range(64)]
    response=service.evaluate(scenario)
    assert len(response['results'])==64
    for kind,path in service.paths.items():
        assert response['configuration_hashes'][kind]==hashlib.sha256(path.read_bytes()).hexdigest()
    scenario['devices'].append(dict(copy.deepcopy(base),id='overflow'))
    with pytest.raises(ValueError):
        service.evaluate(scenario)

def test_original_copies_unchanged():
    root=Path(__file__).resolve().parents[1]
    manifest=json.loads((root/'equipment_models/source_manifest.json').read_text(encoding='utf-8'))
    assert manifest
    for row in manifest:
        raw=(root/row['copy']).read_bytes()
        # Git can convert CRLF/LF on Windows; all other source bytes must match.
        assert hashlib.sha256(raw.replace(b'\r\n',b'\n')).hexdigest()==row['normalized_sha256']

def test_http_errors_and_real_evaluation(service,scenario):
    server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(service))
    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
    conn=HTTPConnection('127.0.0.1',server.server_port,timeout=5)
    try:
        conn.request('GET','/api/capabilities/catalog');res=conn.getresponse()
        assert res.status==200 and json.loads(res.read())['scene']['building_count']==15889
        conn.request('POST','/api/capabilities/evaluate',json.dumps(scenario),{'Content-Type':'application/json'})
        res=conn.getresponse();assert res.status==200 and len(json.loads(res.read())['results'])==2
        conn.request('POST','/api/capabilities/evaluate','{}',{'Content-Type':'application/json'})
        res=conn.getresponse();assert res.status==400 and 'error'in json.loads(res.read())
    finally:
        conn.close();server.shutdown();server.server_close();worker.join()

