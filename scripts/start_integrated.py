"""One command starts the loopback Python API and the existing Vite platform."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[1]

def main():
    os.chdir(ROOT)
    if not (ROOT/'public/data/city.json').exists():
        raise SystemExit('请先运行 python scripts/prepare_data.py')
    node=shutil.which('node')
    vite=ROOT/'node_modules/vite/bin/vite.js'
    if not node or not vite.exists():
        raise SystemExit('请先安装 Node.js 22.12+ 并运行 npm ci')
    api=subprocess.Popen([sys.executable,'-u','backend/server.py'],cwd=ROOT)
    web=None
    try:
        for _ in range(80):
            if api.poll() is not None:
                raise SystemExit('Python模型服务启动失败，请查看上方报错。')
            try:
                with urlopen('http://127.0.0.1:8765/api/capabilities/health',timeout=.2) as r:
                    if json.load(r).get('ok'):break
            except OSError:time.sleep(.1)
        else:raise SystemExit('Python模型服务未能就绪。')
        print('浏览器打开 http://127.0.0.1:5173 ，点击“装备建模”选择光电或声学设备。Ctrl+C 停止两个服务。',flush=True)
        web=subprocess.Popen([node,str(vite),'--host','127.0.0.1','--port','5173','--strictPort'],cwd=ROOT)
        while api.poll() is None and web.poll() is None:time.sleep(.3)
    except KeyboardInterrupt:
        pass
    finally:
        for process in (web,api):
            if process is not None and process.poll() is None:
                process.terminate()
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill()

if __name__=='__main__':main()
