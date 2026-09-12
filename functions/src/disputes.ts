// Dispute workflow (spec §7). Packages are bureau-specific, built only from
// CONFIRMED issues, and cannot become READY without the client's explicit
// approval statement. Nothing here sends anything anywhere.

import { z } from 'zod';
import {
  approveDisputeInputSchema,
  createDisputeInputSchema,
  disputeStatusUpdateSchema,
  DISPUTE_TRANSITIONS,
  disputeLetterSubject,
  type CreditIssue,
  type Dispute,
} from '@valeur/shared';
import { db, FieldValue, nowIso } from './lib/admin.js';
import { callable, AppError } from './lib/callable.js';
import { assertClientAccess, assertOwner, loadOwned } from './lib/access.js';
import { logActivity } from './lib/audit.js';
import { getSettings } from './lib/settings.js';
import { buildDisputeLetterForDispute } from './letters.js';

export const createDispute = callable(
  createDisputeInputSchema.extend({ clientId: z.string().min(1).optional() }),
  async ({ input, actor, requestId }) => {
    const clientId = input.clientId ?? actor.uid;
    await assertClientAccess(actor, clientId);

    const issueIds = [...new Set(input.items.map((i) => i.issueId))];
    const snaps = await db.getAll(...issueIds.map((id) => db.doc(`creditIssues/${id}`)));
    const issues: CreditIssue[] = [];
    for (const s of snaps) {
      if (!s.exists) throw new AppError('not-found', 'One of the selected issues could not be found.');
      const issue = { id: s.id, ...(s.data() as Omit<CreditIssue, 'id'>) };
      if (issue.clientId !== clientId) throw new AppError('permission-denied', 'One of the selected issues belongs to a different client.');
      if (issue.status !== 'CONFIRMED') {
        throw new AppError('failed-precondition', `"${issue.summary.slice(0, 60)}…" is not confirmed. Only confirmed issues can be added to a dispute.`);
      }
      if (issue.bureau && issue.bureau !== input.bureau) {
        throw new AppError('failed-precondition', 'A dispute package cannot mix Equifax and TransUnion items. Create a separate package for each bureau.');
      }
      issues.push(issue);
    }

    const ref = db.collection('disputes').doc();
    const batch = db.batch();
    batch.set(ref, {
      clientId,
      bureau: input.bureau,
      status: 'DRAFT',
      subject: disputeLetterSubject(),
      body: null,
      letterId: null,
      issueIds,
      clientApprovedAt: null,
      approvedBy: null,
      approvalStatement: null,
      sentAt: null,
      deliveryMethod: null,
      trackingNumber: null,
      responseDueAt: null,
      responseReceivedAt: null,
      responseSummary: null,
      responseFilePath: null,
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const item of input.items) {
      const issue = issues.find((i) => i.id === item.issueId)!;
      batch.set(db.collection('disputeItems').doc(), {
        disputeId: ref.id,
        clientId,
        issueId: item.issueId,
        accountId: issue.accountId ?? null,
        requestedAction: item.requestedAction,
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.update(db.doc(`creditIssues/${item.issueId}`), { disputeId: ref.id, updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();

    // Generate the draft letter immediately so the client can review it.
    const letter = await buildDisputeLetterForDispute(ref.id, actor, requestId);

    await logActivity({
      clientId,
      actorId: actor.uid,
      actorRole: actor.role,
      action: 'DISPUTE_CREATED',
      entityType: 'dispute',
      entityId: ref.id,
      metadata: { bureau: input.bureau, issueIds, letterId: letter.letterId },
      requestId,
    });
    return { disputeId: ref.id, letterId: letter.letterId, status: 'DRAFT' as const };
  },
);

export const approveDispute = callable(approveDisputeInputSchema, async ({ input, actor, requestId }) => {
  const dispute = await loadOwned<Dispute>(actor, 'disputes', input.disputeId, 'dispute');
  // Staff can prepare, but only the client can approve (spec §2).
  assertOwner(actor, dispute.clientId);
  if (dispute.status !== 'DRAFT') throw new AppError('failed-precondition', 'Only a draft dispute can be approved.');
  if (!dispute.letterId) throw new AppError('failed-precondition', 'Generate the letter before approving.');

  const at = nowIso();
  const batch = db.batch();
  batch.update(db.doc(`disputes/${dispute.id}`), {
    status: 'READY',
    clientApprovedAt: at,
    approvedBy: actor.uid,
    approvalStatement: input.statement,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.update(db.doc(`letters/${dispute.letterId}`), { status: 'READY', approvedAt: at, approvedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
  for (const issueId of dispute.issueIds) {
    batch.update(db.doc(`creditIssues/${issueId}`), { status: 'DISPUTED', updatedAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();

  await logActivity({ clientId: dispute.clientId, actorId: actor.uid, actorRole: actor.role, action: 'DISPUTE_APPROVED', entityType: 'dispute', entityId: dispute.id, metadata: { approvedAt: at, letterId: dispute.letterId }, requestId });
  await logActivity({ clientId: dispute.clientId, actorId: actor.uid, actorRole: actor.role, action: 'LETTER_APPROVED', entityType: 'letter', entityId: dispute.letterId, metadata: { disputeId: dispute.id }, requestId });
  for (const issueId of dispute.issueIds) {
    await logActivity({ clientId: dispute.clientId, actorId: actor.uid, actorRole: actor.role, action: 'ISSUE_STATUS_CHANGED', entityType: 'creditIssue', entityId: issueId, metadata: { from: 'CONFIRMED', to: 'DISPUTED', disputeId: dispute.id }, requestId });
  }
  return { disputeId: dispute.id, status: 'READY' as const, clientApprovedAt: at };
});

export const updateDisputeStatus = callable(disputeStatusUpdateSchema, async ({ input, actor, requestId }) => {
  const dispute = await loadOwned<Dispute>(actor, 'disputes', input.disputeId, 'dispute');
  const allowed = DISPUTE_TRANSITIONS[dispute.status] ?? [];
  if (!allowed.includes(input.status)) {
    if (dispute.status === 'DRAFT' && input.status === 'READY') {
      throw new AppError('failed-precondition', 'A dispute becomes ready only after the client approves it.');
    }
    throw new AppError('failed-precondition', `A dispute that is ${dispute.status.toLowerCase().replace('_', ' ')} cannot move to ${input.status.toLowerCase().replace('_', ' ')}.`);
  }
  if (input.status === 'SENT' && actor.uid !== dispute.clientId) {
    throw new AppError('permission-denied', 'Only the client can record that a dispute was sent.');
  }

  const update: Record<string, unknown> = { status: input.status, updatedAt: FieldValue.serverTimestamp() };
  const at = nowIso();
  if (input.status === 'SENT') {
    if (!input.deliveryMethod) throw new AppError('invalid-argument', 'Tell us how the dispute was submitted (online, mail, or fax).');
    const settings = await getSettings();
    const due = new Date(Date.now() + settings.responseDueDays * 86_400_000).toISOString();
    Object.assign(update, { sentAt: at, deliveryMethod: input.deliveryMethod, trackingNumber: input.trackingNumber ?? null, responseDueAt: due });
    if (dispute.letterId) {
      await db.doc(`letters/${dispute.letterId}`).update({ status: 'SENT', sentAt: at, deliveryMethod: input.deliveryMethod, trackingNumber: input.trackingNumber ?? null, updatedAt: FieldValue.serverTimestamp() });
      await logActivity({ clientId: dispute.clientId, actorId: actor.uid, actorRole: actor.role, action: 'LETTER_SENT', entityType: 'letter', entityId: dispute.letterId, metadata: { deliveryMethod: input.deliveryMethod }, requestId });
    }
  }
  if (input.status === 'RESPONSE_RECEIVED') {
    Object.assign(update, { responseReceivedAt: at, responseSummary: input.responseSummary ?? null, responseFilePath: input.responseFilePath ?? null });
    if (input.responseFilePath) {
      await logActivity({ clientId: dispute.clientId, actorId: actor.uid, actorRole: actor.role, action: 'DISPUTE_RESPONSE_UPLOADED', entityType: 'dispute', entityId: dispute.id, metadata: { path: input.responseFilePath }, requestId });
    }
  }
  if (input.status === 'DRAFT') {
    // Un-approving: reset approval and return issues to CONFIRMED.
    Object.assign(update, { clientApprovedAt: null, approvedBy: null, approvalStatement: null });
    const batch = db.batch();
    for (const issueId of dispute.issueIds) batch.update(db.doc(`creditIssues/${issueId}`), { status: 'CONFIRMED', updatedAt: FieldValue.serverTimestamp() });
    if (dispute.letterId) batch.update(db.doc(`letters/${dispute.letterId}`), { status: 'DRAFT', approvedAt: null, approvedBy: null, updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }
  await db.doc(`disputes/${dispute.id}`).update(update);
  await logActivity({ clientId: dispute.clientId, actorId: actor.uid, actorRole: actor.role, action: 'DISPUTE_STATUS_CHANGED', entityType: 'dispute', entityId: dispute.id, metadata: { from: dispute.status, to: input.status, note: input.note ?? null }, requestId });
  return { disputeId: dispute.id, status: input.status, responseDueAt: (update.responseDueAt as string | undefined) ?? dispute.responseDueAt ?? null };
});
