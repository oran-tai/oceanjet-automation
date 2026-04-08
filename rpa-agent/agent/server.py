"""FastAPI HTTP server for the RPA agent."""

import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from agent.config import RPA_AUTH_TOKEN, PRIME_WINDOW_TITLE
from agent.error_codes import TicketErrorCode, PrimeError
from agent.prime_driver import PrimeDriver

logger = logging.getLogger("rpa-agent")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)


# --- Pydantic models mirroring TypeScript types ---


class PassengerData(BaseModel):
    firstName: str
    lastName: str
    age: str
    gender: str


class LegData(BaseModel):
    origin: str
    destination: str
    date: str
    time: str
    accommodation: str


class TranslatedBooking(BaseModel):
    bookingId: str
    reference: str
    bookingType: str  # one-way, round-trip, connecting-one-way, connecting-round-trip
    passengers: list[PassengerData]
    departureLeg: LegData
    returnLeg: Optional[LegData] = None
    connectingLegs: Optional[list[LegData]] = None
    connectingReturnLegs: Optional[list[LegData]] = None
    contactInfo: Optional[str] = ""


class PartialResult(BaseModel):
    passengerIndex: int
    passengerName: str
    tickets: list[str]
    success: bool
    errorCode: Optional[str] = None
    error: Optional[str] = None


class TicketResult(BaseModel):
    success: bool
    departureTickets: list[str] = []
    returnTickets: list[str] = []
    errorCode: Optional[str] = None
    error: Optional[str] = None
    partialResults: Optional[list[PartialResult]] = None


class HealthResponse(BaseModel):
    status: str
    prime_running: bool


# --- Auth ---


def verify_auth(authorization: str = Header(default="")):
    if not RPA_AUTH_TOKEN:
        return  # No token configured, skip auth
    if authorization != f"Bearer {RPA_AUTH_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# --- App ---


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("RPA Agent starting up")
    yield
    logger.info("RPA Agent shutting down")


app = FastAPI(title="OceanJet RPA Agent", lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
async def health():
    """Check if the RPA agent is running and PRIME is accessible."""
    prime_running = False
    try:
        from pywinauto import Application

        prime_app = Application(backend="uia").connect(
            title=PRIME_WINDOW_TITLE, timeout=3
        )
        prime_running = True
    except Exception:
        pass

    return HealthResponse(
        status="ok",
        prime_running=prime_running,
    )


@app.post("/issue-tickets", response_model=TicketResult)
async def issue_tickets(
    booking: TranslatedBooking,
    authorization: str = Header(default=""),
):
    """Receive a booking and fill PRIME forms (Phase 1: dry run)."""
    verify_auth(authorization)

    logger.info(
        f"Received booking {booking.bookingId} ({booking.bookingType}, "
        f"{len(booking.passengers)} passengers)"
    )

    try:
        driver = PrimeDriver()
        result = driver.fill_booking(booking.model_dump())

        return TicketResult(
            success=result["success"],
            departureTickets=result.get("departureTickets", []),
            returnTickets=result.get("returnTickets", []),
            errorCode=result.get("errorCode"),
            error=result.get("error"),
            partialResults=[
                PartialResult(**pr) for pr in result["partialResults"]
            ] if result.get("partialResults") else None,
        )

    except Exception as e:
        # Detect PRIME window not found — likely crashed or restarted
        from pywinauto.findwindows import ElementNotFoundError
        if isinstance(e, ElementNotFoundError) or isinstance(e.__context__, ElementNotFoundError):
            logger.error(f"PRIME window lost during booking {booking.bookingId} — may have crashed or restarted")
            return TicketResult(
                success=False,
                departureTickets=[],
                returnTickets=[],
                errorCode=TicketErrorCode.PRIME_CRASH.value,
                error="PRIME window lost — application may have crashed or restarted",
            )

        logger.exception(f"Unexpected error processing booking {booking.bookingId}")
        return TicketResult(
            success=False,
            departureTickets=[],
            returnTickets=[],
            errorCode=TicketErrorCode.RPA_INTERNAL_ERROR.value,
            error=str(e),
        )
