import dotenv from 'dotenv';

dotenv.config();

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function resolveBookawayUrls(): { apiUrl: string; origin: string } {
  const env = (process.env.BOOKAWAY_ENV || 'stage').trim().toLowerCase();
  if (env === 'prod') {
    return {
      apiUrl: required('BOOKAWAY_API_URL_PROD'),
      origin: 'https://admin.bookaway.com',
    };
  }
  return {
    apiUrl: required('BOOKAWAY_API_URL_STAGE'),
    origin: 'https://admin-stage.bookaway.com',
  };
}

const bookawayUrls = resolveBookawayUrls();

export const config = {
  bookaway: {
    env: (process.env.BOOKAWAY_ENV || 'stage').trim().toLowerCase() as 'prod' | 'stage',
    apiUrl: bookawayUrls.apiUrl,
    origin: bookawayUrls.origin,
    username: required('BOOKAWAY_USERNAME'),
    password: required('BOOKAWAY_PASSWORD'),
    botIdentifier: required('BOOKAWAY_BOT_IDENTIFIER'),
    supplierId: '5c6147b2967ae90001ca6702',
  },
  polling: {
    intervalMs: parseInt(process.env.POLLING_INTERVAL_MS || '30000', 10),
  },
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  },
  rpa: {
    agentUrl: process.env.RPA_AGENT_URL || 'http://localhost:8080',
    authToken: process.env.RPA_AUTH_TOKEN || '',
  },
  pacing: {
    bookingDelayMinMs: parseInt(process.env.BOOKING_DELAY_MIN_MS || '90000', 10),  // 1.5 min
    bookingDelayMaxMs: parseInt(process.env.BOOKING_DELAY_MAX_MS || '180000', 10), // 3 min
  },
  operatorMode: (process.env.OPERATOR_MODE || 'mock') as 'mock' | 'rpa',
  targetBooking: (process.env.TARGET_BOOKING || '').trim(),
} as const;
