# OceanJet PRIME RPA Agent

Python agent that drives OceanJet PRIME's desktop UI to issue ferry tickets. Receives booking data from the TypeScript orchestrator via HTTP and fills PRIME forms using pywinauto.

**Phase 1**: Form fill only (no Issue button click). Verify data flows correctly before committing to real ticket issuance.

## VM Setup

1. **Python 3.12+** must be installed (use `py` launcher)
2. **PRIME** must be open and logged in
3. Copy this entire `rpa-agent/` folder to the VM

## Installation

```batch
install.bat
```

Or manually:
```batch
py -m pip install -r requirements.txt
```

## Configuration

Copy `.env.example` to `.env` and fill in:

```
RPA_AUTH_TOKEN=your-secret-token
ANTHROPIC_API_KEY=sk-ant-...
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
