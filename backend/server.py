"""Loopback-only stdlib JSON service used through the Vite same-origin proxy."""
import argparse
from collections import defaultdict, deque
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading
import time
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import auth, project_chat
from backend.capabilities import CapabilityService

MAX_LOGIN_FAILURES = 5
LOGIN_WINDOW_SECONDS = 600
_attempts = defaultdict(deque)
_attempts_lock = threading.Lock()


def _client_ip(handler):
    # Nginx sets X-Real-IP; direct loopback calls fall back to the socket peer.
    return handler.headers.get('X-Real-IP') or handler.client_address[0]


def _login_blocked(ip):
    now = time.time()
    with _attempts_lock:
        bucket = _attempts[ip]
        while bucket and now - bucket[0] > LOGIN_WINDOW_SECONDS:
            bucket.popleft()
        return len(bucket) >= MAX_LOGIN_FAILURES


def _record_login_failure(ip):
    with _attempts_lock:
        _attempts[ip].append(time.time())


def _clear_login_failures(ip):
    with _attempts_lock:
        _attempts.pop(ip, None)


def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, data, headers=None):
            body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def read_json(self):
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 256000:
                raise ValueError('请求大小需在1至256000字节之间')
            if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                raise ValueError('需要 application/json')
            def reject(value):
                raise ValueError('不接受 NaN 或 Infinity')
            return json.loads(self.rfile.read(length), parse_constant=reject)

        def authenticated(self):
            return auth.authenticated(self.headers.get('Cookie'))

        def require_auth(self):
            if self.authenticated():
                return True
            self.reply(401, {'error': '未登录或登录已过期'})
            return False

        def project_chat(self):
            key = project_chat.api_key()
            if not key:
                self.reply(503, {'error': project_chat.UNCONFIGURED})
                return
            try:
                payload = project_chat.upstream_payload(self.read_json())
            except (ValueError, TypeError) as exc:
                self.reply(400, {'error': str(exc)})
                return

            with closing(project_chat.answer(key, payload)) as events:
                try:
                    first = next(events)
                except project_chat.ChatError as exc:
                    self.reply(exc.status, {'error': str(exc)})
                    return

                def emit(event):
                    line = json.dumps(event, ensure_ascii=False) + '\n'
                    self.wfile.write(line.encode('utf-8'))
                    self.wfile.flush()

                self.close_connection = True
                try:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('X-Accel-Buffering', 'no')
                    self.end_headers()
                    emit(first)
                    try:
                        for event in events:
                            emit(event)
                    except project_chat.ChatError as exc:
                        emit({'error': str(exc)})
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    return

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == '/api/auth/check':
                if self.authenticated():
                    self.reply(200, {'ok': True})
                else:
                    self.reply(401, {'ok': False})
                return
            if path == '/api/auth/me':
                if self.authenticated():
                    self.reply(200, {'ok': True, 'user': auth._config()[0]})
                else:
                    self.reply(401, {'ok': False})
                return
            if path == '/api/project-chat':
                if self.require_auth():
                    available = bool(project_chat.api_key())
                    self.reply(200, {'available': True} if available else
                               {'available': False, 'error': project_chat.UNCONFIGURED})
                return
            if path.startswith('/api/capabilities/'):
                if not self.require_auth():
                    return
                if path == '/api/capabilities/health':
                    self.reply(200, {'ok': True})
                elif path == '/api/capabilities/catalog':
                    try:
                        self.reply(200, service.catalog())
                    except (ValueError, OSError) as exc:
                        self.reply(400, {'error': str(exc)})
                else:
                    self.reply(404, {'error': '接口不存在'})
                return
            self.reply(404, {'error': '接口不存在'})

        def do_POST(self):
            path = urlsplit(self.path).path
            if path == '/api/auth/login':
                if not auth.enabled():
                    self.reply(503, {'error': '网站登录尚未配置'})
                    return
                ip = _client_ip(self)
                if _login_blocked(ip):
                    self.reply(429, {'error': '尝试次数过多，请稍后再试'})
                    return
                try:
                    request = self.read_json()
                    username = request.get('username')
                    password = request.get('password')
                    if not isinstance(username, str) or not isinstance(password, str):
                        raise ValueError('请输入用户名和密码')
                except (ValueError, TypeError, KeyError) as exc:
                    self.reply(400, {'error': str(exc)})
                    return
                if not auth.check_credentials(username, password):
                    _record_login_failure(ip)
                    self.reply(401, {'error': '用户名或密码错误'})
                    return
                _clear_login_failures(ip)
                self.reply(200, {'ok': True}, {'Set-Cookie': auth.login_cookie()})
                return
            if path == '/api/auth/logout':
                self.reply(200, {'ok': True}, {'Set-Cookie': auth.logout_cookie()})
                return
            if path == '/api/project-chat':
                if self.require_auth():
                    self.project_chat()
                return
            if path == '/api/capabilities/evaluate':
                if not self.require_auth():
                    return
                try:
                    request = self.read_json()
                    self.reply(200, service.evaluate(request))
                except (ValueError, TypeError, KeyError, OSError, OverflowError) as exc:
                    self.reply(400, {'error': str(exc)})
                return
            self.reply(404, {'error': '接口不存在'})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    try:
        service = CapabilityService()
    except FileNotFoundError:
        parser.exit(1, '请先执行 python scripts/prepare_data.py 生成 public/data/city.json\n')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(service))
    print(f'光电／声学 Python 服务：http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
