@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title UAV 低空防御仿真平台

set "PY=.venv\Scripts\python.exe"

echo [1/5] 检查 Python 虚拟环境...
if not exist "%PY%" (
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 -m venv .venv
  ) else (
    where python >nul 2>nul
    if errorlevel 1 goto :no_python
    python -m venv .venv
  )
  if errorlevel 1 goto :fail
)

echo [2/5] 检查 Python 依赖...
"%PY%" -c "import shapefile, rasterio, numpy, pyproj, shapely, yaml, geopandas, requests, PIL, pytest" >nul 2>nul
if errorlevel 1 (
  echo         首次运行，正在安装 Python 依赖（需要网络）...
  "%PY%" -m pip install --disable-pip-version-check -r requirements-integration.txt
  if errorlevel 1 goto :fail
)

echo [3/5] 检查 Node.js 与前端依赖...
where node >nul 2>nul
if errorlevel 1 goto :no_node
if not exist "node_modules\vite\package.json" (
  echo         首次运行，正在安装 Node 依赖（需要网络）...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto :fail
)

echo [4/5] 检查场景与模型数据...
if not exist "public\data\city.json" (
  if exist "创意二文件\创意二数据集\区域数据\building\zheng_apart.shp" (
    echo         正在从“创意二文件”生成基础场景数据...
    "%PY%" scripts\prepare_data.py
    if errorlevel 1 goto :fail
  ) else (
    echo [错误] 缺少 public\data\city.json，且未找到“创意二文件”原始数据。
    echo        请完整下载仓库后重试。
    goto :fail
  )
)
for %%F in (
  "public\data\beijing\beijing-gba.glb"
  "public\data\beijing\beijing-gba.json"
  "public\data\sites\daxing\daxing-gba.glb"
  "public\data\sites\nuclear\nuclear-gba.glb"
  "public\data\sites\railway\railway-gba.glb"
  "public\data\sites\shenzhen\shenzhen-gba.glb"
  "public\data\sites\hangzhou\hangzhou-gba.glb"
  "public\data\sites\changjiang\changjiang-gba.glb"
) do (
  if not exist %%F (
    echo [错误] 缺少模型文件 %%F
    echo        请确认仓库已完整下载，或重新下载该文件。
    goto :fail
  )
)

echo [5/5] 启动页面与 Python 模型服务...
echo         浏览器访问 http://127.0.0.1:5173
echo         关闭本窗口或按 Ctrl+C 停止服务。
echo.
"%PY%" scripts\start_integrated.py
if errorlevel 1 goto :fail
echo.
echo 服务已停止。
pause
exit /b 0

:no_python
echo [错误] 未找到 Python。
echo        请安装 Python 3.12+，安装时勾选“Add python.exe to PATH”。
echo        下载地址：https://www.python.org/downloads/windows/
pause
exit /b 1

:no_node
echo [错误] 未找到 Node.js。
echo        请安装 Node.js 22.12+（推荐 24）。
echo        下载地址：https://nodejs.org/
pause
exit /b 1

:fail
echo.
echo 启动准备失败，请查看上方信息。
pause
exit /b 1
