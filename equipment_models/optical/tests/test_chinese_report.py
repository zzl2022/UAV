import copy
import json
from pathlib import Path
import pytest
from optical_model.report import render_report, write_report

ROOT = Path(__file__).resolve().parents[1]
optical = "optical"

@pytest.fixture
def payload():
    return json.loads((ROOT/"outputs/optical_demo.json").read_text(encoding="utf-8-sig"))

def test_report_preserves_input_and_all_scenarios(payload):
    before = copy.deepcopy(payload)
    text = render_report(payload, optical)
    assert payload == before
    assert all(f'<section><h2>{i}. ' in text for i in range(1, len(payload['scenarios']) + 1))
    assert '场景对比' in text and '不是' in text and '成功率' in text

def test_missing_is_not_zero(payload):
    r = payload['scenarios'][0]['result']
    r['distance']['value'] = None
    text = render_report(payload, optical)
    assert '无法计算／未提供' in text
    assert '缺失值' not in text or '零' in text

def test_report_escapes_untrusted_content(payload):
    payload['scenarios'][0]['scenario'] = '<script>alert(1)</script>'
    text = render_report(payload, optical, '<img src=x onerror=alert(1)>')
    assert '<script>' not in text and '<img' not in text
    assert '&lt;script&gt;' in text

def test_invalid_payload_rejected():
    for p in ({}, {'scenarios':[]}, {'scenarios':[{}]}):
        with pytest.raises(ValueError):
            render_report(p, optical)

def test_writes_utf8_file(payload, tmp_path):
    output = tmp_path/'报告.html'
    write_report(payload, output, optical)
    assert '场景对比' in output.read_text(encoding='utf-8')

def test_unknown_path_is_explicit(payload):
    r = payload['scenarios'][0]['result']
    path = r['line_of_sight'] if optical == 'optical' else r['building_environment']['direct_path']
    path['state'] = 'unknown'
    text = render_report(payload, optical)
    assert '无法判断' in text
    assert '未知不等于无遮挡' in text if optical == 'optical' else '不能当作无遮挡' in text

def test_blockage_explanation_matches_physics(payload):
    r = payload['scenarios'][0]['result']
    path = r['line_of_sight'] if optical == 'optical' else r['building_environment']['direct_path']
    path['state'] = 'blocked'
    text = render_report(payload, optical)
    assert '无法直接观察目标' in text if optical == 'optical' else '不表示声音完全消失' in text
