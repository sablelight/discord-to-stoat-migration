@echo off
title Discord to Stoat Migration
cd /d "%~dp0"

REM --- EDIT THESE VALUES ---
set DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
set STOAT_TOKEN=YOUR_STOAT_TOKEN_HERE
set DISCORD_SERVER_ID=YOUR_SERVER_ID_HERE
set MESSAGE_LIMIT=0
REM -------------------------

echo Running migration...
echo.
node index.js
echo.
pause
