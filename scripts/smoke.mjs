// End-to-end smoke test against the LOCAL EMULATORS using the web SDK, so it
// exercises Firestore/Storage rules and every callable the same way the UI
// does. Run after `npm run seed`.

import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, query, where, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectStorageEmulator, getStorage, ref, uploadBytes } from 'firebase/storage';
import { readFileSync } from 'node:fs';

const app = initializeApp({ apiKey: 'demo', authDomain: 'localhost', projectId: 'valeur-credit', storageBucket: 'valeur-credit.appspot.com', appId: 'demo' });
const auth = getAuth(app);
const db = getFirestore(app);
const fns = getFunctions(app, 'northamerica-northeast1');
const storage = getStorage(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectFunctionsEmulator(fns, '127.0.0.1', 5001);
connectStorageEmulator(storage, '127.0.0.1', 9199);

let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const call = async (name, data) => {
  const res = (await httpsCallable(fns, name)(data)).data;
  return res;
};

// ---- sign in as client ----
const cred = await signInWithEmailAndPassword(auth, 'client@demo.valeur.local', 'demo-password-1');
const uid = cred.user.uid;
const token = await cred.user.getIdTokenResult();
ok('client signed in with role claim', token.claims.role === 'client');

// ---- rules: can read own, cannot read others ----
const own = await getDocs(query(collection(db, 'accounts'), where('clientId', '==', uid)));
ok('client can read own accounts', own.size >= 8, `${own.size} accounts`);
let denied = false;
try {
  await getDocs(collection(db, 'accounts')); // unscoped query must be denied
} catch (e) {
  denied = /permission/i.test(String(e.code ?? e.message));
}
ok('unscoped account query is denied by rules', denied);
try {
  await setDoc(doc(db, 'activityLogs', 'hack'), { clientId: uid, action: 'X' });
  ok('client cannot write activityLogs', false);
} catch (e) {
  ok('client cannot write activityLogs', /permission/i.test(String(e.code)));
}
try {
  await setDoc(doc(db, 'accounts', 'hack'), { clientId: uid, source: 'MANUAL', creditorName: 'X', fullAccountNumber: '4111111111111111', accountType: 'OTHER', status: 'OPEN', reviewState: 'REVIEWED', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  ok('rules reject fullAccountNumber field', false);
} catch (e) {
  ok('rules reject fullAccountNumber field', /permission/i.test(String(e.code)));
}

// ---- issue workflow ----
const issues = await getDocs(query(collection(db, 'creditIssues'), where('clientId', '==', uid), where('status', '==', 'OPEN')));
const eqIssues = issues.docs.filter((d) => d.get('bureau') === 'EQUIFAX');
ok('seeded open issues present', eqIssues.length >= 2, `${eqIssues.length} Equifax open`);
const i1 = eqIssues[0].id;
const i2 = eqIssues[1].id;
let r = await call('updateIssueStatus', { issueId: i1, status: 'CONFIRMED', note: 'Statement shows different amount' });
ok('confirm issue via callable', r.error === null && r.data?.status === 'CONFIRMED', r.error?.message);
r = await call('updateIssueStatus', { issueId: i1, status: 'DISPUTED' });
ok('cannot set DISPUTED directly', r.error?.code === 'failed-precondition');
r = await call('updateIssueStatus', { issueId: i2, status: 'CONFIRMED' });
ok('confirm second issue', r.error === null);

// ---- dispute workflow ----
r = await call('createDispute', { bureau: 'TRANSUNION', items: [{ issueId: i1, requestedAction: 'CORRECT' }] });
ok('mixed-bureau dispute rejected', r.error?.code === 'failed-precondition', r.error?.message);
r = await call('createDispute', { bureau: 'EQUIFAX', items: [{ issueId: i1, requestedAction: 'CORRECT' }, { issueId: i2, requestedAction: 'INVESTIGATE' }] });
ok('create Equifax dispute', r.error === null && r.data?.status === 'DRAFT', r.error?.message);
const disputeId = r.data?.disputeId;
const letterId = r.data?.letterId;
const letter = await getDoc(doc(db, 'letters', letterId));
ok('letter generated with destination section', letter.exists() && /Where to send this letter/.test(letter.get('body')));
ok('letter contains no outcome promise', !/guarantee|score increase/i.test(letter.get('body')));
r = await call('updateDisputeStatus', { disputeId, status: 'READY' });
ok('DRAFT→READY blocked without approval', r.error?.code === 'failed-precondition');
r = await call('approveDispute', { disputeId, reviewed: true, statement: 'I agree' });
ok('approval with wrong statement rejected', r.error?.code === 'invalid-argument');
r = await call('approveDispute', { disputeId, reviewed: true, statement: 'I reviewed the account information, the statements are accurate to the best of my knowledge, and I authorize this letter to be prepared for my submission.' });
ok('approve dispute', r.error === null && r.data?.status === 'READY', r.error?.message);
const afterIssue = await getDoc(doc(db, 'creditIssues', i1));
ok('issue moved to DISPUTED on approval', afterIssue.get('status') === 'DISPUTED');
r = await call('updateDisputeStatus', { disputeId, status: 'SENT', deliveryMethod: 'ONLINE', trackingNumber: 'ABC123' });
ok('mark sent sets responseDueAt', r.error === null && !!r.data?.responseDueAt, r.error?.message);
r = await call('updateDisputeStatus', { disputeId, status: 'RESPONSE_RECEIVED', responseSummary: 'Bureau corrected the balance.' });
ok('record response', r.error === null);

// ---- settlement ----
r = await call('upsertSettlement', { data: { creditorName: 'CBV Collection Services', status: 'NOT_STARTED', amountOwed: 640, targetAmount: 900 } });
ok('target > owed rejected', r.error?.code === 'invalid-argument', r.error?.message);
r = await call('upsertSettlement', { data: { creditorName: 'CBV Collection Services', status: 'NOT_STARTED', amountOwed: 640, targetAmount: 400 } });
ok('create settlement', r.error === null, r.error?.message);
const settlementId = r.data?.settlementId;
r = await call('upsertSettlement', { settlementId, data: { status: 'ACCEPTED', acceptedTerms: 'x', acceptedDueDate: '2026-10-01', writtenConfirmationReceived: false } });
ok('NOT_STARTED→ACCEPTED blocked', ['failed-precondition','invalid-argument'].includes(r.error?.code));
r = await call('upsertSettlement', { settlementId, data: { status: 'CONTACTED', contactLog: [{ date: '2026-09-12', method: 'PHONE', notes: 'Asked for written terms' }] } });
ok('move to CONTACTED', r.error === null, r.error?.message);
r = await call('generateLetter', { type: 'SETTLEMENT_REQUEST', settlementId, recipientName: 'CBV Collection Services', recipientAddress: '1 Sample Rd, Toronto ON' });
ok('settlement letter generated', r.error === null, r.error?.message);
const sLetter = await getDoc(doc(db, 'letters', r.data.letterId));
ok('settlement letter asks for written terms, no admission', /written confirmation/i.test(sLetter.get('body')) && /not an admission of liability/i.test(sLetter.get('body')));

// ---- account correction ----
const acct = own.docs[0];
r = await call('updateAccount', { accountId: acct.id, changes: { balance: 1234.56, isUnfamiliar: true } });
ok('account correction audited', r.error === null && r.data?.changed.includes('balance'), r.error?.message);
r = await call('updateAccount', { accountId: acct.id, changes: { maskedAccountNumber: '4111111111111111' } });
ok('full account number rejected on correction', r.error?.code === 'invalid-argument');
const logs = await getDocs(query(collection(db, 'activityLogs'), where('clientId', '==', uid)));
ok('activity log has entries', logs.size >= 10, `${logs.size} entries`);
ok('UNKNOWN_ACCOUNT issue created after marking unfamiliar', (await getDocs(query(collection(db, 'creditIssues'), where('clientId', '==', uid), where('accountId', '==', acct.id), where('ruleCode', '==', 'UNKNOWN_ACCOUNT')))).size === 1);

// ---- report upload → parse ----
const pdfPath = process.argv[2];
if (pdfPath) {
  const bytes = readFileSync(pdfPath);
  const reportRef = doc(collection(db, 'creditReports'));
  const storagePath = `credit-reports/${uid}/${reportRef.id}.pdf`;
  await setDoc(reportRef, { clientId: uid, bureau: 'EQUIFAX', fileName: 'smoke.pdf', storagePath, fileSize: bytes.length, status: 'UPLOADED', score: null, parserConfidence: null, pageCount: null, accountCount: null, issueCount: null, errorMessage: null, reviewNotes: [], parsedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await uploadBytes(ref(storage, storagePath), bytes, { contentType: 'application/pdf' });
  const final = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 60000);
    onSnapshot(reportRef, (s) => {
      const st = s.get('status');
      if (['PARSED', 'REVIEW_REQUIRED', 'OCR_REQUIRED', 'FAILED'].includes(st)) {
        clearTimeout(t);
        resolve(s.data());
      }
    });
  });
  ok('report parsed by storage trigger', !!final, final ? `status=${final.status} score=${final.score} accounts=${final.accountCount} issues=${final.issueCount} conf=${final.parserConfidence}` : 'timed out');
  if (final) {
    const pages = await getDocs(collection(db, 'creditReports', reportRef.id, 'pages'));
    ok('page text stored in subcollection', pages.size === final.pageCount, `${pages.size} pages`);
  }
  // Non-PDF must be rejected by rules
  try {
    await uploadBytes(ref(storage, `credit-reports/${uid}/x.txt`), new TextEncoder().encode('hi'), { contentType: 'text/plain' });
    ok('non-PDF upload rejected by storage rules', false);
  } catch (e) {
    ok('non-PDF upload rejected by storage rules', /unauthorized|permission/i.test(String(e.code ?? e)));
  }
}

// ---- export ----
r = await call('requestDataExport', {});
ok('data export completes', r.error === null && r.data?.status === 'COMPLETED', r.error?.message);
r = await call('getSignedDownloadUrl', { path: r.data.exportPath });
ok('signed url issued', r.error === null && /^http/.test(r.data?.url ?? ''));

// ---- advisor access ----
const adv = await signInWithEmailAndPassword(auth, 'advisor@demo.valeur.local', 'demo-password-1');
const advAccounts = await getDocs(query(collection(db, 'accounts'), where('clientId', '==', uid)));
ok('assigned advisor can read client accounts', advAccounts.size > 0);
r = await call('approveDispute', { disputeId, reviewed: true, statement: 'I reviewed the account information, the statements are accurate to the best of my knowledge, and I authorize this letter to be prepared for my submission.' });
ok('advisor cannot approve a dispute', r.error?.code === 'permission-denied' || r.error?.code === 'failed-precondition', r.error?.message);
void adv;

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures ? 1 : 0);
