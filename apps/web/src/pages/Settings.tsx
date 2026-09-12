import { useEffect, useState, type FormEvent } from 'react';
import { where } from 'firebase/firestore';
import { profileUpdateSchema, type DataRequest } from '@valeur/shared';
import { useAuth } from '@/lib/auth';
import { saveProfile, useClientCollection } from '@/lib/data';
import { api, CallableError } from '@/lib/callables';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Dialog, Input, PageHeader, Select, Textarea, toast } from '@/components/ui';

const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'].map((p) => ({ value: p, label: p }));

export default function SettingsPage() {
  const { user, profile } = useAuth();
  const requests = useClientCollection<DataRequest>('dataRequests', user?.uid, [where('type', '==', 'DELETE')], 'none');
  const [form, setForm] = useState({ fullName: '', phone: '', address: '', city: '', province: '', postalCode: '' });
  const [prefs, setPrefs] = useState({ email: true, reportReady: true, dueDateReminders: true, disputeUpdates: true });
  const [aiConsent, setAiConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState('');
  const pendingDeletion = requests.data.find((r) => r.status === 'PENDING');

  useEffect(() => {
    if (!profile) return;
    setForm({ fullName: profile.fullName ?? '', phone: profile.phone ?? '', address: profile.address ?? '', city: profile.city ?? '', province: profile.province ?? '', postalCode: profile.postalCode ?? '' });
    setPrefs({ ...{ email: true, reportReady: true, dueDateReminders: true, disputeUpdates: true }, ...(profile.notificationPrefs ?? {}) });
    setAiConsent(!!profile.aiDataConsent);
  }, [profile]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function saveProfileForm(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    const parsed = profileUpdateSchema.safeParse({ fullName: form.fullName, phone: form.phone || null, address: form.address || null, city: form.city || null, province: form.province || null, postalCode: form.postalCode || null });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path.join('.')] = i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await saveProfile(user.uid, user.email, parsed.data, false);
      toast.success('Profile saved.');
    } catch {
      toast.error('Could not save your profile.');
    } finally {
      setBusy(false);
    }
  }

  async function savePrefs() {
    if (!user?.email) return;
    try {
      await saveProfile(user.uid, user.email, { notificationPrefs: prefs, aiDataConsent: aiConsent }, false);
      toast.success('Preferences saved.');
    } catch {
      toast.error('Could not save preferences.');
    }
  }

  async function exportData() {
    setExporting(true);
    try {
      const r = await api.requestDataExport();
      setExportPath(r.exportPath ?? null);
      if (r.exportPath) {
        const { url } = await api.getSignedDownloadUrl(r.exportPath);
        window.open(url, '_blank', 'noopener');
      }
      toast.success('Export ready.');
    } catch (err) {
      toast.error(err instanceof CallableError ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Profile, consent, notifications, and your data." />

      <Card>
        <CardHeader title="Profile" description="Used on letters you generate. Nothing here is shared without your approval." />
        <CardBody>
          <form onSubmit={saveProfileForm} className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" required value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
            <Input label="Email" value={user?.email ?? ''} disabled hint="Contact support to change your email." />
            <Input label="Phone" value={form.phone} onChange={set('phone')} error={errors.phone} />
            <Input label="Street address" value={form.address} onChange={set('address')} />
            <Input label="City" value={form.city} onChange={set('city')} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Province" placeholder="—" options={PROVINCES} value={form.province} onChange={set('province')} error={errors.province} />
              <Input label="Postal code" value={form.postalCode} onChange={set('postalCode')} error={errors.postalCode} />
            </div>
            <div className="sm:col-span-2"><Button type="submit" loading={busy}>Save profile</Button></div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Consent and notifications" description={profile?.consentAt ? `You acknowledged how Valeur handles your information on ${fmtDate(profile.consentAt)}.` : undefined} />
        <CardBody className="space-y-3">
          <Checkbox label="Allow the Ask Valeur assistant to use my report and account data" description="Only masked summaries are shared with the AI provider. Turn off any time." checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} />
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-sm font-medium text-slate-700">Email notifications</p>
            <div className="space-y-2">
              <Checkbox label="When a report has been read" checked={prefs.reportReady} onChange={(e) => setPrefs((p) => ({ ...p, reportReady: e.target.checked }))} />
              <Checkbox label="Bill due-date reminders" checked={prefs.dueDateReminders} onChange={(e) => setPrefs((p) => ({ ...p, dueDateReminders: e.target.checked }))} />
              <Checkbox label="Dispute response reminders" checked={prefs.disputeUpdates} onChange={(e) => setPrefs((p) => ({ ...p, disputeUpdates: e.target.checked }))} />
            </div>
          </div>
          <Button variant="secondary" onClick={savePrefs}>Save preferences</Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Your data" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Export everything</p>
              <p className="text-xs text-slate-500">A JSON file with your profile, accounts, reports, issues, disputes, letters, settlements, and activity log.</p>
              {exportPath && <p className="text-xs text-emerald-700">Export created. If it did not open, allow pop-ups and try again.</p>}
            </div>
            <Button variant="outline" onClick={exportData} loading={exporting}>Request export</Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div>
              <p className="text-sm font-medium text-red-700">Delete my account</p>
              <p className="text-xs text-slate-500">Files and records are removed after the retention period. Your audit log is kept without identifying details.</p>
              {pendingDeletion && <p className="text-xs text-amber-700">Deletion scheduled for {fmtDateTime(pendingDeletion.scheduledFor)}.</p>}
            </div>
            {pendingDeletion ? (
              <Button variant="outline" onClick={async () => { await api.cancelDeletionRequest(pendingDeletion.id); toast.success('Deletion cancelled.'); }}>Cancel deletion</Button>
            ) : (
              <Button variant="danger" onClick={() => setDeleting(true)}>Request deletion</Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Dialog open={deleting} onClose={() => setDeleting(false)} title="Request account deletion" footer={<><Button variant="ghost" onClick={() => setDeleting(false)}>Keep my account</Button><Button variant="danger" onClick={async () => { try { const r = await api.requestAccountDeletion(reason || undefined); toast.success(`Deletion scheduled for ${fmtDate(r.scheduledFor)}. You can cancel before then.`); setDeleting(false); } catch (err) { toast.error(err instanceof CallableError ? err.message : 'Could not submit the request.'); } }}>Schedule deletion</Button></>}>
        <Alert tone="warning">Consider exporting your data first. Once the retention period passes, your reports, accounts, and letters are permanently removed.</Alert>
        <Textarea className="mt-3" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
    </div>
  );
}
