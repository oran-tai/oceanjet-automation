@echo off
:: Gracefully stop the OceanJet automation (both orchestrator and RPA agent).
:: The orchestrator will finish the current booking before stopping.
:: No error notifications are sent.

echo Requesting automation shutdown...

:: Signal the orchestrator to stop gracefully
echo. > C:\oceanjet-automation\orchestrator\.stop

:: Wait for orchestrator to pick up the signal and finish current booking
echo Waiting for orchestrator to finish current booking...
timeout /t 5 /nobreak >nul

:: Stop the RPA agent
taskkill /FI "WINDOWTITLE eq *run-rpa*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq *uvicorn*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq *Start RPA*" /F >nul 2>&1

echo.
echo Automation stopped.
pause
