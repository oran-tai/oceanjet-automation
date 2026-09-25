import { describe, it, expect, vi } from 'vitest';
import { withRetry, isTransientHttpError } from '../src/utils/retry.js';

function axiosError(status?: number, code?: string) {
  return { isAxiosError: true, message: `status ${status}`, code, response: status ? { status } : undefined };
}

describe('isTransientHttpError', () => {
  it('treats 5xx as transient', () => {
    expect(isTransientHttpError(axiosError(502))).toBe(true);
    expect(isTransientHttpError(axiosError(503))).toBe(true);
  });
  it('treats 4xx as permanent', () => {
    expect(isTransientHttpError(axiosError(401))).toBe(false);
    expect(isTransientHttpError(axiosError(404))).toBe(false);
  });
  it('treats network errors (no response) as transient', () => {
    expect(isTransientHttpError(axiosError(undefined, 'ECONNRESET'))).toBe(true);
  });
  it('ignores plain errors', () => {
    expect(isTransientHttpError(new Error('boom'))).toBe(false);
  });
});

describe('withRetry', () => {
  const noDelay = () => 0;

  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { retries: 2, delayMs: noDelay })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient 502 and succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(axiosError(502)).mockResolvedValue('ok');
    const onRetry = vi.fn();
    await expect(withRetry(fn, { retries: 2, delayMs: noDelay, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.objectContaining({ message: 'status 502' }));
  });

  it('gives up after the retry budget', async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(502));
    await expect(withRetry(fn, { retries: 2, delayMs: noDelay })).rejects.toMatchObject({ message: 'status 502' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 4xx', async () => {
    const fn = vi.fn().mockRejectedValue(axiosError(404));
    await expect(withRetry(fn, { retries: 2, delayMs: noDelay })).rejects.toMatchObject({ message: 'status 404' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
