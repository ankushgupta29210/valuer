// Deterministic diagnostic rule engine (spec §6). Runs over the accounts of a
// single report and returns issue candidates. It never confirms an issue and
// never decides that something is inaccurate — it only surfaces patterns and
// tells the client what evidence would help.

import type { RuleCode, Severity } from './enums.js';
import type { Account } from './schemas.js';

export type RuleAccount = Pick<
  Account,
  | 'id'
  | 'creditorName'
  | 'maskedAccountNumber'
  | 'accountType'
  | 'status'
  | 'balance'
  | 'pastDue'
  | 'creditLimit'
  | 'openedDate'
  | 'lastReportedDate'
  | 'paymentHistoryText'
  | 'sourceText'
  | 'sourcePage'
  | 'fieldConfidence'
  | 'isUnfamiliar'
>;

export interface RuleIssue {
  ruleCode: RuleCode;
  severity: Severity;
  accountId: string | null;
  summary: string;
  whyItMatters: string;
  evidenceNeeded: string;
  sourcePage: number | null;
  sourceText: string | null;
  /** Additional accounts implicated (duplicates). */
  relatedAccountIds?: string[];
}

export interface RuleDefinition {
  code: RuleCode;
  severity: Severity;
  title: string;
  whyItMatters: string;
  evidenceNeeded: string;
}

export const RULE_DEFINITIONS: Record<RuleCode, RuleDefinition> = {
  UNKNOWN_ACCOUNT: {
    code: 'UNKNOWN_ACCOUNT',
    severity: 'HIGH',
    title: 'Account you may not recognize',
    whyItMatters:
      'An account you do not recognize could be a reporting mix-up, an old account under a different name, or a sign of identity misuse.',
    evidenceNeeded:
      'Confirm whether this account belongs to you. Gather any creditor correspondence, and identity-theft records if you believe it is not yours.',
  },
  COLLECTION_STATUS: {
    code: 'COLLECTION_STATUS',
    severity: 'HIGH',
    title: 'Account in collection',
    whyItMatters:
      'Collection items carry significant weight with lenders. Making sure the amount, dates, and ownership are accurate helps you decide the next step.',
    evidenceNeeded:
      'Compare the collection notice, any validation information, your payment history, and any written settlement terms you already have.',
  },
  CHARGEOFF_STATUS: {
    code: 'CHARGEOFF_STATUS',
    severity: 'HIGH',
    title: 'Charged-off or written-off account',
    whyItMatters:
      'A charge-off means the creditor wrote the debt off as a loss. The balance and dates should match the original creditor’s records.',
    evidenceNeeded:
      'Compare the original creditor statement, the charge-off date, the balance, and your payment history.',
  },
  LATE_PAYMENT_INDICATOR: {
    code: 'LATE_PAYMENT_INDICATOR',
    severity: 'HIGH',
    title: 'Late or past-due payment reported',
    whyItMatters:
      'Payment history is the largest factor in most scoring models. If a late marker is wrong, it is worth documenting.',
    evidenceNeeded:
      'Collect statements or payment confirmations for the month(s) reported late.',
  },
  PAST_DUE_EXCEEDS_BALANCE: {
    code: 'PAST_DUE_EXCEEDS_BALANCE',
    severity: 'HIGH',
    title: 'Past-due amount is larger than the balance',
    whyItMatters:
      'A past-due amount should not normally exceed the total balance. This usually points to a reporting or timing error.',
    evidenceNeeded: 'Compare the latest statement and your payment ledger.',
  },
  DUPLICATE_TRADELINE: {
    code: 'DUPLICATE_TRADELINE',
    severity: 'MEDIUM',
    title: 'Possible duplicate tradeline',
    whyItMatters:
      'The same debt listed twice can make your total owed look larger than it is.',
    evidenceNeeded: 'Compare both entries and the source pages, including account numbers and dates.',
  },
  INCOMPLETE_TRADELINE: {
    code: 'INCOMPLETE_TRADELINE',
    severity: 'MEDIUM',
    title: 'Incomplete or low-confidence account details',
    whyItMatters:
      'Missing fields make it hard to compare bureaus or build a plan. This may be an extraction gap rather than a reporting problem.',
    evidenceNeeded:
      'Request a clearer report page or correct the account manually using your statement.',
  },
};

const COLLECTION_RE = /\b(collection|collections|recovery|recoveries)\b/i;
const CHARGEOFF_RE = /\b(charge[\s-]?off|charged[\s-]?off|write[\s-]?off|written[\s-]?off)\b/i;
const LATE_RE = /\b(late|delinquent|delinquency|past[\s-]?due|(30|60|90|120)[\s-]?days?)\b/i;
const UNKNOWN_RE = /\b(unrecognized|not recognized|unknown creditor)\b/i;
const REQUIRED_FIELDS: (keyof RuleAccount)[] = ['creditorName', 'accountType', 'status', 'balance', 'lastReportedDate'];
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

function textOf(a: RuleAccount): string {
  return [a.status, a.paymentHistoryText ?? '', a.sourceText ?? ''].join(' \n ');
}

function issue(a: RuleAccount, code: RuleCode, summary: string, extra?: Partial<RuleIssue>): RuleIssue {
  const def = RULE_DEFINITIONS[code];
  return {
    ruleCode: code,
    severity: def.severity,
    accountId: a.id,
    summary,
    whyItMatters: def.whyItMatters,
    evidenceNeeded: def.evidenceNeeded,
    sourcePage: a.sourcePage ?? null,
    sourceText: a.sourceText ?? null,
    ...extra,
  };
}

export function normalizeCreditor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(inc|ltd|llc|corp|co|the|bank|of|canada|financial|services|card|visa|mastercard|mc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function last4(masked: string | null | undefined): string | null {
  if (!masked) return null;
  const m = masked.match(/(\d{4})\s*$/);
  return m ? m[1] : null;
}

/** Run every rule over the accounts of one report. */
export function runRules(accounts: RuleAccount[]): RuleIssue[] {
  const out: RuleIssue[] = [];

  for (const a of accounts) {
    const text = textOf(a);
    const label = a.creditorName || 'this account';

    if (a.isUnfamiliar || UNKNOWN_RE.test(text)) {
      out.push(
        issue(a, 'UNKNOWN_ACCOUNT', `${label} is marked as unfamiliar or the report text says it is not recognized.`),
      );
    }

    if (a.status === 'COLLECTION' || COLLECTION_RE.test(text)) {
      out.push(issue(a, 'COLLECTION_STATUS', `${label} is reported with a collection or recovery status.`));
    }

    if (a.status === 'CHARGE_OFF' || CHARGEOFF_RE.test(text)) {
      out.push(issue(a, 'CHARGEOFF_STATUS', `${label} is reported as charged off or written off.`));
    }

    if (a.status === 'LATE' || a.status === 'PAST_DUE' || LATE_RE.test(text)) {
      out.push(issue(a, 'LATE_PAYMENT_INDICATOR', `${label} shows a late or past-due payment signal.`));
    }

    if (a.pastDue != null && a.balance != null && a.pastDue > a.balance) {
      out.push(
        issue(
          a,
          'PAST_DUE_EXCEEDS_BALANCE',
          `${label} shows a past-due amount of $${a.pastDue.toFixed(2)} which is greater than the balance of $${a.balance.toFixed(2)}.`,
        ),
      );
    }

    const missing = REQUIRED_FIELDS.filter((f) => a[f] == null || a[f] === '' || a[f] === 'UNKNOWN' || a[f] === 'OTHER');
    const lowConf = Object.entries(a.fieldConfidence ?? {}).filter(([, c]) => c < LOW_CONFIDENCE_THRESHOLD);
    if (missing.length > 0 || lowConf.length > 0) {
      const parts: string[] = [];
      if (missing.length) parts.push(`missing ${missing.join(', ')}`);
      if (lowConf.length) parts.push(`low confidence on ${lowConf.map(([f]) => f).join(', ')}`);
      out.push(issue(a, 'INCOMPLETE_TRADELINE', `${label} has incomplete details (${parts.join('; ')}).`));
    }
  }

  // Duplicate detection: same normalized creditor + same last-4 (when present)
  // + matching balance, appearing more than once.
  const groups = new Map<string, RuleAccount[]>();
  for (const a of accounts) {
    const key = [normalizeCreditor(a.creditorName), last4(a.maskedAccountNumber) ?? '', a.balance ?? ''].join('|');
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group;
    out.push(
      issue(
        first,
        'DUPLICATE_TRADELINE',
        `${first.creditorName} appears ${group.length} times with the same identifying values.`,
        { relatedAccountIds: rest.map((r) => r.id) },
      ),
    );
  }

  return out;
}
