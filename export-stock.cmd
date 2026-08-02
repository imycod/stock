@echo off
chcp 65001 >nul
title 股票数据导出
cd /d "%~dp0"

echo.
echo ========================================
echo        股票历史数据导出工具
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 18+
  echo 下载: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\xlsx" (
  echo 首次运行，正在安装依赖...
  call pnpm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
  )
  echo.
)

node src\exportStock.js

echo.
pause
