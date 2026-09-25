/**
 * Converts 24-hour time string to 12-hour AM/PM format.
 * e.g., "13:00" → "1:00 PM", "08:20" → "8:20 AM", "00:00" → "12:00 AM"
 */
export function to12Hour(time24: string): string {
  const [hourStr, minuteStr] = time24.split(':');
  let hour = parseInt(hourStr, 10);
  const minute = minuteStr;
  const period = hour >= 12 ? 'PM' : 'AM';

  if (hour === 0) {
    hour = 12;
  } else if (hour > 12) {
    hour -= 12;
  }

  return `${hour}:${minute} ${period}`;
}

/** Days ahead PRIME allows a ticket to be issued for. */
export const BOOKING_WINDOW_MONTHS = 2;

/**
 * Parse a Bookaway formatted date ("Wed, Apr 15th 2026") into a Date.
 * Returns null when the string cannot be parsed.
 */
export function parseBookawayDate(dateStr: string): Date | null {
  const cleaned = dateStr.replace(/(\d+)(st|nd|rd|th)/g, '$1');
  const parsed = new Date(cleaned);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * True when the departure falls inside PRIME's booking window (now + 2 months).
 * Unparseable dates are allowed through so a formatting change never silently
 * hides bookings; the caller decides whether to log that.
 */
export function isDepartureWithinWindow(departureDateStr: string, now: Date = new Date()): boolean {
  const departureDate = parseBookawayDate(departureDateStr);
  if (!departureDate) return true;
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() + BOOKING_WINDOW_MONTHS);
  return departureDate <= cutoff;
}
