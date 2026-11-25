from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from threading import Thread

import pytest

from backend import project_chat
from backend.server import make_handler


@pytest.fixture
def chat(monkeypatch):
    for name in ('UAV_WEB_USER', 'UAV_WEB_PASSWORD', 'UAV_SESSION_SECRET',
                 'PROJECT_CHAT_API_KEY', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL'):
        monkeypatch.delenv(name, raising=False)
    server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(None))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def call(method, payload=None):
        connection = HTTPConnection(*server.server_address, timeout=4)
        try:
            body = json.dumps(payload) if payload is not None else None
            connection.request(method, '/api/project-chat', body, {'Content-Type': 'application/json'})
            response = connection.getresponse()
            return response.status, response.getheader('Content-Type'), response.read().decode()
        finally:
            connection.close()

    yield call
    server.shutdown()
    server.server_close()
    thread.join()


@pytest.fixture
def question():
    return {'scene': 'wuxi', 'messages': [{'role': 'user', 'content': '地图数据来自哪里？'}]}


def test_missing_key_and_login(chat, monkeypatch, question):
    status, _, body = chat('GET')
    assert status == 200 and json.loads(body)['available'] is False
    assert 'deepseek' not in body.casefold()
    assert chat('POST', question)[0] == 503
    for key in ('UAV_WEB_USER', 'UAV_WEB_PASSWORD', 'UAV_SESSION_SECRET'):
        monkeypatch.setenv(key, 'test-only')
    assert chat('GET')[0] == 401
    assert chat('POST', question)[0] == 401


class Stream:
    headers = {'Content-Type': 'text/event-stream'}
    status_code = 200

    def __init__(self, finished):
        self.finished = finished

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def iter_lines(self, **_):
        yield b': keep-alive'
        yield ('data: ' + json.dumps({'choices': [{'delta': {'content': '无锡建筑'}}]},
                                     ensure_ascii=False)).encode()
        if self.finished:
            yield b'data: {"choices":[{"delta":{"content":" Overture"},"finish_reason":"stop"}]}'
            yield b'data: [DONE]'


@pytest.mark.parametrize('finished', [True, False])
def test_chat_relays_content_and_terminal_status(chat, monkeypatch, question, finished):
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'test-only')
    monkeypatch.setenv('DEEPSEEK_MODEL', 'another-model')

    def fake_post(url, *, json, stream, headers, **_):
        assert url == 'https://api.deepseek.com/chat/completions'
        assert headers['Authorization'] == 'Bearer test-only'
        assert stream and json['model'] == 'deepseek-flash' and json['stream']
        assert '当前地图：无锡市市民中心' in json['messages'][0]['content']
        assert json['messages'][1:] == question['messages']
        return Stream(finished)

    monkeypatch.setattr(project_chat.requests, 'post', fake_post)
    status, content_type, body = chat('POST', question)
    assert status == 200 and content_type.startswith('application/x-ndjson')
    events = [json.loads(line) for line in body.splitlines()]
    assert events[0] == {'delta': '无锡建筑'}
    if finished:
        assert events[1:] == [{'delta': ' Overture'}, {'done': True, 'truncated': False}]
    else:
        assert events[1:] == [{'error': '回答中断，请重试。'}]


def test_rejects_user_supplied_system_prompt_before_upstream(chat, monkeypatch, question):
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'test-only')
    question['messages'][0]['role'] = 'system'
    assert chat('POST', question)[0] == 400


def test_plan_summary_is_grounded_and_filtered(question):
    question['plan'] = {
        'status': 'ready', 'activePlanId': 'balanced', 'recommendedPlanId': 'economy',
        'conditionId': 'weather', 'budget': 640, 'deviceLimit': 40,
        'weights': {'coverage': 0.4, 'blind': 0.25, 'cost': 0.2, 'feasibility': 0.15},
        'plans': [
            {'id': 'economy', 'rank': 1, 'score': 0.827, 'cost': 118, 'deviceCount': 14,
             'conditions': [{'id': 'weather', 'coverageRate': 0.76, 'total': 100}],
             'emc': {'verdict': 'pass', 'severe': 0, 'warnings': 0},
             'sites': ['private-placement-marker']},
            {'id': 'balanced', 'rank': 2, 'score': 0.814, 'cost': 151, 'deviceCount': 18,
             'conditionOverride': 'injected-text-marker'},
        ],
        'supplement': {'deviceCount': 20, 'addedDeviceCount': 2, 'cost': 173, 'addedCost': 22},
        'routes': ['private-route-marker'],
    }
    context = project_chat.upstream_payload(question)['messages'][0]['content']
    data = json.loads(context.split('本轮方案摘要：', 1)[1])
    assert data['当前方案'] == '均衡型' and data['推荐方案'] == '经济型'
    assert data['当前工况'] == '雨雾及街道噪声' and data['总相对预算'] == 640
    assert data['原方案对比'][0]['综合得分'] == 0.827
    assert data['原方案对比'][0]['工况明细'][0]['采样覆盖率'] == 0.76
    assert data['原方案对比'][1]['设备数量'] == 18
    assert data['当前移动补充结果']['设备数量'] == 20
    assert 'private-' not in context and 'injected-text-marker' not in context

    question['plan']['status'] = 'stale'
    stale = project_chat.upstream_payload(question)['messages'][0]['content']
    assert json.loads(stale.split('本轮方案摘要：', 1)[1]) == {'状态': '输入已修改，需要重新生成方案'}


def test_provider_name_is_removed_before_streaming_to_the_browser(chat, monkeypatch, question):
    monkeypatch.setenv('PROJECT_CHAT_API_KEY', 'test-only')

    class SplitNameStream(Stream):
        def iter_lines(self, **_):
            for fragment in ('我是 De', 'ep', 'Seek，', '也叫深', '度求', '索。'):
                packet = {'choices': [{'delta': {'content': fragment}}]}
                yield ('data: ' + json.dumps(packet, ensure_ascii=False)).encode()
            yield b'data: {"choices":[{"finish_reason":"stop"}]}'
            yield b'data: [DONE]'

    monkeypatch.setattr(project_chat.requests, 'post', lambda *_, **__: SplitNameStream(True))
    status, _, body = chat('POST', question)
    assert status == 200
    events = [json.loads(line) for line in body.splitlines()]
    assert ''.join(event.get('delta', '') for event in events) == '我是 项目问答，也叫项目问答。'
    assert events[-1]['done'] is True


def test_device_question_only_supplies_the_number_model_and_simulation_role(question):
    device = {
        'status': 'found', 'planId': 'balanced', 'number': 2, 'type': 'optical',
        'presetId': 'optical-nvt', 'role': 'redundancy', 'position': ['private-position-marker'],
        'parameters': {'marker': 'private-parameter-marker'},
    }
    question['plan'] = {
        'status': 'ready', 'activePlanId': 'balanced', 'recommendedPlanId': 'economy',
        'plans': [{'id': 'economy', 'deviceCount': 1}, {'id': 'balanced', 'deviceCount': 2}],
        'device': device,
    }

    def context():
        prompt = project_chat.upstream_payload(question)['messages'][0]['content']
        assert 'private-' not in prompt
        return json.loads(prompt.split('本轮方案摘要：', 1)[1]).get('单台设备说明')

    found = context()
    assert found['方案'] == '均衡型' and found['设备编号'] == '设备-2'
    assert found['型号'] == 'NVT-951 双光谱光电'
    assert '热成像' in found['仿真用途'] and '二重覆盖' in found['方案角色']

    device.update(number=3, role='mobile')
    assert '型号' not in context()
    question['plan']['supplement'] = {'deviceCount': 3}
    assert '移动补盲' in context()['方案角色']

    device.update(planId='enhanced')
    assert context()['状态'] == '本轮未生成所问方案'
    question['plan']['status'] = 'stale'
    assert context() is None
