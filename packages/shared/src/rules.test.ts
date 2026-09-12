import { describe, expect, it } from 'vitest';
import { runRules, type RuleAccount } from './rules.js';
import { compareBureaus } from './compare.js';
import { redactSensitive, maskAccountNumber, scanQuestionSafety } from './redact.js';
import { settlementSchema, approveDisputeInputSchema, DISPUTE_APPROVAL_STATEMENT, maskedAccountNumber } from './schemas.js';
import { buildDisputeLetter } from './letters.js';

const base = (over: Partial<RuleAccount> & { id: string }): RuleAccount => ({
  creditorName: 'Test Bank',
  maskedAccountNumber: '****1234',
  accountType: 'CREDIT_CARD',
  status: 'OPEN',
  balance: 100,
  pastDue: 0,
  creditLimit: 1000,
  openedDate: '2020-01-01',
  lastReportedDate: '2025-01-01',
  paymentHistoryText: null,
  sourceText: null,
  sourcePage: 1,
  fieldConfidence: {},
  isUnfamiliar: false,
  ...over,
});

describe('rule engine', () => {
  it('returns nothing for a clean account', () => {
    expect(runRules([base({ id: 'a' })])).toEqual([]);
  });

  it('flags collection status', () => {
    const out = runRules([base({ id: 'a', status: 'COLLECTION', accountType: 'COLLECTION' })]);
    expect(out.map((i) => i.ruleCode)).toContain('COLLECTION_STATUS');
  });

  it('flags charge-off via text', () => {
    const out = runRules([base({ id: 'a', sourceText: 'Status: Written off' })]);
    expect(out.map((i) => i.ruleCode)).toContain('CHARGEOFF_STATUS');
  });

  it('flags late payment via 30-day marker', () => {
    const out = runRules([base({ id: 'a', paymentHistoryText: '30 days late Jan 2024' })]);
    expect(out.map((i) => i.ruleCode)).toContain('LATE_PAYMENT_INDICATOR');
  });

  it('flags past due exceeding balance', () => {
    const out = runRules([base({ id: 'a', balance: 50, pastDue: 75 })]);
    expect(out.map((i) => i.ruleCode)).toContain('PAST_DUE_EXCEEDS_BALANCE');
  });

  it('flags unknown account when client marks unfamiliar', () => {
    const out = runRules([base({ id: 'a', isUnfamiliar: true })]);
    expect(out[0].ruleCode).toBe('UNKNOWN_ACCOUNT');
    expect(out[0].severity).toBe('HIGH');
  });

  it('flags duplicate tradelines', () => {
    const out = runRules([base({ id: 'a' }), base({ id: 'b' })]);
    const dup = out.find((i) => i.ruleCode === 'DUPLICATE_TRADELINE');
    expect(dup).toBeDefined();
    expect(dup?.relatedAccountIds).toEqual(['b']);
  });

  it('flags incomplete tradelines on missing fields and low confidence', () => {
    const out = runRules([base({ id: 'a', balance: null, fieldConfidence: { creditorName: 0.3 } })]);
    const inc = out.find((i) => i.ruleCode === 'INCOMPLETE_TRADELINE');
    expect(inc?.summary).toMatch(/missing balance/);
    expect(inc?.summary).toMatch(/low confidence on creditorName/);
  });

  it('never returns a confirmed status — issues are only candidates', () => {
    const out = runRules([base({ id: 'a', status: 'COLLECTION' })]);
    expect(out.every((i) => !('status' in i))).toBe(true);
  });
});

describe('comparison', () => {
  const eq = { id: 'e1', bureau: 'EQUIFAX' as const, creditorName: 'RBC Visa', maskedAccountNumber: '****1111', status: 'OPEN' as const, balance: 500, pastDue: 0, creditLimit: 2000, lastReportedDate: '2025-01-01', openedDate: '2020-01-01', accountType: 'CREDIT_CARD' as const };
  const tu = { ...eq, id: 't1', bureau: 'TRANSUNION' as const, creditorName: 'Royal Bank Visa', balance: 600 };

  it('pairs same creditor and flags balance mismatch beyond tolerance', () => {
    const rows = compareBureaus([eq, tu], 25);
    expect(rows).toHaveLength(1);
    expect(rows[0].flags).toEqual(['SAME_CREDITOR', 'BALANCE_MISMATCH']);
  });

  it('does not flag balances within tolerance', () => {
    const rows = compareBureaus([eq, { ...tu, balance: 510 }], 25);
    expect(rows[0].flags).toEqual(['SAME_CREDITOR']);
  });

  it('flags missing tradeline', () => {
    const rows = compareBureaus([eq], 25);
    expect(rows[0].flags).toEqual(['MISSING_TRADELINE']);
  });

  it('flags status mismatch when one side is negative', () => {
    const rows = compareBureaus([eq, { ...tu, balance: 500, status: 'COLLECTION' }], 25);
    expect(rows[0].flags).toContain('STATUS_MISMATCH');
  });

  it('flags duplicates within a bureau', () => {
    const rows = compareBureaus([eq, { ...eq, id: 'e2' }], 25);
    expect(rows.some((r) => r.flags.includes('DUPLICATE'))).toBe(true);
  });
});

describe('redaction', () => {
  it('masks full account numbers', () => {
    const r = redactSensitive('my card 4111 1111 1111 1234 was charged');
    expect(r.text).toBe('my card ****1234 was charged');
    expect(r.flags).toContain('ACCOUNT_NUMBER_REDACTED');
  });
  it('redacts passwords and tokens', () => {
    const r = redactSensitive('password: hunter2 and key sk-abcdefghijklmnopqrstuvwxyz');
    expect(r.text).not.toContain('hunter2');
    expect(r.text).not.toContain('sk-abc');
  });
  it('maskAccountNumber keeps last four', () => {
    expect(maskAccountNumber('1234567890123456')).toBe('****3456');
  });
  it('flags requests to remove accurate info', () => {
    expect(scanQuestionSafety('how do I remove an accurate late payment')).toContain('REQUEST_TO_REMOVE_ACCURATE_INFO');
  });
});

describe('schemas', () => {
  it('rejects full account numbers', () => {
    expect(maskedAccountNumber.safeParse('4111111111111111').success).toBe(false);
    expect(maskedAccountNumber.safeParse('****1111').success).toBe(true);
  });
  it('rejects target greater than owed', () => {
    const r = settlementSchema.safeParse({ clientId: 'c', creditorName: 'X', status: 'NOT_STARTED', amountOwed: 100, targetAmount: 150 });
    expect(r.success).toBe(false);
  });
  it('requires written confirmation for ACCEPTED', () => {
    const r = settlementSchema.safeParse({ clientId: 'c', creditorName: 'X', status: 'ACCEPTED', acceptedTerms: 'x', acceptedDueDate: '2025-01-01', writtenConfirmationReceived: false });
    expect(r.success).toBe(false);
  });
  it('approval requires the exact statement', () => {
    expect(approveDisputeInputSchema.safeParse({ disputeId: 'd', reviewed: true, statement: 'I agree' }).success).toBe(false);
    expect(approveDisputeInputSchema.safeParse({ disputeId: 'd', reviewed: true, statement: DISPUTE_APPROVAL_STATEMENT }).success).toBe(true);
  });
});

describe('letters', () => {
  it('dispute letter never promises outcomes and ends with destination', () => {
    const body = buildDisputeLetter({
      bureau: 'EQUIFAX',
      sender: { fullName: 'Sam Client' },
      recipient: { name: 'Equifax Canada', address: null, onlineUrl: 'https://example.com', lastVerifiedAt: null },
      items: [{ index: 1, creditorName: 'Bank', maskedAccountNumber: '****1234', reportDescription: 'Equifax page 2', issueSummary: 'late marker', requestedAction: 'CORRECT', evidenceAttached: 'statement' }],
    });
    expect(body).not.toMatch(/guarantee|will increase|score increase/i);
    expect(body).toMatch(/Where to send this letter/);
    expect(body).toMatch(/NOT yet been verified/);
  });
});
