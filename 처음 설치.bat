@echo off
chcp 65001 >nul
title 사이버 홍대입구 - 처음 설치
cd /d "%~dp0app"
echo.
echo  ==============================================
echo    사이버 홍대입구 설치를 시작합니다
echo  ==============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js 가 설치되어 있지 않습니다.
  echo     잠시 후 열리는 https://nodejs.org 에서 "LTS" 버전을 설치한 뒤
  echo     이 파일을 다시 더블클릭하세요.
  start https://nodejs.org
  pause
  exit /b 1
)
echo [1/5] 프로그램 부품(npm 패키지) 내려받는 중... 몇 분 걸릴 수 있어요
call npm install --no-audit --no-fund
if errorlevel 1 ( echo [!] npm install 실패. 인터넷 연결을 확인하고 다시 실행하세요. & pause & exit /b 1 )
echo [2/5] 관리자 프로그램(Electron) 확인 중...
node scripts\fix-electron.js
if errorlevel 1 ( pause & exit /b 1 )
echo [3/5] 영상 도구(ffmpeg, yt-dlp, cloudflared) 내려받는 중...
node scripts\setup-tools.js
if errorlevel 1 ( pause & exit /b 1 )
echo [4/5] 캐릭터 모델 준비 중...
node scripts\prepare-assets.js
echo [5/5] 바탕화면에 바로가기 만드는 중...
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\사이버 홍대입구 관리자.lnk'); $s.TargetPath='%~dp0app\node_modules\electron\dist\electron.exe'; $s.Arguments='.'; $s.WorkingDirectory='%~dp0app'; $s.IconLocation='%~dp0app\dashboard\renderer\icon.ico'; $s.Save()"
echo.
echo  ==============================================
echo    설치 완료!
echo    바탕화면의 "사이버 홍대입구 관리자" 를 실행하세요.
echo  ==============================================
echo.
pause
