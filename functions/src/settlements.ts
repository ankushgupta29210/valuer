// Settlement tracking (spec §8). Valeur records what the client did; it
// never contacts a creditor or moves money.

import { z } from 'zod';
import { settlementSchema, SETTLEMENT_TRANSITIONS, type Settlement } from '@valeur/shared';
import { db, FieldValue } from './lib/admin.js';
import { callable, AppError } from './lib/callable.js';
import { assertClientAccess, loadOwned } from './lib/access.js';
import { logActivity } from './lib/audit.js';

const inputSchema = z.object({
  settlementId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  // The full document minus clientId; validated by settlementSchema after merge.
  data: z.record(z.unknown()),
});

export const upsertSettlement = callable(inputSchema, async ({ input, actor, requestId }) => {
  let existing: (Settlement & { id: string }) | null = null;
  let clientId = input.clientId ?? actor.uid;
  if (input.settlementId) {
    existing = await loadOwned<Settlement>(actor, 'settlements', input.settlementId, 'settlement');
    clientId = existing.clientId;
  } else {
    await assertClientAccess(actor, clientId);
  }

  const merged = { ...(existing ?? {}), ...input.data, clientId };
  delete (merged as Record<string, unknown>).id;
  delete (merged as Record<string, unknown>).createdAt;
  delete (merged as Record<string, unknown>).updatedAt;
  const parsed = settlementSchema.safeParse(merged);
  if (!parsed.success) {
    throw new AppError('invalid-argument', 'Some settlement details are missing or not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const next = parsed.data;

  if (existing && existing.status !== next.status) {
    const allowed = SETTLEMENT_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(next.status)) {
      throw new AppError('failed-precondition', `A settlement that is ${existing.status.toLowerCase().replace('_', ' ')} cannot move to ${next.status.toLowerCase().replace('_', ' ')}.`);
    }
  }
  if (existing?.status === 'PAID' && next.status === 'PAID') {
    // Paid records are frozen except notes.
    const changed = Object.keys(input.data).filter((k) => k !== 'notes');
    if (changed.length) throw new AppError('failed-precondition', 'A paid settlement can no longer be edited, except for notes.');
  }

  const ref = existing ? db.doc(`settlements/${existing.id}`) : db.collection('settlements').doc();
  await ref.set(
    { ...next, ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await logActivity({
    clientId,
    actorId: actor.uid,
    actorRole: actor.role,
    action: existing ? 'SETTLEMENT_UPDATED' : 'SETTLEMENT_CREATED',
    entityType: 'settlement',
    entityId: ref.id,
    metadata: { from: existing?.status ?? null, to: next.status, targetAmount: next.targetAmount ?? null, offeredAmount: next.offeredAmount ?? null },
    requestId,
  });
  return { settlementId: ref.id, status: next.status };
});
