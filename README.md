# OceanJet Automated Booking Integration

Automates OceanJet ferry ticket issuance from Bookaway bookings. Two microservices run on a Windows VM alongside the OceanJet PRIME desktop app.

## Architecture

```
Windows VM
├── PRIME desktop app                    (OceanJet ticketing system)
├── RPA Agent    (Python, port 8080)     (drives PRIME UI)
└── Orchestrator (Node.js)               (polls Bookaway, sends to RPA, approves)
```

The **Orchestrator** polls Bookaway for pending bookings, translates them to OceanJet format, and sends them to the **RPA Agent** via HTTP. The RPA Agent fills the PRIME form, clicks Issue, captures the ticket number, and returns it. The Orchestrator then approves the booking on Bookaway with the real ticket number.

## Quick Start (Fresh VM)

Open PowerShell and run:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
iwr -Uri 'https://raw.githubusercontent.com/oran-tai/oceanjet-automation/main/setup.ps1' -OutFile setup.ps1
.\setup.ps1
```

This installs Git, Node.js, clones the repo, installs dependencies, and prompts for API keys.

## Running

1. Open PRIME and log in to Issue New Ticket
2. Double-click **Start RPA Agent** on desktop
3. Double-click **Start Orchestrator** on desktop

To process a single booking, set `TARGET_BOOKING=BW1234567` in `orchestrator/.env`.

## Updating

```
update-oceanjet
```

## Project Structure

```
oceanjet-automation/
├── orchestrator/          TypeScript — Bookaway API, booking translation, approval
│   ├── src/
│   ├── tests/
│   ├── package.json
│   └── .env.example
├── rpa-agent/             Python — PRIME UI automation via pywinauto
│   ├── agent/
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
├── docs/                  API docs, PRD, reference sheets
├── setup.ps1              VM setup script
└── CLAUDE.md              Project conventions
```

## Documentation

- [PRD](docs/PRD-OceanJet-Automated-Booking-Integration.md)
- [Bookaway API Docs](docs/bookaway-backoffice-API-documentation-v2.md)
- [Implementation Status](docs/implementation-status.md)
- [PRIME UI Inspection](docs/prime-ui-inspection.md)
- [OceanJet Inventory Reference](docs/oceanjet-inventory-reference-sheet.md)
