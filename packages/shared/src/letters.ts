// Plain-language letter templates (spec §7.1, §8, §14). These are deterministic
// so that the wording never promises an outcome or accuses anyone.

import type { Bureau, RequestedAction } from './enums.js';

export interface LetterRecipient {
  name: string;
  address: string | null;
  onlineUrl: string | null;
  onlineInstructions?: string | null;
  lastVerifiedAt: string | null;
}

export interface LetterSender {
  fullName: string;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface DisputeLetterItem {
  index: number;
  creditorName: string;
  maskedAccountNumber: string | null;
  reportDescription: string; // e.g. "Equifax report dated 2025-03-01, page 4"
  issueSummary: string;
  requestedAction: RequestedAction;
  evidenceAttached: string;
}

export const REQUESTED_ACTION_TEXT: Record<RequestedAction, string> = {
  INVESTIGATE: 'Please investigate this item.',
  CORRECT: 'Please investigate and correct this item if it cannot be verified as complete and accurate.',
  UPDATE: 'Please investigate and update this item to reflect the current, verified information.',
  DELETE_IF_UNVERIFIED: 'Please investigate and remove this item only if it cannot be verified as complete and accurate.',
};

export const BUREAU_DISPLAY: Record<Bureau, string> = {
  EQUIFAX: 'Equifax Canada',
  TRANSUNION: 'TransUnion Canada',
};

export const DISPUTE_ATTACHMENTS_CHECKLIST = [
  'Copy of one piece of government-issued photo identification',
  'Proof of current address (utility bill, bank statement, or lease)',
  'Copy of the relevant credit report pages with the items circled',
  'Supporting records for each item (statements, payment confirmations, correspondence)',
];

export const SETTLEMENT_ATTACHMENTS_CHECKLIST = [
  'Copy of the most recent statement or collection notice',
  'Any prior written correspondence about this account',
];

function formatDate(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

function senderBlock(s: LetterSender): string {
  const lines = [s.fullName];
  if (s.address) lines.push(s.address);
  const cityLine = [s.city, s.province, s.postalCode].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  if (s.phone) lines.push(s.phone);
  if (s.email) lines.push(s.email);
  return lines.join('\n');
}

export function destinationSection(r: LetterRecipient): string {
  const lines = ['--- Where to send this letter ---', `Recipient: ${r.name}`];
  if (r.address) lines.push(`Mailing address: ${r.address}`);
  else lines.push('Mailing address: not verified — use the official online channel below.');
  if (r.onlineUrl) lines.push(`Official online submission: ${r.onlineUrl}`);
  if (r.onlineInstructions) lines.push(`Online instructions: ${r.onlineInstructions}`);
  lines.push(
    r.lastVerifiedAt
      ? `Recipient details last verified: ${r.lastVerifiedAt}`
      : 'Recipient details have NOT yet been verified. Confirm the current address or online channel before sending.',
  );
  lines.push('Keep proof of delivery and a copy of any response you receive.');
  return lines.join('\n');
}

export function disputeLetterSubject(): string {
  return 'Request to investigate and correct information in my credit file';
}

export function buildDisputeLetter(args: {
  bureau: Bureau;
  sender: LetterSender;
  recipient: LetterRecipient;
  items: DisputeLetterItem[];
  date?: Date;
}): string {
  const { bureau, sender, recipient, items } = args;
  const rows = items
    .map((it) =>
      [
        `${it.index}. Creditor: ${it.creditorName}${it.maskedAccountNumber ? ` (account ending ${it.maskedAccountNumber.slice(-4)})` : ''}`,
        `   Report: ${it.reportDescription}`,
        `   Concern: ${it.issueSummary}`,
        `   Requested action: ${REQUESTED_ACTION_TEXT[it.requestedAction]}`,
        `   Evidence attached: ${it.evidenceAttached}`,
      ].join('\n'),
    )
    .join('\n\n');

  return [
    formatDate(args.date),
    '',
    senderBlock(sender),
    '',
    `${recipient.name}`,
    recipient.address ?? '',
    '',
    `Subject: ${disputeLetterSubject()}`,
    '',
    `To ${BUREAU_DISPLAY[bureau]},`,
    '',
    'I am writing to request an investigation of the items listed below on my credit file. Based on my records, these items may be inaccurate, incomplete, duplicated, or may need supporting information. I am not asking for the removal of information that is accurate; I am asking that each item be verified and, where it cannot be verified as complete and accurate, corrected, updated, or removed as appropriate.',
    '',
    rows,
    '',
    'Please send me the results of your investigation in writing, together with an updated copy of my credit report reflecting any changes.',
    '',
    'Attachments:',
    ...DISPUTE_ATTACHMENTS_CHECKLIST.map((a) => `  [ ] ${a}`),
    '',
    'Thank you for your attention to this request.',
    '',
    'Sincerely,',
    '',
    sender.fullName,
    '',
    destinationSection(recipient),
  ].join('\n');
}

export function settlementLetterSubject(creditorName: string): string {
  return `Request for written settlement terms — ${creditorName}`;
}

export function buildSettlementRequestLetter(args: {
  sender: LetterSender;
  recipient: LetterRecipient;
  creditorName: string;
  maskedAccountNumber: string | null;
  amountOwed: number | null;
  targetAmount: number | null;
  date?: Date;
}): string {
  const { sender, recipient, creditorName, maskedAccountNumber, amountOwed, targetAmount } = args;
  const acct = maskedAccountNumber ? ` (account ending ${maskedAccountNumber.slice(-4)})` : '';
  const owedLine = amountOwed != null ? `My records show a balance of $${amountOwed.toFixed(2)}.` : '';
  const offerLine =
    targetAmount != null
      ? `I would like to ask whether you would consider a settlement of $${targetAmount.toFixed(2)} in full satisfaction of this account, and if so, to provide the terms in writing.`
      : 'I would like to ask whether a settlement arrangement is available for this account, and if so, to provide the terms in writing.';

  return [
    formatDate(args.date),
    '',
    senderBlock(sender),
    '',
    recipient.name,
    recipient.address ?? '',
    '',
    `Subject: ${settlementLetterSubject(creditorName)}`,
    '',
    `To ${recipient.name},`,
    '',
    `I am writing about the ${creditorName} account${acct} that appears in my records. ${owedLine}`.trim(),
    '',
    offerLine,
    '',
    'Before I make any payment, I would appreciate written confirmation of the following:',
    '  1. The exact settlement amount and the date by which it must be paid.',
    '  2. Whether the payment will satisfy the account in full.',
    '  3. Whether any remaining balance will be waived.',
    '  4. How the account will be reported to Equifax and TransUnion after payment.',
    '',
    'This letter is a request for information about possible terms. It is not an admission of liability and does not create any new agreement on its own.',
    '',
    'Attachments:',
    ...SETTLEMENT_ATTACHMENTS_CHECKLIST.map((a) => `  [ ] ${a}`),
    '',
    'Thank you for your time.',
    '',
    'Sincerely,',
    '',
    sender.fullName,
    '',
    destinationSection(recipient),
  ].join('\n');
}
