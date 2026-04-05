export type EventType =
  | 'booking_claimed'
  | 'booking_skipped'
  | 'booking_failed'
  | 'booking_approved'
  | 'poll_cycle_completed';

export interface BookingEvent {
  event_id: string;
  event_type: EventType;
  timestamp: string;
  booking_id: string | null;
  reference: string | null;
  booking_type: string | null;
  origin: string | null;
  destination: string | null;
  departure_date: string | null;
  passenger_count: number | null;
  environment: string;
  status: string | null;
  error_code: string | null;
  error_detail: string | null;
  skip_reason: string | null;
  tickets_issued_count: number | null;
  departure_tickets: string | null;
  return_tickets: string | null;
  duration_ms: number | null;
  approved_count: number | null;
  skipped_count: number | null;
  booking_errors_count: number | null;
  system_errors_count: number | null;
}
