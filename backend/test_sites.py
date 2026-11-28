from contextlib import contextmanager
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
from threading import Event, Thread
import time
from urllib.parse import quote

import numpy as np
from PIL import Image
from pyproj import CRS
import pytest
import rasterio
from rasterio.transform import from_bounds
import shapefile

from backend.server import make_handler
from backend.sites import MAX_AGE, MAX_FILE, SiteService


@contextmanager
def running_server(storage):
    service = SiteService(storage)
    with ThreadingHTTPServer(('127.0.0.1', 0), make_handler(None, service)) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def call(method, path='/api/sites', body=None, headers=None):
            headers = dict(headers or {})
            if isinstance(body, dict):
                body = json.dumps(body).encode()
                headers['Content-Type'] = 'application/json'
            with_connection = HTTPConnection(*server.server_address, timeout=12)
            try:
                with_connection.request(method, path, body=body, headers=headers)
                response = with_connection.getresponse()
                payload = response.read()
                if response.getheader('Content-Type', '').startswith('application/json'):
                    payload = json.loads(payload)
                return response.status, payload
            finally:
                with_connection.close()

        try:
            yield call, service
        finally:
            server.shutdown()
            thread.join()
            service.close()


@pytest.fixture
def api(tmp_path, monkeypatch):
    for name in ('UAV_WEB_USER', 'UAV_WEB_PASSWORD', 'UAV_SESSION_SECRET'):
        monkeypatch.delenv(name, raising=False)
    with running_server(tmp_path / 'sites') as running:
        yield running


@pytest.fixture
def layers(tmp_path):
    root = tmp_path / '区域'
    shape = root / '图层' / '轮廓'
    shape.parent.mkdir(parents=True)
    with shapefile.Writer(str(shape)) as writer:
        writer.field('HiGH', 'N', 10, 2)
        writer.field('height', 'N', 10, 2)
        writer.field('NAME', 'C', 40)
        ring = [[113.6465, 34.789], [113.6465, 34.793], [113.6505, 34.793],
                [113.6505, 34.789], [113.6465, 34.789]]
        writer.poly([ring])
        writer.record(18.5, 99, '有效建筑')
        writer.poly([ring])
        writer.record(0, 120, '非法高度')
    shape.with_suffix('.prj').write_text(CRS.from_epsg(4326).to_wkt(), encoding='utf-8')
    shape.with_suffix('.cpg').write_text('65001', encoding='utf-8')
    bounds = [113.64, 34.78, 113.66, 34.80]
    with rasterio.open(root / '高程.tif', 'w', driver='GTiff', height=3, width=3,
                       count=1, dtype='float32', crs='EPSG:4326', transform=from_bounds(*bounds, 3, 3)) as raster:
        raster.write(np.arange(9, dtype=np.float32).reshape(3, 3) * 10, 1)
    Image.new('RGB', (6, 3), (95, 130, 120)).save(root / '底图.png')
    (root / '底图.json').write_text(json.dumps({'crs': 'EPSG:4326', 'bbox': bounds}), encoding='utf-8')
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob('*')
            if path.is_file() and path.suffix != '.shx'}


def upload(call, layers):
    status, data = call('POST', '/api/sites/uploads')
    assert status == 201
    session = '/api/sites/uploads/' + data['uploadId']
    for path, contents in layers.items():
        assert call('PUT', session + '/' + quote(path), contents)[0] == 201
    return session


def wait_job(call, session):
    status, result = call('POST', session + '/build', {'name': '  测试模型  '})
    assert status == 202
    job = '/api/sites/builds/' + result['jobId']
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        status, state = call('GET', job)
        assert status == 200
        if state['status'] in {'done', 'failed'}:
            return state
        time.sleep(.1)
    pytest.fail('生成任务未在测试期限内结束')


def test_upload_build_assets_and_restart(api, layers):
    call, service = api
    state = wait_job(call, upload(call, layers))
    assert state['status'] == 'done', state
    assert state['progress'] == 100 and state['error'] is None
    entry = state['site']
    assert entry['name'] == '测试模型'
    assert entry['buildingCount'] == 1 and entry['maxHeight'] == 18.5
    base = entry['base'].removeprefix('.')
    meta = call('GET', base + '-meta.json')[1]
    assert meta['custom'] and meta['meshType'] == 'json'
    assert meta['heightField'] == 'HiGH' and meta['buildingValidation']['invalidHeight'] == 1
    assert len(meta['ecefTransform']) == 16 and len(meta['localBounds']) == 4
    assert meta['center'] == pytest.approx([113.65, 34.79])
    assert len(meta['sources']) == len(layers) and all(len(digest) == 64 for digest in meta['sources'].values())
    assert meta['coreBuilding']['selection'] == 'auto-nearest-tallest'
    data = call('GET', base + '.json')[1]
    building = data['buildings'][0]
    assert data['metadata'] == meta and building['height'] == 18.5
    assert building['ground'] == 40 and building['foundation'] == 30 and building['foundationDepth'] == 10
    assert building['name'] == '有效建筑'
    terrain = call('GET', base.removesuffix('-gba') + '-terrain.json')[1]
    assert len(terrain['positions']) == 27 and len(terrain['indices']) == 24
    assert terrain['max'] - terrain['min'] > 60
    image = entry['imagery'].removeprefix('.')
    assert call('GET', image)[1].startswith(b'\xff\xd8\xff')
    image_info = call('GET', image.removesuffix('.jpg') + '.json')[1]
    assert image_info['bbox'] == meta['bbox'] and max(image_info['width'], image_info['height']) <= 4096
    assert call('GET', base + '.glb')[0] == 404
    assert call('GET', '/data/custom-sites/index.json')[0] == 404
    assert call('GET', '/data/custom-sites/' + entry['slug'] + '/')[0] == 404
    with running_server(service.folder) as (after_restart, _):
        assert after_restart('GET') == (200, {'sites': [entry]})
        assert after_restart('GET', base + '.json')[1] == data


@pytest.mark.parametrize(('extra', 'remove', 'message'), [
    (None, '图层/轮廓.prj', '缺少.prj'),
    (None, '高程.tif', '缺少 DEM GeoTIFF'),
    ('图层/重复.shp', None, '找到 2 个.shp'),
    ('第二块.tif', None, '找到 2 个 DEM GeoTIFF'),
    ('第二张.png', None, '找到 2 个影像底图'),
    (None, '底图.json', '影像 底图.png 无法定位到 DEM'),
])
def test_bad_inputs_leave_no_index(api, layers, extra, remove, message):
    call, service = api
    if remove:
        del layers[remove]
    if extra:
        layers[extra] = next(value for path, value in layers.items() if Path(path).suffix == Path(extra).suffix)
    state = wait_job(call, upload(call, layers))
    assert state['status'] == 'failed' and message in state['error'], state
    if extra:
        assert extra in state['error']
    assert call('GET') == (200, {'sites': []})
    assert not list(service.folder.iterdir())


def test_no_imagery(api, layers):
    call, _ = api
    layers = {path: contents for path, contents in layers.items() if not path.startswith('底图')}
    state = wait_job(call, upload(call, layers))
    assert state['status'] == 'done' and state['site']['imagery'] is None, state
    assert '未提供影像底图' in call('GET', state['site']['base'].removeprefix('.') + '-meta.json')[1]['limitations'][-1]


def test_delete_model_and_persist_after_restart(api, layers):
    call, service = api
    site = wait_job(call, upload(call, layers))['site']
    slug = site['slug']
    route = '/api/sites/' + slug
    generated = site['base'].removeprefix('.') + '.json'
    unlisted = service.folder / ('custom-' + 'f' * 32)
    unlisted.mkdir()
    assert call('DELETE', '/api/sites/' + unlisted.name)[0] == 404 and unlisted.is_dir()
    for attempted in ('recon', 'custom-123', '%2e%2e', '../index.json', '%2e%2e%2findex.json'):
        assert call('DELETE', '/api/sites/' + attempted)[0] in (400, 404)
    assert call('GET') == (200, {'sites': [site]})
    assert call('DELETE', route) == (200, {'ok': True, 'slug': slug})
    assert call('DELETE', route)[0] == 404
    assert call('GET') == (200, {'sites': []})
    assert call('GET', generated)[0] == 404
    assert not (service.folder / slug).exists() and unlisted.is_dir()
    with running_server(service.folder) as (restarted, _):
        assert restarted('GET') == (200, {'sites': []})
        assert restarted('GET', generated)[0] == 404


def test_delete_restores_directory_when_index_write_fails(api, layers, monkeypatch):
    call, service = api
    site = wait_job(call, upload(call, layers))['site']
    slug = site['slug']

    def fail_write(_):
        raise OSError('模拟文件系统写入失败')

    with monkeypatch.context() as broken_disk:
        broken_disk.setattr(service, '_write_index', fail_write)
        assert call('DELETE', '/api/sites/' + slug)[0] == 500
    assert call('GET') == (200, {'sites': [site]})
    assert call('GET', site['base'].removeprefix('.') + '.json')[0] == 200
    assert not any(service.folder.glob('.deleted-*'))

    # 恢复进程在目录移出之后、索引提交之前中断的删除。
    directory = service.folder / slug
    directory.rename(service.folder / ('.deleted-' + slug))
    with running_server(service.folder) as (restarted, _):
        assert restarted('GET') == (200, {'sites': [site]})
        assert directory.is_dir()


def test_upload_rejects_invalid_requests(api, monkeypatch):
    call, _ = api
    session = upload(call, {})
    for path in ('../outside.shp', '%2e%2e/outside.shp', '/absolute.shp', 'C%3a/file.shp',
                 'link%5Coutside.shp', 'CON.shp', 'bad%00.shp'):
        status, result = call('PUT', session + '/' + path, b'a')
        assert status == 400 and '相对路径' in result['error'], path
    assert call('PUT', session + '/unsupported.exe', b'a')[0] == 415
    assert call('PUT', session + '/large.tif', b'', {'Content-Length': str(MAX_FILE + 1)})[0] == 413
    assert call('PUT', session + '/empty.tif', b'')[0] == 400
    assert call('PUT', '/api/sites/uploads/' + '0' * 32 + '/x.shp', b'a')[0] == 404
    assert call('GET', '/api/sites/builds/' + '0' * 32)[0] == 404
    assert call('POST', session + '/build', {'name': '无数据'})[0] == 400
    assert call('PUT', session + '/file.shp', b'a')[0] == 201
    assert call('PUT', session + '/FILE.SHP', b'a')[0] == 409
    for name in (' ', '名称\x01', '高' * 25):
        assert call('POST', session + '/build', {'name': name})[0] == 400
    monkeypatch.setattr('backend.sites.MAX_TOTAL', 2)
    assert call('PUT', session + '/another.shp', b'aa')[0] == 413
    monkeypatch.setattr('backend.sites.MAX_FILES', 1)
    assert call('PUT', session + '/another.shp', b'a')[0] == 413
    assert call('DELETE', session)[0] == 200
    assert call('POST', session + '/build', {'name': '已取消'})[0] == 404


def test_cancel_queued_build_and_require_login(api, monkeypatch):
    call, service = api
    started, release = Event(), Event()
    run = service._run

    def block_start(job):
        started.set()
        assert release.wait(4)
        run(job)

    monkeypatch.setattr(service, '_run', block_start)
    session = upload(call, {'shape.shp': b'a'})
    status, result = call('POST', session + '/build', {'name': '等待中'})
    assert status == 202 and started.wait(4)
    try:
        assert call('DELETE', session)[0] == 200
        status, state = call('GET', '/api/sites/builds/' + result['jobId'])
        assert status == 200 and state['status'] == 'failed' and state['stage'] == '已取消'
        assert not service.index.exists()
    finally:
        release.set()
    service.queue.join()
    assert not service.index.exists()
    for key in ('UAV_WEB_USER', 'UAV_WEB_PASSWORD', 'UAV_SESSION_SECRET'):
        monkeypatch.setenv(key, 'test-only')
    assert call('GET')[0] == 401
    assert call('POST', '/api/sites/uploads')[0] == 401
    assert call('PUT', session + '/shape.shp', b'a')[0] == 401
    assert call('DELETE', session)[0] == 401
    assert call('DELETE', '/api/sites/custom-' + '0' * 32)[0] == 401
    assert call('GET', '/data/custom-sites/index.json')[0] == 401


def test_prune_only_expired_work(tmp_path):
    import os

    old = tmp_path / '.custom-sites-work' / 'sites' / ('1' * 32)
    new = old.with_name('2' * 32)
    for work in (old, new):
        work.mkdir(parents=True, exist_ok=True)
    earlier = time.time() - MAX_AGE - 10
    os.utime(old, (earlier, earlier))
    with running_server(tmp_path / 'sites'):
        assert not old.exists() and new.exists()
