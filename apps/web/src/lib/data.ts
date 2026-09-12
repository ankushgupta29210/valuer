// Realtime data hooks + client-side writes for collections the rules allow
// clients to write directly (profiles, bills, manual accounts, action plans,
// client-raised issues). Everything audited goes through callables.
//
// In demo mode (VITE_DEMO_MODE=true) the same hooks read from the in-browser
// store instead of Firestore, so pages do not change.

import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, uploadBytesResumable } from 'firebase/storage';
import type { Bureau, Bill, Account, ActionPlan, Profile, Settings, AgencyContact } from '@valeur/shared';
import { DEFAULT_SETTINGS } from '@valeur/shared';
import { db, storage } from './firebase';
import { where, orderBy, toFirestore, type Constraint } from './query';
import { isDemo, demoStore, nowIso } from './demo/store';
import { demoParseReport } from './demo/api';

export interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
}

export function useCollection<T>(path: string, constraints: Constraint[], deps: unknown[] = [], enabled = true): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: [], loading: enabled, error: null });
  useEffect(() => {
    if (!enabled) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    if (isDemo) {
      const read = () => setState({ data: demoStore.list<T>(path, constraints), loading: false, error: null });
      read();
      return demoStore.subscribe(read);
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const q = query(collection(db, path), ...toFirestore(constraints));
    const unsub = onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }) as T), loading: false, error: null }),
      (err) => setState({ data: [], loading: false, error: friendlyFirestoreError(err) }),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, ...deps]);
  return state;
}

export function useDoc<T>(path: string | null): { data: T | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: !!path, error: null });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    if (isDemo) {
      const read = () => setState({ data: demoStore.get<T>(path), loading: false, error: null });
      read();
      return demoStore.subscribe(read);
    }
    setState((s) => ({ ...s, loading: true }));
    const unsub = onSnapshot(
      doc(db, path),
      (snap) => setState({ data: snap.exists() ? ({ id: snap.id, ...(snap.data() as DocumentData) } as T) : null, loading: false, error: null }),
      (err) => setState({ data: null, loading: false, error: friendlyFirestoreError(err) }),
    );
    return unsub;
  }, [path]);
  return state;
}

/** Client-owned collection scoped to one client, newest first. */
export function useClientCollection<T>(path: string, clientId: string | null | undefined, extra: Constraint[] = [], order: 'createdAt' | 'none' = 'createdAt') {
  const constraints = clientId ? [where('clientId', '==', clientId), ...extra, ...(order === 'createdAt' ? [orderBy('createdAt', 'desc')] : [])] : [];
  return useCollection<T>(path, constraints, [clientId, JSON.stringify(extra)], !!clientId);
}

export function useSettings(): Settings {
  const { data } = useDoc<Settings>('settings/global');
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
}

export function useAgencyContacts() {
  return useCollection<AgencyContact>('agencyContacts', [orderBy('name')]);
}

export function friendlyFirestoreError(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  if (code.includes('permission-denied')) return 'You do not have access to this information.';
  if (code.includes('unavailable')) return 'We could not reach the server. Check your connection and try again.';
  if (code.includes('failed-precondition')) return 'This view needs a database index that is still building. Try again in a minute.';
  return 'Something went wrong loading this information.';
}

// ---------- generic writes (demo-aware) ----------

async function createDoc(coll: string, data: Record<string, unknown>): Promise<string> {
  if (isDemo) return demoStore.add(coll, data);
  const ref = await addDoc(collection(db, coll), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}
async function patchDoc(coll: string, id: string, data: Record<string, unknown>): Promise<void> {
  if (isDemo) return demoStore.update(coll, id, data);
  await updateDoc(doc(db, coll, id), { ...data, updatedAt: serverTimestamp() });
}
async function removeDoc(coll: string, id: string): Promise<void> {
  if (isDemo) return demoStore.delete(coll, id);
  await deleteDoc(doc(db, coll, id));
}
async function putDoc(coll: string, id: string, data: Record<string, unknown>, create: boolean): Promise<void> {
  if (isDemo) {
    const existing = demoStore.get(`${coll}/${id}`);
    demoStore.set(coll, id, { ...(existing ?? { createdAt: nowIso() }), ...data, updatedAt: nowIso() });
    return;
  }
  await setDoc(doc(db, coll, id), { ...data, updatedAt: serverTimestamp(), ...(create ? { createdAt: serverTimestamp() } : {}) }, { merge: true });
}

// ---------- domain writes allowed directly by rules ----------

export async function saveProfile(uid: string, email: string, data: Partial<Profile>, create: boolean) {
  if (create) await putDoc('profiles', uid, { ...data, email }, true);
  else await patchDoc('profiles', uid, data);
}

export async function addBill(clientId: string, bill: Omit<Bill, 'id' | 'clientId'>) {
  await createDoc('bills', { ...bill, clientId });
}
export const updateBill = (id: string, bill: Partial<Bill>) => patchDoc('bills', id, bill);
export const deleteBill = (id: string) => removeDoc('bills', id);

export async function addManualAccount(clientId: string, account: Record<string, unknown>) {
  await createDoc('accounts', { ...account, clientId, source: 'MANUAL', reportId: null, sourcePage: null, sourceText: null, fieldConfidence: {}, reviewState: 'REVIEWED' });
}
export const updateManualAccount = (id: string, account: Partial<Account>) => patchDoc('accounts', id, account);
export const deleteManualAccount = (id: string) => removeDoc('accounts', id);

export async function addClientIssue(clientId: string, input: { accountId: string | null; summary: string; evidenceNeeded: string; severity: string; bureau?: Bureau | null }) {
  await createDoc('creditIssues', {
    clientId, reportId: null, accountId: input.accountId, bureau: input.bureau ?? null, origin: 'CLIENT', ruleCode: null, type: 'CLIENT_CONCERN',
    severity: input.severity, status: 'OPEN', summary: input.summary, whyItMatters: null, evidenceNeeded: input.evidenceNeeded, evidenceNotes: null,
    sourcePage: null, sourceText: null, confirmedAt: null, confirmedBy: null, resolvedAt: null, disputeId: null,
  });
}
export const updateIssueNotes = (id: string, evidenceNotes: string) => patchDoc('creditIssues', id, { evidenceNotes });

export async function savePlan(clientId: string, plan: Omit<ActionPlan, 'id' | 'clientId'>, id?: string) {
  if (id) await patchDoc('actionPlans', id, plan);
  else await createDoc('actionPlans', { ...plan, clientId });
}
export const deletePlan = (id: string) => removeDoc('actionPlans', id);

export async function addAdvisorNote(clientId: string, authorId: string, authorName: string, note: string, visibility: 'INTERNAL' | 'CLIENT_VISIBLE') {
  await createDoc('advisorNotes', { clientId, authorId, authorName, note, visibility });
}

// ---------- admin writes ----------
export const saveAgencyContact = (id: string, data: Record<string, unknown>, create: boolean) => putDoc('agencyContacts', id, data, create);
export const deleteAgencyContact = (id: string) => removeDoc('agencyContacts', id);
export const saveSettings = (data: Record<string, unknown>) => putDoc('settings', 'global', data, false);

// ---------- files ----------

/**
 * Upload a credit report: create the Firestore row first (status UPLOADED),
 * then upload the PDF to the private path. The Storage trigger picks it up.
 * In demo mode the parse is simulated in the browser.
 */
export function uploadCreditReport(clientId: string, bureau: Bureau, file: File, onProgress: (pct: number) => void): { promise: Promise<string>; cancel: () => void } {
  let cancel = () => {};
  const promise = (async () => {
    const base = {
      clientId, bureau, fileName: file.name, fileSize: file.size, status: 'UPLOADED', score: null, parserConfidence: null, pageCount: null,
      accountCount: null, issueCount: null, errorMessage: null, reviewNotes: [], parsedAt: null,
    };
    if (isDemo) {
      for (let p = 0; p <= 100; p += 20) {
        onProgress(p);
        await new Promise((r) => setTimeout(r, 120));
      }
      const id = demoStore.add('creditReports', { ...base, storagePath: `credit-reports/${clientId}/demo.pdf` });
      demoStore.add('activityLogs', { clientId, actorId: clientId, actorRole: 'client', action: 'REPORT_UPLOADED', entityType: 'creditReport', entityId: id, metadata: { demo: true } });
      void demoParseReport(id);
      return id;
    }
    const reportRef = doc(collection(db, 'creditReports'));
    const storagePath = `credit-reports/${clientId}/${reportRef.id}.pdf`;
    await setDoc(reportRef, { ...base, storagePath, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    const task = uploadBytesResumable(storageRef(storage, storagePath), file, { contentType: 'application/pdf' });
    cancel = () => task.cancel();
    await new Promise<void>((resolve, reject) => {
      task.on(
        'state_changed',
        (s) => onProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
        async (err) => {
          await deleteDoc(reportRef).catch(() => {});
          reject(err);
        },
        () => resolve(),
      );
    });
    return reportRef.id;
  })();
  return { promise, cancel: () => cancel() };
}

export const deleteReport = (id: string) => removeDoc('creditReports', id);

export async function uploadDisputeResponse(clientId: string, disputeId: string, file: File): Promise<string> {
  const path = `dispute-responses/${clientId}/${disputeId}/${Date.now()}-${file.name}`;
  if (isDemo) return path;
  await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
  return path;
}
