import { useEffect, useState, type FormEvent } from 'react';
import { orderBy } from '@/lib/query';
import { Plus, Trash2 } from 'lucide-react';
import { CONTACT_KINDS, DEFAULT_SETTINGS, ROLES, agencyContactSchema, settingsSchema, type AgencyContact, type Role, type StaffAssignment, type Settings } from '@valeur/shared';
import { useAuth } from '@/lib/auth';
import { useAgencyContacts, useCollection, useDoc, saveAgencyContact, deleteAgencyContact, saveSettings } from '@/lib/data';
import { api, CallableError } from '@/lib/callables';
import { fmtDate } from '@/lib/format';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Dialog, EmptyState, Input, LoadingBlock, PageHeader, Select, Textarea, toast } from '@/components/ui';

type Tab = 'users' | 'contacts' | 'settings';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <div className="space-y-6">
      <PageHeader title="Administration" description="Users and roles, staff assignments, the recipient directory, and rule settings. Every change here is audited." />
      <div className="flex gap-1 border-b border-slate-200">
        {(['users', 'contacts', 'settings'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t === 'users' ? 'Users & assignments' : t === 'contacts' ? 'Recipient directory' : 'Rules & retention'}
          </button>
        ))}
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'contacts' && <ContactsTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

// ---------- users ----------

function UsersTab() {
  const { refreshClaims } = useAuth();
  const [users, setUsers] = useState<{ id: string; email: string; fullName: string | null; role: Role; disabled: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const assignments = useCollection<StaffAssignment>('staffAssignments', [orderBy('createdAt', 'desc')]);
  const [assign, setAssign] = useState({ clientId: '', staffUid: '' });

  async function load() {
    setLoading(true);
    try {
      setUsers(await api.listUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof CallableError ? err.message : 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function changeRole(uid: string, role: Role) {
    try {
      await api.setUserRole(uid, role);
      toast.success('Role updated. The user sees it on their next sign-in.');
      await refreshClaims();
      load();
    } catch (err) {
      toast.error(err instanceof CallableError ? err.message : 'Could not change the role.');
    }
  }

  const clients = users.filter((u) => u.role === 'client');
  const staff = users.filter((u) => u.role !== 'client');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Users" action={<Button size="sm" variant="ghost" onClick={load}>Refresh</Button>} />
        {loading ? <LoadingBlock /> : error ? <CardBody><Alert tone="error">{error}</Alert></CardBody> : users.length === 0 ? <EmptyState title="No users yet" /> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2">User</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">User id</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-2"><p className="font-medium">{u.fullName ?? '—'}</p><p className="text-xs text-slate-500">{u.email}</p></td>
                    <td className="px-3 py-2"><Select options={ROLES.map((r) => ({ value: r, label: r }))} value={u.role} onChange={(e) => changeRole(u.id, e.target.value as Role)} className="w-32" /></td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{u.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Staff assignments" description="Staff only see clients they are assigned to." />
        <CardBody className="space-y-4">
          <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); try { await api.assignStaff(assign.clientId, assign.staffUid, true); toast.success('Assigned.'); setAssign({ clientId: '', staffUid: '' }); } catch (err) { toast.error(err instanceof CallableError ? err.message : 'Could not assign.'); } }}>
            <Select label="Client" placeholder="Choose a client" options={clients.map((c) => ({ value: c.id, label: `${c.fullName ?? c.email}` }))} value={assign.clientId} onChange={(e) => setAssign((a) => ({ ...a, clientId: e.target.value }))} className="w-64" />
            <Select label="Staff member" placeholder="Choose staff" options={staff.map((s) => ({ value: s.id, label: `${s.fullName ?? s.email} (${s.role})` }))} value={assign.staffUid} onChange={(e) => setAssign((a) => ({ ...a, staffUid: e.target.value }))} className="w-64" />
            <Button type="submit" disabled={!assign.clientId || !assign.staffUid}><Plus className="h-4 w-4" /> Assign</Button>
          </form>
          {assignments.data.length > 0 && (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {assignments.data.map((a) => {
                const c = users.find((u) => u.id === a.clientId);
                const s = users.find((u) => u.id === a.staffUid);
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>{c?.fullName ?? c?.email ?? a.clientId} → {s?.fullName ?? s?.email ?? a.staffUid}</span>
                    <div className="flex items-center gap-2">
                      <Badge tone={a.status === 'ACTIVE' ? 'green' : 'neutral'}>{a.status.toLowerCase()}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => api.assignStaff(a.clientId, a.staffUid, a.status !== 'ACTIVE').then(() => toast.success('Updated.'))}>{a.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------- recipient directory ----------

function ContactsTab() {
  const contacts = useAgencyContacts();
  const [editing, setEditing] = useState<AgencyContact | 'new' | null>(null);
  return (
    <Card>
      <CardHeader title="Recipient directory" description="Where letters go. Verify each entry against the bureau or creditor's official instructions and record the date." action={<Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add recipient</Button>} />
      {contacts.loading ? <LoadingBlock /> : contacts.data.length === 0 ? <EmptyState title="No recipients yet" description="Add Equifax Canada and TransUnion Canada dispute channels first." /> : (
        <ul className="divide-y divide-slate-100">
          {contacts.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{c.name} <Badge tone={c.active ? 'green' : 'neutral'}>{c.active ? 'active' : 'inactive'}</Badge> <Badge tone="blue">{c.kind.toLowerCase().replace('_', ' ')}{c.bureau ? ` · ${c.bureau.toLowerCase()}` : ''}</Badge></p>
                {c.address && <p className="whitespace-pre-line text-slate-600">{c.address}</p>}
                {c.onlineUrl && <a href={c.onlineUrl} target="_blank" rel="noreferrer" className="break-all text-xs">{c.onlineUrl}</a>}
                <p className={`text-xs ${c.lastVerifiedAt ? 'text-slate-500' : 'text-amber-700'}`}>{c.lastVerifiedAt ? `Verified ${fmtDate(c.lastVerifiedAt)}` : 'Not yet verified'}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <ContactEditor contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ContactEditor({ contact, onClose }: { contact: AgencyContact | null; onClose: () => void }) {
  const [form, setForm] = useState({
    kind: contact?.kind ?? 'BUREAU',
    bureau: contact?.bureau ?? '',
    name: contact?.name ?? '',
    address: contact?.address ?? '',
    onlineUrl: contact?.onlineUrl ?? '',
    onlineInstructions: contact?.onlineInstructions ?? '',
    phone: contact?.phone ?? '',
    lastVerifiedAt: contact?.lastVerifiedAt ?? '',
    active: contact?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = agencyContactSchema.safeParse({ ...form, bureau: form.bureau || null, address: form.address || null, onlineUrl: form.onlineUrl || null, onlineInstructions: form.onlineInstructions || null, phone: form.phone || null, lastVerifiedAt: form.lastVerifiedAt || null });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path.join('.')] = i.message;
      setErrors(errs);
      return;
    }
    setBusy(true);
    try {
      const id = contact ? contact.id : `${parsed.data.kind}_${(parsed.data.bureau ?? parsed.data.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      await saveAgencyContact(id, parsed.data, !contact);
      toast.success('Recipient saved.');
      onClose();
    } catch {
      toast.error('Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={contact ? 'Edit recipient' : 'Add recipient'} size="lg" footer={<>{contact && <Button variant="ghost" className="mr-auto text-red-700" onClick={async () => { await deleteAgencyContact(contact.id); onClose(); }}><Trash2 className="h-4 w-4" /> Delete</Button>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button form="contact-form" type="submit" loading={busy}>Save</Button></>}>
      <form id="contact-form" onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Kind" options={CONTACT_KINDS.map((k) => ({ value: k, label: k.toLowerCase().replace('_', ' ') }))} value={form.kind} onChange={set('kind')} />
          <Select label="Bureau" placeholder="Not a bureau" options={[{ value: 'EQUIFAX', label: 'Equifax' }, { value: 'TRANSUNION', label: 'TransUnion' }]} value={form.bureau} onChange={set('bureau')} />
          <Input label="Name" required value={form.name} onChange={set('name')} error={errors.name} className="sm:col-span-2" />
          <Textarea label="Mailing address" value={form.address} onChange={set('address')} className="sm:col-span-2" />
          <Input label="Official online URL" type="url" value={form.onlineUrl} onChange={set('onlineUrl')} error={errors.onlineUrl} className="sm:col-span-2" />
          <Textarea label="Online instructions" value={form.onlineInstructions} onChange={set('onlineInstructions')} className="sm:col-span-2" />
          <Input label="Phone" value={form.phone} onChange={set('phone')} />
          <Input label="Last verified" type="date" value={form.lastVerifiedAt} onChange={set('lastVerifiedAt')} error={errors.lastVerifiedAt} hint="Set this only after checking the official source." />
        </div>
        <Checkbox label="Active" checked={form.active} onChange={set('active')} />
      </form>
    </Dialog>
  );
}

// ---------- settings ----------

function SettingsTab() {
  const current = useDoc<Settings>('settings/global');
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (current.data) setForm({ ...DEFAULT_SETTINGS, ...current.data, rateLimits: { ...DEFAULT_SETTINGS.rateLimits, ...(current.data.rateLimits ?? {}) } }); }, [current.data]);
  const n = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }));
  const rl = (k: keyof Settings['rateLimits']) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, rateLimits: { ...f.rateLimits, [k]: Number(e.target.value) } }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = settingsSchema.safeParse(form);
    if (!parsed.success) return toast.error('Check the values — all must be positive numbers.');
    setBusy(true);
    try {
      await saveSettings(parsed.data);
      toast.success('Settings saved.');
    } catch {
      toast.error('Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Rules and retention" />
      <CardBody>
        {current.loading ? <LoadingBlock /> : (
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Input label="Max upload size (bytes)" type="number" value={form.maxUploadBytes} onChange={n('maxUploadBytes')} hint={`${Math.round(form.maxUploadBytes / 1024 / 1024)} MB`} />
            <Input label="Balance tolerance for comparison ($)" type="number" step="0.01" value={form.balanceTolerance} onChange={n('balanceTolerance')} />
            <Input label="Dispute response due (days after sent)" type="number" value={form.responseDueDays} onChange={n('responseDueDays')} />
            <Input label="Retention before deletion (days)" type="number" value={form.retentionDays} onChange={n('retentionDays')} />
            <Input label="AI questions per hour" type="number" value={form.rateLimits.aiPerHour} onChange={rl('aiPerHour')} />
            <Input label="Uploads per day" type="number" value={form.rateLimits.uploadsPerDay} onChange={rl('uploadsPerDay')} />
            <Input label="Letters per day" type="number" value={form.rateLimits.lettersPerDay} onChange={rl('lettersPerDay')} />
            <div className="sm:col-span-2"><Button type="submit" loading={busy}>Save settings</Button></div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
