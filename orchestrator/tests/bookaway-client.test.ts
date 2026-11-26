import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get,
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { BookawayClient } from '../src/bookaway/client.js';

const networkError = (code: string) =>
  Object.assign(new Error(`read ${code}`), { isAxiosError: true, code });
const httpError = (status: number) =>
  Object.assign(new Error(`status ${status}`), { isAxiosError: true, response: { status } });

describe('BookawayClient.fetchBookingDetails', () => {
  beforeEach(() => {
    get.mockReset();
    vi.useFakeTimers();
  });

  it('retries a dropped connection and returns the booking', async () => {
    get
      .mockRejectedValueOnce(networkError('ECONNRESET'))
      .mockResolvedValueOnce({ data: { _id: 'b1' } });

    const result = new BookawayClient().fetchBookingDetails('b1');
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ _id: 'b1' });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('gives up after 2 retries', async () => {
    get.mockRejectedValue(networkError('ECONNRESET'));

    const result = new BookawayClient().fetchBookingDetails('b1');
    const settled = expect(result).rejects.toMatchObject({ message: 'read ECONNRESET' });
    await vi.runAllTimersAsync();

    await settled;
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404', async () => {
    get.mockRejectedValue(httpError(404));

    await expect(new BookawayClient().fetchBookingDetails('b1')).rejects.toMatchObject({
      message: 'status 404',
    });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
