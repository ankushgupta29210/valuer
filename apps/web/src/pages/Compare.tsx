import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitCompare } from 'lucide-react';
import { compareBureaus, COMPARISON_EXPLANATIONS, ACCOUNT_STATUS_LABEL, type Account, type ComparisonFlag, type CreditReport } from '@valeur/shared';
import { useClientContext } from '@/lib/clientContext';
import { useClientCollection, useSettings } from '@/lib/data';
import { fmtDate, money } from '@/lib/format';
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, LoadingBlock, PageHeader } from '@/components/ui';

const FLAG_TONE: Record<ComparisonFlag, 'green' | 'amber' | 'red' | 'purple' | 'blue'> = {
  SAME_CREDITOR: 'green',
  MISSING_TRADELINE: 'amber',
  BALANCE_MISMATCH: 'red',
  STATUS_MISMATCH: 'red',
  DUPLICATE: 'purple',
};
const FLAG_LABEL: Record<ComparisonFlag, string> = {
  SAME_CREDITOR: 'On both reports',
  MISSING_TRADELINE: 'Only on one report',
  BALANCE_MISMATCH: 'Balance differs',
  STATUS_MISMATCH: 'Status differs',
  DUPLICATE: 'Possible duplicate',
};

export default function ComparePage() {
  const { clientId } = useClientContext();
  const settings = useSettings();
  const accounts = useClientCollection<Account>('accounts', clientId);
  const reports = useClientCollection<CreditReport>('creditReports', clientId);
  const [only, setOnly] = useState<ComparisonFlag | 'ALL'>('ALL');

  // Use only the most recent report per bureau (plus manual accounts tagged
  // with a bureau) so re-uploads do not double every tradeline.
  const eqReport = reports.data.find((r) => r.bureau === 'EQUIFAX');
  const tuReport = reports.data.find((r) => r.bureau === 'TRANSUNION');
  const bureauAccounts = useMemo(() => {
    const latest = new Set([eqReport?.id, tuReport?.id].filter(Boolean));
    return accounts.data.filter((a) => a.bureau && (a.source === 'MANUAL' || (a.reportId && latest.has(a.reportId))));
  }, [accounts.data, eqReport?.id, tuReport?.id]);
  const rows = useMemo(() => compareBureaus(bureauAccounts, settings.balanceTolerance), [bureauAccounts, settings.balanceTolerance]);
  const filtered = only === 'ALL' ? rows : rows.filter((r) => r.flags.includes(only));
  const hasEq = bureauAccounts.some((a) => a.bureau === 'EQUIFAX');
  const hasTu = bureauAccounts.some((a) => a.bureau === 'TRANSUNION');
  const counts = (Object.keys(FLAG_LABEL) as ComparisonFlag[]).map((f) => ({ flag: f, n: rows.filter((r) => r.flags.includes(f)).length }));

  return (
    <div className="space-y-6">
      <PageHeader title="Compare bureaus" description="The same creditor side by side. A difference is not automatically an error — the bureaus receive updates on different dates." />

      {accounts.loading ? (
        <Card><LoadingBlock rows={5} /></Card>
      ) : !hasEq || !hasTu ? (
        <Card>
          <EmptyState
            icon={<GitCompare className="h-5 w-5" />}
            title={!hasEq && !hasTu ? 'Nothing to compare yet' : `Waiting for your ${hasEq ? 'TransUnion' : 'Equifax'} report`}
            description="Comparison needs accounts from both bureaus. Upload the missing report, or add its accounts manually with the bureau set."
            action={<Link to="/reports" className="text-sm font-medium">Go to reports →</Link>}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {[{ label: 'Equifax', r: eqReport }, { label: 'TransUnion', r: tuReport }].map(({ label, r }) => (
              <Card key={label}>
                <CardBody className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="text-2xl font-semibold">{r?.score ?? '—'}</p>
                  </div>
                  <p className="text-right text-xs text-slate-500">
                    {r ? <>Report dated {fmtDate(r.reportDate)}<br />{bureauAccounts.filter((a) => a.bureau === (label === 'Equifax' ? 'EQUIFAX' : 'TRANSUNION')).length} accounts</> : 'Accounts added manually'}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            <button onClick={() => setOnly('ALL')} className={`rounded-full px-3 py-1 text-sm ${only === 'ALL' ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>All {rows.length}</button>
            {counts.map((c) => (
              <button key={c.flag} onClick={() => setOnly(c.flag)} className={`rounded-full px-3 py-1 text-sm ${only === c.flag ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>
                {FLAG_LABEL[c.flag]} {c.n}
              </button>
            ))}
          </div>

          <Card>
            <CardHeader title="Side by side" description={`Balance tolerance: ${money(settings.balanceTolerance)}.`} />
            {filtered.length === 0 ? (
              <EmptyState title="No rows match" />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2">Creditor</th>
                      <th className="px-3 py-2">Equifax</th>
                      <th className="px-3 py-2">TransUnion</th>
                      <th className="px-3 py-2">What to check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 align-top">
                    {filtered.map((row) => (
                      <tr key={row.key + (row.equifax?.id ?? '') + (row.transunion?.id ?? '')}>
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{row.creditorName}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {row.flags.map((f) => (
                              <Badge key={f} tone={FLAG_TONE[f]}>{FLAG_LABEL[f]}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3"><Side a={row.equifax} diff={row.differences} side="equifax" /></td>
                        <td className="px-3 py-3"><Side a={row.transunion} diff={row.differences} side="transunion" /></td>
                        <td className="max-w-xs px-3 py-3 text-xs text-slate-600">
                          {row.flags.map((f) => (
                            <p key={f}>{COMPARISON_EXPLANATIONS[f]}</p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Alert tone="info">Spotted something that needs a closer look? Add a concern on the <Link to="/diagnose">Diagnose</Link> page so it can be tracked with evidence.</Alert>
        </>
      )}
    </div>
  );
}

function Side({ a, diff, side }: { a: ReturnType<typeof compareBureaus>[number]['equifax']; diff: { field: string }[]; side: 'equifax' | 'transunion' }) {
  if (!a) return <span className="text-xs text-slate-400">Not reported</span>;
  const changed = new Set(diff.map((d) => d.field));
  const cell = (field: string, value: string) => <span className={changed.has(field) ? 'font-medium text-red-700' : ''}>{value}</span>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
      <dt className="text-slate-500">No.</dt><dd>{a.maskedAccountNumber ?? '—'}</dd>
      <dt className="text-slate-500">Balance</dt><dd>{cell('balance', money(a.balance))}</dd>
      <dt className="text-slate-500">Limit</dt><dd>{cell('creditLimit', money(a.creditLimit))}</dd>
      <dt className="text-slate-500">Past due</dt><dd>{cell('pastDue', money(a.pastDue))}</dd>
      <dt className="text-slate-500">Status</dt><dd>{cell('status', ACCOUNT_STATUS_LABEL[a.status])}</dd>
      <dt className="text-slate-500">Reported</dt><dd>{cell('lastReportedDate', fmtDate(a.lastReportedDate))}</dd>
      <dt className="sr-only">{side}</dt><dd className="sr-only" />
    </dl>
  );
}
