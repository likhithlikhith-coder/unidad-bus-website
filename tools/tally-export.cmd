@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tally-export.ps1" %*
pause
