#!/usr/bin/env bash
# Build a Linux deployment bundle from the current Windows/macOS checkout.
# Usage: bash scripts/build_linux_bundle.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Vite build"
npm run build

STAGE="artifacts/uav-linux"
BUNDLE="artifacts/uav-linux-bundle.tar.gz"
rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "==> 复制运行文件"
cp -a dist "$STAGE/dist"
cp -a backend "$STAGE/backend"
cp -a equipment_models "$STAGE/equipment_models"
cp -a deploy "$STAGE/deploy"
cp -a requirements.txt "$STAGE/requirements.txt"
mkdir -p "$STAGE/scripts"
cp -a scripts/{build_custom_site,prepare_data,imagery}.py "$STAGE/scripts/"
cp -a 启动平台.sh "$STAGE/启动平台.sh"

echo "==> 删除主界面已移除站点的数据（保留深圳/无锡/杭州）"
rm -rf \
  "$STAGE/dist/data/beijing" \
  "$STAGE/dist/data/sites/daxing" \
  "$STAGE/dist/data/sites/railway" \
  "$STAGE/dist/data/sites/nuclear" \
  "$STAGE/dist/data/sites/changjiang"
rm -f "$STAGE/dist/data/NoLod_"*.glb "$STAGE/dist/data/tileset.json"

echo "==> 清理测试/缓存文件"
find "$STAGE" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$STAGE" -type d -name .pytest_cache -prune -exec rm -rf {} +
find "$STAGE" -type d -name '*.egg-info' -prune -exec rm -rf {} +
find "$STAGE/equipment_models" -maxdepth 2 -type d \
  \( -name tests -o -name docs -o -name examples -o -name outputs \) \
  -prune -exec rm -rf {} +

echo "==> 设置执行权限"
chmod +x "$STAGE/deploy/install_linux.sh" "$STAGE/启动平台.sh" "$STAGE/deploy/"*.sh 2>/dev/null || true

echo "==> 打包"
rm -f "$BUNDLE"
tar -czf "$BUNDLE" -C artifacts uav-linux
ls -lh "$BUNDLE"
echo "完成：$BUNDLE"
echo "上传后在服务器执行：tar -xzf uav-linux-bundle.tar.gz -C /root/uav-linux --strip-components=1 && bash /root/uav-linux/deploy/install_linux.sh"
