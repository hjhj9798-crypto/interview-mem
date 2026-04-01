@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo === Interview-mem 로컬 서버 ===
echo 이 창을 닫으면 폰에서 접속이 끊깁니다.
echo.

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do (
    echo PC 주소 후보: %%b
  )
)

echo.
echo 폰 브라우저에 입력:  http://위_IP:8080
echo (예: http://192.168.0.4:8080 )
echo.
echo 방화벽 창이 뜨면 "액세스 허용"을 누르세요.
echo.

py -3 -m http.server 8080 --bind 0.0.0.0 2>nul
if errorlevel 1 (
  python -m http.server 8080 --bind 0.0.0.0 2>nul
)
if errorlevel 1 (
  echo.
  echo [오류] Python이 없습니다. https://www.python.org 에서 설치하거나,
  echo Node.js 설치 후:  npx serve -l 8080
  echo.
  pause
  exit /b 1
)
