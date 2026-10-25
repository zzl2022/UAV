"""Loopback-only stdlib JSON service used through the Vite same-origin proxy."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.capabilities import CapabilityService

def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, data):
            body = json.dumps(data,ensure_ascii=False,allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == '/api/capabilities/health':
                self.reply(200,{'ok':True})
            elif self.path == '/api/capabilities/catalog':
                try:
                    self.reply(200,service.catalog())
                except (ValueError,OSError) as exc:
                    self.reply(400,{'error':str(exc)})
            else:
                self.reply(404,{'error':'接口不存在'})

        def do_POST(self):
            if self.path != '/api/capabilities/evaluate':
                self.reply(404,{'error':'接口不存在'})
                return
            try:
                length = int(self.headers.get('Content-Length','0'))
                if not 0 < length <= 256000:
                    raise ValueError('请求大小需在1至256000字节之间')
                if self.headers.get('Content-Type','').split(';')[0].strip() != 'application/json':
                    raise ValueError('需要 application/json')
                def reject(value):
                    raise ValueError('不接受 NaN 或 Infinity')
                request = json.loads(self.rfile.read(length),parse_constant=reject)
                self.reply(200,service.evaluate(request))
            except (ValueError,TypeError,KeyError,OSError,OverflowError) as exc:
                self.reply(400,{'error':str(exc)})
    return Handler

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8765)
    args = parser.parse_args()
    try:
        service = CapabilityService()
    except FileNotFoundError:
        parser.exit(1,'请先执行 python scripts/prepare_data.py 生成 public/data/city.json\n')
    server = ThreadingHTTPServer(('127.0.0.1',args.port),make_handler(service))
    print(f'光电／声学 Python 服务：http://127.0.0.1:{args.port}',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
