"""pywinauto driver for OceanJet PRIME desktop application."""

import logging
import time

import io

from google import genai
from google.genai import types
from pywinauto import Desktop, Application, timings
from pywinauto.keyboard import send_keys

from agent.config import PRIME_WINDOW_TITLE, PRIME_TIMEOUT_SEC, GEMINI_API_KEY
from agent.date_utils import bookaway_date_to_prime, match_departure_time
from agent.error_codes import TicketErrorCode, PrimeError

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
        """
        issue_pane = self.main_window.child_window(
            title="ISSUE NEW TICKET", control_type="Pane"
        )
        if not issue_pane.exists(timeout=5):
            raise PrimeError(
                TicketErrorCode.RPA_INTERNAL_ERROR,
                "PRIME is not on the Issue New Ticket screen. "
                "Please navigate to Transactions > Passage > Issue New Ticket first.",
            )
        logger.info("Verified: on Issue New Ticket screen")

    def _get_issue_pane(self):
        """Get the innermost ISSUE NEW TICKET pane."""
        return (
            self.main_window.child_window(
                title="ISSUE NEW TICKET", control_type="Pane"
            )
            .child_window(title="ISSUE NEW TICKET", control_type="Pane")
            .child_window(title="", control_type="Pane")
        )

    def _get_trip_details_pane(self):
        """Get the Trip Details pane."""
        return self._get_issue_pane().child_window(
            title="Trip Details", control_type="Pane"
        )

    def _get_personal_details_pane(self):
        """Get the Personal Details pane."""
        return self._get_issue_pane().child_window(
            title="Personal Details", control_type="Pane"
        )

    def _get_trip_type_pane(self):
        """Get the Trip Type pane within Trip Details."""
        return self._get_trip_details_pane().child_window(
            title="Trip Type", control_type="Pane"
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

        # 2. Fill departure date (edit[1] in tree order)
        prime_date = bookaway_date_to_prime(leg["date"])
        edits = trip_details.children(control_type="Edit")
        departure_date_edit = edits[1]
        departure_date_edit.click_input()
        # Select all existing text and type over it
        send_keys("^a")
        send_keys(prime_date, with_spaces=True)
        time.sleep(0.3)

        # 3. Select origin (combo_box[2])
        combos = trip_details.children(control_type="ComboBox")
        origin_combo = combos[2]
        origin_combo.select(leg["origin"])
        time.sleep(0.3)

        # 4. Select destination (combo_box[1])
        dest_combo = combos[1]
        dest_combo.select(leg["destination"])
        time.sleep(0.3)

        # 5. Click voyage search button (button[1])
        buttons = trip_details.children(control_type="Button")
        voyage_search_btn = buttons[1]
        voyage_search_btn.click_input()
        time.sleep(1)

        # 6. Select voyage via Gemini Vision
        voyage_no = self.select_voyage(leg["time"])
        logger.info(f"Selected voyage: {voyage_no}")
        time.sleep(0.5)

        # 7. Select accommodation (combo_box[0])
        accom_combo = combos[0]
        accom_combo.select(leg["accommodation"])
        time.sleep(0.3)

        # 8. If round-trip, fill return details
        if trip_type == "Round Trip" and return_leg:
            logger.info(
                f"Filling return trip: {return_leg['origin']}->{return_leg['destination']} "
                f"on {return_leg['date']} at {return_leg['time']}"
            )
            # Return date (edit[0])
            return_date = bookaway_date_to_prime(return_leg["date"])
            return_date_edit = edits[0]
            return_date_edit.click_input()
            send_keys("^a")
            send_keys(return_date, with_spaces=True)
            time.sleep(0.3)

            # Return voyage search (button[0])
            return_search_btn = buttons[0]
            return_search_btn.click_input()
            time.sleep(1)

            # Select return voyage
            return_voyage_no = self.select_voyage(return_leg["time"])
            logger.info(f"Selected return voyage: {return_voyage_no}")
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

        # Connect to the Voyage Schedule dialog via win32 backend
        try:
            voyage_app = Application(backend="win32").connect(
                title="Voyage Schedule", timeout=PRIME_TIMEOUT_SEC
            )
            voyage_dlg = voyage_app.window(title="Voyage Schedule")
        except Exception as e:
            raise PrimeError(
                TicketErrorCode.PRIME_TIMEOUT,
                f"Voyage Schedule dialog did not appear: {e}",
            )

        # Find the TDBGrid within TScrollBox
        try:
            grid = voyage_dlg.child_window(class_name="TDBGrid")
        except Exception as e:
            raise PrimeError(
                TicketErrorCode.RPA_INTERNAL_ERROR,
                f"Could not find voyage grid: {e}",
            )

        # Capture screenshot of the grid
        try:
            grid_image = grid.capture_as_image()
        except Exception as e:
            raise PrimeError(
                TicketErrorCode.RPA_INTERNAL_ERROR,
                f"Failed to capture grid screenshot: {e}",
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
            # Close the dialog before raising
            try:
                voyage_dlg.child_window(title="C&lose").click_input()
            except Exception:
                send_keys("%{F4}")
            raise PrimeError(
                TicketErrorCode.TRIP_NOT_FOUND,
                "Voyage Schedule grid is empty - no voyages available",
            )

        # Extract departure times for matching
        grid_times = [row.get("departure_time", "") for row in grid_rows]
        target_row = match_departure_time(target_time, grid_times)

        if target_row is None:
            # Close the dialog before raising
            try:
                voyage_dlg.child_window(title="C&lose").click_input()
            except Exception:
                send_keys("%{F4}")
            raise PrimeError(
                TicketErrorCode.VOYAGE_TIME_MISMATCH,
                f"No voyage matches departure time {target_time}. "
                f"Available times: {grid_times}",
            )

        # Navigate to the target row using arrow keys
        # First click on the grid to ensure it has focus
        grid.click_input()
        time.sleep(0.2)

        # Press Home to go to first row, then Down arrow to target row
        send_keys("{HOME}")
        time.sleep(0.1)
        for _ in range(target_row):
            send_keys("{DOWN}")
            time.sleep(0.1)

        # Click Select button on the toolbar
        try:
            select_btn = voyage_dlg.child_window(title="Select")
            select_btn.click_input()
        except Exception:
            # Fallback: double-click the grid row
            grid.double_click_input()

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

    def fill_booking(self, booking: dict):
        """Fill PRIME forms for an entire booking (Phase 1: no Issue click).

        Args:
            booking: TranslatedBooking dict from the orchestrator.
        """
        booking_type = booking["bookingType"]
        passengers = booking["passengers"]
        contact_info = booking.get("contactInfo", "")

        logger.info(
            f"Processing booking {booking.get('bookingId', 'N/A')} "
            f"({booking_type}, {len(passengers)} passengers)"
        )

        self.verify_issue_new_ticket_screen()

        if booking_type == "one-way":
            for i, pax in enumerate(passengers):
                logger.info(f"Passenger {i + 1}/{len(passengers)}")
                self.click_refresh()
                self.fill_trip_details(booking["departureLeg"], "One Way")
                self.fill_personal_details(pax, contact_info)
                logger.info(f"[Phase 1] Form filled for passenger {i + 1} - NOT clicking Issue")

        elif booking_type == "round-trip":
            for i, pax in enumerate(passengers):
                logger.info(f"Passenger {i + 1}/{len(passengers)}")
                self.click_refresh()
                self.fill_trip_details(
                    booking["departureLeg"],
                    "Round Trip",
                    return_leg=booking.get("returnLeg"),
                )
                self.fill_personal_details(pax, contact_info)
                logger.info(f"[Phase 1] Form filled for passenger {i + 1} - NOT clicking Issue")

        elif booking_type == "connecting-one-way":
            for i, pax in enumerate(passengers):
                for j, leg in enumerate(booking["connectingLegs"]):
                    logger.info(
                        f"Passenger {i + 1}/{len(passengers)}, Leg {j + 1}/2"
                    )
                    self.click_refresh()
                    self.fill_trip_details(leg, "One Way")
                    self.fill_personal_details(pax, contact_info)
                    logger.info(f"[Phase 1] Form filled - NOT clicking Issue")

        elif booking_type == "connecting-round-trip":
            # Departure legs
            for i, pax in enumerate(passengers):
                for j, leg in enumerate(booking["connectingLegs"]):
                    logger.info(
                        f"Passenger {i + 1}/{len(passengers)}, "
                        f"Departure Leg {j + 1}/2"
                    )
                    self.click_refresh()
                    self.fill_trip_details(leg, "One Way")
                    self.fill_personal_details(pax, contact_info)
                    logger.info(f"[Phase 1] Form filled - NOT clicking Issue")

            # Return legs
            for i, pax in enumerate(passengers):
                for j, leg in enumerate(booking["connectingReturnLegs"]):
                    logger.info(
                        f"Passenger {i + 1}/{len(passengers)}, "
                        f"Return Leg {j + 1}/2"
                    )
                    self.click_refresh()
                    self.fill_trip_details(leg, "One Way")
                    self.fill_personal_details(pax, contact_info)
                    logger.info(f"[Phase 1] Form filled - NOT clicking Issue")

        logger.info(f"Booking {booking.get('bookingId', 'N/A')} form fill complete")
