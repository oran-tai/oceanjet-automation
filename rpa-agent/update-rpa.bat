@echo off
powershell -ExecutionPolicy Bypass -Command "iwr -Uri 'https://raw.githubusercontent.com/oran-tai/oceanjet-automation/main/rpa-agent/setup.ps1' -OutFile setup.ps1; .\setup.ps1"
