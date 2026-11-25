"""Start the local model API and the Vite platform together."""
import argparse
import errno
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener
import webbrowser


ROOT = Path(__file__).resolve().parents[1]
HOST = '127.0.0.1'
API_PORT = 8765
WEB_PORT = 5173
API_URL = f'http://{HOST}:{API_PORT}'
WEB_URL = f'http://{HOST}:{WEB_PORT}'
OPENER = build_opener(ProxyHandler({}))


def require_free_port(port):
    with socket.socket() as probe:
        if os.name != 'nt':
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((HOST, port))
        except OSError as exc:
            if os.name == 'nt' and exc.winerror == errno.WSAEADDRINUSE:
                # Windows can retain closed connections on a stopped service's port.
                try:
                    with socket.create_connection((HOST, port), timeout=3):
                        pass
                except ConnectionRefusedError:
                    return
                except OSError:
                    pass
            raise RuntimeError(f'本机端口 {port} 无法绑定。请检查是否已有服务占用。（{exc}）') from exc


def wait_for_http(process, name, url, content_type, *, method='GET'):
    deadline = time.monotonic() + 45
    last_error = '未收到响应'
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'{name}已退出（退出码 {process.returncode}），请查看上方日志。')
        try:
            with OPENER.open(Request(url, method=method), timeout=2) as response:
                if response.headers.get_content_type() != content_type:
                    raise RuntimeError(f'{name}返回了意外的内容类型：{url}')
                if method == 'GET' and content_type == 'application/json':
                    return json.load(response)
                return None
        except HTTPError as exc:
            with exc:
                body = exc.read(1024).decode('utf-8', errors='replace').strip()
            raise RuntimeError(f'{name}返回 HTTP {exc.code}：{body or url}') from exc
        except OSError as exc:
            last_error = str(exc)
            time.sleep(0.2)
    raise RuntimeError(f'{name}在 45 秒内未就绪：{url}（{last_error}）')


def stop_process(process):
    if process.poll() is None:
        # A Windows virtual environment may launch Python through a redirector.
        if os.name == 'nt':
            subprocess.run(
                ['taskkill.exe', '/PID', str(process.pid), '/T', '/F'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
            )
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-browser', action='store_true', help='start without opening a browser')
    args = parser.parse_args()
    processes = []
    try:
        for name in ('city.json', 'terrain.json'):
            if not (ROOT / 'public' / 'data' / name).is_file():
                raise RuntimeError(f'缺少 public/data/{name}，请运行启动平台.bat 或准备场景数据。')
        node = shutil.which('node')
        vite = ROOT / 'node_modules' / 'vite' / 'bin' / 'vite.js'
        if not node or not vite.is_file():
            raise RuntimeError('请先安装 Node.js 并运行 npm ci，或双击启动平台.bat。')
        for port in (API_PORT, WEB_PORT):
            require_free_port(port)

        api = subprocess.Popen([sys.executable, '-u', 'backend/server.py', '--port', str(API_PORT)], cwd=ROOT)
        processes.append(api)
        catalog_path = '/api/capabilities/catalog'
        catalog = wait_for_http(api, 'Python 模型目录', API_URL + catalog_path, 'application/json')

        # The integrated launcher pairs the frontend with the API it just started.
        env = {**os.environ, 'CAPABILITY_API_URL': API_URL}
        web = subprocess.Popen(
            [node, str(vite), '--host', HOST, '--port', str(WEB_PORT), '--strictPort'], cwd=ROOT, env=env,
        )
        processes.append(web)
        wait_for_http(web, '平台页面', WEB_URL, 'text/html')
        proxied_catalog = wait_for_http(web, '前端模型代理', WEB_URL + catalog_path, 'application/json')
        if proxied_catalog != catalog:
            raise RuntimeError('前端模型代理返回的设备目录与本地 Python 服务不一致。')
        for name in ('city.json', 'terrain.json'):
            wait_for_http(web, f'场景数据 {name}', f'{WEB_URL}/data/{name}', 'application/json', method='HEAD')

        print(f'页面与模型服务已就绪。浏览器访问 {WEB_URL}，按 Ctrl+C 停止。', flush=True)
        if not args.no_browser:
            webbrowser.open(WEB_URL)
        while True:
            for process, name in ((api, 'Python 模型服务'), (web, 'Vite 前端')):
                if process.poll() is not None:
                    raise RuntimeError(f'{name}已退出（退出码 {process.returncode}）。')
            time.sleep(0.3)
    except KeyboardInterrupt:
        return 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(f'[启动错误] {exc}', file=sys.stderr, flush=True)
        return 1
    finally:
        for process in reversed(processes):
            stop_process(process)


if __name__ == '__main__':
    sys.exit(main())
