@echo off
setlocal
cd /d "%~dp0"
title QS-VC Platform Launcher

echo ==================================================
echo           Starting QS-VC Platform                 
echo ==================================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is required to run QS-VC.
    echo Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

node start-intranet.js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] QS-VC encountered an error during startup.
    pause
)

