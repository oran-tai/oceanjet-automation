"""pywinauto driver for OceanJet PRIME desktop application."""

import logging
import re
import time

import io

from google import genai
from google.genai import types
from pywinauto import Desktop, Application, timings
from pywinauto.keyboard import send_keys

from agent.config import PRIME_WINDOW_TITLE, PRIME_TIMEOUT_SEC, GEMINI_API_KEY
from agent.date_utils import bookaway_date_to_prime, match_departure_time
from agent.error_codes import TicketErrorCode, PrimeError, SYSTEM_ERROR_CODES

logger = logging.getLogger("rpa-agent")

# Gender mapping: Bookaway -> PRIME
GENDER_MAP = {"Male": "M", "Female": "F", "male": "M", "female": "F"}


class PrimeDriver:
    """Drives OceanJet PRIME's Issue New Ticket screen via pywinauto."""

    def __init__(self):
        """Connect to the running PRIME application via UIA backend."""
        try:
            self.app = Application(backend="uia").connect(
                title=PRIME_WINDOW_TITLE, timeout=PRIME_TIMEOUT_SEC
            )
            self.main_window = self.app.window(title=PRIME_WINDOW_TITLE)
        except Exception as e:
            raise PrimeError(
                TicketErrorCode.PRIME_CRASH,
                f"Failed to connect to PRIME: {e}",
            )

        self.gemini_client = genai.Client(api_key=GEMINI_API_KEY)

    def verify_issue_new_ticket_screen(self):
        """Verify that PRIME is on the Issue New Ticket screen.

        Assumes the operator has already navigated to this screen.
        Uses 'Trip Details' pane as the check since 'ISSUE NEW TICKET'
        matches two nested panes and causes ambiguity.
        """
        trip_details = self.main_window.child_window(
            title_re=" *Trip Details *", control_type="Pane"
        )
        if not trip_details.exists(timeout=5):
            raise PrimeError(
                TicketErrorCode.RPA_INTERNAL_ERROR,
                "PRIME is not on the Issue New Ticket screen. "
                "Please navigate to Transactions > Passage > Issue New Ticket first.",
            )
        logger.info("Verified: on Issue New Ticket screen")

    def _get_trip_details_pane(self):
        """Get the Trip Details pane."""
        return self.main_window.child_window(
            title_re=" *Trip Details *", control_type="Pane"
        )

    def _get_personal_details_pane(self):
        """Get the Personal Details pane."""
        return self.main_window.child_window(
            title_re=" *Personal Details *", control_type="Pane"
        )

    def _get_trip_type_pane(self):
        """Get the Trip Type pane within Trip Details."""
        return self._get_trip_details_pane().child_window(
            title_re=" *Trip Type *", control_type="Pane"
        )

    def click_refresh(self):
        """Click the Refresh button to reset the form between passengers."""
        logger.info("Clicking Refresh to reset form")
        try:
            refresh_btn = self.main_window.child_window(
                title="Refresh", control_type="Button"
            )
            refresh_btn.click_input()
            time.sleep(1)
        except Exception as e:
            raise PrimeError(
                TicketErrorCode.RPA_INTERNAL_ERROR,
                f"Failed to click Refresh: {e}",
            )

    def fill_trip_details(self, leg, trip_type: str, return_leg=None):
        """Fill the Trip Details pane.

        Args:
            leg: Dict with origin, destination, date, time, accommodation.
            trip_type: "One Way" or "Round Trip".
            return_leg: Optional dict for return trip details.
        """
        logger.info(
            f"Filling trip details: {leg['origin']}->{leg['destination']} "
            f"on {leg['date']} at {leg['time']} ({trip_type})"
        )
        trip_details = self._get_trip_details_pane()
        trip_type_pane = self._get_trip_type_pane()

        # 1. Select trip type radio button
        radio = trip_type_pane.child_window(
            title=trip_type, control_type="RadioButton"
        )
        radio.click_input()
        time.sleep(0.3)

        edits = trip_details.children(control_type="Edit")
        combos = trip_details.children(control_type="ComboBox")
        buttons = trip_details.children(control_type="Button")

        # 2. Fill departure date (edit[1] in tree order)
        prime_date = bookaway_date_to_prime(leg["date"])
        departure_date_edit = edits[1]
        departure_date_edit.click_input()
        send_keys("{HOME}")
        send_keys(prime_date, with_spaces=True)
        time.sleep(0.3)

        # 3. Fill return date if round-trip (edit[0])
        if trip_type == "Round Trip" and return_leg:
            logger.info(
                f"Filling return date: {return_leg['date']}"
            )
            return_date = bookaway_date_to_prime(return_leg["date"])
            return_date_edit = edits[0]
            return_date_edit.click_input()
            send_keys("{HOME}")
            send_keys(return_date, with_spaces=True)
            time.sleep(0.3)

        # 4. Select origin (combo_box[2])
        origin_combo = combos[2]
        try:
            origin_combo.select(leg["origin"])
        except Exception:
            raise PrimeError(
                TicketErrorCode.STATION_NOT_FOUND,
                f"Origin station '{leg['origin']}' not found in PRIME dropdown",
            )
        time.sleep(0.3)

        # 5. Select destination (combo_box[1])
        dest_combo = combos[1]
        try:
            dest_combo.select(leg["destination"])
        except Exception:
            raise PrimeError(
                TicketErrorCode.STATION_NOT_FOUND,
                f"Destination station '{leg['destination']}' not found in PRIME dropdown",
            )
        time.sleep(0.3)

        # 6. Click departure voyage search button (button[1])
        voyage_search_btn = buttons[1]
        voyage_search_btn.click_input()
        time.sleep(1)

        # 7. Select departure voyage via Gemini Vision
        voyage_no = self.select_voyage(leg["time"])
        logger.info(f"Selected departure voyage: {voyage_no}")
        time.sleep(0.5)

        # 8. If round-trip, search and select return voyage
        if trip_type == "Round Trip" and return_leg:
            logger.info(
                f"Selecting return voyage: {return_leg['time']}"
            )
            # Return voyage search (button[0])
            return_search_btn = buttons[0]
            return_search_btn.click_input()
            time.sleep(1)

            # Select return voyage via Gemini Vision
            return_voyage_no = self.select_voyage(return_leg["time"])
            logger.info(f"Selected return voyage: {return_voyage_no}")
            time.sleep(0.5)

        # 9. Select accommodation (combo_box[0])
        accom_combo = combos[0]
        try:
            accom_combo.select(leg["accommodation"])
        except Exception:
            raise PrimeError(
                TicketErrorCode.ACCOMMODATION_UNAVAILABLE,
                f"Accommodation '{leg['accommodation']}' not found in PRIME dropdown",
            )
        time.sleep(0.3)

    def _close_voyage_dialog(self, voyage_dlg):
        """Reliably close the Voyage Schedule dialog.

        Delphi forms may not respond to .close() — use the C&lose button
        or Alt+F4 as fallbacks, then verify it's gone.
        """
        try:
            close_btn = voyage_dlg.child_window(title="C&lose", control_type="Button")
            if close_btn.exists(timeout=1):
                close_btn.click_input()
                time.sleep(0.5)
                return
        except Exception:
            pass

        try:
            voyage_dlg.close()
            time.sleep(0.5)
            if not voyage_dlg.exists(timeout=1):
                return
        except Exception:
            pass

        # Last resort
        send_keys("%{F4}")
        time.sleep(0.5)

    def select_voyage(self, target_time: str) -> str:
        """Select a voyage from the Voyage Schedule dialog using Gemini Vision.

        Args:
            target_time: Target departure time, e.g. "1:00 PM".

        Returns:
            Voyage number string for logging.

        Raises:
            PrimeError: If no voyages found or time doesn't match.
        """
        logger.info(f"Selecting voyage for departure time: {target_time}")

        # Find the Voyage Schedule dialog — it's a separate top-level window
        try:
            desktop = Desktop(backend="uia")
            voyage_dlg = desktop.window(title="Voyage Schedule")
            voyage_dlg.wait("visible", timeout=PRIME_TIMEOUT_SEC)
        except Exception as e:
            raise PrimeError(
                TicketErrorCode.PRIME_TIMEOUT,
                f"Voyage Schedule dialog did not appear: {e}",
            )

        # Capture screenshot of the dialog using PIL ImageGrab
        # (more reliable than capture_as_image with 32-bit Delphi apps)
        try:
            from PIL import ImageGrab
            rect = voyage_dlg.rectangle()
            grid_image = ImageGrab.grab(bbox=(
                rect.left, rect.top, rect.right, rect.bottom
            ))
        except Exception as e:
            raise PrimeError(
                TicketErrorCode.RPA_INTERNAL_ERROR,
                f"Failed to capture Voyage Schedule screenshot: {e}",
            )

        # Send to Gemini Vision API for grid parsing
        prompt = (
            "This is a screenshot of a voyage schedule grid from a ferry booking system. "
            "Extract ALL rows from the grid as a JSON array. Each row should be an object with:\n"
            '- "voyage_number": the voyage number (e.g., "OJ884A")\n'
            '- "departure_time": the departure date/time (e.g., "3/27/2026 7:30:00 AM")\n'
            '- "origin": origin code\n'
            '- "destination": destination code\n\n'
            "Return ONLY the JSON array, no other text. "
            "If the grid is empty (no data rows), return an empty array []."
        )

        # Convert PIL image to bytes for the Gemini API
        img_buffer = io.BytesIO()
        grid_image.save(img_buffer, format="PNG")
        image_bytes = img_buffer.getvalue()

        try:
            response = self.gemini_client.models.generate_content(
                model="gemini-flash-latest",
                contents=[
                    prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                ],
            )
        except Exception as e:
            raise PrimeError(
                TicketErrorCode.RPA_INTERNAL_ERROR,
                f"Gemini Vision API call failed: {e}",
            )

        # Parse the response
        import json

        response_text = response.text.strip()
        # Strip markdown code fences if present
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            response_text = "\n".join(lines[1:-1])

        try:
            grid_rows = json.loads(response_text)
        except json.JSONDecodeError as e:
            raise PrimeError(
                TicketErrorCode.RPA_INTERNAL_ERROR,
                f"Failed to parse Gemini Vision response: {e}\nResponse: {response_text}",
            )

        if not grid_rows:
            self._close_voyage_dialog(voyage_dlg)
            raise PrimeError(
                TicketErrorCode.TRIP_NOT_FOUND,
                "Voyage Schedule grid is empty - no voyages available",
            )

        # Extract departure times for matching
        grid_times = [row.get("departure_time", "") for row in grid_rows]
        target_row = match_departure_time(target_time, grid_times)

        if target_row is None:
            self._close_voyage_dialog(voyage_dlg)
            raise PrimeError(
                TicketErrorCode.VOYAGE_TIME_MISMATCH,
                f"No voyage matches departure time {target_time}. "
                f"Available times: {grid_times}",
            )

        # Navigate to the target row using arrow keys
        # Click on the dialog to ensure it has focus
        voyage_dlg.click_input()
        time.sleep(0.2)

        # Press Ctrl+Home to go to first row, then Down arrow to target row
        send_keys("^{HOME}")
        time.sleep(0.1)
        for _ in range(target_row):
            send_keys("{DOWN}")
            time.sleep(0.1)

        # Click Select button
        try:
            select_btn = voyage_dlg.child_window(title="Select", control_type="Button")
            select_btn.click_input()
        except Exception:
            # Fallback: press Enter
            send_keys("{ENTER}")

        time.sleep(0.5)

        voyage_number = grid_rows[target_row].get("voyage_number", "unknown")
        return voyage_number

    def fill_personal_details(self, passenger, contact_info: str = ""):
        """Fill the Personal Details pane for one passenger.

        Args:
            passenger: Dict with firstName, lastName, age, gender.
            contact_info: Contact info string (booking email).
        """
        logger.info(
            f"Filling personal details: {passenger['firstName']} {passenger['lastName']}"
        )
        personal = self._get_personal_details_pane()
        edits = personal.children(control_type="Edit")
        combos = personal.children(control_type="ComboBox")

        # First Name (edit[2])
        edits[2].click_input()
        send_keys("^a")
        send_keys(passenger["firstName"], with_spaces=True)
        time.sleep(0.2)

        # Last Name (edit[3])
        edits[3].click_input()
        send_keys("^a")
        send_keys(passenger["lastName"], with_spaces=True)
        time.sleep(0.2)

        # Age (edit[5])
        edits[5].click_input()
        send_keys("^a")
        send_keys(str(passenger["age"]), with_spaces=True)
        time.sleep(0.2)

        # Sex (combo_box[0]): map "Male" -> "M", "Female" -> "F"
        gender_code = GENDER_MAP.get(passenger["gender"], passenger["gender"])
        combos[0].select(gender_code)
        time.sleep(0.2)

        # Contact Info (edit[0])
        if contact_info:
            edits[0].click_input()
            send_keys("^a")
            send_keys(contact_info, with_spaces=True)
            time.sleep(0.2)

    def click_issue(self):
        """Click the Issue button to submit the form."""
        logger.info("Clicking Issue button")
        try:
            issue_btn = self.main_window.child_window(
                title_re=" *Issue", control_type="Button"
            )
            issue_btn.click_input()
            time.sleep(1)
        except Exception as e:
            raise PrimeError(
                TicketErrorCode.RPA_INTERNAL_ERROR,
                f"Failed to click Issue button: {e}",
            )

    def handle_issue_result(self) -> list[str]:
        """Handle dialogs after clicking Issue and return ticket number(s).

        The Issue flow has two possible paths:
        1. Confirmation dialog ("Confirm" / "Continue issuing ticket?") → Yes
           → Success dialog ("Process Complete. Ticket number(s): [XXXXXXXX].")
        2. Validation error dialog (same title as main window, error message) → OK
           → raises PRIME_VALIDATION_ERROR

        Returns:
            List of ticket number strings extracted from the success dialog.
        """
        desktop = Desktop(backend="uia")

        # Wait for a dialog to appear — either Confirm or an error
        dialog = None
        for _ in range(PRIME_TIMEOUT_SEC * 2):
            # Check for confirmation dialog first
            try:
                confirm_dlg = desktop.window(title="Confirm")
                if confirm_dlg.exists(timeout=0.1):
                    dialog = confirm_dlg
                    break
            except Exception:
                pass

            # Check for error dialog (uses same title as PRIME main window)
            try:
                # Error dialogs are small windows with the app title
                windows = desktop.windows(title_re="OCEAN FAST FERRIES.*")
                for w in windows:
                    # Skip the main PRIME window itself
                    rect = w.rectangle()
                    width = rect.right - rect.left
                    if width < 700:  # Error dialogs are smaller than main window
                        dialog = w
                        break
                if dialog:
                    break
            except Exception:
                pass

            time.sleep(0.5)

        if dialog is None:
            raise PrimeError(
                TicketErrorCode.PRIME_TIMEOUT,
                "No dialog appeared after clicking Issue",
            )

        # Handle based on dialog type
        dialog_title = dialog.window_text()

        if dialog_title == "Confirm":
            return self._handle_confirm_dialog(dialog, desktop)
        else:
            return self._handle_error_dialog(dialog)

    def _handle_confirm_dialog(self, confirm_dlg, desktop) -> list[str]:
        """Click Yes on the confirmation dialog and handle the result."""
        logger.info("Confirmation dialog: 'Continue issuing ticket?' → clicking Yes")
        try:
            yes_btn = confirm_dlg.child_window(title="Yes", control_type="Button")
            yes_btn.click_input()
        except Exception:
            # Fallback: press Enter (Yes is typically focused)
            send_keys("{ENTER}")

        # Wait for PRIME to process the ticket — this can take a few seconds
        time.sleep(3)

        # Now wait for the result dialog — success or error
        # The success dialog has "Process Complete" text inside it.
        # We need to read the text BEFORE clicking OK.
        result_dlg = None
        for attempt in range(PRIME_TIMEOUT_SEC * 2):
            try:
                windows = desktop.windows(title_re="OCEAN FAST FERRIES.*")
                for w in windows:
                    rect = w.rectangle()
                    width = rect.right - rect.left
                    if width < 700:
                        # Found a small dialog — read its text to confirm
                        # it's a result dialog (not the main window)
                        result_dlg = w
                        break
                if result_dlg:
                    break
            except Exception:
                pass
            time.sleep(0.5)

        if result_dlg is None:
            raise PrimeError(
                TicketErrorCode.PRIME_TIMEOUT,
                "No result dialog appeared after confirming Issue",
            )

        # Wait for the dialog to fully render
        time.sleep(1)

        # Screenshot the dialog and send to Gemini to read the text
        # (Delphi paints the message directly — not accessible via UIA)
        dialog_text = self._read_dialog_via_screenshot(result_dlg)
        logger.info(f"Result dialog text: {dialog_text}")

        if "Process Complete" in dialog_text or "Ticket number" in dialog_text:
            # Success — extract ticket numbers from brackets [XXXXXXXX]
            # Extract ticket numbers — handles both [12345678] (one-way)
            # and [13023072,13023073] (round-trip, comma-separated in one bracket pair)
            ticket_numbers = re.findall(r"\d{7,}", dialog_text)
            logger.info(f"Ticket number(s) captured: {ticket_numbers}")

            # Click OK to close the success dialog
            try:
                ok_btn = result_dlg.child_window(title="OK", control_type="Button")
                ok_btn.click_input()
            except Exception:
                send_keys("{ENTER}")
            time.sleep(1)

            # Close the print preview that opens after ticket issuance
            self._close_print_preview(desktop)

            if not ticket_numbers:
                raise PrimeError(
                    TicketErrorCode.RPA_INTERNAL_ERROR,
                    f"CRITICAL: Ticket was issued but number could not be captured from: {dialog_text}",
                )

            return ticket_numbers
        else:
            # CRITICAL: We already clicked Yes on the Confirm dialog,
            # so a ticket was likely issued. If we can't read the success
            # message, we must treat this as a system error — retrying
            # would issue a duplicate ticket.
            logger.error(
                f"CRITICAL: Ticket may have been issued but could not read "
                f"success dialog. Text found: {dialog_text}"
            )

            # Close the dialog
            try:
                ok_btn = result_dlg.child_window(title="OK", control_type="Button")
                ok_btn.click_input()
            except Exception:
                send_keys("{ENTER}")
            time.sleep(1)

            # Close print preview if it appeared
            self._close_print_preview(desktop)

            raise PrimeError(
                TicketErrorCode.RPA_INTERNAL_ERROR,
                f"CRITICAL: Ticket likely issued but number not captured. "
                f"Dialog text: {dialog_text}. Manual intervention required.",
            )

    def _read_dialog_via_screenshot(self, dialog) -> str:
        """Read text from a PRIME dialog by screenshotting it and sending to Gemini.

        Delphi dialogs paint their message text directly on the window surface
        rather than using accessible label controls, so we need OCR via Gemini.
        """
        from PIL import ImageGrab

        try:
            rect = dialog.rectangle()
            screenshot = ImageGrab.grab(bbox=(
                rect.left, rect.top, rect.right, rect.bottom
            ))
        except Exception as e:
            logger.error(f"Failed to capture dialog screenshot: {e}")
            return dialog.window_text()

        prompt = (
            "This is a screenshot of a dialog box from a ferry ticketing system. "
            "Read ALL the text shown in the dialog and return it exactly as written. "
            "Include the full message text. Return ONLY the text content, nothing else."
        )

        img_buffer = io.BytesIO()
        screenshot.save(img_buffer, format="PNG")
        image_bytes = img_buffer.getvalue()

        try:
            response = self.gemini_client.models.generate_content(
                model="gemini-flash-latest",
                contents=[
                    prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                ],
            )
            text = response.text.strip()
            if text:
                return text
        except Exception as e:
            logger.error(f"Gemini Vision API call failed for dialog: {e}")

        return dialog.window_text()

    def _close_print_preview(self, desktop):
        """Close the print preview window that appears after issuing a ticket."""
        time.sleep(3)
        try:
            # Try common print preview window titles
            for title_pattern in ["Print Preview", "Preview", "Report"]:
                try:
                    preview = desktop.window(title_re=f".*{title_pattern}.*")
                    if preview.exists(timeout=3):
                        logger.info(f"Closing print preview: {preview.window_text()}")
                        preview.close()
                        time.sleep(0.5)
                        return
                except Exception:
                    continue

            # Fallback: look for any new window that isn't PRIME main or known dialogs
            windows = desktop.windows()
            for w in windows:
                try:
                    title = w.window_text()
                    if (title and
                        "OCEAN FAST FERRIES" not in title and
                        title not in ("", "Confirm", "Program Manager") and
                        "Start" not in title):
                        rect = w.rectangle()
                        width = rect.right - rect.left
                        if width > 400:  # Print preview is likely a sizeable window
                            logger.info(f"Closing unexpected window: {title}")
                            w.close()
                            time.sleep(0.5)
                            return
                except Exception:
                    continue

            logger.info("No print preview window found to close")
        except Exception as e:
            logger.warning(f"Failed to close print preview: {e}")

    def _handle_error_dialog(self, error_dlg) -> list[str]:
        """Handle a PRIME validation error dialog. Always raises PrimeError."""
        error_text = self._read_dialog_via_screenshot(error_dlg)

        logger.error(f"PRIME validation error: {error_text}")

        # Click OK to close the error dialog
        try:
            ok_btn = error_dlg.child_window(title="OK", control_type="Button")
            ok_btn.click_input()
        except Exception:
            send_keys("{ENTER}")
        time.sleep(0.5)

        # Detect specific error types from the message text
        error_lower = error_text.lower()
        if "sold out" in error_lower or "no available" in error_lower or "no seat" in error_lower:
            raise PrimeError(
                TicketErrorCode.TRIP_SOLD_OUT,
                error_text,
            )

        raise PrimeError(
            TicketErrorCode.PRIME_VALIDATION_ERROR,
            error_text,
        )

    def _build_ticket_tasks(self, booking: dict):
        """Build the list of (passenger_index, passenger, leg, trip_type, return_leg, label)
        tuples that represent each individual ticket to issue.

        Each task = one form fill + one Issue click = one ticket.
        """
        booking_type = booking["bookingType"]
        passengers = booking["passengers"]
        tasks = []

        if booking_type == "one-way":
            for i, pax in enumerate(passengers):
                tasks.append((
                    i, pax, booking["departureLeg"], "One Way", None,
                    f"Pax {i+1}/{len(passengers)} departure",
                    "departure",
                ))

        elif booking_type == "round-trip":
            for i, pax in enumerate(passengers):
                tasks.append((
                    i, pax, booking["departureLeg"], "Round Trip",
                    booking.get("returnLeg"),
                    f"Pax {i+1}/{len(passengers)} round-trip",
                    "round-trip",
                ))

        elif booking_type == "connecting-one-way":
            for i, pax in enumerate(passengers):
                for j, leg in enumerate(booking["connectingLegs"]):
                    tasks.append((
                        i, pax, leg, "One Way", None,
                        f"Pax {i+1}/{len(passengers)} leg {j+1}/2",
                        "departure",
                    ))

        elif booking_type == "connecting-round-trip":
            for i, pax in enumerate(passengers):
                for j, leg in enumerate(booking["connectingLegs"]):
                    tasks.append((
                        i, pax, leg, "One Way", None,
                        f"Pax {i+1}/{len(passengers)} dep leg {j+1}/2",
                        "departure",
                    ))
            for i, pax in enumerate(passengers):
                for j, leg in enumerate(booking["connectingReturnLegs"]):
                    tasks.append((
                        i, pax, leg, "One Way", None,
                        f"Pax {i+1}/{len(passengers)} ret leg {j+1}/2",
                        "return",
                    ))

        return tasks

    def fill_booking(self, booking: dict) -> dict:
        """Fill PRIME forms for an entire booking, tracking per-passenger results.

        Returns a dict with:
            success: bool - True if all passengers succeeded
            departureTickets: list[str] - ticket numbers for departure legs
            returnTickets: list[str] - ticket numbers for return legs
            partialResults: list[dict] - per-passenger results
            errorCode: str | None - error code if failed
            error: str | None - error message if failed
        """
        booking_type = booking["bookingType"]
        passengers = booking["passengers"]
        contact_info = booking.get("contactInfo", "")

        logger.info(
            f"Processing booking {booking.get('bookingId', 'N/A')} "
            f"({booking_type}, {len(passengers)} passengers)"
        )

        self.verify_issue_new_ticket_screen()

        tasks = self._build_ticket_tasks(booking)
        departure_tickets = []
        return_tickets = []

        # Track per-passenger results: {pax_index: {tickets, success, error}}
        pax_results = {}
        for i, pax in enumerate(passengers):
            pax_name = f"{pax['firstName']} {pax['lastName']}"
            pax_results[i] = {
                "passengerIndex": i,
                "passengerName": pax_name,
                "tickets": [],
                "success": False,
            }

        has_failure = False
        last_error_code = None
        last_error_msg = None

        for pax_idx, pax, leg, trip_type, return_leg, label, leg_type in tasks:
            logger.info(f"--- {label} ---")
            try:
                self.click_refresh()
                self.fill_trip_details(leg, trip_type, return_leg=return_leg)
                self.fill_personal_details(pax, contact_info)

                # Click Issue, handle confirmation, capture ticket number(s)
                self.click_issue()
                ticket_numbers = self.handle_issue_result()
                logger.info(f"Issued {len(ticket_numbers)} ticket(s) for {label}: {ticket_numbers}")

                pax_results[pax_idx]["success"] = True
                for ticket_no in ticket_numbers:
                    pax_results[pax_idx]["tickets"].append(ticket_no)

                if leg_type == "round-trip" and len(ticket_numbers) == 2:
                    # Round-trip: PRIME returns 2 tickets per passenger
                    # First = departure, second = return
                    departure_tickets.append(ticket_numbers[0])
                    return_tickets.append(ticket_numbers[1])
                elif leg_type == "return":
                    for ticket_no in ticket_numbers:
                        return_tickets.append(ticket_no)
                else:
                    for ticket_no in ticket_numbers:
                        departure_tickets.append(ticket_no)

            except PrimeError as e:
                has_failure = True
                last_error_code = e.error_code
                last_error_msg = e.message
                pax_results[pax_idx]["success"] = False
                pax_results[pax_idx]["errorCode"] = e.error_code.value
                pax_results[pax_idx]["error"] = e.message
                logger.error(
                    f"FAILED {label}: [{e.error_code.value}] {e.message}"
                )

                # System-level errors: stop processing entirely
                if e.error_code in SYSTEM_ERROR_CODES:
                    logger.error("System-level error, stopping booking")
                    break

                # Booking-level errors: stop processing — if the data is wrong
                # for one passenger, it'll be wrong for all of them
                try:
                    self.click_refresh()
                except Exception:
                    pass
                break

        partial_results = list(pax_results.values())
        any_success = any(r["success"] for r in partial_results)

        if not has_failure:
            logger.info(f"Booking {booking.get('bookingId', 'N/A')} complete — all passengers OK")
            return {
                "success": True,
                "departureTickets": departure_tickets,
                "returnTickets": return_tickets,
                "partialResults": None,
            }

        if any_success:
            # Partial failure: some passengers succeeded, some failed
            logger.warn(
                f"Booking {booking.get('bookingId', 'N/A')} partial failure"
            )
            return {
                "success": False,
                "departureTickets": departure_tickets,
                "returnTickets": return_tickets,
                "errorCode": last_error_code.value if last_error_code else None,
                "error": last_error_msg,
                "partialResults": partial_results,
            }

        # Total failure: all passengers failed
        logger.error(
            f"Booking {booking.get('bookingId', 'N/A')} total failure"
        )
        return {
            "success": False,
            "departureTickets": [],
            "returnTickets": [],
            "errorCode": last_error_code.value if last_error_code else None,
            "error": last_error_msg,
            "partialResults": partial_results,
        }
