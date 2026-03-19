# Windows VM — System Details

## Machine

| Field | Value |
|---|---|
| Device name | EC2AMAZ-H35KUGL |
| Platform | AWS EC2 |
| Processor | Intel Xeon Platinum 8259CL @ 2.50GHz |
| RAM | 4 GB |
| System type | 64-bit, x64 |
| OS | Windows Server 2019 Datacenter |
| OS version | 1809 (build 17763.8276) |
| Installed on | 2/27/2026 |

## Access

- Remote access via **AnyDesk**

## Installed Software

| Software | Version | Notes |
|---|---|---|
| OceanJet PRIME | Build 20231109E | Pre-installed, Delphi VCL app |
| Python | 3.12.9 | Installed via `python.org`, uses `py` command |
| pywinauto | latest | `py -m pip install pywinauto` |
| Pillow | latest | `py -m pip install Pillow` (screenshot capture) |
| pyperclip | latest | `py -m pip install pyperclip` |
| Accessibility Insights | latest | UI element inspector |

## Notes

- `pip` is not on PATH directly — use `py -m pip` instead
- Python is accessible via `py` command (not `python`)
- TLS downloads via PowerShell require `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12` on this OS version

## Purpose

Runs the Python RPA agent that drives OceanJet PRIME to issue tickets. The TypeScript orchestrator (this project) communicates with the RPA agent via HTTP.
