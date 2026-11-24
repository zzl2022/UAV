#!/usr/bin/env bash
# Linux/macOS development launcher for the UAV platform.
# For a public server, use deploy/install_linux.sh (Nginx + systemd) instead.
set -euo pipefail
cd "$(dirname "$0")"

PY=""
for candidate in python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      PY="$candidate"
      break
    fi
  fi
done
if [ -z "$PY" ]; then
  echo "需要 Python 3.10+。Alibaba Cloud Linux 3 可执行：sudo dnf install -y python3.11" >&2
  exit 1
fi

if [ ! -d .venv ]; then
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements-integration.txt

if [ ! -d node_modules ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "需要 Node.js >= 22.12 才能运行 Vite 开发服务器。" >&2
    exit 1
  fi
  npm ci
fi

python scripts/start_integrated.py "$@"
