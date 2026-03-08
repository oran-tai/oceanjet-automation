import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { TicketErrorCode } from '../operators/types.js';

async function sendSlackMessage(text: string): Promise<void> {
  if (!config.slack.webhookUrl) {
    logger.warn('Slack webhook URL not configured, skipping notification');
    return;
  }
  try {
    await axios.post(config.slack.webhookUrl, { text });
  } catch (error: any) {
    logger.error('Failed to send Slack notification', {
      error: error.message,
    });
  }
}

export async function notifyBookingFailure(
  reference: string,
  bookingId: string,
  errorCode: TicketErrorCode,
  reason: string
): Promise<void> {
  const bookawayLink = `https://admin.bookaway.com/bookings/${bookingId}`;
  const message =
    `:warning: *Booking Failed — Manual Review Required*\n` +
    `*Reference:* ${reference}\n` +
    `*Error:* \`${errorCode}\`\n` +
    `*Details:* ${reason}\n` +
    `*Link:* <${bookawayLink}|Open in Bookaway>`;
  logger.warn('Booking failure alert', { reference, errorCode, reason });
  await sendSlackMessage(message);
}

export async function notifySystemFailure(
  reason: string,
  bookingReference?: string
): Promise<void> {
  const message =
    `:rotating_light: *System Failure — Automation Stopped*\n` +
    `*Reason:* ${reason}\n` +
    (bookingReference
      ? `*Last booking:* ${bookingReference}\n`
      : '') +
    `The automation has stopped. Please verify PRIME is online and re-login before restarting.`;
  logger.error('System failure alert', { reason, bookingReference });
  await sendSlackMessage(message);
}

export async function notifyPartialFailure(
  reference: string,
  bookingId: string,
  results: {
    passengerName: string;
    tickets: string[];
    success: boolean;
    error?: string;
  }[]
): Promise<void> {
  const bookawayLink = `https://admin.bookaway.com/bookings/${bookingId}`;
  const details = results
    .map((r) =>
      r.success
        ? `:white_check_mark: ${r.passengerName}: ${r.tickets.join(', ')}`
        : `:x: ${r.passengerName}: ${r.error || 'Failed'}`
    )
    .join('\n');
  const message =
    `:warning: *Partial Failure — Manual Resolution Required*\n` +
    `*Reference:* ${reference}\n` +
    `${details}\n` +
    `*Link:* <${bookawayLink}|Open in Bookaway>\n` +
    `Booking remains claimed. Please resolve manually.`;
  logger.warn('Partial failure alert', { reference });
  await sendSlackMessage(message);
}

export async function notifySessionExpired(): Promise<void> {
  const message =
    `:rotating_light: *PRIME Session Expired*\n` +
    `The automation detected that PRIME is logged out or the session has expired.\n` +
    `Please re-login to PRIME and restart the automation.`;
  logger.error('Session expired alert');
  await sendSlackMessage(message);
}
