// Typed wrappers around Cloud Functions. Every function returns the
// { data, error, requestId } envelope; callFn unwraps it and throws a
// CallableError with the plain-English message and any field details.

import { httpsCallable } from 'firebase/functions';
import type {
  CallableResponse,
  DisputeStatus,
  IssueStatus,
  ReportStatus,
  RequestedAction,
  Bureau,
  Role,
  DeliveryMethod,
  SettlementStatus,
  AiProvider,
} from '@valeur/shared';
import { functions } from './firebase';
import { CallableError } from './errors';
import { demoApi } from './demo/api';

export { CallableError };

async function callFn<I, O>(name: string, input: I): Promise<O> {
  const fn = httpsCallable<I, CallableResponse<O>>(functions, name);
  let res: CallableResponse<O>;
  try {
    res = (await fn(input)).data;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    throw new CallableError(e.code ?? 'internal', e.message ?? 'Something went wrong. Please try again.');
  }
  if (res.error) throw new CallableError(res.error.code, res.error.message, res.error.details, res.requestId);
  return res.data as O;
}

const firebaseApi = {
  reparseReport: (reportId: string) => callFn<{ reportId: string }, { reportId: string; status: ReportStatus }>('reparseReport', { reportId }),
  updateAccount: (accountId: string, changes: Record<string, unknown>) =>
    callFn<{ accountId: string; changes: Record<string, unknown> }, { accountId: string; changed: string[] }>('updateAccount', { accountId, changes }),
  markAccountReviewed: (accountId: string) => callFn<{ accountId: string }, { accountId: string; reviewState: string }>('markAccountReviewed', { accountId }),
  updateIssueStatus: (issueId: string, status: IssueStatus, note?: string) =>
    callFn<{ issueId: string; status: IssueStatus; note?: string }, { issueId: string; status: IssueStatus }>('updateIssueStatus', { issueId, status, note }),
  createDispute: (bureau: Bureau, items: { issueId: string; requestedAction: RequestedAction }[], clientId?: string) =>
    callFn<{ bureau: Bureau; items: typeof items; clientId?: string }, { disputeId: string; letterId: string; status: 'DRAFT' }>('createDispute', { bureau, items, clientId }),
  approveDispute: (disputeId: string, statement: string) =>
    callFn<{ disputeId: string; reviewed: true; statement: string }, { disputeId: string; status: 'READY'; clientApprovedAt: string }>('approveDispute', { disputeId, reviewed: true, statement }),
  updateDisputeStatus: (input: { disputeId: string; status: DisputeStatus; deliveryMethod?: DeliveryMethod; trackingNumber?: string; responseSummary?: string; responseFilePath?: string; note?: string }) =>
    callFn<typeof input, { disputeId: string; status: DisputeStatus; responseDueAt: string | null }>('updateDisputeStatus', input),
  generateLetter: (input: { type: 'DISPUTE'; disputeId: string } | { type: 'SETTLEMENT_REQUEST'; settlementId: string; recipientName: string; recipientAddress: string }) =>
    callFn<typeof input, { letterId: string }>('generateLetter', input),
  approveLetter: (letterId: string) => callFn<{ letterId: string; reviewed: true }, { letterId: string; status: 'READY'; approvedAt: string }>('approveLetter', { letterId, reviewed: true }),
  markLetterSent: (letterId: string, deliveryMethod: DeliveryMethod, trackingNumber?: string) =>
    callFn<{ letterId: string; deliveryMethod: DeliveryMethod; trackingNumber?: string }, { letterId: string; status: 'SENT'; sentAt: string }>('markLetterSent', { letterId, deliveryMethod, trackingNumber }),
  upsertSettlement: (data: Record<string, unknown>, settlementId?: string, clientId?: string) =>
    callFn<{ settlementId?: string; clientId?: string; data: Record<string, unknown> }, { settlementId: string; status: SettlementStatus }>('upsertSettlement', { settlementId, clientId, data }),
  getSignedDownloadUrl: (path: string) => callFn<{ path: string }, { url: string; expiresInSeconds: number }>('getSignedDownloadUrl', { path }),
  requestDataExport: () => callFn<Record<string, never>, { requestId: string; status: string; exportPath?: string }>('requestDataExport', {}),
  requestAccountDeletion: (reason?: string) => callFn<{ reason?: string; confirm: true }, { requestId: string; status: string; scheduledFor: string }>('requestAccountDeletion', { reason, confirm: true }),
  cancelDeletionRequest: (requestId: string) => callFn<{ requestId: string }, { requestId: string; status: string }>('cancelDeletionRequest', { requestId }),
  aiCoach: (message: string, useMyData: boolean) =>
    callFn<{ message: string; useMyData: boolean }, { response: string; provider: AiProvider | null; model: string | null; usedClientData: boolean; safetyFlags: string[]; messageId?: string }>('aiCoach', { message, useMyData }),
  setUserRole: (uid: string, role: Role) => callFn<{ uid: string; role: Role }, { uid: string; role: Role }>('setUserRole', { uid, role }),
  assignStaff: (clientId: string, staffUid: string, active: boolean) =>
    callFn<{ clientId: string; staffUid: string; active: boolean }, { id: string; status: string }>('assignStaff', { clientId, staffUid, active }),
  listUsers: () => callFn<{ limit?: number }, { id: string; email: string; fullName: string | null; role: Role; disabled: boolean }[]>('listUsers', {}),
};

export type Api = typeof firebaseApi;
// Demo mode swaps in an in-browser implementation with the same contract.
export const api: Api = import.meta.env.VITE_DEMO_MODE === 'true' ? demoApi : firebaseApi;
