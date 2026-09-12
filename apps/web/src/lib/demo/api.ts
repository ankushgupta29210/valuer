// Demo-mode implementation of the Cloud Functions API. Same validation and
// workflow rules as functions/src, running against the in-browser store.

import {
  DISPUTE_TRANSITIONS,
  ISSUE_TRANSITIONS,
  SETTLEMENT_TRANSITIONS,
  DISPUTE_APPROVAL_STATEMENT,
  DISPUTE_ATTACHMENTS_CHECKLIST,
  SETTLEMENT_ATTACHMENTS_CHECKLIST,
  BUREAU_DISPLAY,
  accountCorrectionSchema,
  settlementSchema,
  buildDisputeLetter,
  buildSettlementRequestLetter,
  disputeLetterSubject,
  settlementLetterSubject,
  runRules,
  scanQuestionSafety,
  type Account,
  type AgencyContact,
  type Bureau,
  type CreditIssue,
  type Dispute,
  type DisputeItem,
  type IssueStatus,
  type Letter,
  type Profile,
  type Role,
  type Settlement,
  type DisputeStatus,
  type DeliveryMethod,
  type RequestedAction,
  type SettlementStatus,
  type AiProvider,
} from '@valeur/shared';
import { CallableError } from '../errors';
import { demoStore, newId, nowIso } from './store';
import { DEMO_USERS } from './seed';

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));
function fail(code: string, message: string, details?: unknown): never {
  throw new CallableError(code, message, details);
}

function actor() {
  const uid = demoStore.getSessionUid();
  if (!uid) fail('unauthenticated', 'You need to be signed in.');
  const user = demoStore.get<{ role: Role }>(`users/${uid}`);
  return { uid: uid!, role: (user?.role ?? 'client') as Role };
}
function canAccess(a: { uid: string; role: Role }, clientId: string) {
  if (a.uid === clientId || a.role === 'admin') return true;
  if (a.role !== 'advisor') return false;
  const asg = demoStore.get<{ status: string }>(`staffAssignments/${clientId}_${a.uid}`);
  return !!asg && asg.status === 'ACTIVE';
}
function loadOwned<T extends { clientId: string }>(coll: string, id: string, label: string): T & { id: string } {
  const d = demoStore.get<T & { id: string }>(`${coll}/${id}`);
  if (!d) fail('not-found', `That ${label} could not be found.`);
  if (!canAccess(actor(), d!.clientId)) fail('permission-denied', 'You do not have access to this client record.');
  return d!;
}
function log(clientId: string, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
  const a = actor();
  demoStore.add('activityLogs', { clientId, actorId: a.uid, actorRole: a.role, action, entityType, entityId, metadata });
}
function settings() {
  return demoStore.get<{ responseDueDays: number; retentionDays: number }>('settings/global') ?? { responseDueDays: 30, retentionDays: 30 };
}

function bureauRecipient(bureau: Bureau) {
  const c = demoStore.list<AgencyContact>('agencyContacts').find((x) => x.kind === 'BUREAU' && x.bureau === bureau && x.active);
  return {
    contactId: c?.id ?? null,
    recipient: c
      ? { name: c.name, address: c.address ?? null, onlineUrl: c.onlineUrl ?? null, onlineInstructions: c.onlineInstructions ?? null, lastVerifiedAt: c.lastVerifiedAt ?? null }
      : { name: BUREAU_DISPLAY[bureau], address: null, onlineUrl: null, onlineInstructions: 'No verified recipient is on file yet.', lastVerifiedAt: null },
  };
}
function sender(clientId: string) {
  const p = demoStore.get<Profile>(`profiles/${clientId}`);
  if (!p) fail('failed-precondition', 'Please complete your profile first.');
  return { fullName: p!.fullName, address: p!.address ?? null, city: p!.city ?? null, province: p!.province ?? null, postalCode: p!.postalCode ?? null, phone: p!.phone ?? null, email: p!.email };
}

function buildDisputeLetterFor(disputeId: string): { letterId: string } {
  const d = loadOwned<Dispute>('disputes', disputeId, 'dispute');
  if (d.status !== 'DRAFT') fail('failed-precondition', 'The letter can only be regenerated while the dispute is a draft.');
  const items = demoStore.list<DisputeItem>('disputeItems').filter((i) => i.disputeId === d.id);
  const report = (rid: string | null | undefined) => (rid ? demoStore.get<{ reportDate?: string }>(`creditReports/${rid}`) : null);
  const letterItems = items.map((it, idx) => {
    const issue = demoStore.get<CreditIssue>(`creditIssues/${it.issueId}`);
    const account = it.accountId ? demoStore.get<Account>(`accounts/${it.accountId}`) : null;
    const r = report(issue?.reportId);
    return {
      index: idx + 1,
      creditorName: account?.creditorName ?? 'Account',
      maskedAccountNumber: account?.maskedAccountNumber ?? null,
      reportDescription: `${BUREAU_DISPLAY[d.bureau]} report${r?.reportDate ? ` dated ${r.reportDate}` : ''}${issue?.sourcePage ? `, page ${issue.sourcePage}` : ''}`,
      issueSummary: issue?.summary ?? '',
      requestedAction: it.requestedAction,
      evidenceAttached: issue?.evidenceNotes ? 'See attached records' : issue?.evidenceNeeded ?? 'See attached records',
    };
  });
  const { recipient, contactId } = bureauRecipient(d.bureau);
  const body = buildDisputeLetter({ bureau: d.bureau, sender: sender(d.clientId), recipient, items: letterItems });
  const letterId = d.letterId ?? newId();
  demoStore.set('letters', letterId, {
    clientId: d.clientId, disputeId: d.id, settlementId: null, type: 'DISPUTE', bureau: d.bureau,
    recipientName: recipient.name, recipientAddress: recipient.address, recipientUrl: recipient.onlineUrl, recipientVerifiedAt: recipient.lastVerifiedAt, agencyContactId: contactId,
    subject: disputeLetterSubject(), body, attachmentsChecklist: DISPUTE_ATTACHMENTS_CHECKLIST, status: 'DRAFT', generatedAt: nowIso(),
    approvedAt: null, approvedBy: null, sentAt: null, deliveryMethod: null, trackingNumber: null, createdAt: nowIso(), updatedAt: nowIso(),
  });
  demoStore.update('disputes', d.id, { letterId, body });
  log(d.clientId, 'LETTER_GENERATED', 'letter', letterId, { type: 'DISPUTE', disputeId: d.id });
  return { letterId };
}

const SAMPLE_EXTRACTION = [
  { creditorName: 'Sample Bank Mastercard', maskedAccountNumber: '****5566', accountType: 'CREDIT_CARD', status: 'OPEN', balance: 1280.4, pastDue: 0, creditLimit: 3000, openedDate: '2021-03-01', lastReportedDate: '2026-08-15', sourcePage: 2 },
  { creditorName: 'Sample Auto Finance', maskedAccountNumber: '****0192', accountType: 'AUTO_LOAN', status: 'OPEN', balance: 14250, pastDue: 0, creditLimit: null, openedDate: '2023-06-15', lastReportedDate: '2026-08-10', sourcePage: 2 },
  { creditorName: 'Sample Recovery Agency', maskedAccountNumber: '****8830', accountType: 'COLLECTION', status: 'COLLECTION', balance: 412, pastDue: 412, creditLimit: null, openedDate: '2025-11-02', lastReportedDate: '2026-08-01', sourcePage: 3 },
];

const AI_CANNED: { re: RegExp; answer: string }[] = [
  { re: /utiliz/i, answer: 'Credit utilization is the share of your available revolving credit you are using — your card and line-of-credit balances divided by their limits. Most scoring models look at it per account and overall. Lower is generally viewed more favourably, and many advisors suggest staying under about 30% as a working target.\n\nNext step: on the Accounts page, check your revolving utilization figure and note which single account is highest.' },
  { re: /late|30|60|90/i, answer: 'In Canada, a late payment is usually reported once an account is 30 or more days past due, and negative information generally stays on a report for six years from the date of the delinquency, though exact rules differ between Equifax and TransUnion. If you believe a late marker is wrong, the useful evidence is a statement or payment confirmation for that month.\n\nNext step: open the flagged item on the Diagnose page and add your evidence notes.' },
  { re: /collection|agency|settle/i, answer: 'Before paying a collection agency, it is reasonable to ask in writing for the exact amount, whether payment satisfies the account in full, whether any remaining balance is waived, and how the account will be reported to the bureaus afterward. Keep every letter and response.\n\nNext step: create a settlement record on the Plan page and generate a request for written terms.' },
  { re: /equifax|transunion|bureau/i, answer: 'Equifax and TransUnion are the two national credit bureaus in Canada. Lenders choose which bureau(s) they report to and check, so the two files often differ in accounts, balances, and dates. A difference is not automatically an error.\n\nNext step: use the Compare page to see the same creditor side by side.' },
];

export const demoApi = {
  async reparseReport(reportId: string) {
    await delay(800);
    const r = loadOwned<{ clientId: string; status: string }>('creditReports', reportId, 'report');
    log(r.clientId, 'REPORT_PARSING_STARTED', 'creditReport', r.id);
    return { reportId: r.id, status: 'PARSED' as const };
  },

  async updateAccount(accountId: string, changes: Record<string, unknown>) {
    await delay();
    const parsed = accountCorrectionSchema.safeParse(changes);
    if (!parsed.success) return fail('invalid-argument', 'Some of the information provided is not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const a = loadOwned<Account>('accounts', accountId, 'account');
    const diff: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data)) if ((a as Record<string, unknown>)[k] !== (v ?? null)) diff[k] = { from: (a as Record<string, unknown>)[k] ?? null, to: v ?? null };
    demoStore.update('accounts', a.id, { ...parsed.data, reviewState: 'CORRECTED' });
    if (parsed.data.isUnfamiliar && !a.isUnfamiliar) {
      const exists = demoStore.list<CreditIssue>('creditIssues').some((i) => i.accountId === a.id && i.ruleCode === 'UNKNOWN_ACCOUNT');
      if (!exists) {
        const issue = runRules([{ ...a, ...parsed.data, isUnfamiliar: true } as never]).find((i) => i.ruleCode === 'UNKNOWN_ACCOUNT');
        if (issue) demoStore.add('creditIssues', { clientId: a.clientId, reportId: a.reportId ?? null, accountId: a.id, bureau: a.bureau ?? null, origin: 'RULE', ruleCode: issue.ruleCode, type: issue.ruleCode, severity: issue.severity, status: 'OPEN', summary: issue.summary, whyItMatters: issue.whyItMatters, evidenceNeeded: issue.evidenceNeeded, evidenceNotes: null, sourcePage: a.sourcePage ?? null, sourceText: a.sourceText ?? null, confirmedAt: null, confirmedBy: null, resolvedAt: null, disputeId: null });
      }
    }
    log(a.clientId, 'ACCOUNT_UPDATED', 'account', a.id, { diff });
    return { accountId: a.id, changed: Object.keys(diff) };
  },

  async markAccountReviewed(accountId: string) {
    await delay(150);
    const a = loadOwned<Account>('accounts', accountId, 'account');
    if (a.reviewState === 'NEEDS_REVIEW') demoStore.update('accounts', a.id, { reviewState: 'REVIEWED' });
    return { accountId: a.id, reviewState: 'REVIEWED' };
  },

  async updateIssueStatus(issueId: string, status: IssueStatus, note?: string) {
    await delay();
    const issue = loadOwned<CreditIssue>('creditIssues', issueId, 'issue');
    if (status === 'DISPUTED') fail('failed-precondition', 'An issue becomes "in dispute" only when it is added to a dispute package you approve.');
    const allowed = ISSUE_TRANSITIONS[issue.status] ?? [];
    if (issue.status !== status && !allowed.includes(status)) fail('failed-precondition', `An issue that is ${issue.status.toLowerCase().replace('_', ' ')} cannot move to ${status.toLowerCase().replace('_', ' ')}.`);
    const a = actor();
    const patch: Record<string, unknown> = { status };
    if (status === 'CONFIRMED') Object.assign(patch, { confirmedAt: nowIso(), confirmedBy: a.uid });
    if (status === 'RESOLVED') patch.resolvedAt = nowIso();
    if (note) patch.evidenceNotes = [issue.evidenceNotes, `[${nowIso().slice(0, 10)}] ${note}`].filter(Boolean).join('\n');
    demoStore.update('creditIssues', issue.id, patch);
    log(issue.clientId, 'ISSUE_STATUS_CHANGED', 'creditIssue', issue.id, { from: issue.status, to: status, note: note ?? null });
    return { issueId: issue.id, status };
  },

  async createDispute(bureau: Bureau, items: { issueId: string; requestedAction: RequestedAction }[], clientIdArg?: string) {
    await delay(600);
    const a = actor();
    const clientId = clientIdArg ?? a.uid;
    if (!canAccess(a, clientId)) fail('permission-denied', 'You do not have access to this client record.');
    const issueIds = [...new Set(items.map((i) => i.issueId))];
    const issues = issueIds.map((id) => {
      const i = demoStore.get<CreditIssue>(`creditIssues/${id}`);
      if (!i) fail('not-found', 'One of the selected issues could not be found.');
      if (i!.clientId !== clientId) fail('permission-denied', 'One of the selected issues belongs to a different client.');
      if (i!.status !== 'CONFIRMED') fail('failed-precondition', `"${i!.summary.slice(0, 60)}…" is not confirmed. Only confirmed issues can be added to a dispute.`);
      if (i!.bureau && i!.bureau !== bureau) fail('failed-precondition', 'A dispute package cannot mix Equifax and TransUnion items. Create a separate package for each bureau.');
      return i!;
    });
    const disputeId = demoStore.add('disputes', { clientId, bureau, status: 'DRAFT', subject: disputeLetterSubject(), body: null, letterId: null, issueIds, clientApprovedAt: null, approvedBy: null, approvalStatement: null, sentAt: null, deliveryMethod: null, trackingNumber: null, responseDueAt: null, responseReceivedAt: null, responseSummary: null, responseFilePath: null, createdBy: a.uid });
    for (const it of items) {
      const issue = issues.find((i) => i.id === it.issueId)!;
      demoStore.add('disputeItems', { disputeId, clientId, issueId: it.issueId, accountId: issue.accountId ?? null, requestedAction: it.requestedAction });
      demoStore.update('creditIssues', it.issueId, { disputeId });
    }
    const { letterId } = buildDisputeLetterFor(disputeId);
    log(clientId, 'DISPUTE_CREATED', 'dispute', disputeId, { bureau, issueIds, letterId });
    return { disputeId, letterId, status: 'DRAFT' as const };
  },

  async approveDispute(disputeId: string, statement: string) {
    await delay();
    if (statement !== DISPUTE_APPROVAL_STATEMENT) fail('invalid-argument', 'Some of the information provided is not valid.');
    const d = loadOwned<Dispute>('disputes', disputeId, 'dispute');
    if (actor().uid !== d.clientId) fail('permission-denied', 'Only the client can perform this action.');
    if (d.status !== 'DRAFT') fail('failed-precondition', 'Only a draft dispute can be approved.');
    if (!d.letterId) fail('failed-precondition', 'Generate the letter before approving.');
    const at = nowIso();
    demoStore.update('disputes', d.id, { status: 'READY', clientApprovedAt: at, approvedBy: d.clientId, approvalStatement: statement });
    demoStore.update('letters', d.letterId!, { status: 'READY', approvedAt: at, approvedBy: d.clientId });
    for (const id of d.issueIds) demoStore.update('creditIssues', id, { status: 'DISPUTED' });
    log(d.clientId, 'DISPUTE_APPROVED', 'dispute', d.id, { approvedAt: at });
    log(d.clientId, 'LETTER_APPROVED', 'letter', d.letterId, {});
    return { disputeId: d.id, status: 'READY' as const, clientApprovedAt: at };
  },

  async updateDisputeStatus(input: { disputeId: string; status: DisputeStatus; deliveryMethod?: DeliveryMethod; trackingNumber?: string; responseSummary?: string; responseFilePath?: string; note?: string }) {
    await delay();
    const d = loadOwned<Dispute>('disputes', input.disputeId, 'dispute');
    const allowed = DISPUTE_TRANSITIONS[d.status] ?? [];
    if (!allowed.includes(input.status)) {
      if (d.status === 'DRAFT' && input.status === 'READY') fail('failed-precondition', 'A dispute becomes ready only after the client approves it.');
      fail('failed-precondition', `A dispute that is ${d.status.toLowerCase().replace('_', ' ')} cannot move to ${input.status.toLowerCase().replace('_', ' ')}.`);
    }
    if (input.status === 'SENT' && actor().uid !== d.clientId) fail('permission-denied', 'Only the client can record that a dispute was sent.');
    const at = nowIso();
    const patch: Record<string, unknown> = { status: input.status };
    let responseDueAt: string | null = d.responseDueAt ?? null;
    if (input.status === 'SENT') {
      if (!input.deliveryMethod) fail('invalid-argument', 'Tell us how the dispute was submitted (online, mail, or fax).');
      responseDueAt = new Date(Date.now() + settings().responseDueDays * 86_400_000).toISOString();
      Object.assign(patch, { sentAt: at, deliveryMethod: input.deliveryMethod, trackingNumber: input.trackingNumber ?? null, responseDueAt });
      if (d.letterId) demoStore.update('letters', d.letterId, { status: 'SENT', sentAt: at, deliveryMethod: input.deliveryMethod, trackingNumber: input.trackingNumber ?? null });
      log(d.clientId, 'LETTER_SENT', 'letter', d.letterId ?? null, { deliveryMethod: input.deliveryMethod ?? null });
    }
    if (input.status === 'RESPONSE_RECEIVED') Object.assign(patch, { responseReceivedAt: at, responseSummary: input.responseSummary ?? null, responseFilePath: input.responseFilePath ?? null });
    if (input.status === 'DRAFT') {
      Object.assign(patch, { clientApprovedAt: null, approvedBy: null, approvalStatement: null });
      for (const id of d.issueIds) demoStore.update('creditIssues', id, { status: 'CONFIRMED' });
      if (d.letterId) demoStore.update('letters', d.letterId, { status: 'DRAFT', approvedAt: null, approvedBy: null });
    }
    demoStore.update('disputes', d.id, patch);
    log(d.clientId, 'DISPUTE_STATUS_CHANGED', 'dispute', d.id, { from: d.status, to: input.status });
    return { disputeId: d.id, status: input.status, responseDueAt };
  },

  async generateLetter(input: { type: 'DISPUTE'; disputeId: string } | { type: 'SETTLEMENT_REQUEST'; settlementId: string; recipientName: string; recipientAddress: string }) {
    await delay(600);
    if (input.type === 'DISPUTE') return buildDisputeLetterFor(input.disputeId);
    const s = loadOwned<Settlement>('settlements', input.settlementId, 'settlement');
    const account = s.accountId ? demoStore.get<Account>(`accounts/${s.accountId}`) : null;
    const recipient = { name: input.recipientName, address: input.recipientAddress, onlineUrl: null, lastVerifiedAt: nowIso().slice(0, 10) };
    const body = buildSettlementRequestLetter({ sender: sender(s.clientId), recipient, creditorName: s.creditorName, maskedAccountNumber: account?.maskedAccountNumber ?? null, amountOwed: s.amountOwed ?? null, targetAmount: s.targetAmount ?? null });
    const letterId = demoStore.add('letters', { clientId: s.clientId, disputeId: null, settlementId: s.id, type: 'SETTLEMENT_REQUEST', bureau: null, recipientName: recipient.name, recipientAddress: recipient.address, recipientUrl: null, recipientVerifiedAt: recipient.lastVerifiedAt, agencyContactId: null, subject: settlementLetterSubject(s.creditorName), body, attachmentsChecklist: SETTLEMENT_ATTACHMENTS_CHECKLIST, status: 'DRAFT', generatedAt: nowIso(), approvedAt: null, approvedBy: null, sentAt: null, deliveryMethod: null, trackingNumber: null });
    demoStore.update('settlements', s.id, { recipientName: recipient.name, recipientAddress: recipient.address, letterId });
    log(s.clientId, 'LETTER_GENERATED', 'letter', letterId, { type: 'SETTLEMENT_REQUEST' });
    return { letterId };
  },

  async approveLetter(letterId: string) {
    await delay();
    const l = loadOwned<Letter>('letters', letterId, 'letter');
    if (l.type === 'DISPUTE') fail('failed-precondition', 'Dispute letters are approved through the dispute package.');
    if (actor().uid !== l.clientId) fail('permission-denied', 'Only the client can approve a letter.');
    if (l.status !== 'DRAFT') fail('failed-precondition', 'Only a draft letter can be approved.');
    const at = nowIso();
    demoStore.update('letters', l.id, { status: 'READY', approvedAt: at, approvedBy: l.clientId });
    log(l.clientId, 'LETTER_APPROVED', 'letter', l.id);
    return { letterId: l.id, status: 'READY' as const, approvedAt: at };
  },

  async markLetterSent(letterId: string, deliveryMethod: DeliveryMethod, trackingNumber?: string) {
    await delay();
    const l = loadOwned<Letter>('letters', letterId, 'letter');
    if (l.type === 'DISPUTE') fail('failed-precondition', 'Mark dispute letters as sent from the dispute page.');
    if (actor().uid !== l.clientId) fail('permission-denied', 'Only the client can record that a letter was sent.');
    if (l.status !== 'READY') fail('failed-precondition', 'Approve the letter before marking it sent.');
    const at = nowIso();
    demoStore.update('letters', l.id, { status: 'SENT', sentAt: at, deliveryMethod, trackingNumber: trackingNumber ?? null });
    log(l.clientId, 'LETTER_SENT', 'letter', l.id, { deliveryMethod });
    return { letterId: l.id, status: 'SENT' as const, sentAt: at };
  },

  async upsertSettlement(data: Record<string, unknown>, settlementId?: string, clientIdArg?: string) {
    await delay();
    const a = actor();
    let existing: (Settlement & { id: string }) | null = null;
    let clientId = clientIdArg ?? a.uid;
    if (settlementId) {
      existing = loadOwned<Settlement>('settlements', settlementId, 'settlement');
      clientId = existing.clientId;
    } else if (!canAccess(a, clientId)) fail('permission-denied', 'You do not have access to this client record.');
    const merged: Record<string, unknown> = { ...(existing ?? {}), ...data, clientId };
    delete merged.id; delete merged.createdAt; delete merged.updatedAt; delete merged.letterId;
    const parsed = settlementSchema.safeParse(merged);
    if (!parsed.success) return fail('invalid-argument', 'Some settlement details are missing or not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const next = parsed.data;
    if (existing && existing.status !== next.status && !(SETTLEMENT_TRANSITIONS[existing.status] ?? []).includes(next.status)) {
      fail('failed-precondition', `A settlement that is ${existing.status.toLowerCase().replace('_', ' ')} cannot move to ${next.status.toLowerCase().replace('_', ' ')}.`);
    }
    const id = existing ? existing.id : newId();
    demoStore.set('settlements', id, { ...(existing ?? { createdAt: nowIso() }), ...next, updatedAt: nowIso() });
    log(clientId, existing ? 'SETTLEMENT_UPDATED' : 'SETTLEMENT_CREATED', 'settlement', id, { to: next.status });
    return { settlementId: id, status: next.status as SettlementStatus };
  },

  async getSignedDownloadUrl(path: string) {
    await delay(200);
    const m = path.match(/^exports\/[^/]+\/(.+)$/);
    if (m) {
      const blob = demoExports.get(path);
      if (blob) return { url: URL.createObjectURL(blob), expiresInSeconds: 600 };
    }
    fail('failed-precondition', 'Demo mode: original files are not stored in the browser. In the live app this opens the private PDF with a short-lived link.');
    return { url: '', expiresInSeconds: 0 };
  },

  async requestDataExport() {
    await delay(700);
    const a = actor();
    const bundle: Record<string, unknown> = { exportedAt: nowIso(), demo: true, profile: demoStore.get(`profiles/${a.uid}`) };
    for (const c of ['creditReports', 'accounts', 'bills', 'creditIssues', 'disputes', 'disputeItems', 'settlements', 'letters', 'actionPlans', 'aiMessages', 'activityLogs']) {
      bundle[c] = demoStore.list<{ clientId: string }>(c).filter((d) => d.clientId === a.uid);
    }
    const path = `exports/${a.uid}/valeur-export-${Date.now()}.json`;
    demoExports.set(path, new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const requestId = demoStore.add('dataRequests', { clientId: a.uid, type: 'EXPORT', status: 'COMPLETED', requestedAt: nowIso(), completedAt: nowIso(), exportPath: path, reason: null });
    log(a.uid, 'EXPORT_REQUESTED', 'dataRequest', requestId);
    return { requestId, status: 'COMPLETED', exportPath: path };
  },

  async requestAccountDeletion(reason?: string) {
    await delay();
    const a = actor();
    const scheduledFor = new Date(Date.now() + settings().retentionDays * 86_400_000).toISOString();
    const requestId = demoStore.add('dataRequests', { clientId: a.uid, type: 'DELETE', status: 'PENDING', requestedAt: nowIso(), scheduledFor, completedAt: null, exportPath: null, reason: reason ?? null });
    log(a.uid, 'DELETION_REQUESTED', 'dataRequest', requestId, { scheduledFor });
    return { requestId, status: 'PENDING', scheduledFor };
  },

  async cancelDeletionRequest(requestId: string) {
    await delay(150);
    const r = demoStore.get<{ clientId: string; status: string }>(`dataRequests/${requestId}`);
    if (!r || r.clientId !== actor().uid) fail('not-found', 'That request could not be found.');
    demoStore.update('dataRequests', requestId, { status: 'CANCELLED' });
    return { requestId, status: 'CANCELLED' };
  },

  async aiCoach(message: string, useMyData: boolean) {
    await delay(900);
    const a = actor();
    const flags = scanQuestionSafety(message);
    const canned = AI_CANNED.find((c) => c.re.test(message));
    const response = flags.includes('FRAUD_REQUEST')
      ? 'I can’t help with that. Valeur is here to help you understand and organize accurate information about your credit.'
      : (canned?.answer ??
        'Demo mode: the live assistant uses Gemini (with Claude as a fallback) to answer in plain English and always ends with a next step. Here, only a few sample answers are available — try asking about utilization, late payments, collection agencies, or the difference between the bureaus.\n\nNext step: pick one flagged item on the Diagnose page and gather the evidence it lists.');
    const usedClientData = useMyData && !!demoStore.get<Profile>(`profiles/${a.uid}`)?.aiDataConsent;
    const messageId = demoStore.add('aiMessages', { clientId: a.uid, userId: a.uid, role: 'user', message, response, provider: 'gemini' as AiProvider, model: 'demo', usedClientData, safetyFlags: flags });
    log(a.uid, 'AI_QUERY', 'aiMessage', messageId, { provider: 'demo' });
    return { response, provider: 'gemini' as AiProvider, model: 'demo', usedClientData, safetyFlags: flags, messageId };
  },

  async setUserRole(uid: string, role: Role) {
    await delay();
    const a = actor();
    if (a.role !== 'admin') fail('permission-denied', 'Administrator access is required.');
    if (uid === a.uid && role !== 'admin') fail('failed-precondition', 'You cannot remove your own administrator role.');
    demoStore.update('users', uid, { role });
    log(uid, 'ROLE_CHANGED', 'user', uid, { role });
    return { uid, role };
  },

  async assignStaff(clientId: string, staffUid: string, active: boolean) {
    await delay();
    const a = actor();
    if (a.role !== 'admin') fail('permission-denied', 'Administrator access is required.');
    const staff = demoStore.get<{ role: Role }>(`users/${staffUid}`);
    if (!staff || staff.role === 'client') fail('failed-precondition', 'Only advisors or administrators can be assigned to a client.');
    const id = `${clientId}_${staffUid}`;
    const existing = demoStore.get(`staffAssignments/${id}`);
    demoStore.set('staffAssignments', id, { ...(existing ?? { createdAt: nowIso() }), clientId, staffUid, status: active ? 'ACTIVE' : 'INACTIVE', updatedAt: nowIso() });
    log(clientId, active ? 'STAFF_ASSIGNED' : 'STAFF_UNASSIGNED', 'staffAssignment', id, { staffUid });
    return { id, status: active ? 'ACTIVE' : 'INACTIVE' };
  },

  async listUsers() {
    await delay(200);
    if (actor().role !== 'admin') fail('permission-denied', 'Administrator access is required.');
    return demoStore.list<{ id: string; email: string; fullName: string | null; role: Role; disabled: boolean }>('users').map((u) => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, disabled: u.disabled ?? false }));
  },
};

const demoExports = new Map<string, Blob>();

/** Simulated server-side parse for demo uploads: creates sample accounts and runs the real rule engine. */
export async function demoParseReport(reportId: string) {
  const r = demoStore.get<{ clientId: string; bureau: Bureau; fileName: string }>(`creditReports/${reportId}`);
  if (!r) return;
  demoStore.update('creditReports', reportId, { status: 'PARSING' });
  await delay(2200);
  const accountIds = SAMPLE_EXTRACTION.map((a) =>
    demoStore.add('accounts', { clientId: r.clientId, reportId, bureau: r.bureau, source: 'EXTRACTED', reviewState: 'NEEDS_REVIEW', isUnfamiliar: false, notes: null, paymentHistoryText: null, sourceText: `DEMO MODE — simulated extraction for ${r.fileName}\n${a.creditorName}\nAccount Number: ${a.maskedAccountNumber}\nBalance: $${a.balance}\nStatus: ${a.status}`, fieldConfidence: { creditorName: 0.85, balance: 0.85, status: 0.8, lastReportedDate: 0.8, creditLimit: a.creditLimit ? 0.8 : 0.6 }, ...a }),
  );
  const accounts = accountIds.map((id) => demoStore.get<Account>(`accounts/${id}`)!);
  const issues = runRules(accounts as never);
  for (const issue of issues) {
    demoStore.add('creditIssues', { clientId: r.clientId, reportId, accountId: issue.accountId, bureau: r.bureau, origin: 'RULE', ruleCode: issue.ruleCode, type: issue.ruleCode, severity: issue.severity, status: 'OPEN', summary: issue.summary, whyItMatters: issue.whyItMatters, evidenceNeeded: issue.evidenceNeeded, evidenceNotes: null, sourcePage: issue.sourcePage, sourceText: issue.sourceText, relatedAccountIds: issue.relatedAccountIds ?? [], confirmedAt: null, confirmedBy: null, resolvedAt: null, disputeId: null });
  }
  for (let p = 1; p <= 3; p++) demoStore.set(`creditReports/${reportId}/pages`, String(p), { page: p, text: `DEMO MODE — page ${p}.\n\nIn the live app the PDF is read on the server and this panel shows the exact text of each page so every extracted value can be traced back to its source.`, charCount: 100 });
  demoStore.update('creditReports', reportId, { status: 'PARSED', score: 690 + Math.floor(Math.random() * 30), scoreSourcePage: 1, scoreSourceText: 'DEMO MODE — simulated score', reportDate: nowIso().slice(0, 10), parserConfidence: 0.78, pageCount: 3, accountCount: accounts.length, issueCount: issues.length, reviewNotes: ['Demo mode: extraction is simulated with sample accounts. The live app reads the actual PDF on the server.'], parsedAt: nowIso() });
  demoStore.add('activityLogs', { clientId: r.clientId, actorId: 'system', actorRole: 'admin', action: 'REPORT_PARSED', entityType: 'creditReport', entityId: reportId, metadata: { accounts: accounts.length, issues: issues.length, demo: true } });
  if (issues.length) demoStore.add('activityLogs', { clientId: r.clientId, actorId: 'system', actorRole: 'admin', action: 'ISSUES_DETECTED', entityType: 'creditReport', entityId: reportId, metadata: { count: issues.length } });
}

export { DEMO_USERS };
