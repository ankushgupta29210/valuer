// Cross-bureau comparison (spec §5.1). Pure function over two account lists.

import type { Bureau, ComparisonFlag } from './enums.js';
import type { Account } from './schemas.js';
import { normalizeCreditor } from './rules.js';

export type CompareAccount = Pick<
  Account,
  'id' | 'bureau' | 'creditorName' | 'maskedAccountNumber' | 'status' | 'balance' | 'pastDue' | 'creditLimit' | 'lastReportedDate' | 'openedDate' | 'accountType'
>;

export interface ComparisonRow {
  key: string;
  creditorName: string;
  equifax: CompareAccount | null;
  transunion: CompareAccount | null;
  flags: ComparisonFlag[];
  explanations: string[];
  /** Field-level differences, when both present. */
  differences: { field: string; equifax: unknown; transunion: unknown }[];
}

export const COMPARISON_EXPLANATIONS: Record<ComparisonFlag, string> = {
  SAME_CREDITOR: 'This account appears on both reports. Review whether the balance, status, and dates match.',
  MISSING_TRADELINE:
    'This account appears on only one report. A difference is not automatically an error; review the source details.',
  BALANCE_MISMATCH: 'The bureaus show different balances. Compare the report dates and latest creditor statement.',
  STATUS_MISMATCH: 'The reported status differs. Compare the payment history and reporting dates.',
  DUPLICATE: 'Similar tradelines appear more than once. Compare account numbers and dates before taking action.',
};

const NEGATIVE_STATUSES = new Set(['COLLECTION', 'CHARGE_OFF', 'LATE', 'PAST_DUE']);

function last4(masked: string | null | undefined): string {
  const m = (masked ?? '').match(/(\d{4})\s*$/);
  return m ? m[1] : '';
}

function matchKey(a: CompareAccount): string {
  return `${normalizeCreditor(a.creditorName)}|${last4(a.maskedAccountNumber)}`;
}

function byBureau(accounts: CompareAccount[], bureau: Bureau): CompareAccount[] {
  return accounts.filter((a) => a.bureau === bureau);
}

export function compareBureaus(accounts: CompareAccount[], balanceTolerance = 25): ComparisonRow[] {
  const eq = byBureau(accounts, 'EQUIFAX');
  const tu = byBureau(accounts, 'TRANSUNION');

  // Index TransUnion accounts by exact key and by creditor-only key so we can
  // still pair accounts when one bureau lacks a masked number.
  const tuByKey = new Map<string, CompareAccount[]>();
  const tuByCreditor = new Map<string, CompareAccount[]>();
  for (const a of tu) {
    const k = matchKey(a);
    tuByKey.set(k, [...(tuByKey.get(k) ?? []), a]);
    const c = normalizeCreditor(a.creditorName);
    tuByCreditor.set(c, [...(tuByCreditor.get(c) ?? []), a]);
  }
  const used = new Set<string>();
  const rows: ComparisonRow[] = [];

  const tuByLast4 = new Map<string, CompareAccount[]>();
  for (const a of tu) {
    const l4 = last4(a.maskedAccountNumber);
    if (l4) tuByLast4.set(l4, [...(tuByLast4.get(l4) ?? []), a]);
  }

  // Tiered matching: exact creditor+last4, then a unique last4 (creditor
  // names often differ between bureaus, e.g. "RBC Visa" vs "Royal Bank
  // Visa"), then creditor-only when no number is available on either side.
  const takeMatch = (a: CompareAccount): CompareAccount | null => {
    const exact = (tuByKey.get(matchKey(a)) ?? []).find((t) => !used.has(t.id));
    if (exact) return exact;
    const l4 = last4(a.maskedAccountNumber);
    if (l4) {
      const candidates = (tuByLast4.get(l4) ?? []).filter((t) => !used.has(t.id));
      if (candidates.length === 1) return candidates[0];
      const sameType = candidates.filter((t) => t.accountType === a.accountType);
      if (sameType.length === 1) return sameType[0];
    }
    const byCreditor = (tuByCreditor.get(normalizeCreditor(a.creditorName)) ?? []).filter((t) => !used.has(t.id));
    if (!l4) {
      if (byCreditor.length) return byCreditor[0];
    } else {
      const noNumber = byCreditor.find((t) => !last4(t.maskedAccountNumber));
      if (noNumber) return noNumber;
    }
    return null;
  };

  for (const e of eq) {
    const t = takeMatch(e);
    if (t) used.add(t.id);
    const flags: ComparisonFlag[] = [];
    const differences: ComparisonRow['differences'] = [];
    if (t) {
      flags.push('SAME_CREDITOR');
      if (e.balance != null && t.balance != null && Math.abs(e.balance - t.balance) > balanceTolerance) {
        flags.push('BALANCE_MISMATCH');
        differences.push({ field: 'balance', equifax: e.balance, transunion: t.balance });
      }
      const eNeg = NEGATIVE_STATUSES.has(e.status);
      const tNeg = NEGATIVE_STATUSES.has(t.status);
      if (e.status !== t.status && (eNeg || tNeg)) {
        flags.push('STATUS_MISMATCH');
        differences.push({ field: 'status', equifax: e.status, transunion: t.status });
      }
      for (const f of ['creditLimit', 'pastDue', 'lastReportedDate', 'openedDate', 'accountType'] as const) {
        if (e[f] != null && t[f] != null && e[f] !== t[f]) {
          differences.push({ field: f, equifax: e[f], transunion: t[f] });
        }
      }
    } else {
      flags.push('MISSING_TRADELINE');
    }
    rows.push({
      key: matchKey(e) || e.id,
      creditorName: e.creditorName,
      equifax: e,
      transunion: t,
      flags,
      explanations: flags.map((f) => COMPARISON_EXPLANATIONS[f]),
      differences,
    });
  }

  for (const t of tu) {
    if (used.has(t.id)) continue;
    rows.push({
      key: matchKey(t) || t.id,
      creditorName: t.creditorName,
      equifax: null,
      transunion: t,
      flags: ['MISSING_TRADELINE'],
      explanations: [COMPARISON_EXPLANATIONS.MISSING_TRADELINE],
      differences: [],
    });
  }

  // Duplicate flag: same creditor + last4 + balance appearing more than once
  // within the same bureau.
  const dupKeys = new Set<string>();
  for (const list of [eq, tu]) {
    const seen = new Map<string, number>();
    for (const a of list) {
      const k = `${matchKey(a)}|${a.balance ?? ''}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const [k, n] of seen) if (n > 1) dupKeys.add(k.split('|').slice(0, 2).join('|'));
  }
  for (const row of rows) {
    if (dupKeys.has(row.key) && !row.flags.includes('DUPLICATE')) {
      row.flags.push('DUPLICATE');
      row.explanations.push(COMPARISON_EXPLANATIONS.DUPLICATE);
    }
  }

  return rows.sort((a, b) => a.creditorName.localeCompare(b.creditorName));
}
