import { Firestore, Timestamp } from '@google-cloud/firestore';
import {
  UNTIL_AGENT_RESTART,
  isActive,
  type DispatchEntry,
  type DispatchStore,
  type RegisterResult,
} from './dispatch-store.js';

/**
 * Firestore-backed dispatch state for the cloud dispatcher service.
 * One document per booking in `collection` (id = Bookaway booking id).
 * `reserve` runs in a transaction, so a booking can be reserved by only one
 * caller even when two service instances run at the same time.
 *
 * Stored fields: reference, agent, state ('in_flight' | 'held'),
 * until (Timestamp, null = until the agent restarts), updatedAt.
 */
export class FirestoreDispatchStore implements DispatchStore {
  private db: Firestore;

  constructor(private collection: string, db?: Firestore) {
    this.db = db ?? new Firestore({ ignoreUndefinedProperties: true });
  }

  private col() {
    return this.db.collection(this.collection);
  }

  private static toEntry(id: string, data: FirebaseFirestore.DocumentData): DispatchEntry {
    const until = data.until === null || data.until === undefined
      ? (data.state === 'held' ? UNTIL_AGENT_RESTART : 0)
      : (data.until as Timestamp).toMillis();
    return { bookingId: id, reference: data.reference, agent: data.agent, state: data.state, until };
  }

  private static untilField(until: number): Timestamp | null {
    return until === UNTIL_AGENT_RESTART ? null : Timestamp.fromMillis(until);
  }

  async active(now: number): Promise<Map<string, DispatchEntry>> {
    const snap = await this.col().get();
    const result = new Map<string, DispatchEntry>();
    const expired: FirebaseFirestore.DocumentReference[] = [];
    for (const doc of snap.docs) {
      const entry = FirestoreDispatchStore.toEntry(doc.id, doc.data());
      if (isActive(entry, now)) result.set(doc.id, entry);
      else expired.push(doc.ref);
    }
    // Housekeeping only — a failure here never blocks a pick
    await Promise.all(expired.map((ref) => ref.delete().catch(() => undefined)));
    return result;
  }

  async reserve(bookingId: string, reference: string, agent: string, now: number): Promise<boolean> {
    const ref = this.col().doc(bookingId);
    return this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (doc.exists && isActive(FirestoreDispatchStore.toEntry(doc.id, doc.data()!), now)) {
        return false;
      }
      tx.set(ref, {
        reference,
        agent,
        state: 'in_flight',
        until: Timestamp.fromMillis(0),
        updatedAt: Timestamp.fromMillis(now),
      });
      return true;
    });
  }

  async finish(bookingId: string, agent: string, until: number, now: number): Promise<void> {
    const ref = this.col().doc(bookingId);
    if (until <= now) {
      await ref.delete();
      return;
    }
    await ref.set(
      {
        agent,
        state: 'held',
        until: FirestoreDispatchStore.untilField(until),
        updatedAt: Timestamp.fromMillis(now),
      },
      { merge: true }
    );
  }

  async registerAgent(agent: string, now: number, interruptedUntil: number): Promise<RegisterResult> {
    const snap = await this.col().where('agent', '==', agent).get();
    const result: RegisterResult = { interrupted: [], cleared: [] };
    const batch = this.db.batch();
    for (const doc of snap.docs) {
      const entry = FirestoreDispatchStore.toEntry(doc.id, doc.data());
      if (entry.state === 'in_flight') {
        batch.set(
          doc.ref,
          {
            state: 'held',
            until: FirestoreDispatchStore.untilField(interruptedUntil),
            updatedAt: Timestamp.fromMillis(now),
          },
          { merge: true }
        );
        result.interrupted.push(entry.reference);
      } else if (entry.until === UNTIL_AGENT_RESTART) {
        batch.delete(doc.ref);
        result.cleared.push(entry.reference);
      }
    }
    await batch.commit();
    return result;
  }
}
