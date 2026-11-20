@echo off
rem Starts the LightMap local runner (runner.mjs beside this file). No labels and no goto: the
rem file is kept with LF line ends in the repository, where cmd.exe can miss a label.
title LightMap runner
cd /d "%~dp0"
node --version >nul 2>nul || (echo Node.js was not found on the PATH. Install Node 22 from https://nodejs.org and start this again. & pause & exit /b 1)
node "%~dp0runner.mjs"
echo.
echo The runner stopped. Press a key to close this window.
pause >nul
