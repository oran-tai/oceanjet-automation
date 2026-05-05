export type BookingType = 'one-way' | 'round-trip' | 'connecting-one-way' | 'connecting-round-trip';

/**
 * Structured error codes returned by the RPA agent.
 * Allows the orchestrator to give actionable Slack alerts
 * and decide whether to release, stop, or escalate.
 */
export type TicketErrorCode =
  // PRIME rejection errors (booking-level: release + alert + continue loop)
  | 'STATION_NOT_FOUND'           // Origin or destination station not found in PRIME's dropdown
  | 'TRIP_NOT_FOUND'              // No voyage listed for this station pair on the given date
  | 'TRIP_SOLD_OUT'               // Voyage exists but no seats available
  | 'VOYAGE_TIME_MISMATCH'        // No voyage matches the expected departure time
  | 'ACCOMMODATION_UNAVAILABLE'   // Requested class sold out (other classes may have seats)
  | 'PASSENGER_VALIDATION_ERROR'  // Missing or invalid passenger details (name, age, gender)
  | 'PRIME_VALIDATION_ERROR'      // Catch-all for unexpected PRIME validation dialogs
  // System-level errors (stop loop + alert)
  | 'PRIME_TIMEOUT'               // PRIME became unresponsive
  | 'PRIME_CRASH'                 // PRIME application crashed
  | 'SESSION_EXPIRED'             // PRIME login session expired
  | 'RPA_INTERNAL_ERROR'          // RPA agent hit an internal error
  | 'ORPHAN_TICKET_DETECTED'      // Found an unhandled success popup with codes — manual reconciliation required
  // Catch-all
  | 'UNKNOWN_ERROR';              // Unclassified error

/** Human-readable descriptions for each error code, used in Slack alerts. */
export const TICKET_ERROR_LABELS: Record<TicketErrorCode, string> = {
  STATION_NOT_FOUND: 'Origin or destination station not found in PRIME',
  TRIP_NOT_FOUND: 'No voyage found for this route and date in PRIME',
  TRIP_SOLD_OUT: 'Trip is fully booked — no seats available',
  VOYAGE_TIME_MISMATCH: 'No voyage matches the expected departure time',
  ACCOMMODATION_UNAVAILABLE: 'Requested accommodation class is sold out',
  PASSENGER_VALIDATION_ERROR: 'Missing or invalid passenger details (check name, age, or gender)',
  PRIME_VALIDATION_ERROR: 'PRIME showed an unexpected validation error',
  PRIME_TIMEOUT: 'PRIME became unresponsive (timeout)',
  PRIME_CRASH: 'PRIME application crashed',
  SESSION_EXPIRED: 'PRIME login session has expired',
  RPA_INTERNAL_ERROR: 'RPA agent encountered an internal error',
  ORPHAN_TICKET_DETECTED: 'Orphan success popup found with ticket codes — manual reconciliation required',
  UNKNOWN_ERROR: 'An unclassified error occurred',
};

/** Error codes that indicate a system-level failure — the loop should stop. */
export const SYSTEM_ERROR_CODES: ReadonlySet<TicketErrorCode> = new Set([
  'PRIME_TIMEOUT',
  'PRIME_CRASH',
  'SESSION_EXPIRED',
  'RPA_INTERNAL_ERROR',
  'ORPHAN_TICKET_DETECTED',
]);

export interface PassengerData {
  firstName: string;
  lastName: string;
  age: string;
  gender: string;
}

export interface LegData {
  origin: string;       // PRIME station code (e.g., "CEB")
  destination: string;  // PRIME station code (e.g., "TAG")
  date: string;         // Departure date as-is from Bookaway
  time: string;         // 12-hour format (e.g., "1:00 PM")
  accommodation: string; // PRIME accommodation code (e.g., "TC")
}

export interface TranslatedBooking {
  bookingId: string;
  reference: string;
  bookingType: BookingType;
  passengers: PassengerData[];
  contactInfo?: string;
  departureLeg: LegData;
  returnLeg?: LegData;
  // For connecting routes: the two legs that make up the departure
  connectingLegs?: LegData[];
  // For connecting round-trip: the two legs that make up the return
  connectingReturnLegs?: LegData[];
}

export interface TicketResult {
  success: boolean;
  /** Ticket numbers for the departure (or departure leg 1 + leg 2 interleaved per passenger) */
  departureTickets: string[];
  /** Ticket numbers for the return trip */
  returnTickets: string[];
  /** Structured error code from the RPA agent */
  errorCode?: TicketErrorCode;
  /** Free-text error message for logging / additional context */
  error?: string;
  /** For partial failures: which passengers succeeded */
  partialResults?: {
    passengerIndex: number;
    passengerName: string;
    tickets: string[];
    success: boolean;
    errorCode?: TicketErrorCode;
    error?: string;
  }[];
}

export interface OperatorModule {
  issueTickets(booking: TranslatedBooking): Promise<TicketResult>;
}
