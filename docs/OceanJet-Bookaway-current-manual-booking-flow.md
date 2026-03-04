# OceanJet & Bookaway: Current Manual Booking Workflow

This document outlines the step-by-step manual process currently executed by Operations Agents to fulfill OceanJet bookings using the Bookaway Admin UI and the OceanJet PRIME desktop application.

## Phase 1: System Access & Queue Management

To begin working on the queue, the agent must set up their workspace across two separate systems.

1. **Log into PRIME:** The agent opens the OceanJet Prime Software desktop application. They enter their assigned Username (e.g., `traveler`) and Password (e.g., `bookaway10`), then click "Sign in".
2. **Access Bookaway Admin:** The agent navigates to the Bookaway Admin web portal (`admin.bookaway.com`).
3. **Filter the Queue:** The agent sets up the view to find urgent bookings by applying the following filters:
* **Sort:** Departure date, earliest first.
* **Status:** Pending.
* **Supplier:** OceanJet.



---

## Phase 2: Booking Selection & Locking

The agent must carefully select a booking to avoid duplicating work with other agents.

1. **Scan for Availability:** The agent scrolls through the filtered list of pending bookings and looks specifically at the "At Work" column. An unchecked box indicates the booking is available, while a checked box means another agent is already working on it.
2. **Select and Lock:** The agent clicks the checkbox in the "At Work" column for an available booking. This immediately marks the booking as in progress, effectively locking it so others know it is being handled.
3. **Review Itinerary:** Once locked, the agent opens the booking in peace to review the critical trip details: Route (e.g., Bohol to Cebu), Class (e.g., Tourist class), Date, Time, and Passenger Details.

---

## Phase 3: Data Translation & PRIME Entry

This is the most time-consuming phase, as the agent must manually translate Bookaway's formatting into OceanJet's specific requirements.

1. **Navigate to Ticketing:** In PRIME, the agent goes to **Transactions -> Passage -> Issue New Ticket**.
2. **Trip Type:** The agent selects "One Way" (or Round Trip, depending on the booking).
3. **Date & Station Mapping:** The agent enters the departure date. They must manually recall and input the correct 3-letter station codes based on the Bookaway city names. For example, if Bookaway says "Bohol to Cebu", the agent types `TAG` (for Tagbilaran) as the origin and `CEB` as the destination.
4. **Time Conversion:** The agent clicks to view the available voyages. Bookaway displays time in a 24-hour format, while OceanJet PRIME uses a 12-hour AM/PM format, requiring the agent to mentally convert the time and select the correct row.
5. **Class Mapping:** The agent selects the Accommodation Type Code. They map Bookaway's class to PRIME's codes (e.g., "Tourist Class" maps to `TC`, "Business Class" maps to `BC`, "Open-Air" maps to `OA`).
6. **Passenger Details:** The agent copies the First Name, Last Name, Age, and Sex from the Bookaway UI and pastes/types them into the respective fields in PRIME.

*Note: Because PRIME only allows one passenger to be booked at a time, if the Bookaway booking has multiple passengers, the agent must repeat this entire PRIME entry process for each individual passenger.*

---

## Phase 4: Ticket Issuance & Temporary Storage

OceanJet's software has a critical UX limitation requiring a manual workaround.

1. **Issue Ticket:** Once passenger details are entered, the agent clicks "Issue", then clicks "Yes" to confirm.
2. **Capture Ticket Number:** A success dialog pops up containing the generated Ticket Number.
3. **Temporary Paste:** Because clicking "OK" closes the dialog and makes the ticket number disappear permanently from that screen, the agent must carefully highlight, copy, and paste the ticket number into a temporary external document, like an Excel spreadsheet or a Notepad file.

---

## Phase 5: Bookaway Approval

The agent finalizes the process by moving the data back into Bookaway.

1. **Initiate Approval:** The agent returns to the Bookaway Admin UI and clicks the green "Approve" button on the booking.
2. **Enter Codes:** A modal appears. The agent copies the ticket number(s) from their temporary Excel/Notepad file and pastes them into the "Booking code" field.
3. **Assign to Passenger:** The agent also pastes the specific ticket number into the dedicated seat number field for the corresponding passenger (e.g., "Passenger 1").
4. **Finalize:** The agent clicks "Approve" in the modal to change the booking status from Pending to Approved. They can then return to the main queue to start the process over.

---