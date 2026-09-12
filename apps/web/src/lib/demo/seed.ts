// Sample dataset for demo mode. Clearly labelled; never real data.
// Mirrors scripts/seed.mjs so the demo and the emulator look the same.

import { runRules } from '@valeur/shared';
import { demoStore, nowIso } from './store';

export const DEMO_USERS = {
  client: { uid: 'demo-client', email: 'client@demo.valeur.local', fullName: 'Demo Client (Sample Data)', role: 'client' as const },
  advisor: { uid: 'demo-advisor', email: 'advisor@demo.valeur.local', fullName: 'Demo Advisor', role: 'advisor' as const },
  admin: { uid: 'demo-admin', email: 'admin@demo.valeur.local', fullName: 'Demo Admin', role: 'admin' as const },
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export function seedDemoData() {
  const c = DEMO_USERS.client.uid;
  const t = nowIso();
  const data: Record<string, Record<string, Record<string, unknown> & { id: string }>> = {};
  const put = (coll: string, id: string, doc: Record<string, unknown>) => {
    data[coll] ??= {};
    data[coll][id] = { id, createdAt: t, updatedAt: t, ...doc };
  };

  for (const u of Object.values(DEMO_USERS)) {
    put('users', u.uid, { email: u.email, fullName: u.fullName, role: u.role, disabled: false });
    put('profiles', u.uid, {
      fullName: u.fullName,
      email: u.email,
      phone: u.role === 'client' ? '416-555-0100' : null,
      address: u.role === 'client' ? '123 Sample Street' : null,
      city: u.role === 'client' ? 'Toronto' : null,
      province: u.role === 'client' ? 'ON' : null,
      postalCode: u.role === 'client' ? 'M5V 1A1' : null,
      consentAt: t,
      aiDataConsent: u.role === 'client',
      notificationPrefs: { email: true, reportReady: true, dueDateReminders: true, disputeUpdates: true },
    });
  }
  put('staffAssignments', `${c}_${DEMO_USERS.advisor.uid}`, { clientId: c, staffUid: DEMO_USERS.advisor.uid, status: 'ACTIVE' });
  put('settings', 'global', { maxUploadBytes: 10 * 1024 * 1024, balanceTolerance: 25, responseDueDays: 30, retentionDays: 30, rateLimits: { aiPerHour: 20, uploadsPerDay: 10, lettersPerDay: 20 } });

  put('agencyContacts', 'BUREAU_equifax', { kind: 'BUREAU', bureau: 'EQUIFAX', name: 'Equifax Canada Co. — Consumer Relations', address: null, onlineUrl: 'https://www.consumer.equifax.ca/personal/dispute/', onlineInstructions: 'Use the online dispute form or the mailing address shown on the current official Equifax Canada dispute page. Verify before sending.', phone: null, lastVerifiedAt: null, active: true });
  put('agencyContacts', 'BUREAU_transunion', { kind: 'BUREAU', bureau: 'TRANSUNION', name: 'TransUnion Canada — Consumer Relations', address: null, onlineUrl: 'https://www.transunion.ca/consumer-support/dispute', onlineInstructions: 'Use the online dispute process or the mailing address shown on the current official TransUnion Canada dispute page. Verify before sending.', phone: null, lastVerifiedAt: null, active: true });

  const eq = 'report-eq-sample';
  const tu = 'report-tu-sample';
  put('creditReports', eq, { clientId: c, bureau: 'EQUIFAX', fileName: 'SAMPLE-equifax-report.pdf', storagePath: `credit-reports/${c}/${eq}.pdf`, fileSize: 184_000, status: 'PARSED', score: 668, scoreSourcePage: 1, scoreSourceText: 'SAMPLE DATA — Equifax Credit Score 668', reportDate: '2026-08-01', parserConfidence: 0.82, pageCount: 6, accountCount: 4, issueCount: 3, errorMessage: null, reviewNotes: ['This is sample data for demonstration.'], parsedAt: t, createdAt: daysAgo(3) });
  put('creditReports', tu, { clientId: c, bureau: 'TRANSUNION', fileName: 'SAMPLE-transunion-report.pdf', storagePath: `credit-reports/${c}/${tu}.pdf`, fileSize: 162_000, status: 'PARSED', score: 654, scoreSourcePage: 1, scoreSourceText: 'SAMPLE DATA — TransUnion CreditVision Score 654', reportDate: '2026-08-03', parserConfidence: 0.79, pageCount: 5, accountCount: 4, issueCount: 1, errorMessage: null, reviewNotes: ['This is sample data for demonstration.'], parsedAt: t, createdAt: daysAgo(2) });
  for (const [rid, n] of [[eq, 6], [tu, 5]] as const) {
    for (let p = 1; p <= n; p++) {
      put(`creditReports/${rid}/pages`, String(p), { page: p, text: `SAMPLE DATA — page ${p} of the ${rid === eq ? 'Equifax' : 'TransUnion'} report.\n\n(In the live app this shows the text read from your PDF so every extracted value can be traced back to its source.)`, charCount: 120 });
    }
  }

  const acct = (id: string, reportId: string, bureau: string, a: Record<string, unknown>) =>
    put('accounts', id, {
      clientId: c, reportId, bureau, source: 'EXTRACTED', reviewState: 'NEEDS_REVIEW', isUnfamiliar: false, notes: null, paymentHistoryText: null, pastDue: 0,
      sourceText: `SAMPLE DATA\n${a.creditorName}\nAccount Number: ${a.maskedAccountNumber}\nBalance: $${a.balance}\nCredit Limit: $${a.creditLimit ?? ''}\nStatus: ${a.status}\nDate Opened: ${a.openedDate}\nLast Reported: ${a.lastReportedDate}`,
      fieldConfidence: { creditorName: 0.85, balance: 0.85, status: 0.8, lastReportedDate: 0.8, creditLimit: a.creditLimit ? 0.8 : 0.6 },
      ...a,
    });
  acct('acct-eq-td', eq, 'EQUIFAX', { creditorName: 'TD Visa', maskedAccountNumber: '****4321', accountType: 'CREDIT_CARD', status: 'OPEN', balance: 2140.55, creditLimit: 5000, openedDate: '2019-04-12', lastReportedDate: '2026-07-28', sourcePage: 2 });
  acct('acct-eq-rogers', eq, 'EQUIFAX', { creditorName: 'Rogers Communications', maskedAccountNumber: '****9901', accountType: 'TELECOM', status: 'OPEN', balance: 85, creditLimit: null, openedDate: '2022-01-05', lastReportedDate: '2026-07-30', sourcePage: 3 });
  acct('acct-eq-cbv', eq, 'EQUIFAX', { creditorName: 'CBV Collection Services', maskedAccountNumber: '****7710', accountType: 'COLLECTION', status: 'COLLECTION', balance: 640, creditLimit: null, openedDate: '2025-02-10', lastReportedDate: '2026-07-15', sourcePage: 4 });
  acct('acct-eq-scotia', eq, 'EQUIFAX', { creditorName: 'Scotiabank Line of Credit', maskedAccountNumber: '****1188', accountType: 'LINE_OF_CREDIT', status: 'LATE', balance: 3900, creditLimit: 10000, pastDue: 4200, openedDate: '2020-09-01', lastReportedDate: '2026-07-20', sourcePage: 4 });
  acct('acct-tu-td', tu, 'TRANSUNION', { creditorName: 'Toronto-Dominion Bank Visa', maskedAccountNumber: '****4321', accountType: 'CREDIT_CARD', status: 'OPEN', balance: 2310.1, creditLimit: 5000, openedDate: '2019-04-12', lastReportedDate: '2026-08-01', sourcePage: 2 });
  acct('acct-tu-rogers', tu, 'TRANSUNION', { creditorName: 'Rogers', maskedAccountNumber: '****9901', accountType: 'TELECOM', status: 'OPEN', balance: 85, creditLimit: null, openedDate: '2022-01-05', lastReportedDate: '2026-07-30', sourcePage: 3 });
  acct('acct-tu-scotia', tu, 'TRANSUNION', { creditorName: 'Scotiabank LOC', maskedAccountNumber: '****1188', accountType: 'LINE_OF_CREDIT', status: 'OPEN', balance: 3900, creditLimit: 10000, openedDate: '2020-09-01', lastReportedDate: '2026-07-31', sourcePage: 3 });
  acct('acct-tu-csl', tu, 'TRANSUNION', { creditorName: 'Canada Student Loans', maskedAccountNumber: '****2044', accountType: 'STUDENT_LOAN', status: 'OPEN', balance: 11200, creditLimit: null, openedDate: '2016-09-01', lastReportedDate: '2026-07-25', sourcePage: 4, fieldConfidence: { creditorName: 0.85, balance: 0.85, status: 0.8, lastReportedDate: 0.8, creditLimit: 0.3 } });

  // Issues from the real rule engine so the demo matches production logic.
  for (const rid of [eq, tu]) {
    const accounts = Object.values(data.accounts).filter((a) => a.reportId === rid);
    const issues = runRules(accounts as never);
    for (const [i, issue] of issues.entries()) {
      put('creditIssues', `${rid}-issue-${i}`, {
        clientId: c, reportId: rid, accountId: issue.accountId, bureau: rid === eq ? 'EQUIFAX' : 'TRANSUNION', origin: 'RULE',
        ruleCode: issue.ruleCode, type: issue.ruleCode, severity: issue.severity, status: 'OPEN', summary: issue.summary,
        whyItMatters: issue.whyItMatters, evidenceNeeded: issue.evidenceNeeded, evidenceNotes: null, sourcePage: issue.sourcePage,
        sourceText: 'SAMPLE DATA', relatedAccountIds: issue.relatedAccountIds ?? [], confirmedAt: null, confirmedBy: null, resolvedAt: null, disputeId: null,
      });
    }
  }

  put('bills', 'bill-td', { clientId: c, name: 'TD Visa', category: 'CREDIT_CARD', dueDay: 18, recurringAmount: 150, minimumAmount: 65, currentAmount: 2140.55, autopay: true, accountId: 'acct-eq-td', status: 'ACTIVE', notes: 'SAMPLE DATA' });
  put('bills', 'bill-rent', { clientId: c, name: 'Rent', category: 'RENT_MORTGAGE', dueDay: 1, recurringAmount: 1850, minimumAmount: null, currentAmount: null, autopay: false, accountId: null, status: 'ACTIVE', notes: 'SAMPLE DATA' });
  put('bills', 'bill-rogers', { clientId: c, name: 'Rogers mobile', category: 'PHONE_INTERNET', dueDay: 27, recurringAmount: 85, minimumAmount: null, currentAmount: 85, autopay: true, accountId: 'acct-eq-rogers', status: 'ACTIVE', notes: 'SAMPLE DATA' });

  put('actionPlans', 'plan-1', { clientId: c, title: 'Mortgage-ready in 12 months (sample)', goal: 'Bring utilization under 30% and clear the collection item with written terms.', archived: false, steps: [
    { id: 'step-1', title: 'Pull the latest Scotiabank LOC statement', detail: 'Needed to check the past-due amount.', dueDate: null, status: 'DONE', linkedType: 'ACCOUNT', linkedId: 'acct-eq-scotia', completedAt: t },
    { id: 'step-2', title: 'Request written terms from CBV Collection Services', detail: null, dueDate: null, status: 'TODO', linkedType: 'ACCOUNT', linkedId: 'acct-eq-cbv', completedAt: null },
    { id: 'step-3', title: 'Set up autopay for rent', detail: null, dueDate: null, status: 'TODO', linkedType: null, linkedId: null, completedAt: null },
  ] });

  put('activityLogs', 'log-1', { clientId: c, actorId: c, actorRole: 'client', action: 'REPORT_UPLOADED', entityType: 'creditReport', entityId: eq, metadata: {}, createdAt: daysAgo(3) });
  put('activityLogs', 'log-2', { clientId: c, actorId: 'system', actorRole: 'admin', action: 'REPORT_PARSED', entityType: 'creditReport', entityId: eq, metadata: { accounts: 4 }, createdAt: daysAgo(3) });
  put('activityLogs', 'log-3', { clientId: c, actorId: c, actorRole: 'client', action: 'REPORT_UPLOADED', entityType: 'creditReport', entityId: tu, metadata: {}, createdAt: daysAgo(2) });
  put('activityLogs', 'log-4', { clientId: c, actorId: 'system', actorRole: 'admin', action: 'ISSUES_DETECTED', entityType: 'creditReport', entityId: tu, metadata: {}, createdAt: daysAgo(2) });

  demoStore.replaceAll(data);
}

export function ensureDemoSeeded() {
  if (demoStore.isEmpty()) seedDemoData();
}
