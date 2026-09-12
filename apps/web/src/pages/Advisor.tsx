import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { where, limit } from '@/lib/query';
import { Users } from 'lucide-react';
import type { ActivityLog, AdvisorNote, CreditIssue, CreditReport, Dispute, Letter, Profile, StaffAssignment, Bill } from '@valeur/shared';
import { useAuth } from '@/lib/auth';
import { useClientContext } from '@/lib/clientContext';
import { addAdvisorNote, useClientCollection, useCollection, useDoc } from '@/lib/data';
import { fmtDateTime, titleCase, relative } from '@/lib/format';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, LoadingBlock, PageHeader, Select, Textarea, toast } from '@/components/ui';
import { DisputeStatusBadge, LetterStatusBadge, ReportStatusBadge } from '@/components/StatusBadge';

export default function AdvisorPage() {
  const { user, role } = useAuth();
  const assignments = useCollection<StaffAssignment>('staffAssignments', role === 'admin' ? [where('status', '==', 'ACTIVE')] : [where('staffUid', '==', user?.uid ?? ''), where('status', '==', 'ACTIVE')], [user?.uid, role], !!user);
  const [selected, setSelected] = useState<string | null>(null);
  const clientIds = [...new Set(assignments.data.map((a) => a.clientId))];

  return (
    <div className="space-y-6">
      <PageHeader title="Advisor workspace" description="Assigned clients only. You can organize information, correct extraction, and prepare letters. The client keeps control of confirmations, approvals, and anything sent externally." />
      {assignments.loading ? (
        <Card><LoadingBlock /></Card>
      ) : assignments.error ? (
        <Alert tone="error">{assignments.error}</Alert>
      ) : clientIds.length === 0 ? (
        <Card><EmptyState icon={<Users className="h-5 w-5" />} title="No clients assigned" description="An administrator assigns clients to advisors." /></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="lg:self-start">
            <CardHeader title={`${clientIds.length} client${clientIds.length === 1 ? '' : 's'}`} />
            <ul className="divide-y divide-slate-100">
              {clientIds.map((id) => (
                <ClientRow key={id} clientId={id} active={selected === id} onSelect={() => setSelected(id)} />
              ))}
            </ul>
          </Card>
          {selected ? <CaseSummary clientId={selected} /> : <Card><EmptyState title="Choose a client" description="Select a client to see their case summary." /></Card>}
        </div>
      )}
    </div>
  );
}

function ClientRow({ clientId, active, onSelect }: { clientId: string; active: boolean; onSelect: () => void }) {
  const profile = useDoc<Profile>(`profiles/${clientId}`);
  const issues = useClientCollection<CreditIssue>('creditIssues', clientId, [where('status', '==', 'OPEN')], 'none');
  return (
    <li>
      <button onClick={onSelect} className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm hover:bg-slate-50 ${active ? 'bg-brand-50' : ''}`}>
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{profile.data?.fullName ?? clientId}</p>
          <p className="truncate text-xs text-slate-500">{profile.data?.email}</p>
        </div>
        {issues.data.length > 0 && <Badge tone="amber">{issues.data.length} open</Badge>}
      </button>
    </li>
  );
}

function CaseSummary({ clientId }: { clientId: string }) {
  const { user, profile: me } = useAuth();
  const ctx = useClientContext();
  const navigate = useNavigate();
  const profile = useDoc<Profile>(`profiles/${clientId}`);
  const reports = useClientCollection<CreditReport>('creditReports', clientId);
  const issues = useClientCollection<CreditIssue>('creditIssues', clientId, [where('status', 'in', ['OPEN', 'CONFIRMED'])]);
  const disputes = useClientCollection<Dispute>('disputes', clientId);
  const letters = useClientCollection<Letter>('letters', clientId);
  const bills = useClientCollection<Bill>('bills', clientId, [where('status', '==', 'ACTIVE')], 'none');
  const notes = useClientCollection<AdvisorNote>('advisorNotes', clientId);
  const activity = useClientCollection<ActivityLog>('activityLogs', clientId, [limit(15)]);
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<'INTERNAL' | 'CLIENT_VISIBLE'>('INTERNAL');
  const [busy, setBusy] = useState(false);
  const today = new Date().getDate();

  function openCase() {
    ctx.select(clientId, profile.data?.fullName ?? null);
    navigate('/');
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">{profile.data?.fullName ?? clientId}</p>
            <p className="text-sm text-slate-500">{profile.data?.email}{profile.data?.province ? ` · ${profile.data.province}` : ''}</p>
          </div>
          <Button onClick={openCase}>Open case workspace</Button>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Reports" />
          {reports.loading ? <LoadingBlock /> : reports.data.length === 0 ? <EmptyState title="No reports" /> : (
            <ul className="divide-y divide-slate-100">
              {reports.data.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-5 py-2 text-sm">
                  <span>{r.bureau === 'EQUIFAX' ? 'Equifax' : 'TransUnion'} · {relative(r.createdAt)}</span>
                  <ReportStatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Unresolved review items" />
          {issues.loading ? <LoadingBlock /> : issues.data.length === 0 ? <EmptyState title="Nothing outstanding" /> : (
            <ul className="divide-y divide-slate-100">
              {issues.data.slice(0, 6).map((i) => (
                <li key={i.id} className="px-5 py-2 text-sm">
                  <p className="truncate">{i.summary}</p>
                  <p className="text-xs text-slate-500">{titleCase(i.ruleCode ?? i.type)} · {i.status.toLowerCase()}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Disputes and letters" />
          {disputes.loading ? <LoadingBlock /> : disputes.data.length === 0 && letters.data.length === 0 ? <EmptyState title="None yet" /> : (
            <ul className="divide-y divide-slate-100">
              {disputes.data.map((d) => (
                <li key={d.id} className="flex items-center justify-between px-5 py-2 text-sm">
                  <span>{d.bureau === 'EQUIFAX' ? 'Equifax' : 'TransUnion'} package · {d.issueIds.length} items</span>
                  <DisputeStatusBadge status={d.status} />
                </li>
              ))}
              {letters.data.filter((l) => l.type === 'SETTLEMENT_REQUEST').map((l) => (
                <li key={l.id} className="flex items-center justify-between px-5 py-2 text-sm">
                  <span className="truncate">{l.subject}</span>
                  <LetterStatusBadge status={l.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Upcoming due dates" />
          {bills.loading ? <LoadingBlock /> : bills.data.length === 0 ? <EmptyState title="No bills tracked" /> : (
            <ul className="divide-y divide-slate-100">
              {[...bills.data].sort((a, b) => ((a.dueDay - today + 31) % 31) - ((b.dueDay - today + 31) % 31)).slice(0, 6).map((b) => (
                <li key={b.id} className="flex items-center justify-between px-5 py-2 text-sm">
                  <span>{b.name}</span>
                  <span className="text-xs text-slate-500">day {b.dueDay}{b.autopay ? ' · autopay' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Case notes" />
        <CardBody className="space-y-3">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note about this case…" />
          <div className="flex flex-wrap items-end gap-2">
            <Select label="Visibility" options={[{ value: 'INTERNAL', label: 'Internal (staff only)' }, { value: 'CLIENT_VISIBLE', label: 'Visible to client' }]} value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)} className="w-56" />
            <Button loading={busy} disabled={!note.trim()} onClick={async () => { if (!user) return; setBusy(true); try { await addAdvisorNote(clientId, user.uid, me?.fullName ?? user.email ?? 'Staff', note.trim(), visibility); setNote(''); toast.success('Note added.'); } catch { toast.error('Could not add the note.'); } finally { setBusy(false); } }}>Add note</Button>
          </div>
          {notes.data.length > 0 && (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {notes.data.map((n) => (
                <li key={n.id} className="py-2 text-sm">
                  <p className="whitespace-pre-wrap text-slate-800">{n.note}</p>
                  <p className="text-xs text-slate-500">{n.authorName ?? n.authorId} · {fmtDateTime(n.createdAt)} · {n.visibility === 'INTERNAL' ? 'internal' : 'visible to client'}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Audit timeline" />
        {activity.loading ? <LoadingBlock /> : activity.data.length === 0 ? <EmptyState title="No activity yet" /> : (
          <ol className="divide-y divide-slate-100">
            {activity.data.map((a) => (
              <li key={a.id} className="px-5 py-2 text-sm">
                <p>{titleCase(a.action)} <span className="text-xs text-slate-500">by {a.actorRole}</span></p>
                <p className="text-xs text-slate-500">{fmtDateTime(a.createdAt)} · {a.entityType}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
