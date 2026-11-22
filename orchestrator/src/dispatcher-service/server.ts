import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { logger } from '../utils/logger.js';
import { HOLD_UNTIL_RESTART, type Dispatcher } from '../orchestrator/dispatcher.js';
import { UNTIL_AGENT_RESTART, type DispatchStore } from '../orchestrator/dispatch-store.js';

/**
 * HTTP front of the cloud dispatcher. Authentication is Cloud Run's job
 * (the service only accepts callers with the run.invoker role), so these
 * handlers trust every request that reaches them.
 *
 *   POST /next      {agent, targetBooking?}        → {booking, preClaimSkipped}
 *   POST /finish    {bookingId, agent, holdMs}     → {ok}   (holdMs null = until the agent restarts)
 *   POST /register  {agent}                        → {interrupted, cleared}
 *   GET  /status                                   → bookings in flight / held
 *   GET  /health                                   → {ok}   (not /healthz — Cloud Run reserves paths ending in z)
 */
export function createDispatcherServer(dispatcher: Dispatcher, store: DispatchStore): Server {
  return createServer(async (req, res) => {
    try {
      const route = `${req.method} ${(req.url ?? '').split('?')[0]}`;
      switch (route) {
        case 'GET /health':
          return send(res, 200, { ok: true });

        case 'GET /status': {
          const active = await store.active(Date.now());
          return send(res, 200, {
            bookings: [...active.values()].map((e) => ({
              ...e,
              until: e.state === 'in_flight' ? null
                : e.until === UNTIL_AGENT_RESTART ? 'until agent restarts'
                : new Date(e.until).toISOString(),
            })),
          });
        }

        case 'POST /next': {
          const body = await readJson(req);
          const agent = requireString(body.agent, 'agent');
          const target = typeof body.targetBooking === 'string' ? body.targetBooking : undefined;
          const result = await dispatcher.next(agent, target);
          if (result.booking) {
            logger.info('Booking assigned', { agent, reference: result.booking.reference });
          }
          return send(res, 200, result);
        }

        case 'POST /finish': {
          const body = await readJson(req);
          const bookingId = requireString(body.bookingId, 'bookingId');
          const agent = requireString(body.agent, 'agent');
          if (body.holdMs !== null && !(typeof body.holdMs === 'number' && body.holdMs >= 0)) {
            throw new BadRequest('holdMs must be a non-negative number or null');
          }
          const holdMs = body.holdMs === null ? HOLD_UNTIL_RESTART : body.holdMs;
          await dispatcher.finish(bookingId, agent, holdMs);
          logger.info('Booking finished', { agent, bookingId, holdMs: body.holdMs });
          return send(res, 200, { ok: true });
        }

        case 'POST /register': {
          const body = await readJson(req);
          const agent = requireString(body.agent, 'agent');
          const result = await dispatcher.register(agent);
          logger.info('Agent registered', { agent, ...result });
          return send(res, 200, result);
        }

        default:
          return send(res, 404, { error: 'Not found' });
      }
    } catch (error: any) {
      if (error instanceof BadRequest) return send(res, 400, { error: error.message });
      logger.error('Dispatcher request failed', { url: req.url, error: error.message });
      return send(res, 500, { error: error.message });
    }
  });
}

class BadRequest extends Error {}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new BadRequest(`${name} is required`);
  return value.trim();
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new BadRequest('Body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch {
    throw new BadRequest('Body must be a JSON object');
  }
}
