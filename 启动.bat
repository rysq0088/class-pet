@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title 班级宠物管理系统

echo.
echo  🐾 正在启动班级宠物管理系统...
echo.
echo  📋 功能说明：
echo     - 管理后台: http://localhost:3001
echo     - 大屏展示: http://localhost:3001/display.html
echo.
echo  ✅ 启动后请在浏览器打开上述地址
echo  ⏹  关闭此窗口可停止服务
echo.

:: 检查端口是否被占用
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo  ⚠️  端口 3001 已被占用，可能已有一个实例在运行
    echo  请先关闭其他窗口后再试
    pause
    exit /b 1
)

:: 启动服务器
node server.js

:: 如果出错，显示错误信息
if %errorlevel% neq 0 (
    echo.
    echo  ❌ 启动失败！请检查：
    echo     1. 是否已运行 npm install
    echo     2. Node.js 是否正常安装
    echo.
    pause
)
