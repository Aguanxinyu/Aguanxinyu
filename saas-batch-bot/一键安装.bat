@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   讯灵批量发布机器人 - 一键安装
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  echo 请先安装 Node.js LTS： https://nodejs.org
  echo 安装完成后重新双击本文件。
  echo.
  pause
  exit /b 1
)

echo [1/3] 正在安装依赖，请稍候...
call npm install
if errorlevel 1 (
  echo [错误] npm install 失败，请把窗口内容截图发给研发。
  pause
  exit /b 1
)

echo.
echo [2/3] 正在安装浏览器组件，请稍候...
call npx playwright install chromium
if errorlevel 1 (
  echo [错误] 浏览器安装失败，请把窗口内容截图发给研发。
  pause
  exit /b 1
)

echo.
echo [3/3] 检查账号表...
if not exist "data\accounts.csv" (
  copy /y "data\accounts.example.csv" "data\accounts.csv" >nul
  echo 已自动创建 data\accounts.csv
  echo 请用 Excel 打开并填写账号密码后保存。
) else (
  echo 已检测到 data\accounts.csv
)

echo.
echo ============================================
echo   安装完成！
echo   下一步：用 Excel 填写 data\accounts.csv
echo   然后双击「开始使用.bat」
echo ============================================
echo.
pause
