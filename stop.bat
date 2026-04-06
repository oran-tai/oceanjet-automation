@echo off
:: Gracefully stop the OceanJet automation.
:: The orchestrator will finish the current booking before stopping.
:: No error notifications are sent.

echo. > C:\oceanjet-automation\orchestrator\.stop
echo Stop requested. The orchestrator will finish the current booking and exit.
echo The RPA agent will remain idle — close its window manually when ready.
