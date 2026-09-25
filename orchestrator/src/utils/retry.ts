import type { AxiosError } from 'axios';

/**
 * True for errors worth retrying: network failures (no response) and 5xx
 * gateway/server responses. 4xx responses are deterministic and are not retried.
 */
export function isTransientHttpError(error: unknown): boolean {
  const err = error as AxiosError | undefined;
  if (!err || typeof err !== 'object') return false;
  const status = err.response?.status;
  if (status === undefined) return Boolean(err.isAxiosError || err.code);
  return status >= 500 && status < 600;
}

export interface RetryOptions {
  /** Number of retries after the first attempt. */
  retries: number;
  /** Delay before retry n (1-based). Defaults to 1s, 2s, 4s... */
  delayMs?: (attempt: number) => number;
  /** Predicate deciding whether an error is retryable. Defaults to isTransientHttpError. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called before each retry with the attempt number and the error that triggered it. */
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Run `fn`, retrying on transient errors. The last error is rethrown once the
 * retry budget is exhausted or a non-retryable error is seen.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    retries,
    delayMs = (attempt) => 1000 * 2 ** (attempt - 1),
    shouldRetry = isTransientHttpError,
    onRetry,
  } = options;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      attempt++;
      onRetry?.(attempt, error);
      await new Promise((resolve) => setTimeout(resolve, delayMs(attempt)));
    }
  }
}
