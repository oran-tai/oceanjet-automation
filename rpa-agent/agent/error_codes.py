"""Error codes and exception class mirroring the TypeScript TicketErrorCode."""

from enum import Enum


class TicketErrorCode(str, Enum):
    # PRIME rejection errors (booking-level)
    STATION_NOT_FOUND = "STATION_NOT_FOUND"
    TRIP_NOT_FOUND = "TRIP_NOT_FOUND"
    TRIP_SOLD_OUT = "TRIP_SOLD_OUT"
    VOYAGE_TIME_MISMATCH = "VOYAGE_TIME_MISMATCH"
    ACCOMMODATION_UNAVAILABLE = "ACCOMMODATION_UNAVAILABLE"
    PASSENGER_VALIDATION_ERROR = "PASSENGER_VALIDATION_ERROR"
    DUPLICATE_PASSENGER = "DUPLICATE_PASSENGER"
    DATE_BLACKOUT = "DATE_BLACKOUT"
    PRIME_VALIDATION_ERROR = "PRIME_VALIDATION_ERROR"
    # System-level errors
    PRIME_TIMEOUT = "PRIME_TIMEOUT"
    PRIME_CRASH = "PRIME_CRASH"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    RPA_INTERNAL_ERROR = "RPA_INTERNAL_ERROR"
    # Catch-all
    UNKNOWN_ERROR = "UNKNOWN_ERROR"


SYSTEM_ERROR_CODES = {
    TicketErrorCode.PRIME_TIMEOUT,
    TicketErrorCode.PRIME_CRASH,
    TicketErrorCode.SESSION_EXPIRED,
    TicketErrorCode.RPA_INTERNAL_ERROR,
}


class PrimeError(Exception):
    """Exception raised when PRIME interaction fails."""

    def __init__(self, error_code: TicketErrorCode, message: str):
        self.error_code = error_code
        self.message = message
        super().__init__(f"[{error_code.value}] {message}")
