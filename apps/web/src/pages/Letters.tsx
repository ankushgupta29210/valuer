import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Plus } from 'lucide-react';
import { REQUESTED_ACTIONS, REQUESTED_ACTION_TEXT, type Account, type Bureau, type CreditIssue, type Dispute, type Letter, type RequestedAction } from '@valeur/shared';
import { useClientContext } from '@/lib/clientContext';
import { useClientCollection } from '@/lib/data';
import { api, CallableError } from '@/lib/callables';
import { fmtDate } from '@/lib/format';
import { Alert, Button, Card, CardHeader, Dialog, EmptyState, LoadingBlock, PageHeader, Select, toast } from '@/components/ui';
import { DisputeStatusBadge, LetterStatusBadge, BureauBadge } from '@/components/StatusBadge';
import { LetterViewer } from '@/components/LetterViewer';

export default function LettersPage() {
  const { clientId } = useClientContext();
  const disputes = useClientCollection<Dispute>('disputes', clientId);
  const letters = useClientCollection<Letter>('letters', clientId);
  const issues = useClientCollection<CreditIssue>('creditIssues', clientId);
  const accounts = useClientCollection<Account>('accounts', clientId);
  const [building, setBuilding] = useState(false);
  const [viewing, setViewing] = useState<Letter | null>(null);

  const confirmed = useMemo(() => issues.data.filter((i) => i.status === 'CONFIRMED'), [issues.data]);
  const settlementLetters = letters.data.filter((l) => l.type === 'SETTLEMENT_REQUEST');

  return (
    <div className="space-y-8">
      <PageHeader
        title="Disputes & letters"
        description="Build a bureau-specific package from confirmed items, review the plain-language draft, approve it, then submit it yourself. Valeur never sends anything on your behalf."
        action={<Button onClick={() => setBuilding(true)} disabled={confirmed.length === 0}><Plus className="h-4 w-4" /> New dispute package</Button>}
      />
      {confirmed.length === 0 && !issues.loading && <Alert tone="info">Confirm at least one item on the <Link to="/diagnose">Diagnose</Link> page before building a dispute package.</Alert>}

      <Card>
        <CardHeader title="Dispute packages" />
        {disputes.loading ? (
          <LoadingBlock />
        ) : disputes.data.length === 0 ? (
          <EmptyState icon={<Mail className="h-5 w-5" />} title="No dispute packages yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {disputes.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <BureauBadge bureau={d.bureau} />
                <Link to={`/disputes/${d.id}`} className="min-w-0 flex-1 text-sm font-medium text-slate-900 hover:underline">
                  {d.subject}
                  <span className="block text-xs font-normal text-slate-500">
                    {d.issueIds.length} item{d.issueIds.length === 1 ? '' : 's'} · created {fmtDate(d.createdAt)}
                    {d.sentAt ? ` · sent ${fmtDate(d.sentAt)}` : ''}
                    {d.responseDueAt && d.status === 'SENT' ? ` · response expected by ${fmtDate(d.responseDueAt)}` : ''}
                  </span>
                </Link>
                <DisputeStatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Settlement request letters" description="Drafts generated from your settlement records." />
        {letters.loading ? (
          <LoadingBlock />
        ) : settlementLetters.length === 0 ? (
          <EmptyState title="No settlement letters" description="Create one from a settlement record on the Plan page." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {settlementLetters.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <button onClick={() => setViewing(l)} className="min-w-0 flex-1 text-left text-sm font-medium text-slate-900 hover:underline">
                  {l.subject}
                  <span className="block text-xs font-normal text-slate-500">To {l.recipientName} · generated {fmtDate(l.generatedAt)}</span>
                </button>
                <LetterStatusBadge status={l.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {building && clientId && <DisputeBuilder clientId={clientId} issues={confirmed} accounts={accounts.data} onClose={() => setBuilding(false)} />}
      {viewing && <LetterViewer letter={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function DisputeBuilder({ clientId, issues, accounts, onClose }: { clientId: string; issues: CreditIssue[]; accounts: Account[]; onClose: () => void }) {
  const [bureau, setBureau] = useState<Bureau | ''>('');
  const [selected, setSelected] = useState<Record<string, RequestedAction>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = issues.filter((i) => !bureau || !i.bureau || i.bureau === bureau);
  const chosen = Object.entries(selected);

  async function create() {
    if (!bureau) return setError('Choose a bureau first.');
    if (chosen.length === 0) return setError('Select at least one confirmed item.');
    setBusy(true);
    setError(null);
    try {
      await api.createDispute(bureau, chosen.map(([issueId, requestedAction]) => ({ issueId, requestedAction })), clientId);
      toast.success('Dispute draft created with a letter to review.');
      onClose();
    } catch (err) {
      setError(err instanceof CallableError ? err.message : 'Could not create the dispute.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="New dispute package" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={create} loading={busy} disabled={!bureau || chosen.length === 0}>Create draft</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Select label="Bureau" required placeholder="Choose one" value={bureau} onChange={(e) => { setBureau(e.target.value as Bureau | ''); setSelected({}); }} options={[{ value: 'EQUIFAX', label: 'Equifax' }, { value: 'TRANSUNION', label: 'TransUnion' }]} hint="A package goes to one bureau. Items from the other bureau are hidden." />
        {bureau && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Confirmed items for this bureau</p>
            {eligible.length === 0 && <p className="text-sm text-slate-500">No confirmed items for this bureau.</p>}
            {eligible.map((i) => {
              const acct = accounts.find((a) => a.id === i.accountId);
              const on = i.id in selected;
              return (
                <div key={i.id} className={`rounded-lg border p-3 ${on ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200'}`}>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-700" checked={on} onChange={(e) => setSelected((s) => { const n = { ...s }; if (e.target.checked) n[i.id] = 'CORRECT'; else delete n[i.id]; return n; })} />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium text-slate-900">{acct?.creditorName ?? 'General'} {acct?.maskedAccountNumber ?? ''}</p>
                      <p className="text-slate-700">{i.summary}</p>
                    </div>
                  </label>
                  {on && (
                    <Select className="mt-2" label="Requested action" options={REQUESTED_ACTIONS.map((a) => ({ value: a, label: REQUESTED_ACTION_TEXT[a] }))} value={selected[i.id]} onChange={(e) => setSelected((s) => ({ ...s, [i.id]: e.target.value as RequestedAction }))} />
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-slate-500">The letter asks the bureau to investigate and correct, update, or remove only information that cannot be verified as complete and accurate. It never claims that accurate information must be removed.</p>
      </div>
    </Dialog>
  );
}
