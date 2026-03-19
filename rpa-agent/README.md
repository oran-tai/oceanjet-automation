# OceanJet PRIME RPA Agent

Python agent that drives OceanJet PRIME's desktop UI to issue ferry tickets. Receives booking data from the TypeScript orchestrator via HTTP and fills PRIME forms using pywinauto.

**Phase 1**: Form fill only (no Issue button click). Verify data flows correctly before committing to real ticket issuance.

## VM Setup

### Prerequisites
- **Python 3.12+** installed with `py` launcher
- **PRIME** open and logged in on the Issue New Ticket screen

### One-Click Install

Open Command Prompt on the VM and run:

```
powershell -ExecutionPolicy Bypass -Command "iwr -Uri 'https://raw.githubusercontent.com/oran-tai/oceanjet-automation/main/rpa-agent/setup.ps1' -OutFile setup.ps1; .\setup.ps1"
```

This downloads the code to `C:\rpa-agent`, installs dependencies, prompts for API keys, and creates a desktop shortcut. Run the same command again to update to the latest version (preserves `.env`).

### Manual Installation

1. Copy this `rpa-agent/` folder to the VM
2. Run `install.bat` (or `py -m pip install -r requirements.txt`)
3. Copy `.env.example` to `.env` and fill in:

```
RPA_AUTH_TOKEN=your-secret-token
GEMINI_API_KEY=your-gemini-key
RPA_PORT=8080
```

## Running

### Start the HTTP server

```batch
start.bat
```

Or manually:
```batch
py -m uvicorn agent.server:app --host 0.0.0.0 --port 8080
```

### Test form fill (standalone)

With PRIME open:
```batch
py test_fill_form.py              # one-way booking
py test_fill_form.py --round-trip  # round-trip booking
py test_fill_form.py --connecting  # connecting route booking
```

Verify fields via AnyDesk after each run.

### Run unit tests

```batch
py -m pytest tests/ -v
```

These tests don't need PRIME — they validate date/time parsing only.

## API Endpoints

### `GET /health`
Returns agent status and whether PRIME is running.

### `POST /issue-tickets`
Accepts a `TranslatedBooking` JSON body. Requires `Authorization: Bearer <token>` header.

Phase 1 response: `{ "success": true, "departureTickets": [], "returnTickets": [] }`

## Orchestrator Integration

In the orchestrator's `.env`:
```
OPERATOR_MODE=rpa
RPA_AGENT_URL=http://VM_IP:8080
```
