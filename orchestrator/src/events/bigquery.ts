import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import type { BookingEvent, EventType } from './types.js';

const DATASET = 'oceanjet';
const TABLE = 'booking_events';

let bq: BigQuery | null = null;

function getClient(): BigQuery {
  if (!bq) {
    const opts: { projectId: string; keyFilename?: string } = {
      projectId: config.bigquery.projectId,
    };
    if (config.bigquery.keyFilename) {
      opts.keyFilename = config.bigquery.keyFilename;
    }
    bq = new BigQuery(opts);
  }
  return bq;
}

function isEnabled(): boolean {
  return !!config.bigquery.projectId;
}

/** Convert Bookaway date format ("Wed, Apr 8th 2026") to ISO date ("2026-04-08"). */
function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/(\d+)(st|nd|rd|th)/g, '$1');
  const parsed = new Date(cleaned);
  if (isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().slice(0, 10);
}

export async function trackEvent(
  eventType: EventType,
  fields: Partial<Omit<BookingEvent, 'event_id' | 'event_type' | 'timestamp' | 'environment'>> = {}
): Promise<void> {
  if (!isEnabled()) return;

  const row: BookingEvent = {
    event_id: randomUUID(),
    event_type: eventType,
    timestamp: new Date().toISOString(),
    environment: config.bookaway.env,
    booking_id: fields.booking_id ?? null,
    reference: fields.reference ?? null,
    booking_type: fields.booking_type ?? null,
    origin: fields.origin ?? null,
    destination: fields.destination ?? null,
    departure_date: normalizeDate(fields.departure_date ?? null),
    passenger_count: fields.passenger_count ?? null,
    status: fields.status ?? null,
    error_code: fields.error_code ?? null,
    error_detail: fields.error_detail ?? null,
    skip_reason: fields.skip_reason ?? null,
    tickets_issued_count: fields.tickets_issued_count ?? null,
    departure_tickets: fields.departure_tickets ?? null,
    return_tickets: fields.return_tickets ?? null,
    duration_ms: fields.duration_ms ?? null,
    approved_count: fields.approved_count ?? null,
    skipped_count: fields.skipped_count ?? null,
    booking_errors_count: fields.booking_errors_count ?? null,
    system_errors_count: fields.system_errors_count ?? null,
  };

  try {
    await getClient().dataset(DATASET).table(TABLE).insert([row]);
  } catch (err: any) {
    // Log but don't throw — events are best-effort, never block the main flow
    const detail = err?.response?.insertErrors
      ? JSON.stringify(err.response.insertErrors)
      : err.message;
    logger.warn('Failed to send event to BigQuery', { eventType, detail });
  }
}
