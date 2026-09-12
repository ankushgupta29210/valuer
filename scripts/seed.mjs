// Seeds the LOCAL EMULATOR with clearly labelled demo data.
// Usage: start the emulators, then `npm run seed`.
// Never run this against a production project.

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'valeur-credit' });
const db = getFirestore();
const auth = getAuth();
const now = FieldValue.serverTimestamp();

async function ensureUser(email, password, displayName, role) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, password, displayName, emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, { role });
  await db.doc(`users/${user.uid}`).set({ email, fullName: displayName, role, disabled: false, createdAt: now, updatedAt: now }, { merge: true });
  return user.uid;
}

const adminUid = await ensureUser('admin@demo.valeur.local', 'demo-password-1', 'Demo Admin', 'admin');
const advisorUid = await ensureUser('advisor@demo.valeur.local', 'demo-password-1', 'Demo Advisor', 'advisor');
const clientUid = await ensureUser('client@demo.valeur.local', 'demo-password-1', 'Demo Client (Sample Data)', 'client');

await db.doc(`profiles/${clientUid}`).set({
  fullName: 'Demo Client (Sample Data)',
  email: 'client@demo.valeur.local',
  phone: '416-555-0100',
  address: '123 Sample Street',
  city: 'Toronto',
  province: 'ON',
  postalCode: 'M5V 1A1',
  consentAt: new Date().toISOString(),
  aiDataConsent: true,
  notificationPrefs: { email: true, reportReady: true, dueDateReminders: true, disputeUpdates: true },
  createdAt: now,
  updatedAt: now,
}, { merge: true });

for (const [uid, name, email] of [[adminUid, 'Demo Admin', 'admin@demo.valeur.local'], [advisorUid, 'Demo Advisor', 'advisor@demo.valeur.local']]) {
  await db.doc(`profiles/${uid}`).set({ fullName: name, email, consentAt: new Date().toISOString(), aiDataConsent: false, notificationPrefs: {}, createdAt: now, updatedAt: now }, { merge: true });
}

await db.doc(`staffAssignments/${clientUid}_${advisorUid}`).set({ clientId: clientUid, staffUid: advisorUid, status: 'ACTIVE', createdAt: now, updatedAt: now });

await db.doc('settings/global').set({
  maxUploadBytes: 10 * 1024 * 1024,
  balanceTolerance: 25,
  responseDueDays: 30,
  retentionDays: 30,
  rateLimits: { aiPerHour: 20, uploadsPerDay: 10, lettersPerDay: 20 },
  updatedAt: now,
}, { merge: true });

// Recipient directory — PLACEHOLDERS. lastVerifiedAt is null on purpose: an
// administrator must verify each entry against the official source before
// launch (spec §14).
await db.doc('agencyContacts/BUREAU_equifax').set({
  kind: 'BUREAU', bureau: 'EQUIFAX', name: 'Equifax Canada Co. — Consumer Relations',
  address: null,
  onlineUrl: 'https://www.consumer.equifax.ca/personal/dispute/',
  onlineInstructions: 'Use the online dispute form or the mailing address shown on the current official Equifax Canada dispute page. Verify before sending.',
  phone: null, lastVerifiedAt: null, active: true, createdAt: now, updatedAt: now,
}, { merge: true });
await db.doc('agencyContacts/BUREAU_transunion').set({
  kind: 'BUREAU', bureau: 'TRANSUNION', name: 'TransUnion Canada — Consumer Relations',
  address: null,
  onlineUrl: 'https://www.transunion.ca/consumer-support/dispute',
  onlineInstructions: 'Use the online dispute process or the mailing address shown on the current official TransUnion Canada dispute page. Verify before sending.',
  phone: null, lastVerifiedAt: null, active: true, createdAt: now, updatedAt: now,
}, { merge: true });

// Sample accounts (labelled) — one report per bureau with overlapping and
// differing tradelines so Compare and Diagnose have something to show.
const eqReport = db.collection('creditReports').doc();
const tuReport = db.collection('creditReports').doc();
await eqReport.set({ clientId: clientUid, bureau: 'EQUIFAX', fileName: 'SAMPLE-equifax-report.pdf', storagePath: `credit-reports/${clientUid}/${eqReport.id}.pdf`, fileSize: 0, status: 'PARSED', score: 668, scoreSourcePage: 1, scoreSourceText: 'SAMPLE DATA — Equifax Credit Score 668', reportDate: '2026-08-01', parserConfidence: 0.82, pageCount: 6, accountCount: 4, issueCount: 2, errorMessage: null, reviewNotes: ['This is sample data seeded for demonstration.'], parsedAt: new Date().toISOString(), createdAt: now, updatedAt: now });
await tuReport.set({ clientId: clientUid, bureau: 'TRANSUNION', fileName: 'SAMPLE-transunion-report.pdf', storagePath: `credit-reports/${clientUid}/${tuReport.id}.pdf`, fileSize: 0, status: 'PARSED', score: 654, scoreSourcePage: 1, scoreSourceText: 'SAMPLE DATA — TransUnion CreditVision Score 654', reportDate: '2026-08-03', parserConfidence: 0.79, pageCount: 5, accountCount: 4, issueCount: 1, errorMessage: null, reviewNotes: ['This is sample data seeded for demonstration.'], parsedAt: new Date().toISOString(), createdAt: now, updatedAt: now });

const acct = (reportId, bureau, a) => ({
  clientId: clientUid, reportId, bureau, source: 'EXTRACTED', reviewState: 'NEEDS_REVIEW', isUnfamiliar: false, notes: null, paymentHistoryText: null,
  sourceText: `SAMPLE DATA\n${a.creditorName}\nAccount Number: ${a.maskedAccountNumber}\nBalance: $${a.balance}\nCredit Limit: $${a.creditLimit ?? ''}\nStatus: ${a.status}\nDate Opened: ${a.openedDate}\nLast Reported: ${a.lastReportedDate}`,
  fieldConfidence: { creditorName: 0.85, balance: 0.85, status: 0.8, lastReportedDate: 0.8, creditLimit: a.creditLimit ? 0.8 : 0.4 },
  pastDue: 0, createdAt: now, updatedAt: now, ...a,
});
const eqAccounts = [
  acct(eqReport.id, 'EQUIFAX', { creditorName: 'TD Visa', maskedAccountNumber: '****4321', accountType: 'CREDIT_CARD', status: 'OPEN', balance: 2140.55, creditLimit: 5000, openedDate: '2019-04-12', lastReportedDate: '2026-07-28', sourcePage: 2 }),
  acct(eqReport.id, 'EQUIFAX', { creditorName: 'Rogers Communications', maskedAccountNumber: '****9901', accountType: 'TELECOM', status: 'OPEN', balance: 85, creditLimit: null, openedDate: '2022-01-05', lastReportedDate: '2026-07-30', sourcePage: 3 }),
  acct(eqReport.id, 'EQUIFAX', { creditorName: 'CBV Collection Services', maskedAccountNumber: '****7710', accountType: 'COLLECTION', status: 'COLLECTION', balance: 640, creditLimit: null, openedDate: '2025-02-10', lastReportedDate: '2026-07-15', sourcePage: 4 }),
  acct(eqReport.id, 'EQUIFAX', { creditorName: 'Scotiabank Line of Credit', maskedAccountNumber: '****1188', accountType: 'LINE_OF_CREDIT', status: 'LATE', balance: 3900, creditLimit: 10000, pastDue: 4200, openedDate: '2020-09-01', lastReportedDate: '2026-07-20', sourcePage: 4 }),
];
const tuAccounts = [
  acct(tuReport.id, 'TRANSUNION', { creditorName: 'Toronto-Dominion Bank Visa', maskedAccountNumber: '****4321', accountType: 'CREDIT_CARD', status: 'OPEN', balance: 2310.1, creditLimit: 5000, openedDate: '2019-04-12', lastReportedDate: '2026-08-01', sourcePage: 2 }),
  acct(tuReport.id, 'TRANSUNION', { creditorName: 'Rogers', maskedAccountNumber: '****9901', accountType: 'TELECOM', status: 'OPEN', balance: 85, creditLimit: null, openedDate: '2022-01-05', lastReportedDate: '2026-07-30', sourcePage: 3 }),
  acct(tuReport.id, 'TRANSUNION', { creditorName: 'Scotiabank LOC', maskedAccountNumber: '****1188', accountType: 'LINE_OF_CREDIT', status: 'OPEN', balance: 3900, creditLimit: 10000, openedDate: '2020-09-01', lastReportedDate: '2026-07-31', sourcePage: 3 }),
  acct(tuReport.id, 'TRANSUNION', { creditorName: 'Canada Student Loans', maskedAccountNumber: '****2044', accountType: 'STUDENT_LOAN', status: 'OPEN', balance: 11200, creditLimit: null, openedDate: '2016-09-01', lastReportedDate: '2026-07-25', sourcePage: 4 }),
];
const ids = {};
for (const [i, a] of [...eqAccounts, ...tuAccounts].entries()) {
  const ref = db.collection('accounts').doc();
  await ref.set(a);
  ids[i] = ref.id;
}

const issue = (reportId, bureau, accountId, ruleCode, severity, summary, whyItMatters, evidenceNeeded, sourcePage) => ({
  clientId: clientUid, reportId, accountId, bureau, origin: 'RULE', ruleCode, type: ruleCode, severity, status: 'OPEN', summary, whyItMatters, evidenceNeeded, evidenceNotes: null, sourcePage, sourceText: 'SAMPLE DATA', relatedAccountIds: [], confirmedAt: null, confirmedBy: null, resolvedAt: null, disputeId: null, createdAt: now, updatedAt: now,
});
await db.collection('creditIssues').add(issue(eqReport.id, 'EQUIFAX', ids[2], 'COLLECTION_STATUS', 'HIGH', 'CBV Collection Services is reported with a collection or recovery status.', 'Collection items carry significant weight with lenders. Making sure the amount, dates, and ownership are accurate helps you decide the next step.', 'Compare the collection notice, any validation information, your payment history, and any written settlement terms you already have.', 4));
await db.collection('creditIssues').add(issue(eqReport.id, 'EQUIFAX', ids[3], 'PAST_DUE_EXCEEDS_BALANCE', 'HIGH', 'Scotiabank Line of Credit shows a past-due amount of $4200.00 which is greater than the balance of $3900.00.', 'A past-due amount should not normally exceed the total balance. This usually points to a reporting or timing error.', 'Compare the latest statement and your payment ledger.', 4));
await db.collection('creditIssues').add(issue(eqReport.id, 'EQUIFAX', ids[3], 'LATE_PAYMENT_INDICATOR', 'HIGH', 'Scotiabank Line of Credit shows a late or past-due payment signal.', 'Payment history is the largest factor in most scoring models. If a late marker is wrong, it is worth documenting.', 'Collect statements or payment confirmations for the month(s) reported late.', 4));
await db.collection('creditIssues').add(issue(tuReport.id, 'TRANSUNION', ids[7], 'INCOMPLETE_TRADELINE', 'MEDIUM', 'Canada Student Loans has incomplete details (low confidence on creditLimit).', 'Missing fields make it hard to compare bureaus or build a plan. This may be an extraction gap rather than a reporting problem.', 'Request a clearer report page or correct the account manually using your statement.', 4));

await db.collection('bills').add({ clientId: clientUid, name: 'TD Visa', category: 'CREDIT_CARD', dueDay: 18, recurringAmount: 150, minimumAmount: 65, currentAmount: 2140.55, autopay: true, accountId: ids[0], status: 'ACTIVE', notes: 'SAMPLE DATA', createdAt: now, updatedAt: now });
await db.collection('bills').add({ clientId: clientUid, name: 'Rent', category: 'RENT_MORTGAGE', dueDay: 1, recurringAmount: 1850, minimumAmount: null, currentAmount: null, autopay: false, accountId: null, status: 'ACTIVE', notes: 'SAMPLE DATA', createdAt: now, updatedAt: now });
await db.collection('bills').add({ clientId: clientUid, name: 'Rogers mobile', category: 'PHONE_INTERNET', dueDay: 27, recurringAmount: 85, minimumAmount: null, currentAmount: 85, autopay: true, accountId: ids[1], status: 'ACTIVE', notes: 'SAMPLE DATA', createdAt: now, updatedAt: now });

await db.collection('actionPlans').add({ clientId: clientUid, title: 'Mortgage-ready in 12 months (sample)', goal: 'Bring utilization under 30% and clear the collection item with written terms.', archived: false, steps: [
  { id: 'step-1', title: 'Pull the latest Scotiabank LOC statement', detail: 'Needed to check the past-due amount.', dueDate: null, status: 'DONE', linkedType: 'ACCOUNT', linkedId: ids[3], completedAt: new Date().toISOString() },
  { id: 'step-2', title: 'Request written terms from CBV Collection Services', detail: null, dueDate: null, status: 'TODO', linkedType: 'ACCOUNT', linkedId: ids[2], completedAt: null },
  { id: 'step-3', title: 'Set up autopay for rent', detail: null, dueDate: null, status: 'TODO', linkedType: null, linkedId: null, completedAt: null },
], createdAt: now, updatedAt: now });

await db.collection('activityLogs').add({ clientId: clientUid, actorId: 'seed', actorRole: 'admin', action: 'REPORT_PARSED', entityType: 'creditReport', entityId: eqReport.id, metadata: { note: 'SAMPLE DATA seeded' }, createdAt: now });

console.log('Seeded demo data.');
console.log('  admin:   admin@demo.valeur.local   / demo-password-1');
console.log('  advisor: advisor@demo.valeur.local / demo-password-1');
console.log('  client:  client@demo.valeur.local  / demo-password-1');
process.exit(0);
