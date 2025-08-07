@echo off
REM Windows启动脚本
set PATH=%~dp0python_env;%~dp0python_env\Scripts;%PATH%
python app.py
pause