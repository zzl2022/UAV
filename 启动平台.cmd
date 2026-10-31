@echo off
chcp 65001 >nul
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto :use_venv

where python >nul 2>nul
if errorlevel 1 goto :no_python

set "PYTHONPATH=%~dp0.python-deps;%PYTHONPATH%"
python scripts\start_integrated.py
goto :done

:use_venv
".venv\Scripts\python.exe" scripts\start_integrated.py
goto :done

:no_python
echo [ERROR] Python not found. Install Python 3.12+ and add it to PATH.
echo         Or create the project venv:
echo         python -m venv .venv
echo         .\.venv\Scripts\python.exe -m pip install -r requirements-integration.txt
pause
exit /b 1

:done
echo.
echo Press any key to close this window.
pause >nul
