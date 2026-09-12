import { onRequest } from 'firebase-functions/v2/https';
import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { z } from 'zod';
import { ROLES } from '@valeur/shared';
import { auth, db, FieldValue, nowIso } from './lib/admin.js';
import { callable, AppError } from './lib/callable.js';
import { assertAdmin } from './lib/access.js';
import { logActivity } from './lib/audit.js';

// New users default to the client role. The profile document is created by
// the client after sign-up (rules allow owner create) so that consent and
// name are captured in the same step; this hook just sets the claim and the
// users directory entry admins use.
export const onUserCreated = beforeUserCreated({ region: 'northamerica-northeast1' }, async (event) => {
  const user = event.data;
  if (!user) return;
  await db.doc(`users/${user.uid}`).set(
    {
      email: user.email ?? null,
      fullName: user.displayName ?? null,
      role: 'client',
      disabled: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { customClaims: { role: 'client' } };
});

// Bootstrap helper for local development and first deploy only. Promotes the
// caller-supplied uid to admin when no admin exists yet. Guarded by
// BOOTSTRAP_TOKEN env var; remove or rotate after first use.
export const bootstrapAdmin = onRequest({ region: 'northamerica-northeast1' }, async (req, res) => {
  const token = process.env.BOOTSTRAP_TOKEN;
  if (!token || req.get('x-bootstrap-token') !== token) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const uid = String(req.query.uid ?? req.body?.uid ?? '');
  if (!uid) {
    res.status(400).json({ error: 'uid required' });
    return;
  }
  const admins = await db.collection('users').where('role', '==', 'admin').limit(1).get();
  if (!admins.empty && process.env.FUNCTIONS_EMULATOR !== 'true') {
    res.status(409).json({ error: 'an admin already exists' });
    return;
  }
  await auth.setCustomUserClaims(uid, { role: 'admin' });
  await db.doc(`users/${uid}`).set({ role: 'admin', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  res.json({ ok: true, uid });
});

export const setUserRole = callable(
  z.object({ uid: z.string().min(1), role: z.enum(ROLES) }),
  async ({ input, actor, requestId }) => {
    assertAdmin(actor);
    if (input.uid === actor.uid && input.role !== 'admin') {
      throw new AppError('failed-precondition', 'You cannot remove your own administrator role.');
    }
    const user = await auth.getUser(input.uid).catch(() => null);
    if (!user) throw new AppError('not-found', 'That user could not be found.');
    await auth.setCustomUserClaims(input.uid, { ...(user.customClaims ?? {}), role: input.role });
    await db.doc(`users/${input.uid}`).set(
      { email: user.email ?? null, role: input.role, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await logActivity({
      clientId: input.uid,
      actorId: actor.uid,
      actorRole: actor.role,
      action: 'ROLE_CHANGED',
      entityType: 'user',
      entityId: input.uid,
      metadata: { role: input.role },
      requestId,
    });
    return { uid: input.uid, role: input.role };
  },
);

export const assignStaff = callable(
  z.object({ clientId: z.string().min(1), staffUid: z.string().min(1), active: z.boolean() }),
  async ({ input, actor, requestId }) => {
    assertAdmin(actor);
    const staff = await db.doc(`users/${input.staffUid}`).get();
    const staffRole = staff.get('role');
    if (staffRole !== 'advisor' && staffRole !== 'admin') {
      throw new AppError('failed-precondition', 'Only advisors or administrators can be assigned to a client.');
    }
    const id = `${input.clientId}_${input.staffUid}`;
    await db.doc(`staffAssignments/${id}`).set(
      {
        clientId: input.clientId,
        staffUid: input.staffUid,
        status: input.active ? 'ACTIVE' : 'INACTIVE',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await logActivity({
      clientId: input.clientId,
      actorId: actor.uid,
      actorRole: actor.role,
      action: input.active ? 'STAFF_ASSIGNED' : 'STAFF_UNASSIGNED',
      entityType: 'staffAssignment',
      entityId: id,
      metadata: { staffUid: input.staffUid },
      requestId,
    });
    return { id, status: input.active ? 'ACTIVE' : 'INACTIVE', at: nowIso() };
  },
);

export const listUsers = callable(z.object({ limit: z.number().int().min(1).max(200).default(100) }), async ({ input, actor }) => {
  assertAdmin(actor);
  const snap = await db.collection('users').orderBy('createdAt', 'desc').limit(input.limit ?? 100).get();
  return snap.docs.map((d) => ({ id: d.id, email: d.get('email'), fullName: d.get('fullName'), role: d.get('role'), disabled: d.get('disabled') ?? false }));
});
