@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || exit /b 1

set "PY=.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo 正在创建 Python 虚拟环境…
  where py >nul 2>&1
  if errorlevel 1 (
    python -c "import sys; sys.exit(sys.version_info < (3, 12))" || goto :no_python
    python -m venv .venv || goto :fail
  ) else (
    py -3 -c "import sys; sys.exit(sys.version_info < (3, 12))" || goto :no_python
    py -3 -m venv .venv || goto :fail
  )
)
"%PY%" -c "import sys; sys.exit(sys.version_info < (3, 12))" || goto :no_python

node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || major === 22 && minor >= 12 ? 0 : 1)" || goto :no_node
node --input-type=module -e "await import('vite'); await import('three'); await import('three-mesh-bvh'); await import('pdfmake')" >nul 2>&1
if errorlevel 1 (
  echo 正在安装前端依赖…
  call npm ci --no-audit --no-fund || goto :fail
)

"%PY%" -c "import backend.capabilities" >nul 2>&1
if errorlevel 1 (
  call :install_python || goto :fail
)

if not exist "public\data\city.json" goto :prepare_data
if not exist "public\data\terrain.json" goto :prepare_data
goto :launch

:prepare_data
if not exist "创意二文件\创意二数据集\区域数据\building\zheng_apart.shp" (
  echo [错误] 缺少基础场景数据，请补齐 public\data\city.json 和 terrain.json，或恢复原始数据集。
  goto :fail
)
echo 正在生成基础场景数据…
"%PY%" -c "import shapefile, rasterio" >nul 2>&1
if errorlevel 1 (
  call :install_python || goto :fail
)
"%PY%" scripts\prepare_data.py || goto :fail

:launch
"%PY%" -u scripts\start_integrated.py %* || goto :fail
popd
exit /b 0

:no_python
echo [错误] 请安装 Python 3.12 或更新版本。如果 .venv 已失效，请重建该虚拟环境。
goto :fail

:no_node
echo [错误] 请安装 Node.js 22.12 或更新版本，推荐 Node.js 24。

:fail
echo 启动失败，请查看上方信息。
popd
pause
exit /b 1

:install_python
echo 正在安装 Python 依赖…
"%PY%" -m pip install --disable-pip-version-check -r requirements-integration.txt
exit /b %errorlevel%
