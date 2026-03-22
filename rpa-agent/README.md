# OceanJet PRIME RPA Agent

Python agent that drives OceanJet PRIME's desktop UI to issue ferry tickets. Receives booking data from the TypeScript orchestrator via HTTP and fills PRIME forms using pywinauto.

## VM Architecture

Both the RPA agent and the orchestrator run on the same Windows VM:

```
Windows VM
├── PRIME desktop app       (always open, logged in)
├── RPA Agent (Python)      → C:\rpa-agent        (port 8080)
└── Orchestrator (Node.js)  → C:\oceanjet-automation
```

The orchestrator talks to Bookaway (internet) and the RPA agent (localhost:8080). No firewall configuration needed.

## Fresh VM Setup

### Prerequisites
- **Windows Server 2019+** (or Windows 10/11)
- **Python 3.12+** installed with `py` launcher
- **PRIME** installed and logged in

### One-Click Install

Open **PowerShell** on the VM and run:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
iwr -Uri 'https://raw.githubusercontent.com/oran-tai/oceanjet-automation/main/rpa-agent/setup.ps1' -OutFile setup.ps1
.\setup.ps1
```

This automatically:
1. Installs **Git** if missing
2. Installs **Node.js LTS** if missing
3. Downloads repo from GitHub
4. Sets up RPA agent at `C:\rpa-agent` with Python dependencies
5. Sets up Orchestrator at `C:\oceanjet-automation` with npm dependencies
6. Prompts for API keys and creates `.env` files for both
7. Creates desktop shortcuts: **Start RPA Agent**, **Start Orchestrator**
8. Creates update commands: `update-rpa`, `update-orchestrator`

### Manual Installation (if PowerShell one-click doesn't work)

**Install Git (from cmd):**
```batch
curl -o %TEMP%\git-install.exe -L https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe
%TEMP%\git-install.exe /VERYSILENT /NORESTART
:: Close and reopen terminal, then add to PATH:
setx PATH "%PATH%;C:\Program Files\Git\bin" /M
```

**Install Node.js (from cmd):**
```batch
curl -o %TEMP%\node-install.msi https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi
msiexec /i %TEMP%\node-install.msi /qn
:: Close and reopen terminal to pick up PATH
```

**Clone and set up:**
```batch
cd C:\
git clone https://github.com/oran-tai/oceanjet-automation.git

:: RPA Agent
cd C:\oceanjet-automation\rpa-agent
py -m pip install -r requirements.txt
copy .env.example .env
:: Edit .env with your API keys

:: Orchestrator
cd C:\oceanjet-automation
npm install
copy .env.example .env
:: Edit .env — set OPERATOR_MODE=rpa, RPA_AGENT_URL=http://localhost:8080
```

## Running

### Start both services

1. Open PRIME and log in to the Issue New Ticket screen
2. Double-click **Start RPA Agent** on desktop (or `cd C:\rpa-agent && start.bat`)
3. Double-click **Start Orchestrator** on desktop (or `cd C:\oceanjet-automation && npm run dev`)

### Process a single booking

Set `TARGET_BOOKING=BW1234567` in `C:\oceanjet-automation\.env` before starting the orchestrator. It will process only that booking and stop.

### Test form fill (no ticket issued)

```batch
cd C:\rpa-agent
py test_fill_form.py              # one-way
py test_fill_form.py --round-trip
py test_fill_form.py --connecting
py test_fill_form.py --issue      # fill + actually issue ticket
```

### Run unit tests

```batch
cd C:\rpa-agent && py -m pytest tests/ -v
cd C:\oceanjet-automation && npm test
```

## Updating

```batch
update-rpa              # pulls latest RPA agent code
update-orchestrator     # pulls latest orchestrator code + npm install
```

## API Endpoints

### `GET /health`
Returns agent status and whether PRIME is running.

### `POST /issue-tickets`
Accepts a `TranslatedBooking` JSON body. Requires `Authorization: Bearer <token>` header.

Returns `TicketResult` with `departureTickets`, `returnTickets`, and per-passenger `partialResults`.

## Error Codes

| Error Code | Type | Trigger |
|---|---|---|
| `STATION_NOT_FOUND` | Booking | Station not in PRIME dropdown |
| `TRIP_NOT_FOUND` | Booking | Voyage grid is empty |
| `VOYAGE_TIME_MISMATCH` | Booking | No voyage matches departure time |
| `ACCOMMODATION_UNAVAILABLE` | Booking | Accommodation not in dropdown |
| `PASSENGER_VALIDATION_ERROR` | Booking | Invalid passenger data (pre-PRIME) |
| `TRIP_SOLD_OUT` | Booking | No seats available |
| `PRIME_VALIDATION_ERROR` | Booking | PRIME rejects form on Issue |
| `PRIME_TIMEOUT` | System | Dialog doesn't appear in time |
| `PRIME_CRASH` | System | Can't connect to PRIME |
| `SESSION_EXPIRED` | System | PRIME login timed out |
| `RPA_INTERNAL_ERROR` | System | Screenshot/API/internal failure |
| `UNKNOWN_ERROR` | System | Unhandled exception |
