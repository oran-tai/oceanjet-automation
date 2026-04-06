@echo off
:: Disconnect the current session to the console without locking.
:: This keeps the desktop rendered so PIL ImageGrab works for RPA.
:: Run this BEFORE closing AnyDesk.

for /f "tokens=*" %%i in ('query session ^| findstr /i "Active"') do (
    for /f "tokens=3" %%s in ("%%i") do (
        echo Disconnecting session %%s to console...
        tscon %%s /dest:console
    )
)
