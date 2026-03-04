export type BookingType = 'one-way' | 'round-trip' | 'connecting-one-way' | 'connecting-round-trip';

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
  itemId: string;
  bookingType: BookingType;
  passengers: PassengerData[];
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
  /** If failed, reason */
  error?: string;
  /** For partial failures: which passengers succeeded */
  partialResults?: {
    passengerIndex: number;
    passengerName: string;
    tickets: string[];
    success: boolean;
    error?: string;
  }[];
}

export interface OperatorModule {
  issueTickets(booking: TranslatedBooking): Promise<TicketResult>;
}
