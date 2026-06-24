@echo off
chcp 65001 >nul
title 동화중 생활기록부 도우미
cd /d "%~dp0"
echo.
echo  대전동화중학교 생활기록부 도우미를 실행합니다...
echo  (이 창을 닫으면 종료됩니다)
echo.
start "" "http://localhost:5180/index.html"
python -m http.server 5180 2>nul || py -m http.server 5180
pause
