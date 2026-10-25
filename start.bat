@echo off
setlocal EnableExtensions
chcp 65001 >nul
title UAV City Model Launcher
cd /d "%~dp0"

echo ============================================================
echo   UAV - Zhengzhou 3D City Model
echo   Setup: environment - dependencies - data - dev server
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 22.12 or newer.
  goto :fail
)
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Install Python 3.12 or newer.
  goto :fail
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR goto :fail
if %NODE_MAJOR% LSS 22 (
  echo [ERROR] Node.js is too old. Version 22.12 or newer is required.
  node --version
  goto :fail
)
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python is too old. Version 3.12 or newer is required.
  python --version
  goto :fail
)

if exist ".venv\Scripts\python.exe" goto :venv_ready
echo [1/5] Creating Python virtual environment...
python -m venv .venv
if errorlevel 1 goto :fail
:venv_ready
set "PY=.venv\Scripts\python.exe"
set "PYTHONUTF8=1"

"%PY%" -c "import rasterio, pyproj, shapely, shapefile, requests" >nul 2>nul
if not errorlevel 1 goto :python_ready
echo [2/5] Installing Python dependencies...
"%PY%" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto :fail
:python_ready

if exist "node_modules\vite\package.json" goto :node_ready
echo [3/5] Installing Node dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 goto :fail
:node_ready

if exist "public\data\city.json" if exist "public\data\terrain.json" goto :data_ready
echo [4/5] Building city and terrain data (first run: 1-2 minutes)...
"%PY%" scripts\prepare_data.py
if errorlevel 1 goto :fail
:data_ready

if exist "public\data\open-lod1.glb" goto :open_ready
echo [5/5] Building the open GBA LoD1 comparison model (network required)...
if exist "public\data\open-lod1.json" goto :open_export
"%PY%" scripts\prepare_open_model.py
if errorlevel 1 (
  echo.
  echo [WARN] GBA download/conversion failed. Continuing without the open model.
  goto :open_ready
)
:open_export
call node scripts\export_open_model.js
if errorlevel 1 echo [WARN] Open-model GLB export failed. Continuing.
:open_ready

if exist "public\data\sat3dgen\input\zhengzhou_museum.png" goto :sat_input_ready
echo [6/6] Preparing the Sat3DGen satellite crop...
"%PY%" scripts\prepare_sat3dgen_input.py
if errorlevel 1 echo [WARN] Sat3DGen input preparation failed. The page will still open.
:sat_input_ready

if exist "public\data\sat3dgen\cnbh-model.glb" goto :cnbh_ready
echo [7/7] Building the CNBH-10m full-extent model (network required)...
"%PY%" scripts\fetch_cnbh_window.py
if errorlevel 1 (
  echo [WARN] CNBH window download failed. Continuing without the CNBH model.
  goto :cnbh_ready
)
"%PY%" scripts\prepare_cnbh_model.py
if errorlevel 1 (
  echo [WARN] CNBH model conversion failed. Continuing.
  goto :cnbh_ready
)
call node scripts\export_cnbh_model.js
if errorlevel 1 echo [WARN] CNBH GLB export failed. Continuing.
:cnbh_ready

if not exist "public\data\beijing\beijing-gba.glb" echo [WARN] Beijing GBA model not found. Run "npm run prepare:beijing:all:win" to enable the Forbidden City model in the main page.

if /i "%~1"=="--check" (
  echo.
  echo [OK] Environment and data are ready.
  exit /b 0
)

echo.
echo ============================================================
echo   Starting the dev server at http://localhost:5173
echo   Close the "UAV dev server" window to stop it.
echo ============================================================
start "UAV dev server" cmd /k "call npm run dev -- --port 5173"
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"
exit /b 0

:fail
echo.
echo [FAILED] Setup did not complete. Check the messages above.
pause
exit /b 1
