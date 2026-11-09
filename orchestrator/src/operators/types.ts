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
  | 'PRICE_MISMATCH'              // PRIME's Total Due differs from Bookaway's cost (5% rule), or Bookaway has no cost to compare — ticket not issued
  | 'APPROVAL_FAILED'             // Tickets issued in PRIME but Bookaway approval API failed — booking stays claimed
  // System-level errors (stop loop + alert)
  | 'PRIME_TIMEOUT'               // PRIME became unresponsive
  | 'PRIME_CRASH'                 // PRIME application crashed
  | 'SESSION_EXPIRED'             // PRIME login session expired
  | 'RPA_INTERNAL_ERROR'          // RPA agent hit an internal error
  | 'ORPHAN_TICKET_DETECTED'      // Found an unhandled success popup with codes — manual reconciliation required
  | 'UNEXPECTED_POPUP'            // A popup is blocking the PRIME form (e.g. missing Session ID) — engineer must intervene
  | 'PRICE_UNREADABLE'            // The Rates pane could not be read (Gemini) — no finance guard, ticket not issued
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
  PRICE_MISMATCH: 'PRIME price differs from Bookaway (5% rule) — ticket not issued, check inventory pricing',
  APPROVAL_FAILED: 'Tickets issued in PRIME but Bookaway approval failed — manual approval required',
  PRIME_TIMEOUT: 'PRIME became unresponsive (timeout)',
  PRIME_CRASH: 'PRIME application crashed',
  SESSION_EXPIRED: 'PRIME login session has expired',
  RPA_INTERNAL_ERROR: 'RPA agent encountered an internal error',
  ORPHAN_TICKET_DETECTED: 'Orphan success popup found with ticket codes — manual reconciliation required',
  UNEXPECTED_POPUP: 'A popup is blocking the PRIME form — engineer intervention required',
  PRICE_UNREADABLE: 'Could not read the price from PRIME — ticket not issued, engineer intervention required',
  UNKNOWN_ERROR: 'An unclassified error occurred',
};

/** Error codes that indicate a system-level failure — the loop should stop. */
export const SYSTEM_ERROR_CODES: ReadonlySet<TicketErrorCode> = new Set([
  'PRIME_TIMEOUT',
  'PRIME_CRASH',
  'SESSION_EXPIRED',
  'RPA_INTERNAL_ERROR',
  'ORPHAN_TICKET_DETECTED',
  'UNEXPECTED_POPUP',
  'PRICE_UNREADABLE',
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

/**
 * What PRIME must charge for one passenger, derived from Bookaway.
 * PRIME shows Total Due per issue: a one-way or round-trip ticket is one issue
 * (round-trip Total Due covers both legs); a connecting route is one issue per
 * leg, which the RPA sums. The RPA compares the first passenger only.
 */
export interface PriceCheck {
  /** Bookaway supplier cost per passenger across all items (legs), PHP. */
  bookawayCostPerPax: number;
  /** bookawayCostPerPax / (1 - discountRate): the PRIME Total Due to expect. */
  expectedTotalDuePerPax: number;
  currency: 'PHP';
  /** OceanJet agreement discount Bookaway already deducted (0.05). */
  discountRate: number;
}

export interface TranslatedBooking {
  bookingId: string;
  reference: string;
  bookingType: BookingType;
  passengers: PassengerData[];
  contactInfo?: string;
  /** Absent when Bookaway carries no PHP cost; the processor then refuses to book. */
  priceCheck?: PriceCheck;
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
