###############################################################################
# OceanJet RPA Agent — One-Click Setup for Windows VM
#
# Run in PowerShell:
#   Set-ExecutionPolicy Bypass -Scope Process -Force; .\setup.ps1
#
# Or from anywhere (downloads + installs):
#   powershell -ExecutionPolicy Bypass -Command "iwr -Uri 'https://raw.githubusercontent.com/oran-tai/oceanjet-automation/main/rpa-agent/setup.ps1' -OutFile setup.ps1; .\setup.ps1"
###############################################################################

$ErrorActionPreference = "Stop"
$INSTALL_DIR = "C:\rpa-agent"
$REPO_ZIP = "https://github.com/oran-tai/oceanjet-automation/archive/refs/heads/main.zip"
$TEMP_ZIP = "$env:TEMP\oceanjet-automation.zip"
$TEMP_EXTRACT = "$env:TEMP\oceanjet-automation-main"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OceanJet RPA Agent - Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Check Python ---
Write-Host "[1/5] Checking Python..." -ForegroundColor Yellow
try {
    $pyVersion = & py --version 2>&1
    Write-Host "  Found: $pyVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Python not found. Install Python 3.12+ and ensure 'py' launcher is available." -ForegroundColor Red
    exit 1
}

# --- Step 2: Download repo ---
Write-Host "[2/5] Downloading from GitHub..." -ForegroundColor Yellow
if (Test-Path $TEMP_ZIP) { Remove-Item $TEMP_ZIP -Force }
if (Test-Path $TEMP_EXTRACT) { Remove-Item $TEMP_EXTRACT -Recurse -Force }

Invoke-WebRequest -Uri $REPO_ZIP -OutFile $TEMP_ZIP -UseBasicParsing
Write-Host "  Downloaded to $TEMP_ZIP" -ForegroundColor Green

# --- Step 3: Extract rpa-agent folder ---
Write-Host "[3/5] Extracting rpa-agent to $INSTALL_DIR..." -ForegroundColor Yellow
Expand-Archive -Path $TEMP_ZIP -DestinationPath $env:TEMP -Force

# Remove old install if present
if (Test-Path $INSTALL_DIR) {
    # Preserve .env if it exists
    $envBackup = $null
    if (Test-Path "$INSTALL_DIR\.env") {
        $envBackup = Get-Content "$INSTALL_DIR\.env" -Raw
        Write-Host "  Preserving existing .env" -ForegroundColor Green
    }
    Remove-Item $INSTALL_DIR -Recurse -Force
}

Copy-Item "$TEMP_EXTRACT\rpa-agent" -Destination $INSTALL_DIR -Recurse

# Restore .env if backed up
if ($envBackup) {
    Set-Content "$INSTALL_DIR\.env" -Value $envBackup -NoNewline
}

# Cleanup temp files
Remove-Item $TEMP_ZIP -Force
Remove-Item $TEMP_EXTRACT -Recurse -Force
Write-Host "  Installed to $INSTALL_DIR" -ForegroundColor Green

# --- Step 4: Install Python dependencies ---
Write-Host "[4/5] Installing Python packages..." -ForegroundColor Yellow
Push-Location $INSTALL_DIR
& py -m pip install -r requirements.txt --quiet
Pop-Location
Write-Host "  Packages installed" -ForegroundColor Green

# --- Step 5: Create .env if needed ---
if (-Not (Test-Path "$INSTALL_DIR\.env")) {
    Write-Host "[5/5] Setting up .env..." -ForegroundColor Yellow

    $geminiKey = Read-Host "  Enter GEMINI_API_KEY"
    $rpaToken = Read-Host "  Enter RPA_AUTH_TOKEN (press Enter for default)"
    if ([string]::IsNullOrWhiteSpace($rpaToken)) {
        $rpaToken = "oceanjet-rpa-secret-2026"
    }
    $slackUrl = Read-Host "  Enter SLACK_WEBHOOK_URL (press Enter to skip)"

    @"
RPA_AUTH_TOKEN=$rpaToken
GEMINI_API_KEY=$geminiKey
RPA_PORT=8080
PRIME_TIMEOUT_SEC=30
SLACK_WEBHOOK_URL=$slackUrl
"@ | Set-Content "$INSTALL_DIR\.env"

    Write-Host "  .env created" -ForegroundColor Green
} else {
    Write-Host "[5/5] .env already exists" -ForegroundColor Green
    # Add SLACK_WEBHOOK_URL if missing from existing .env
    $envContent = Get-Content "$INSTALL_DIR\.env" -Raw
    if ($envContent -notmatch "SLACK_WEBHOOK_URL") {
        $slackUrl = Read-Host "  Enter SLACK_WEBHOOK_URL (press Enter to skip)"
        Add-Content "$INSTALL_DIR\.env" -Value "`nSLACK_WEBHOOK_URL=$slackUrl"
        Write-Host "  Added SLACK_WEBHOOK_URL to .env" -ForegroundColor Green
    }
}

# --- Create desktop shortcut ---
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = "$desktop\Start RPA Agent.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/k cd /d $INSTALL_DIR && start.bat"
$shortcut.WorkingDirectory = $INSTALL_DIR
$shortcut.Description = "Start OceanJet RPA Agent"
$shortcut.Save()
Write-Host ""
Write-Host "  Desktop shortcut created: 'Start RPA Agent'" -ForegroundColor Green

# --- Done ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Install dir:  $INSTALL_DIR" -ForegroundColor White
Write-Host "  To start:     Double-click 'Start RPA Agent' on desktop" -ForegroundColor White
Write-Host "  To test:      cd $INSTALL_DIR && py test_fill_form.py" -ForegroundColor White
Write-Host "  Unit tests:   cd $INSTALL_DIR && py -m pytest tests/ -v" -ForegroundColor White
Write-Host ""
pause
