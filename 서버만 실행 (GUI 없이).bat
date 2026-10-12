@echo off
chcp 65001 >nul
cd /d "%~dp0app"
rem 관리 화면이 필요 없을 때: 터널로 공개하고 콘솔에 주소를 표시합니다.
rem 같은 PC 브라우저에서 http://localhost:7777/admin?token=local-admin 으로 웹 관리 화면을 쓸 수 있습니다.
node server\standalone.js --port 7777 --expose tunnel --admin-token local-admin
pause
