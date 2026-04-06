###############################################################################
# OceanJet VM Setup — Full Installation
#
# Installs everything needed on a fresh Windows VM:
#   - Git, Node.js LTS (if missing)
#   - Clones repo to C:\oceanjet-automation
#   - Installs Python packages (RPA agent)
#   - Installs npm packages (Orchestrator)
#   - Creates desktop shortcuts and update commands
#
# Run in PowerShell:
#   Set-ExecutionPolicy Bypass -Scope Process -Force; .\setup.ps1
#
# Remote install (from any VM):
#   powershell -ExecutionPolicy Bypass -Command "iwr -Uri 'https://raw.githubusercontent.com/oran-tai/oceanjet-automation/main/setup.ps1' -OutFile setup.ps1; .\setup.ps1"
###############################################################################

$ErrorActionPreference = "Stop"
$REPO_URL = "https://github.com/oran-tai/oceanjet-automation.git"
$PROJECT_DIR = "C:\oceanjet-automation"
$RPA_DIR = "$PROJECT_DIR\rpa-agent"
$ORCH_DIR = "$PROJECT_DIR\orchestrator"

$NODE_VERSION = "v22.16.0"
$NODE_MSI_URL = "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-x64.msi"
$GIT_EXE_URL = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OceanJet VM Setup" -ForegroundColor Cyan
Write-Host "  RPA Agent + Orchestrator" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Install Git if missing ---
$gitPath = "C:\Program Files\Git\bin\git.exe"
if (-Not (Get-Command git -ErrorAction SilentlyContinue) -and -Not (Test-Path $gitPath)) {
    Write-Host "[1/7] Installing Git..." -ForegroundColor Yellow
    $gitInstaller = "$env:TEMP\git-install.exe"
    Invoke-WebRequest -Uri $GIT_EXE_URL -OutFile $gitInstaller -UseBasicParsing
    Start-Process $gitInstaller -ArgumentList "/VERYSILENT /NORESTART" -Wait
    $env:PATH += ";C:\Program Files\Git\bin"
    [Environment]::SetEnvironmentVariable("PATH", [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";C:\Program Files\Git\bin", "Machine")
    Write-Host "  Git installed" -ForegroundColor Green
} else {
    Write-Host "[1/7] Git already installed" -ForegroundColor Green
}

# --- Step 2: Install Node.js if missing ---
if (-Not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[2/7] Installing Node.js $NODE_VERSION..." -ForegroundColor Yellow
    $nodeMsi = "$env:TEMP\node-install.msi"
    Invoke-WebRequest -Uri $NODE_MSI_URL -OutFile $nodeMsi -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i $nodeMsi /qn" -Wait
    $env:PATH += ";C:\Program Files\nodejs"
    Write-Host "  Node.js installed" -ForegroundColor Green
} else {
    $nodeVer = & node --version 2>&1
    Write-Host "[2/7] Node.js already installed: $nodeVer" -ForegroundColor Green
}

# --- Step 3: Check Python ---
Write-Host "[3/7] Checking Python..." -ForegroundColor Yellow
try {
    $pyVersion = & py --version 2>&1
    Write-Host "  Found: $pyVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Python not found. Install Python 3.12+ and ensure 'py' launcher is available." -ForegroundColor Red
    exit 1
}

# --- Step 4: Clone or update repo ---
Write-Host "[4/7] Setting up project at $PROJECT_DIR..." -ForegroundColor Yellow
if (Test-Path "$PROJECT_DIR\.git") {
    # Repo exists — pull latest
    Push-Location $PROJECT_DIR
    & git pull origin main 2>&1
    Pop-Location
    Write-Host "  Updated from GitHub" -ForegroundColor Green
} else {
    # Fresh clone
    if (Test-Path $PROJECT_DIR) { Remove-Item $PROJECT_DIR -Recurse -Force }
    & git clone $REPO_URL $PROJECT_DIR 2>&1
    Write-Host "  Cloned from GitHub" -ForegroundColor Green
}

# --- Step 5: Install dependencies ---
Write-Host "[5/7] Installing dependencies..." -ForegroundColor Yellow

# Python (RPA agent)
Push-Location $RPA_DIR
& py -m pip install -r requirements.txt --quiet
Pop-Location
Write-Host "  Python packages installed" -ForegroundColor Green

# Node.js (Orchestrator)
Push-Location $ORCH_DIR
& npm install --silent 2>&1 | Out-Null
Pop-Location
Write-Host "  npm packages installed" -ForegroundColor Green

# --- Step 6: Create RPA .env if needed ---
if (-Not (Test-Path "$RPA_DIR\.env")) {
    Write-Host "[6/7] Setting up RPA agent .env..." -ForegroundColor Yellow

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
"@ | Set-Content "$RPA_DIR\.env"

    Write-Host "  RPA .env created" -ForegroundColor Green
} else {
    Write-Host "[6/7] RPA .env already exists" -ForegroundColor Green
}

# --- Step 7: Create Orchestrator .env if needed ---
if (-Not (Test-Path "$ORCH_DIR\.env")) {
    Write-Host "[7/7] Setting up Orchestrator .env..." -ForegroundColor Yellow

    $bwUsername = Read-Host "  Enter BOOKAWAY_USERNAME"
    $bwPassword = Read-Host "  Enter BOOKAWAY_PASSWORD"
    $bwBot = Read-Host "  Enter BOOKAWAY_BOT_IDENTIFIER (press Enter to use username)"
    if ([string]::IsNullOrWhiteSpace($bwBot)) { $bwBot = $bwUsername }
    $orchSlackUrl = Read-Host "  Enter SLACK_WEBHOOK_URL (press Enter to skip)"
    $rpaToken = Read-Host "  Enter RPA_AUTH_TOKEN (press Enter for default)"
    if ([string]::IsNullOrWhiteSpace($rpaToken)) { $rpaToken = "oceanjet-rpa-secret-2026" }

    @"
# Bookaway API
BOOKAWAY_ENV=prod
BOOKAWAY_API_URL_PROD=https://www.bookaway.com/_api
BOOKAWAY_API_URL_STAGE=https://admin-stage.bookaway.com/_api
BOOKAWAY_USERNAME=$bwUsername
BOOKAWAY_PASSWORD=$bwPassword
BOOKAWAY_BOT_IDENTIFIER=$bwBot

# Polling
POLLING_INTERVAL_MS=30000

# Slack Notifications
SLACK_WEBHOOK_URL=$orchSlackUrl

# RPA Agent (localhost — both run on same VM)
RPA_AGENT_URL=http://localhost:8080
RPA_AUTH_TOKEN=$rpaToken

# Operator Mode
OPERATOR_MODE=rpa

# Target a single booking by reference (leave empty to process all)
TARGET_BOOKING=
"@ | Set-Content "$ORCH_DIR\.env"

    Write-Host "  Orchestrator .env created" -ForegroundColor Green
} else {
    Write-Host "[7/7] Orchestrator .env already exists" -ForegroundColor Green
}

# --- Create desktop shortcuts ---
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell

$shortcut = $shell.CreateShortcut("$desktop\Start RPA Agent.lnk")
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/k cd /d $RPA_DIR && start.bat"
$shortcut.WorkingDirectory = $RPA_DIR
$shortcut.Description = "Start OceanJet RPA Agent"
$shortcut.Save()

$shortcut = $shell.CreateShortcut("$desktop\Start Orchestrator.lnk")
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/k cd /d $ORCH_DIR && start.bat"
$shortcut.WorkingDirectory = $ORCH_DIR
$shortcut.Description = "Start OceanJet Orchestrator"
$shortcut.Save()

Write-Host ""
Write-Host "  Desktop shortcuts created" -ForegroundColor Green

# --- Configure session to stay active on disconnect (for RPA screenshots) ---
Write-Host ""
Write-Host "Step 8: Configuring session keep-alive for RPA..." -ForegroundColor Cyan

# Disable lock screen on disconnect — keeps desktop rendered for PIL ImageGrab
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization" -Name "NoLockScreen" -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization" -Force -ErrorAction SilentlyContinue | Out-Null
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization" -Name "NoLockScreen" -Value 1 -Type DWord -Force

# Install disconnect command — run before closing AnyDesk
Copy-Item "$PROJECT_DIR\disconnect.bat" "C:\Windows\disconnect.bat" -Force
Write-Host "  Lock screen disabled on disconnect" -ForegroundColor Green
Write-Host "  Command installed: type 'disconnect' before closing AnyDesk" -ForegroundColor Green

# --- Create update command ---
@"
@echo off
echo Updating OceanJet...
cd /d $PROJECT_DIR
git pull origin main
cd /d $RPA_DIR
py -m pip install -r requirements.txt --quiet
cd /d $ORCH_DIR
call npm install --silent
echo.
echo Updated!
pause
"@ | Set-Content "C:\Windows\update-oceanjet.bat"
Write-Host "  Command installed: type 'update-oceanjet' from anywhere to update" -ForegroundColor Green

# --- Done ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Project:    $PROJECT_DIR" -ForegroundColor White
Write-Host "  RPA Agent:  $RPA_DIR" -ForegroundColor White
Write-Host "  Orchestr.:  $ORCH_DIR" -ForegroundColor White
Write-Host ""
Write-Host "  To start:" -ForegroundColor White
Write-Host "    1. Open PRIME and log in" -ForegroundColor White
Write-Host "    2. Double-click 'Start RPA Agent' on desktop" -ForegroundColor White
Write-Host "    3. Double-click 'Start Orchestrator' on desktop" -ForegroundColor White
Write-Host ""
Write-Host "  To update:  update-oceanjet" -ForegroundColor White
Write-Host "  To test:    cd $RPA_DIR && py test_fill_form.py" -ForegroundColor White
Write-Host ""
pause
