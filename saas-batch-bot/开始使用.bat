@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先双击「一键安装.bat」或安装 Node.js。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo 还没安装依赖，正在自动执行一键安装...
  call "%~dp0一键安装.bat"
)

if not exist "data\accounts.csv" (
  copy /y "data\accounts.example.csv" "data\accounts.csv" >nul
  echo 已创建 data\accounts.csv，请先用 Excel 填写账号密码，保存后再重新打开本菜单。
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\ops-menu.mjs"
echo.
pause
