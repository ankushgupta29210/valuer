// Signed download URLs and data export / deletion requests (spec §11).

import { z } from 'zod';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { db, storage, auth, FieldValue, nowIso } from './lib/admin.js';
import { callable, AppError } from './lib/callable.js';
import { assertClientAccess, assertOwner } from './lib/access.js';
import { logActivity } from './lib/audit.js';
import { getSettings } from './lib/settings.js';

const REGION = 'northamerica-northeast1';
const CLIENT_COLLECTIONS = [
  'creditReports', 'accounts', 'bills', 'creditIssues', 'disputes', 'disputeItems',
  'settlements', 'letters', 'advisorNotes', 'aiMessages', 'actionPlans', 'dataRequests',
];

function clientIdFromPath(path: string): string | null {
  const m = path.match(/^(?:credit-reports|dispute-responses|settlement-confirmations|exports)\/([^/]+)\//);
  return m ? m[1] : null;
}

export const getSignedDownloadUrl = callable(z.object({ path: z.string().min(1) }), async ({ input, actor, requestId }) => {
  const clientId = clientIdFromPath(input.path);
  if (!clientId) throw new AppError('invalid-argument', 'That file path is not recognized.');
  await assertClientAccess(actor, clientId);
  const file = storage.bucket().file(input.path);
  const [exists] = await file.exists();
  if (!exists) throw new AppError('not-found', 'That file could not be found.');

  // The emulator does not support signed URLs; fall back to a token-less
  // emulator URL there. In production the URL expires in 10 minutes.
  let url: string;
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199';
    url = `http://${host}/v0/b/${storage.bucket().name}/o/${encodeURIComponent(input.path)}?alt=media`;
  } else {
    [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 10 * 60 * 1000, version: 'v4' });
  }
  await logActivity({ clientId, actorId: actor.uid, actorRole: actor.role, action: 'FILE_DOWNLOAD_URL_ISSUED', entityType: 'file', entityId: input.path, requestId });
  return { url, expiresInSeconds: 600 };
});

export const requestDataExport = callable(z.object({}), async ({ actor, requestId }) => {
  const clientId = actor.uid;
  const existing = await db.collection('dataRequests').where('clientId', '==', clientId).where('type', '==', 'EXPORT').where('status', 'in', ['PENDING', 'PROCESSING']).limit(1).get();
  if (!existing.empty) return { requestId: existing.docs[0].id, status: existing.docs[0].get('status') as string };

  const ref = db.collection('dataRequests').doc();
  await ref.set({ clientId, type: 'EXPORT', status: 'PROCESSING', requestedAt: nowIso(), scheduledFor: null, completedAt: null, exportPath: null, reason: null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await logActivity({ clientId, actorId: actor.uid, actorRole: actor.role, action: 'EXPORT_REQUESTED', entityType: 'dataRequest', entityId: ref.id, requestId });

  // Build the export synchronously — the data volume per client is small.
  const bundle: Record<string, unknown> = { exportedAt: nowIso(), profile: (await db.doc(`profiles/${clientId}`).get()).data() ?? null };
  for (const c of CLIENT_COLLECTIONS) {
    const snap = await db.collection(c).where('clientId', '==', clientId).get();
    bundle[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  const logs = await db.collection('activityLogs').where('clientId', '==', clientId).get();
  bundle.activityLogs = logs.docs.map((d) => ({ id: d.id, ...d.data() }));
  const path = `exports/${clientId}/valeur-export-${Date.now()}.json`;
  await storage.bucket().file(path).save(JSON.stringify(bundle, null, 2), { contentType: 'application/json' });
  await ref.update({ status: 'COMPLETED', completedAt: nowIso(), exportPath: path, updatedAt: FieldValue.serverTimestamp() });
  return { requestId: ref.id, status: 'COMPLETED', exportPath: path };
});

export const requestAccountDeletion = callable(z.object({ reason: z.string().max(1000).optional(), confirm: z.literal(true) }), async ({ input, actor, requestId }) => {
  const clientId = actor.uid;
  assertOwner(actor, clientId);
  const settings = await getSettings();
  const scheduledFor = new Date(Date.now() + settings.retentionDays * 86_400_000).toISOString();
  const ref = db.collection('dataRequests').doc();
  await ref.set({ clientId, type: 'DELETE', status: 'PENDING', requestedAt: nowIso(), scheduledFor, completedAt: null, exportPath: null, reason: input.reason ?? null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await logActivity({ clientId, actorId: actor.uid, actorRole: actor.role, action: 'DELETION_REQUESTED', entityType: 'dataRequest', entityId: ref.id, metadata: { scheduledFor, retentionDays: settings.retentionDays }, requestId });
  return { requestId: ref.id, status: 'PENDING', scheduledFor };
});

export const cancelDeletionRequest = callable(z.object({ requestId: z.string().min(1) }), async ({ input, actor }) => {
  const snap = await db.doc(`dataRequests/${input.requestId}`).get();
  if (!snap.exists || snap.get('clientId') !== actor.uid) throw new AppError('not-found', 'That request could not be found.');
  if (snap.get('status') !== 'PENDING') throw new AppError('failed-precondition', 'This request can no longer be cancelled.');
  await snap.ref.update({ status: 'CANCELLED', updatedAt: FieldValue.serverTimestamp() });
  return { requestId: snap.id, status: 'CANCELLED' };
});

async function deleteClientData(clientId: string): Promise<void> {
  for (const prefix of ['credit-reports', 'dispute-responses', 'settlement-confirmations', 'exports']) {
    await storage.bucket().deleteFiles({ prefix: `${prefix}/${clientId}/`, force: true }).catch((e) => logger.warn('deleteFiles', { prefix, e }));
  }
  for (const c of CLIENT_COLLECTIONS) {
    const snap = await db.collection(c).where('clientId', '==', clientId).get();
    for (const d of snap.docs) {
      if (c === 'creditReports') {
        const pages = await d.ref.collection('pages').get();
        for (const p of pages.docs) await p.ref.delete();
      }
      await d.ref.delete();
    }
  }
  const assignments = await db.collection('staffAssignments').where('clientId', '==', clientId).get();
  for (const d of assignments.docs) await d.ref.delete();
  await db.doc(`profiles/${clientId}`).delete();
  await db.doc(`users/${clientId}`).delete();
  await auth.deleteUser(clientId).catch((e) => logger.warn('auth.deleteUser', { clientId, e }));
  // Activity logs are retained (immutable audit) but the identity is gone.
  await logActivity({ clientId, actorId: 'system', actorRole: 'admin', action: 'DELETION_COMPLETED', entityType: 'user', entityId: clientId });
}

export const processDeletionRequests = onSchedule({ region: REGION, schedule: 'every 24 hours' }, async () => {
  const due = await db.collection('dataRequests').where('type', '==', 'DELETE').where('status', '==', 'PENDING').get();
  const now = Date.now();
  for (const d of due.docs) {
    const scheduledFor = Date.parse(d.get('scheduledFor') ?? '');
    if (!Number.isFinite(scheduledFor) || scheduledFor > now) continue;
    await d.ref.update({ status: 'PROCESSING', updatedAt: FieldValue.serverTimestamp() });
    try {
      await deleteClientData(d.get('clientId'));
    } catch (e) {
      logger.error('deletion failed', { requestId: d.id, e });
      await d.ref.update({ status: 'PENDING', updatedAt: FieldValue.serverTimestamp() });
    }
  }
});

// Admin-only immediate deletion (for support cases and local testing).
export const deleteClientNow = callable(z.object({ clientId: z.string().min(1), confirm: z.literal(true) }), async ({ input, actor }) => {
  if (actor.role !== 'admin') throw new AppError('permission-denied', 'Administrator access is required.');
  await deleteClientData(input.clientId);
  return { clientId: input.clientId, deleted: true };
});
