# Plan: Persistent Logging — Local Daily Files

## Context

Both services (orchestrator + RPA agent) currently log to console only. Logs are lost on process restart. Now running in continuous mode processing 300-400 bookings/day, we need persistent logs for debugging and auditing.

**Volume estimate:** ~10-15 MB/day total. At 14 days retention: ~200 MB. Local files are sufficient — Coralogix can be added later if needed.

**Approach:** Two log destinations for each service:
1. Console (keep existing — real-time visibility on VM)
2. Local daily log files with auto-rotation and 14-day retention

## Changes

### 1. Orchestrator: Add daily rotating file transport

**File:** `orchestrator/src/utils/logger.ts`

Install `winston-daily-rotate-file` and add a file transport:
- Path: `logs/orchestrator-%DATE%.log`
- Date pattern: `YYYY-MM-DD`
- Max files: `14d` (auto-delete after 14 days)
- Format: JSON (same as current, with timestamp + redaction)
- `winston-daily-rotate-file` auto-creates the `logs/` directory

### 2. RPA Agent: Add daily rotating file handler

**File:** `rpa-agent/agent/server.py`

Add Python's `TimedRotatingFileHandler`:
- Path: `logs/rpa-agent.log`
- Rotation: daily (`when='midnight'`)
- Backup count: 14 (keep 14 days)
- Same format as existing console output
- Create `logs/` directory with `os.makedirs('logs', exist_ok=True)`

### 3. Update .gitignore

**File:** `.gitignore` (root)

Add `logs/` directory exclusion. (`*.log` is already excluded but explicit directory exclusion is cleaner.)

## Files Modified
1. `orchestrator/src/utils/logger.ts` — add file transport
2. `orchestrator/package.json` — add `winston-daily-rotate-file`
3. `rpa-agent/agent/server.py` — add file handler
4. `.gitignore` — add `logs/`

## Log file locations on VM
- `C:\oceanjet-automation\orchestrator\logs\orchestrator-2026-03-31.log`
- `C:\oceanjet-automation\rpa-agent\logs\rpa-agent.log` (rotated daily to `rpa-agent.log.2026-03-31`)

## Verification
1. `npm test` — existing tests still pass
2. Run orchestrator locally with `OPERATOR_MODE=mock` → verify `logs/orchestrator-YYYY-MM-DD.log` is created with JSON entries
3. Run RPA agent → verify `logs/rpa-agent.log` is created
4. On VM: update, run both services, confirm log files appear
