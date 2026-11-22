/**
 * Where the dispatcher keeps which bookings are in flight or held.
 *
 * - MemoryDispatchStore: one orchestrator process (single VM, or one
 *   orchestrator driving several agents directly).
 * - FirestoreDispatchStore (dispatch-store-firestore.ts): the cloud
 *   dispatcher service, so state survives restarts and the reservation is
 *   atomic even if two service instances run at once (e.g. during a deploy).
 */

/** Hold a booking until the agent that held it registers again (its worker restarts). */
export const UNTIL_AGENT_RESTART = Number.POSITIVE_INFINITY;

export interface DispatchEntry {
  bookingId: string;
  reference: string;
  agent: string;
  state: 'in_flight' | 'held';
  /** Epoch ms the hold ends; UNTIL_AGENT_RESTART for system errors; unused while in flight. */
  until: number;
}

export interface RegisterResult {
  /** Bookings this agent had in flight when its worker stopped — now held for review. */
  interrupted: string[];
  /** System-error holds of this agent, cleared because a human restarted it. */
  cleared: string[];
}

export interface DispatchStore {
  /** Entries that currently block a booking (in flight, or held and not yet expired). */
  active(now: number): Promise<Map<string, DispatchEntry>>;
  /** Atomically mark a booking in flight for `agent`. False if another caller holds it. */
  reserve(bookingId: string, reference: string, agent: string, now: number): Promise<boolean>;
  /** Agent is done: hold until `until` (epoch ms or UNTIL_AGENT_RESTART); `until <= now` frees it. */
  finish(bookingId: string, agent: string, until: number, now: number): Promise<void>;
  /**
   * An agent's worker (re)started: its in-flight bookings become held until
   * `interruptedUntil`, and its system-error holds are cleared.
   */
  registerAgent(agent: string, now: number, interruptedUntil: number): Promise<RegisterResult>;
}

export function isActive(entry: DispatchEntry, now: number): boolean {
  return entry.state === 'in_flight' || now < entry.until;
}

export class MemoryDispatchStore implements DispatchStore {
  private entries = new Map<string, DispatchEntry>();

  async active(now: number): Promise<Map<string, DispatchEntry>> {
    for (const [id, e] of this.entries) {
      if (!isActive(e, now)) this.entries.delete(id);
    }
    return new Map(this.entries);
  }

  async reserve(bookingId: string, reference: string, agent: string, now: number): Promise<boolean> {
    const existing = this.entries.get(bookingId);
    if (existing && isActive(existing, now)) return false;
    this.entries.set(bookingId, { bookingId, reference, agent, state: 'in_flight', until: 0 });
    return true;
  }

  async finish(bookingId: string, agent: string, until: number, now: number): Promise<void> {
    if (until <= now) {
      this.entries.delete(bookingId);
      return;
    }
    const reference = this.entries.get(bookingId)?.reference ?? bookingId;
    this.entries.set(bookingId, { bookingId, reference, agent, state: 'held', until });
  }

  async registerAgent(agent: string, now: number, interruptedUntil: number): Promise<RegisterResult> {
    const result: RegisterResult = { interrupted: [], cleared: [] };
    for (const [id, e] of this.entries) {
      if (e.agent !== agent) continue;
      if (e.state === 'in_flight') {
        this.entries.set(id, { ...e, state: 'held', until: interruptedUntil });
        result.interrupted.push(e.reference);
      } else if (e.until === UNTIL_AGENT_RESTART) {
        this.entries.delete(id);
        result.cleared.push(e.reference);
      }
    }
    return result;
  }
}
