// Valeur Credit — Cloud Functions entry point.
// Every callable returns { data, error, requestId } (spec §10.1).

export { onUserCreated, bootstrapAdmin, setUserRole, assignStaff, listUsers } from './users.js';
export { parseCreditReport, reparseReport } from './reports/parse.js';
export { updateAccount, markAccountReviewed, updateIssueStatus } from './accounts.js';
export { createDispute, approveDispute, updateDisputeStatus } from './disputes.js';
export { generateLetter, approveLetter, markLetterSent } from './letters.js';
export { upsertSettlement } from './settlements.js';
export { getSignedDownloadUrl, requestDataExport, requestAccountDeletion, cancelDeletionRequest, processDeletionRequests, deleteClientNow } from './files.js';
export { aiCoach } from './ai/coach.js';
