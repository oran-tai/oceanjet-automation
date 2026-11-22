import axios, { type AxiosInstance } from 'axios';
import { GoogleAuth } from 'google-auth-library';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { RegisterResult } from './dispatch-store.js';
import { HOLD_UNTIL_RESTART, type BookingDispatcher, type DispatchResult } from './dispatcher.js';

/** Returns an Authorization header value, or null to send none (local tests). */
export type TokenProvider = () => Promise<string | null>;

/**
 * ID-token provider for the private Cloud Run dispatcher: signs in as the
 * service account in `keyFile` (the oceanjet-events key already on each VM).
 */
export function googleIdTokenProvider(audience: string, keyFile: string): TokenProvider {
  const auth = new GoogleAuth({ keyFile });
  let clientPromise: ReturnType<GoogleAuth['getIdTokenClient']> | null = null;
  return async () => {
    clientPromise ??= auth.getIdTokenClient(audience);
    const client = await clientPromise;
    const headers = await client.getRequestHeaders();
    // google-auth-library returns a Headers object (v10) or a plain record (older)
    const value = typeof (headers as any).get === 'function'
      ? (headers as any).get('authorization')
      : (headers as any).Authorization ?? (headers as any).authorization;
    return value ?? null;
  };
}

/**
 * Worker-side client of the cloud dispatcher service. Same contract as the
 * in-process Dispatcher, over HTTPS (outbound only — no VM needs to accept
 * connections). HOLD_UNTIL_RESTART travels as `holdMs: null` (JSON has no Infinity).
 */
export class RemoteDispatcher implements BookingDispatcher {
  private http: AxiosInstance;

  constructor(baseUrl: string, private token: TokenProvider) {
    this.http = axios.create({ baseURL: baseUrl.replace(/\/+$/, ''), timeout: 60_000 });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const authorization = await this.token();
    const res = await this.http.post<T>(path, body, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    return res.data;
  }

  next(agent: string, targetBooking?: string): Promise<DispatchResult> {
    return this.post<DispatchResult>('/next', { agent, targetBooking: targetBooking || undefined });
  }

  async finish(bookingId: string, agent: string, holdMs: number): Promise<void> {
    // A lost "finish" leaves the booking in flight (safe: nobody gets it), so
    // retry hard before giving up
    await withRetry(
      () => this.post('/finish', {
        bookingId,
        agent,
        holdMs: holdMs === HOLD_UNTIL_RESTART ? null : holdMs,
      }),
      {
        retries: 5,
        onRetry: (attempt, error: any) =>
          logger.warn(`Dispatcher finish failed, retrying (${attempt}/5)`, { bookingId, error: error?.message }),
      }
    );
  }

  register(agent: string): Promise<RegisterResult> {
    return this.post<RegisterResult>('/register', { agent });
  }
}
