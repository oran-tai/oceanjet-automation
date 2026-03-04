import winston from 'winston';

const redactSecrets = winston.format((info) => {
  const redacted = { ...info };
  if (typeof redacted.message === 'string') {
    redacted.message = redacted.message.replace(
      /Bearer\s+[A-Za-z0-9+/=._-]+/gi,
      'Bearer [REDACTED]'
    );
  }
  // Redact authorization headers in metadata
  const headers = redacted.headers as Record<string, unknown> | undefined;
  if (headers?.Authorization || headers?.authorization) {
    redacted.headers = { ...headers };
    const h = redacted.headers as Record<string, unknown>;
    if (h.Authorization) h.Authorization = '[REDACTED]';
    if (h.authorization) h.authorization = '[REDACTED]';
  }
  return redacted;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    redactSecrets(),
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        redactSecrets(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
        })
      ),
    }),
  ],
});
