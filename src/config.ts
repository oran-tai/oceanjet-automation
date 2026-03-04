import dotenv from 'dotenv';

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  bookaway: {
    apiUrl: required('BOOKAWAY_API_URL'),
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
  operatorMode: (process.env.OPERATOR_MODE || 'mock') as 'mock' | 'rpa',
} as const;
