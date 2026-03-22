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
