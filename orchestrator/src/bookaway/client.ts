import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type {
  LoginResponse,
  BookingListResponse,
  BookingSummary,
  BookingDetail,
  ApprovalRequest,
} from './types.js';

export class BookawayClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: config.bookaway.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        Origin: config.bookaway.origin,
      },
    });

    // Attach auth token to every request
    this.client.interceptors.request.use((req) => {
      if (this.accessToken) {
        req.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return req;
    });

    // Auto-refresh on 401
    this.client.interceptors.response.use(
      (res) => res,
      async (error: AxiosError) => {
        const originalRequest = error.config;
        if (
          error.response?.status === 401 &&
          originalRequest &&
          !(originalRequest as any)._retried
        ) {
          (originalRequest as any)._retried = true;
          logger.info('Token expired, re-authenticating...');
          await this.login();
          originalRequest.headers.Authorization = `Bearer ${this.accessToken}`;
          return this.client(originalRequest);
        }
        throw error;
      }
    );
  }

  async login(): Promise<void> {
    logger.info('Logging in to Bookaway API...');
    const response = await axios.post<LoginResponse>(
      `${config.bookaway.apiUrl}/users/auth/login`,
      {
        username: config.bookaway.username,
        password: config.bookaway.password,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Origin: config.bookaway.origin,
        },
      }
    );
    this.accessToken = response.data.access_token;
    logger.info('Logged in to Bookaway successfully');
  }

  async fetchPendingBookings(): Promise<BookingSummary[]> {
    logger.info('Fetching pending OceanJet bookings...');
    const response = await this.client.get<BookingListResponse>(
      '/bookings/bookings',
      {
        params: {
          supplier: config.bookaway.supplierId,
          status: 'pending',
          customerStatus: 'pending',
          payment: 'paid;authorized',
          sort: 'departureDate:1',
          limit: 50,
          disableCount: true,
          domain: 'all',
          date: 'created',
        },
      }
    );
    const bookings = response.data.data;
    logger.info(`Fetched ${bookings.length} pending bookings`);
    return bookings;
  }

  async fetchBookingDetails(bookingId: string): Promise<BookingDetail> {
    logger.info('Fetching booking details', { bookingId });
    const response = await this.client.get<BookingDetail>(
      `/bookings/bookings/${bookingId}`
    );
    return response.data;
  }

  async claimBooking(bookingId: string): Promise<void> {
    logger.info('Claiming booking', {
      bookingId,
      botIdentifier: config.bookaway.botIdentifier,
    });
    await this.client.put(
      `/bookings/v2/bookings/${bookingId}/update-in-progress`,
      { inProgressBy: config.bookaway.botIdentifier }
    );
  }

  async releaseBooking(bookingId: string): Promise<void> {
    logger.info('Releasing booking', { bookingId });
    await this.client.put(
      `/bookings/v2/bookings/${bookingId}/update-in-progress`,
      { inProgressBy: null }
    );
  }

  async approveBooking(
    bookingId: string,
    approval: ApprovalRequest
  ): Promise<void> {
    logger.info('Approving booking', { bookingId });
    await this.client.post(
      `/bookings/v2/bookings/${bookingId}/approve`,
      approval
    );
    logger.info('Booking approved successfully', { bookingId });
  }
}
