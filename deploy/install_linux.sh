#!/usr/bin/env bash
# Install the prebuilt UAV platform on Alibaba Cloud Linux 3 / RHEL-like hosts.
# Usage (as root, from the extracted bundle):
#   bash deploy/install_linux.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 或 sudo 运行：sudo bash deploy/install_linux.sh" >&2
  exit 1
fi

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="/opt/uav"
WEB_ROOT="$APP_DIR/dist"

echo "==> 安装系统依赖"
if command -v dnf >/dev/null 2>&1; then
  dnf install -y nginx tar gzip curl
  # Alibaba Cloud Linux 3.2104 provides python3.11 alongside system Python 3.6.
  dnf install -y python3.11 || {
    echo "未找到 python3.11 包，请先启用 alinux3-updates 源，或安装 python3.12。" >&2
    exit 1
  }
  dnf install -y python3.11-pip || true
elif command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nginx tar gzip curl python3.11 python3.11-venv python3.11-dev
else
  echo "未识别的包管理器；请手动安装 nginx、Python 3.10+。" >&2
  exit 1
fi

PY=""
for candidate in python3.11 python3.12 python3.10; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      PY="$candidate"
      break
    fi
  fi
done
if [ -z "$PY" ]; then
  echo "需要 Python 3.10+（当前系统 python3 版本过低）。" >&2
  exit 1
fi
echo "==> 使用 $PY ($($PY -V 2>&1))"

id -u uav >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin uav

echo "==> 部署代码到 $APP_DIR"
mkdir -p "$APP_DIR"
rm -rf "$APP_DIR/dist" "$APP_DIR/backend" "$APP_DIR/equipment_models" "$APP_DIR/deploy"
cp -a "$SRC_DIR/dist" "$APP_DIR/"
cp -a "$SRC_DIR/backend" "$APP_DIR/"
cp -a "$SRC_DIR/equipment_models" "$APP_DIR/"
cp -a "$SRC_DIR/deploy" "$APP_DIR/"
cp -a "$SRC_DIR/requirements.txt" "$APP_DIR/"
[ -f "$SRC_DIR/启动平台.sh" ] && cp -a "$SRC_DIR/启动平台.sh" "$APP_DIR/"

# The backend reads public/data/city.json; dist already contains the same data.
rm -rf "$APP_DIR/public"
ln -s "$WEB_ROOT" "$APP_DIR/public"

echo "==> 创建 Python 虚拟环境并安装依赖"
if [ ! -d "$APP_DIR/.venv" ]; then
  "$PY" -m venv "$APP_DIR/.venv"
fi
# shellcheck disable=SC1091
source "$APP_DIR/.venv/bin/activate"
PIP_INDEX="--index-url https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com"
python -m pip install --upgrade pip setuptools wheel $PIP_INDEX
python -m pip install -r "$APP_DIR/requirements.txt" $PIP_INDEX
python -m pip install -e "$APP_DIR/equipment_models/optical" -e "$APP_DIR/equipment_models/acoustic" $PIP_INDEX
python - <<'PYCHECK'
import optical_model, acoustic_model
print('optical/acoustic model imports OK')
PYCHECK

echo "==> 权限与 SELinux"
chown -R uav:uav "$APP_DIR"
chmod -R a+rX "$APP_DIR"
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
  chcon -R -t httpd_sys_content_t "$WEB_ROOT" || true
  setsebool -P httpd_can_network_connect 1 || true
fi

echo "==> 配置网站登录"
AUTH_ENV="/etc/uav/uav-web.env"
if [ ! -f "$AUTH_ENV" ]; then
  install -d -m 0700 /etc/uav
  WEB_PASS="$($PY -c "import secrets,string; a=string.ascii_letters+string.digits+'@#'; print(''.join(secrets.choice(a) for _ in range(16)))")"
  WEB_SECRET="$($PY -c 'import secrets; print(secrets.token_hex(32))')"
  cat > "$AUTH_ENV" <<EOF
UAV_WEB_USER=uav
UAV_WEB_PASSWORD=$WEB_PASS
UAV_SESSION_SECRET=$WEB_SECRET
EOF
  chmod 600 "$AUTH_ENV"
  echo "网站登录账号：uav"
  echo "网站登录密码：$WEB_PASS"
  echo "（已写入 $AUTH_ENV，可修改后重启 uav-api）"
else
  echo "保留现有网站登录配置：$AUTH_ENV"
fi

echo "==> 配置 systemd"
install -m 0644 "$APP_DIR/deploy/uav-api.service" /etc/systemd/system/uav-api.service
systemctl daemon-reload
systemctl enable uav-api
# `enable --now` does not restart an already-running service, so an update
# would keep the old backend process (and its old routes) alive.
systemctl restart uav-api

echo "==> 配置 Nginx"
install -m 0644 "$APP_DIR/deploy/nginx-uav.conf" /etc/nginx/conf.d/uav.conf
rm -f /etc/nginx/conf.d/default.conf
# Alibaba Cloud Linux ships a stock `server { root /usr/share/nginx/html; }`
# block in nginx.conf.  It conflicts with our `server_name _` block; comment
# it out so the UAV site is the only port-80 server.
python3 - <<'PYCONF'
from pathlib import Path
path = Path('/etc/nginx/nginx.conf')
lines = path.read_text().splitlines()
for i, line in enumerate(lines):
    if line.lstrip().startswith('#'):
        continue
    if 'root         /usr/share/nginx/html;' not in line:
        continue
    start = i
    while start >= 0 and ('server {' not in lines[start] or lines[start].lstrip().startswith('#')):
        start -= 1
    if start < 0:
        continue
    end = i
    while end < len(lines) and lines[end] != '    }':
        end += 1
    if end >= len(lines):
        continue
    for j in range(start, end + 1):
        lines[j] = '# ' + lines[j]
    break
path.write_text('\n'.join(lines) + '\n')
PYCONF
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> 防火墙"
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http >/dev/null || true
  firewall-cmd --permanent --add-service=https >/dev/null || true
  firewall-cmd --reload >/dev/null || true
fi

echo "==> 健康检查"
sleep 2
AUTH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/api/auth/check || true)"
if [ "$AUTH_CODE" != "200" ] && [ "$AUTH_CODE" != "401" ]; then
  echo "后端登录检查异常：HTTP $AUTH_CODE" >&2
  exit 1
fi
echo "后端登录检查 HTTP $AUTH_CODE（200=未启用登录，401=登录门已启用）"
curl -fsS -o /dev/null -w "登录页 HTTP %{http_code}\n" http://127.0.0.1/login.html
curl -sS -o /dev/null -w "首页 HTTP %{http_code}（未登录应为 302）\n" http://127.0.0.1/
echo
echo "完成。请在阿里云轻量应用服务器控制台放行 80 端口，然后访问："
echo "  http://<公网IP>/"
echo "日志：journalctl -u uav-api -f   /   tail -f /var/log/nginx/error.log"
