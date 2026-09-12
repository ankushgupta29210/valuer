import { z } from 'zod';
import { accountCorrectionSchema, issueStatusUpdateSchema, ISSUE_TRANSITIONS, runRules, type Account, type CreditIssue } from '@valeur/shared';
import { db, FieldValue, nowIso } from './lib/admin.js';
import { callable, AppError } from './lib/callable.js';
import { loadOwned } from './lib/access.js';
import { logActivity } from './lib/audit.js';

// Corrections to extracted accounts. Records what changed so the audit trail
// can show the before/after values (spec §5 step 8).
export const updateAccount = callable(
  z.object({ accountId: z.string().min(1), changes: accountCorrectionSchema }),
  async ({ input, actor, requestId }) => {
    const account = await loadOwned<Account>(actor, 'accounts', input.accountId, 'account');
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(input.changes)) {
      const before = (account as unknown as Record<string, unknown>)[k] ?? null;
      if (before !== (v ?? null)) diff[k] = { from: before, to: v ?? null };
    }
    if (Object.keys(diff).length === 0) return { accountId: account.id, changed: [] as string[] };

    await db.doc(`accounts/${account.id}`).update({
      ...input.changes,
      reviewState: 'CORRECTED',
      updatedAt: FieldValue.serverTimestamp(),
    });

    // If the client just marked this account unfamiliar, surface the rule so
    // it lands in the issue list without waiting for a re-parse.
    if (diff.isUnfamiliar?.to === true) {
      const existing = await db.collection('creditIssues').where('accountId', '==', account.id).where('ruleCode', '==', 'UNKNOWN_ACCOUNT').limit(1).get();
      if (existing.empty) {
        const [issue] = runRules([{ ...account, ...input.changes, isUnfamiliar: true }]).filter((i) => i.ruleCode === 'UNKNOWN_ACCOUNT');
        if (issue) {
          await db.collection('creditIssues').add({
            clientId: account.clientId,
            reportId: account.reportId ?? null,
            accountId: account.id,
            bureau: account.bureau ?? null,
            origin: 'RULE',
            ruleCode: issue.ruleCode,
            type: issue.ruleCode,
            severity: issue.severity,
            status: 'OPEN',
            summary: issue.summary,
            whyItMatters: issue.whyItMatters,
            evidenceNeeded: issue.evidenceNeeded,
            evidenceNotes: null,
            sourcePage: account.sourcePage ?? null,
            sourceText: account.sourceText ?? null,
            confirmedAt: null,
            confirmedBy: null,
            resolvedAt: null,
            disputeId: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }

    await logActivity({
      clientId: account.clientId,
      actorId: actor.uid,
      actorRole: actor.role,
      action: 'ACCOUNT_UPDATED',
      entityType: 'account',
      entityId: account.id,
      metadata: { diff },
      requestId,
    });
    return { accountId: account.id, changed: Object.keys(diff) };
  },
);

export const markAccountReviewed = callable(z.object({ accountId: z.string().min(1) }), async ({ input, actor }) => {
  const account = await loadOwned<Account>(actor, 'accounts', input.accountId, 'account');
  if (account.reviewState === 'NEEDS_REVIEW') {
    await db.doc(`accounts/${account.id}`).update({ reviewState: 'REVIEWED', updatedAt: FieldValue.serverTimestamp() });
  }
  return { accountId: account.id, reviewState: account.reviewState === 'NEEDS_REVIEW' ? 'REVIEWED' : account.reviewState };
});

// Issue status workflow (spec §6.1). Transitions are validated server-side and
// every change is audited. DISPUTED is reserved for the dispute functions.
export const updateIssueStatus = callable(issueStatusUpdateSchema, async ({ input, actor, requestId }) => {
  const issue = await loadOwned<CreditIssue>(actor, 'creditIssues', input.issueId, 'issue');
  if (input.status === 'DISPUTED') {
    throw new AppError('failed-precondition', 'An issue becomes "in dispute" only when it is added to a dispute package you approve.');
  }
  const allowed = ISSUE_TRANSITIONS[issue.status] ?? [];
  if (issue.status !== input.status && !allowed.includes(input.status)) {
    throw new AppError('failed-precondition', `An issue that is ${issue.status.toLowerCase().replace('_', ' ')} cannot move to ${input.status.toLowerCase().replace('_', ' ')}.`);
  }
  if (issue.status === 'DISPUTED' && input.status === 'OPEN') {
    // Only allowed if the dispute is no longer active.
    if (issue.disputeId) {
      const d = await db.doc(`disputes/${issue.disputeId}`).get();
      if (d.exists && !['CLOSED', 'DRAFT'].includes(d.get('status'))) {
        throw new AppError('failed-precondition', 'This issue is part of an active dispute. Close the dispute first.');
      }
    }
  }

  const update: Record<string, unknown> = { status: input.status, updatedAt: FieldValue.serverTimestamp() };
  if (input.status === 'CONFIRMED') {
    update.confirmedAt = nowIso();
    update.confirmedBy = actor.uid;
  }
  if (input.status === 'RESOLVED') update.resolvedAt = nowIso();
  if (input.note) {
    update.evidenceNotes = [issue.evidenceNotes, `[${nowIso().slice(0, 10)}] ${input.note}`].filter(Boolean).join('\n');
  }
  await db.doc(`creditIssues/${issue.id}`).update(update);
  await logActivity({
    clientId: issue.clientId,
    actorId: actor.uid,
    actorRole: actor.role,
    action: 'ISSUE_STATUS_CHANGED',
    entityType: 'creditIssue',
    entityId: issue.id,
    metadata: { from: issue.status, to: input.status, note: input.note ?? null, ruleCode: issue.ruleCode ?? null },
    requestId,
  });
  return { issueId: issue.id, status: input.status };
});
