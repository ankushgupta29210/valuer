// Letter generation (spec §7.1, §8, §14). Recipients come from the
// agencyContacts directory — never hard-coded — and every letter ends with a
// destination section that shows the verification date.

import {
  buildDisputeLetter,
  buildSettlementRequestLetter,
  disputeLetterSubject,
  settlementLetterSubject,
  generateLetterInputSchema,
  DISPUTE_ATTACHMENTS_CHECKLIST,
  SETTLEMENT_ATTACHMENTS_CHECKLIST,
  BUREAU_DISPLAY,
  type Account,
  type AgencyContact,
  type CreditIssue,
  type Dispute,
  type DisputeItem,
  type Settlement,
  type LetterRecipient,
  type LetterSender,
  type Bureau,
} from '@valeur/shared';
import { z } from 'zod';
import { db, FieldValue, nowIso } from './lib/admin.js';
import { callable, AppError, type Actor } from './lib/callable.js';
import { loadOwned } from './lib/access.js';
import { logActivity } from './lib/audit.js';
import { getProfile } from './lib/profile.js';
import { getSettings } from './lib/settings.js';
import { enforceRateLimit } from './lib/rateLimit.js';

async function bureauRecipient(bureau: Bureau): Promise<{ recipient: LetterRecipient; contactId: string | null }> {
  const snap = await db.collection('agencyContacts').where('kind', '==', 'BUREAU').where('bureau', '==', bureau).where('active', '==', true).limit(1).get();
  if (snap.empty) {
    return {
      contactId: null,
      recipient: { name: BUREAU_DISPLAY[bureau], address: null, onlineUrl: null, onlineInstructions: 'No verified recipient is on file yet. Ask an administrator to verify the bureau contact before sending.', lastVerifiedAt: null },
    };
  }
  const c = { id: snap.docs[0].id, ...(snap.docs[0].data() as Omit<AgencyContact, 'id'>) };
  return {
    contactId: c.id,
    recipient: { name: c.name, address: c.address ?? null, onlineUrl: c.onlineUrl ?? null, onlineInstructions: c.onlineInstructions ?? null, lastVerifiedAt: c.lastVerifiedAt ?? null },
  };
}

function senderFromProfile(p: Awaited<ReturnType<typeof getProfile>>): LetterSender {
  return { fullName: p.fullName, address: p.address ?? null, city: p.city ?? null, province: p.province ?? null, postalCode: p.postalCode ?? null, phone: p.phone ?? null, email: p.email };
}

export async function buildDisputeLetterForDispute(disputeId: string, actor: Actor, requestId: string): Promise<{ letterId: string }> {
  const dispute = await loadOwned<Dispute>(actor, 'disputes', disputeId, 'dispute');
  if (dispute.status !== 'DRAFT') throw new AppError('failed-precondition', 'The letter can only be regenerated while the dispute is a draft.');
  const profile = await getProfile(dispute.clientId);

  const itemsSnap = await db.collection('disputeItems').where('disputeId', '==', dispute.id).get();
  const items = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DisputeItem, 'id'>) }));
  const issueSnaps = await db.getAll(...items.map((i) => db.doc(`creditIssues/${i.issueId}`)));
  const accountIds = [...new Set(items.map((i) => i.accountId).filter((x): x is string => !!x))];
  const accountSnaps = accountIds.length ? await db.getAll(...accountIds.map((id) => db.doc(`accounts/${id}`))) : [];
  const accounts = new Map(accountSnaps.filter((s) => s.exists).map((s) => [s.id, { id: s.id, ...(s.data() as Omit<Account, 'id'>) }]));
  const reportIds = [...new Set(issueSnaps.map((s) => s.get('reportId')).filter(Boolean))] as string[];
  const reportSnaps = reportIds.length ? await db.getAll(...reportIds.map((id) => db.doc(`creditReports/${id}`))) : [];
  const reports = new Map(reportSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()!]));

  const letterItems = items.map((item, idx) => {
    const issueSnap = issueSnaps.find((s) => s.id === item.issueId);
    const issue = issueSnap?.data() as CreditIssue | undefined;
    const account = item.accountId ? accounts.get(item.accountId) : undefined;
    const report = issue?.reportId ? reports.get(issue.reportId) : undefined;
    const reportDesc = report
      ? `${BUREAU_DISPLAY[dispute.bureau]} report${report.reportDate ? ` dated ${report.reportDate}` : ''}${issue?.sourcePage ? `, page ${issue.sourcePage}` : ''}`
      : `${BUREAU_DISPLAY[dispute.bureau]} report`;
    return {
      index: idx + 1,
      creditorName: account?.creditorName ?? 'Account',
      maskedAccountNumber: account?.maskedAccountNumber ?? null,
      reportDescription: reportDesc,
      issueSummary: issue?.summary ?? '',
      requestedAction: item.requestedAction,
      evidenceAttached: issue?.evidenceNotes ? 'See attached records' : issue?.evidenceNeeded ?? 'See attached records',
    };
  });

  const { recipient, contactId } = await bureauRecipient(dispute.bureau);
  const body = buildDisputeLetter({ bureau: dispute.bureau, sender: senderFromProfile(profile), recipient, items: letterItems });

  const generatedAt = nowIso();
  const letterRef = dispute.letterId ? db.doc(`letters/${dispute.letterId}`) : db.collection('letters').doc();
  await letterRef.set({
    clientId: dispute.clientId,
    disputeId: dispute.id,
    settlementId: null,
    type: 'DISPUTE',
    bureau: dispute.bureau,
    recipientName: recipient.name,
    recipientAddress: recipient.address,
    recipientUrl: recipient.onlineUrl,
    recipientVerifiedAt: recipient.lastVerifiedAt,
    agencyContactId: contactId,
    subject: disputeLetterSubject(),
    body,
    attachmentsChecklist: DISPUTE_ATTACHMENTS_CHECKLIST,
    status: 'DRAFT',
    generatedAt,
    approvedAt: null,
    approvedBy: null,
    sentAt: null,
    deliveryMethod: null,
    trackingNumber: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`disputes/${dispute.id}`).update({ letterId: letterRef.id, body, updatedAt: FieldValue.serverTimestamp() });
  await logActivity({ clientId: dispute.clientId, actorId: actor.uid, actorRole: actor.role, action: 'LETTER_GENERATED', entityType: 'letter', entityId: letterRef.id, metadata: { type: 'DISPUTE', disputeId: dispute.id, recipientVerified: !!recipient.lastVerifiedAt }, requestId });
  return { letterId: letterRef.id };
}

export const generateLetter = callable(generateLetterInputSchema, async ({ input, actor, requestId }) => {
  const settings = await getSettings();
  await enforceRateLimit(actor.uid, 'generateLetter', settings.rateLimits.lettersPerDay, 86_400_000);

  if (input.type === 'DISPUTE') {
    return buildDisputeLetterForDispute(input.disputeId, actor, requestId);
  }

  const settlement = await loadOwned<Settlement>(actor, 'settlements', input.settlementId, 'settlement');
  const profile = await getProfile(settlement.clientId);
  const account = settlement.accountId ? (await db.doc(`accounts/${settlement.accountId}`).get()).data() as Account | undefined : undefined;
  const recipient: LetterRecipient = {
    name: input.recipientName,
    address: input.recipientAddress,
    onlineUrl: null,
    lastVerifiedAt: nowIso().slice(0, 10), // entered by the client from the latest statement
  };
  const body = buildSettlementRequestLetter({
    sender: senderFromProfile(profile),
    recipient,
    creditorName: settlement.creditorName,
    maskedAccountNumber: account?.maskedAccountNumber ?? null,
    amountOwed: settlement.amountOwed ?? null,
    targetAmount: settlement.targetAmount ?? null,
  });
  const ref = db.collection('letters').doc();
  await ref.set({
    clientId: settlement.clientId,
    disputeId: null,
    settlementId: settlement.id,
    type: 'SETTLEMENT_REQUEST',
    bureau: null,
    recipientName: recipient.name,
    recipientAddress: recipient.address,
    recipientUrl: null,
    recipientVerifiedAt: recipient.lastVerifiedAt,
    agencyContactId: null,
    subject: settlementLetterSubject(settlement.creditorName),
    body,
    attachmentsChecklist: SETTLEMENT_ATTACHMENTS_CHECKLIST,
    status: 'DRAFT',
    generatedAt: nowIso(),
    approvedAt: null,
    approvedBy: null,
    sentAt: null,
    deliveryMethod: null,
    trackingNumber: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`settlements/${settlement.id}`).update({ recipientName: recipient.name, recipientAddress: recipient.address, letterId: ref.id, updatedAt: FieldValue.serverTimestamp() });
  await logActivity({ clientId: settlement.clientId, actorId: actor.uid, actorRole: actor.role, action: 'LETTER_GENERATED', entityType: 'letter', entityId: ref.id, metadata: { type: 'SETTLEMENT_REQUEST', settlementId: settlement.id }, requestId });
  return { letterId: ref.id };
});

// Settlement letters have no dispute package; approval + sent tracking is
// handled directly on the letter. Dispute letters go through approveDispute.
export const approveLetter = callable(z.object({ letterId: z.string().min(1), reviewed: z.literal(true) }), async ({ input, actor, requestId }) => {
  const letter = await loadOwned<{ clientId: string; type: string; status: string }>(actor, 'letters', input.letterId, 'letter');
  if (letter.type === 'DISPUTE') throw new AppError('failed-precondition', 'Dispute letters are approved through the dispute package.');
  if (actor.uid !== letter.clientId) throw new AppError('permission-denied', 'Only the client can approve a letter.');
  if (letter.status !== 'DRAFT') throw new AppError('failed-precondition', 'Only a draft letter can be approved.');
  const at = nowIso();
  await db.doc(`letters/${letter.id}`).update({ status: 'READY', approvedAt: at, approvedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
  await logActivity({ clientId: letter.clientId, actorId: actor.uid, actorRole: actor.role, action: 'LETTER_APPROVED', entityType: 'letter', entityId: letter.id, requestId });
  return { letterId: letter.id, status: 'READY' as const, approvedAt: at };
});

export const markLetterSent = callable(
  z.object({ letterId: z.string().min(1), deliveryMethod: z.enum(['ONLINE', 'MAIL', 'FAX', 'OTHER']), trackingNumber: z.string().max(100).optional() }),
  async ({ input, actor, requestId }) => {
    const letter = await loadOwned<{ clientId: string; type: string; status: string; settlementId?: string | null }>(actor, 'letters', input.letterId, 'letter');
    if (letter.type === 'DISPUTE') throw new AppError('failed-precondition', 'Mark dispute letters as sent from the dispute page.');
    if (actor.uid !== letter.clientId) throw new AppError('permission-denied', 'Only the client can record that a letter was sent.');
    if (letter.status !== 'READY') throw new AppError('failed-precondition', 'Approve the letter before marking it sent.');
    const at = nowIso();
    await db.doc(`letters/${letter.id}`).update({ status: 'SENT', sentAt: at, deliveryMethod: input.deliveryMethod, trackingNumber: input.trackingNumber ?? null, updatedAt: FieldValue.serverTimestamp() });
    await logActivity({ clientId: letter.clientId, actorId: actor.uid, actorRole: actor.role, action: 'LETTER_SENT', entityType: 'letter', entityId: letter.id, metadata: { deliveryMethod: input.deliveryMethod }, requestId });
    return { letterId: letter.id, status: 'SENT' as const, sentAt: at };
  },
);
