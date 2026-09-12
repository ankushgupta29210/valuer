import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Stethoscope } from 'lucide-react';
import { ISSUE_STATUS_MEANING, ISSUE_TRANSITIONS, RULE_DEFINITIONS, clientIssueInputSchema, type Account, type CreditIssue, type IssueStatus, type RuleCode } from '@valeur/shared';
import { useClientContext } from '@/lib/clientContext';
import { addClientIssue, updateIssueNotes, useClientCollection } from '@/lib/data';
import { api, CallableError } from '@/lib/callables';
import { fmtDate, titleCase } from '@/lib/format';
import { Alert, Button, Card, CardBody, Dialog, EmptyState, Input, PageHeader, Select, Textarea, LoadingBlock, toast } from '@/components/ui';
import { BureauBadge, IssueStatusBadge, SeverityBadge } from '@/components/StatusBadge';

const FILTERS: { value: IssueStatus | 'ALL'; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'DISPUTED', label: 'In dispute' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'NOT_SUPPORTED', label: 'Not supported' },
  { value: 'ALL', label: 'All' },
];

export default function DiagnosePage() {
  const { clientId, isOwnCase } = useClientContext();
  const issues = useClientCollection<CreditIssue>('creditIssues', clientId);
  const accounts = useClientCollection<Account>('accounts', clientId);
  const [filter, setFilter] = useState<IssueStatus | 'ALL'>('OPEN');
  const [adding, setAdding] = useState(false);
  const [decision, setDecision] = useState<{ issue: CreditIssue; status: IssueStatus } | null>(null);

  const rows = useMemo(() => issues.data.filter((i) => filter === 'ALL' || i.status === filter), [issues.data, filter]);
  const accountOf = (id: string | null | undefined) => accounts.data.find((a) => a.id === id);
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, f.value === 'ALL' ? issues.data.length : issues.data.filter((i) => i.status === f.value).length]));
  const confirmedCount = counts.CONFIRMED ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnose"
        description="Valeur points out patterns. You decide whether each one is worth reviewing — nothing becomes a dispute on its own, and accurate information is never treated as an error."
        action={<Button variant="outline" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add a concern</Button>}
      />

      {confirmedCount > 0 && (
        <Alert tone="info" title={`${confirmedCount} confirmed item${confirmedCount === 1 ? '' : 's'}`}>
          Confirmed items can be grouped into a bureau-specific dispute package on the <Link to="/letters">Disputes & letters</Link> page.
        </Alert>
      )}

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-sm ${filter === f.value ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}
          >
            {f.label} <span className="opacity-70">{counts[f.value]}</span>
          </button>
        ))}
      </div>

      {issues.loading ? (
        <Card><LoadingBlock rows={5} /></Card>
      ) : issues.error ? (
        <Alert tone="error">{issues.error}</Alert>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Stethoscope className="h-5 w-5" />} title={filter === 'OPEN' ? 'Nothing open right now' : 'No items match this filter'} description={issues.data.length === 0 ? 'Upload a report to run the diagnostic checks, or add a concern yourself.' : undefined} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((issue) => {
            const acct = accountOf(issue.accountId);
            const def = issue.ruleCode ? RULE_DEFINITIONS[issue.ruleCode as RuleCode] : null;
            const next = ISSUE_TRANSITIONS[issue.status] ?? [];
            return (
              <Card key={issue.id}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={issue.severity} />
                      <IssueStatusBadge status={issue.status} />
                      <BureauBadge bureau={issue.bureau} />
                    </div>
                    <span className="text-xs text-slate-500">{fmtDate(issue.createdAt)}</span>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{def?.title ?? titleCase(issue.type)}</p>
                    <p className="mt-0.5 text-sm text-slate-700">{issue.summary}</p>
                    {acct && (
                      <p className="mt-1 text-xs text-slate-500">
                        {acct.creditorName} {acct.maskedAccountNumber ?? ''}
                        {issue.sourcePage && issue.reportId ? (
                          <>
                            {' · '}<Link to={`/reports/${issue.reportId}`}>source page {issue.sourcePage}</Link>
                          </>
                        ) : null}
                      </p>
                    )}
                  </div>
                  {issue.whyItMatters && (
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Why it matters</p>
                      <p className="mt-0.5 text-slate-700">{issue.whyItMatters}</p>
                    </div>
                  )}
                  <div className="rounded-lg bg-brand-50 p-3 text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Evidence to gather</p>
                    <p className="mt-0.5 text-slate-800">{issue.evidenceNeeded}</p>
                  </div>
                  <EvidenceNotes issue={issue} />
                  <p className="text-xs text-slate-500">{ISSUE_STATUS_MEANING[issue.status]}</p>
                  {next.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      {issue.status === 'OPEN' && (
                        <>
                          <Button size="sm" onClick={() => setDecision({ issue, status: 'CONFIRMED' })}>Confirm — deserves review</Button>
                          <Button size="sm" variant="outline" onClick={() => setDecision({ issue, status: 'NOT_SUPPORTED' })}>Not supported</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDecision({ issue, status: 'RESOLVED' })}>Already resolved</Button>
                        </>
                      )}
                      {issue.status === 'CONFIRMED' && (
                        <>
                          <Link to="/letters"><Button size="sm">Add to a dispute</Button></Link>
                          <Button size="sm" variant="ghost" onClick={() => setDecision({ issue, status: 'OPEN' })}>Reopen</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDecision({ issue, status: 'RESOLVED' })}>Mark resolved</Button>
                        </>
                      )}
                      {issue.status === 'DISPUTED' && (
                        <>
                          {issue.disputeId && <Link to={`/disputes/${issue.disputeId}`}><Button size="sm" variant="outline">View dispute</Button></Link>}
                          <Button size="sm" variant="ghost" onClick={() => setDecision({ issue, status: 'RESOLVED' })}>Mark resolved</Button>
                        </>
                      )}
                      {(issue.status === 'RESOLVED' || issue.status === 'NOT_SUPPORTED') && (
                        <Button size="sm" variant="ghost" onClick={() => setDecision({ issue, status: 'OPEN' })}>Reopen</Button>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {decision && <DecisionDialog issue={decision.issue} status={decision.status} onClose={() => setDecision(null)} />}
      {adding && clientId && isOwnCase !== undefined && <AddConcernDialog clientId={clientId} accounts={accounts.data} onClose={() => setAdding(false)} />}
    </div>
  );
}

function EvidenceNotes({ issue }: { issue: CreditIssue }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(issue.evidenceNotes ?? '');
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <div className="text-sm">
        {issue.evidenceNotes ? <pre className="whitespace-pre-wrap font-sans text-slate-700">{issue.evidenceNotes}</pre> : null}
        <button className="text-xs text-brand-700 underline" onClick={() => setOpen(true)}>{issue.evidenceNotes ? 'Edit evidence notes' : 'Add evidence notes'}</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Textarea label="Evidence notes" value={value} onChange={(e) => setValue(e.target.value)} placeholder="What do your statements or records show? Which documents do you have?" />
      <div className="flex gap-2">
        <Button size="sm" loading={busy} onClick={async () => { setBusy(true); try { await updateIssueNotes(issue.id, value); setOpen(false); } catch { toast.error('Could not save notes.'); } finally { setBusy(false); } }}>Save notes</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

const DECISION_COPY: Record<IssueStatus, { title: string; body: string; cta: string }> = {
  CONFIRMED: { title: 'Confirm this item deserves review', body: 'This does not mean the information is wrong. It means you have looked at it and want to take it further — into a dispute package or your action plan.', cta: 'Confirm' },
  NOT_SUPPORTED: { title: 'Mark as not supported', body: 'Use this when your records show the item is accurate or you do not have evidence to question it. It stays visible for transparency and will not be included in a dispute.', cta: 'Mark not supported' },
  RESOLVED: { title: 'Mark as resolved', body: 'Record that this item has been corrected or otherwise dealt with. Your evidence and outcome stay in the activity log.', cta: 'Mark resolved' },
  OPEN: { title: 'Reopen this item', body: 'Move it back to open so you can reconsider it.', cta: 'Reopen' },
  DISPUTED: { title: '', body: '', cta: '' },
};

function DecisionDialog({ issue, status, onClose }: { issue: CreditIssue; status: IssueStatus; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = DECISION_COPY[status];
  return (
    <Dialog
      open
      onClose={onClose}
      title={copy.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.updateIssueStatus(issue.id, status, note || undefined);
                toast.success('Decision recorded.');
                onClose();
              } catch (err) {
                toast.error(err instanceof CallableError ? err.message : 'Could not update the item.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {copy.cta}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">{copy.body}</p>
      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{issue.summary}</p>
      <Textarea className="mt-3" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth recording about this decision." />
    </Dialog>
  );
}

function AddConcernDialog({ clientId, accounts, onClose }: { clientId: string; accounts: Account[]; onClose: () => void }) {
  const [form, setForm] = useState({ accountId: '', summary: '', evidenceNeeded: '', severity: 'MEDIUM' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = clientIssueInputSchema.safeParse({ accountId: form.accountId || null, summary: form.summary, evidenceNeeded: form.evidenceNeeded || undefined, severity: form.severity });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path.join('.')] = i.message;
      setErrors(errs);
      return;
    }
    setBusy(true);
    try {
      const acct = accounts.find((a) => a.id === parsed.data.accountId);
      await addClientIssue(clientId, { ...parsed.data, accountId: parsed.data.accountId ?? null, bureau: acct?.bureau ?? null });
      toast.success('Concern added.');
      onClose();
    } catch {
      toast.error('Could not add the concern.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Add a concern" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button form="concern-form" type="submit" loading={busy}>Add</Button></>}>
      <form id="concern-form" onSubmit={onSubmit} className="space-y-4">
        <Select label="Related account" placeholder="Not tied to one account" options={accounts.map((a) => ({ value: a.id, label: `${a.creditorName} ${a.maskedAccountNumber ?? ''}` }))} value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))} />
        <Textarea label="What looks off?" required value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} error={errors.summary} placeholder="e.g. The balance shown is higher than my latest statement." />
        <Input label="Evidence you plan to gather" value={form.evidenceNeeded} onChange={(e) => setForm((f) => ({ ...f, evidenceNeeded: e.target.value }))} error={errors.evidenceNeeded} placeholder="Statements, payment confirmations, letters…" />
        <Select label="Priority" options={[{ value: 'HIGH', label: 'High' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'LOW', label: 'Low' }]} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))} />
      </form>
    </Dialog>
  );
}
