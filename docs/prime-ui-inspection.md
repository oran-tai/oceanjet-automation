# PRIME UI Inspection Report

**Last updated:** March 19, 2026

---

## Application Details

| Field | Value |
|---|---|
| Window title | `Prime Software - OCEAN FAST FERRIES CORPORATION Build 20231109E` |
| UI framework | **Delphi VCL** (Borland/Embarcadero) |
| Class names | `TDataFormBaseGenericSelectForm`, `TDBGrid`, `TButton`, `TPanel`, `TEdit`, `TScrollBox`, `TToolBar` |
| pywinauto backend | **`win32`** for Delphi class names, **`uia`** for control tree navigation |

## Key Discovery: Control Tree Order

The Accessibility Insights / UIA control tree lists children in **reverse visual order** (bottom-to-top). The first child in the tree corresponds to the bottom-most visual element. All index mappings below account for this.

## Identifying Controls Without Names

Most leaf controls (Edit, ComboBox) have no `Name` property. We identify them using:

1. **Parent pane name + child index** — pane names exist (`'Trip Details'`, `'Personal Details'`, `'Trip Type'`), and child order within each pane is stable
2. **Control type filtering** — e.g., `trip_details.children(control_type='Edit')[1]` for the departure date
3. **BoundingRectangle** — fixed coordinates as a fallback (PRIME runs at fixed resolution)

---

## ISSUE NEW TICKET Screen

Accessed via: **Transactions → Passage → Issue New Ticket** (left sidebar tree)

### Page Structure (UIA tree)

```
window 'Prime Software - OCEAN FAST FERRIES CORPORATION Build 20231109E'
└── pane ''
    └── tab ''
        └── pane 'ISSUE NEW TICKET'
            └── pane 'ISSUE NEW TICKET'
                └── pane ''
                    ├── pane 'Special Terminal Fee (Optional)'
                    ├── pane 'Trip Availability'
                    ├── pane 'Rates'
                    ├── pane 'Promo /Discounts'
                    ├── pane 'Personal Details'
                    ├── pane 'Trip Details'
                    │   └── pane 'Trip Type'
                    ├── button 'Issue'
                    └── button 'Close'
```

### pane 'Trip Details' — Control Map

**Important:** Tree index 0 = bottom-most visual element (Accom. Type Code). The visual layout is top-to-bottom, but the tree is bottom-to-top.

| Tree Index | Control Type | Visual Field | Notes |
|---|---|---|---|
| combo box [0] | ComboBox | **Accom. Type Code** | Dropdown: TC, BC, OA |
| edit [0] | Edit | **Return Date** | Format: `_M/DD/YY` |
| edit [1] | Edit | **Departure Date** | Format: `_M/DD/YY` |
| button [0] | Button `...` | **Return Voyage search** | Opens Voyage Schedule for return |
| edit [2] | Edit | **Return Voy. No.** | Auto-filled after voyage selection |
| button [1] | Button `...` | **Voyage search** | Opens Voyage Schedule for departure |
| edit [3] | Edit | **Voyage No.** | Auto-filled after voyage selection |
| combo box [1] | ComboBox | **Destination** | Station codes: TAG, CEB, SIQ, etc. |
| combo box [2] | ComboBox | **Origin** | Station codes: TAG, CEB, SIQ, etc. |
| pane 'Trip Type' | Pane | **Trip Type container** | Contains radio buttons |

### pane 'Trip Type' — Control Map

| Control | Type | Name |
|---|---|---|
| radio button | RadioButton | `'One Way'` |
| radio button | RadioButton | `'Round Trip'` |

Radio buttons **have names** — can be targeted directly by title.

### pane 'Personal Details' — Control Map

**Same reversed order as Trip Details.** Tree index 0 = bottom-most visual element.

| Tree Index | Control Type | Visual Field | Used? | Notes |
|---|---|---|---|---|
| edit [0] | Edit | **Contact Info.** | Yes | Fill with booking email |
| edit [1] | Edit | **ID Number** | No | Leave empty |
| combo box [0] | ComboBox | **Sex** | Yes | Options: `M` (male), `F` (female) |
| edit [2] | Edit | **First Name** | Yes | |
| edit [3] | Edit | **Last Name** | Yes | |
| edit [4] | Edit | **M.I.** | No | Leave empty |
| edit [5] | Edit | **Age** | Yes | Numeric input |

### Other Panes (read-only, no interaction needed)

| Pane | Purpose | Interaction |
|---|---|---|
| `'Trip Availability'` | Shows Voyage No., Depart. Date, Capacity, Available, Total Seats, WL No. | Read-only — auto-populates after voyage selection |
| `'Rates'` | Shows Accom Desc., Trip, Accom Code, Mode of Payment, Charge to | Read-only — shows `TRAVELERTICK` |
| `'Promo /Discounts'` | Promo Code, Discount Code fields | Not used |
| `'Special Terminal Fee (Optional)'` | Terminal fee fields | Not used |

### Action Buttons

| Button | Name | Action |
|---|---|---|
| **Issue** | `'Issue'` | Submits the ticket — triggers confirmation dialog |
| **Close** | `'Close'` | Closes the ISSUE NEW TICKET tab |
| **Refresh** | `'Refresh'` | Resets the form |

---

## Voyage Schedule Dialog

Opened by clicking the `...` button next to Voyage No. or Return Voy. No.

### Window Details

| Field | Value |
|---|---|
| Window title | `Voyage Schedule` |
| Class name (win32) | `TDataFormBaseGenericSelectForm` |

### Control Tree (win32 backend)

```
TDataFormBaseGenericSelectForm 'Voyage Schedule'
├── Toolbar 'ToolBar1' (class: TToolBar)
│   ├── Button 'Show'
│   ├── Button 'Refresh'
│   ├── Button 'Select'
│   └── Button 'Sort...'
├── Static '' (class: TPanel) — search bar area
│   ├── Button 'GO'
│   └── Edit '' — Simple Search input
├── TScrollBox → TDBGrid — the voyage data grid
├── TScrollBox — bottom button bar
│   ├── Button 'Maintenance'
│   └── Button 'C&lose'
└── TitleBar (Minimize, Maximize, Close)
```

### Grid Columns

| Column | Example Value |
|---|---|
| Start Date | 3/27/2026 |
| Voyage Number | OJ884A |
| Origin Code | TAG |
| Dest. Code | SIQ |
| Departure Date | 3/27/2026 7:30:00 AM |
| Arrival Date | 3/27/2026 9:30:00 AM |

### Reading the Grid — Approach Decision

We tested multiple approaches to read the TDBGrid data:

| Approach | Result |
|---|---|
| `grid.texts()` / `grid.window_text()` (win32) | **Empty** — TDBGrid doesn't expose text via Win32 messages |
| UIA control tree | **No cell controls** — grid appears as opaque `Pane` with scroll bars only |
| Ctrl+A → Ctrl+C (clipboard) | **Empty** — TDBGrid doesn't support clipboard copy |
| `capture_as_image()` → screenshot | **Works** — returns a PIL image of the grid (500x312 px) |
| Keyboard navigation (arrow keys) | **Works** — Up/Down arrows move row selection |
| Tesseract OCR | **Not installed** — download failed due to TLS issues on Windows Server 2019 |

**Chosen approach: Screenshot → Claude API (vision)**

1. Capture grid screenshot via `grid.capture_as_image()`
2. Send to Claude API with a prompt asking to extract departure times and row positions
3. Match the target departure time to the correct row number
4. Use keyboard arrow keys (`{DOWN}` / `{UP}`) to navigate to that row
5. Double-click or click `Select` button to select the voyage

This is reliable, handles any grid layout, and the grid is small (<10 rows typically) so the API call is fast and cheap.

### Selecting a Voyage

- **Double-click** a row to select it, OR
- Navigate with arrow keys and click the **Select** toolbar button
- After selection, the dialog closes and the main form's Voyage No., ETD, ETA fields auto-populate

---

## Post-Inspection: Remaining Open Questions

- [ ] What happens after clicking **Issue**? (confirmation dialog details)
- [ ] What does the **success dialog** look like? (ticket number location)
- [ ] What does a **failure/error dialog** look like?
- [ ] Does PRIME have any idle timeout or auto-logout?
- [ ] Exact behavior when a station code is not found in Origin/Destination dropdown
- [ ] What happens when Voyage Schedule shows no voyages (empty grid)?

---

## pywinauto Backend Summary

| Backend | Use Case |
|---|---|
| `win32` | Delphi-specific class names (`TDBGrid`, `TButton`, `TPanel`), toolbar access |
| `uia` | Control tree hierarchy, pane names, radio button names, `print_control_identifiers()` |

Both backends can connect to PRIME. Use `win32` for the Voyage Schedule dialog (TDBGrid access), and `uia` for the main ISSUE NEW TICKET form (pane-based navigation).
