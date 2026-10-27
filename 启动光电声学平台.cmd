@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" scripts\start_integrated.py
) else (
  python scripts\start_integrated.py
)
pause
