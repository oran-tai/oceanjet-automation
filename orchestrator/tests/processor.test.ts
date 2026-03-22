import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processBooking } from '../src/orchestrator/processor.js';
import type { BookawayClient } from '../src/bookaway/client.js';
import type { BookingSummary, BookingDetail } from '../src/bookaway/types.js';
import type { OperatorModule, TicketResult } from '../src/operators/types.js';

// Mock slack notifications
vi.mock('../src/notifications/slack.js', () => ({
  notifyBookingFailure: vi.fn(),
  notifySystemFailure: vi.fn(),
  notifyPartialFailure: vi.fn(),
  notifySessionExpired: vi.fn(),
}));

function makeBookingSummary(id = 'booking123'): BookingSummary {
  return {
    _id: id,
    reference: 'BW1234567',
    status: 'pending',
    inProgressBy: null,
    items: [
      {
        reference: 'IT1234567',
        productType: 'line',
        product: { lineClass: 'Tourist' },
      },
    ],
  };
}

/** Build a date string ~5 days from now in Bookaway format */
function nearFutureDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  const year = d.getFullYear();
  return `${weekday}, ${month} ${day} ${year}`;
}

function makeBookingDetail(overrides: Partial<{
  departureDate: string;
  status: string;
  passengers: { firstName: string; lastName: string; _id: string; extraInfos: { definition: string; value: string }[] }[];
}>): BookingDetail {
  const { departureDate = nearFutureDate(), status = 'pending', passengers } = overrides;
  const defaultPassengers = [
    {
      firstName: 'John',
      lastName: 'Doe',
      _id: 'p1',
      extraInfos: [
        { definition: '58f47da902e97f000888b000', value: '30' },
        { definition: '58f47db102e97f000888b001', value: 'Male' },
      ],
    },
  ];
  return {
    _id: 'booking123',
    reference: 'BW1234567',
    status,
    inProgressBy: null,
    contact: { email: 'test@test.com', phone: '+1234567890' },
    misc: {
      route: 'Cebu to Bohol',
      departureDate,
      departureTime: '13:00',
      passengers: 'John Doe',
    },
    items: [
      {
        reference: 'IT1234567',
        product: {
          _id: 'prod123',
          lineClass: 'Tourist',
        },
        trip: {
          fromId: { city: { name: 'Cebu' }, address: '' },
          toId: { city: { name: 'Bohol' }, address: '' },
        },
        passengers: passengers || defaultPassengers,
      },
    ],
  };
}

function makeMockClient(detail?: BookingDetail): BookawayClient {
  return {
    fetchBookingDetails: vi.fn().mockResolvedValue(detail || makeBookingDetail({})),
    releaseBooking: vi.fn().mockResolvedValue(undefined),
    approveBooking: vi.fn().mockResolvedValue(undefined),
    claimBooking: vi.fn().mockResolvedValue(undefined),
  } as unknown as BookawayClient;
}

function makeMockOperator(result?: TicketResult): OperatorModule {
  return {
    issueTickets: vi.fn().mockResolvedValue(
      result || {
        success: true,
        departureTickets: ['T001'],
        returnTickets: [],
      }
    ),
  };
}

describe('processBooking', () => {
  it('processes a one-way booking successfully', async () => {
    const client = makeMockClient();
    const operator = makeMockOperator();
    const summary = makeBookingSummary();

    const result = await processBooking(summary, operator, client);

    expect(result.status).toBe('approved');
    expect(client.approveBooking).toHaveBeenCalled();
    const approval = (client.approveBooking as any).mock.calls[0][1];
    expect(approval.approvalInputs.bookingCode).toBe('T001');
    expect(approval.approvalInputs.departureTrip.seatsNumber).toEqual(['T001']);
    expect(approval.approvalInputs).not.toHaveProperty('_id');
  });

  it('releases and alerts on booking-level ticket failure', async () => {
    const client = makeMockClient();
    const operator = makeMockOperator({
      success: false,
      departureTickets: [],
      returnTickets: [],
      errorCode: 'TRIP_SOLD_OUT',
      error: 'No seats available',
    });
    const summary = makeBookingSummary();

    const result = await processBooking(summary, operator, client);

    expect(result.status).toBe('booking-error');
    expect(result).toHaveProperty('errorCode', 'TRIP_SOLD_OUT');
    expect(client.releaseBooking).toHaveBeenCalledWith('booking123');
    expect(client.approveBooking).not.toHaveBeenCalled();
  });

  it('stops the loop on system-level RPA error', async () => {
    const client = makeMockClient();
    const operator = makeMockOperator({
      success: false,
      departureTickets: [],
      returnTickets: [],
      errorCode: 'PRIME_CRASH',
      error: 'PRIME process terminated',
    });
    const summary = makeBookingSummary();

    const result = await processBooking(summary, operator, client);

    expect(result.status).toBe('system-error');
    expect(result).toHaveProperty('errorCode', 'PRIME_CRASH');
    expect(client.releaseBooking).toHaveBeenCalledWith('booking123');
  });

  it('defaults to UNKNOWN_ERROR when no errorCode provided', async () => {
    const client = makeMockClient();
    const operator = makeMockOperator({
      success: false,
      departureTickets: [],
      returnTickets: [],
      error: 'Something went wrong',
    });
    const summary = makeBookingSummary();

    const result = await processBooking(summary, operator, client);

    expect(result.status).toBe('booking-error');
    expect(result).toHaveProperty('errorCode', 'UNKNOWN_ERROR');
    expect(client.releaseBooking).toHaveBeenCalled();
  });

  it('handles system-level errors', async () => {
    const client = makeMockClient();
    const operator: OperatorModule = {
      issueTickets: vi.fn().mockRejectedValue(new Error('PRIME crashed')),
    };
    const summary = makeBookingSummary();

    const result = await processBooking(summary, operator, client);

    expect(result.status).toBe('system-error');
    expect(client.releaseBooking).toHaveBeenCalled();
  });

  it('skips bookings that are no longer pending', async () => {
    const client = makeMockClient(makeBookingDetail({ status: 'confirmed' }));
    const operator = makeMockOperator();
    const summary = makeBookingSummary();

    const result = await processBooking(summary, operator, client);

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('confirmed');
    expect(operator.issueTickets).not.toHaveBeenCalled();
  });

  it('skips bookings with departure too far out', async () => {
    const farDate = new Date();
    farDate.setMonth(farDate.getMonth() + 3);
    const dateStr = farDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const client = makeMockClient(makeBookingDetail({ departureDate: dateStr }));
    const operator = makeMockOperator();
    const summary = makeBookingSummary();

    const result = await processBooking(summary, operator, client);

    expect(result.status).toBe('skipped');
    expect(operator.issueTickets).not.toHaveBeenCalled();
  });

  it('rejects bookings with missing passenger data', async () => {
    const client = makeMockClient(makeBookingDetail({
      passengers: [
        {
          firstName: 'John',
          lastName: 'Doe',
          _id: 'p1',
          extraInfos: [
            // Missing age and gender
          ],
        },
      ],
    }));
    const operator = makeMockOperator();
    const summary = makeBookingSummary();

    const result = await processBooking(summary, operator, client);

    expect(result.status).toBe('booking-error');
    expect((result as any).errorCode).toBe('PASSENGER_VALIDATION_ERROR');
    expect(operator.issueTickets).not.toHaveBeenCalled();
    expect(client.releaseBooking).toHaveBeenCalled();
  });
});
