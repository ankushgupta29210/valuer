import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Plus, Trash2 } from 'lucide-react';
import { ACCOUNT_TYPE_LABEL, type Account } from '@valeur/shared';
import { useClientContext } from '@/lib/clientContext';
import { deleteManualAccount, useClientCollection } from '@/lib/data';
import { fmtDate, money } from '@/lib/format';
import { Alert, Button, Card, CardHeader, Dialog, EmptyState, LoadingBlock, PageHeader, Select, toast } from '@/components/ui';
import { AccountStatusBadge, BureauBadge, ReviewStateBadge } from '@/components/StatusBadge';
import { AccountEditor } from '@/components/AccountEditor';

export default function AccountsPage() {
  const { clientId } = useClientContext();
  const accounts = useClientCollection<Account>('accounts', clientId);
  const [editing, setEditing] = useState<Account | null | 'new'>(null);
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'EQUIFAX' | 'TRANSUNION' | 'MANUAL' | 'NEEDS_REVIEW'>('ALL');

  const rows = useMemo(() => {
    const data = accounts.data.filter((a) => {
      if (filter === 'ALL') return true;
      if (filter === 'MANUAL') return a.source === 'MANUAL';
      if (filter === 'NEEDS_REVIEW') return a.reviewState === 'NEEDS_REVIEW';
      return a.bureau === filter;
    });
    return data.sort((a, b) => a.creditorName.localeCompare(b.creditorName));
  }, [accounts.data, filter]);

  const totals = useMemo(() => {
    const open = accounts.data.filter((a) => a.status !== 'CLOSED' && a.status !== 'PAID');
    const bal = open.reduce((s, a) => s + (a.balance ?? 0), 0);
    const lim = open.filter((a) => a.accountType === 'CREDIT_CARD' || a.accountType === 'LINE_OF_CREDIT').reduce((s, a) => s + (a.creditLimit ?? 0), 0);
    const revolving = open.filter((a) => a.accountType === 'CREDIT_CARD' || a.accountType === 'LINE_OF_CREDIT').reduce((s, a) => s + (a.balance ?? 0), 0);
    return { bal, util: lim > 0 ? revolving / lim : null, pastDue: open.reduce((s, a) => s + (a.pastDue ?? 0), 0) };
  }, [accounts.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Tradelines extracted from your reports plus anything you add yourself. Account numbers are always masked."
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add account
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Summary label="Total balances (open)" value={money(totals.bal)} />
        <Summary label="Revolving utilization" value={totals.util == null ? '—' : `${Math.round(totals.util * 100)}%`} hint="Balance ÷ limit on cards and lines of credit." />
        <Summary label="Total past due" value={money(totals.pastDue)} />
      </div>

      <Card>
        <CardHeader
          title={`${rows.length} account${rows.length === 1 ? '' : 's'}`}
          action={
            <Select
              options={[
                { value: 'ALL', label: 'All sources' },
                { value: 'EQUIFAX', label: 'Equifax' },
                { value: 'TRANSUNION', label: 'TransUnion' },
                { value: 'MANUAL', label: 'Added manually' },
                { value: 'NEEDS_REVIEW', label: 'Needs review' },
              ]}
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="w-44"
            />
          }
        />
        {accounts.loading ? (
          <LoadingBlock rows={5} />
        ) : accounts.error ? (
          <div className="p-5"><Alert tone="error">{accounts.error}</Alert></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<CreditCard className="h-5 w-5" />} title="No accounts here yet" description="Upload a report or add an account manually." action={<Button variant="secondary" onClick={() => setEditing('new')}>Add account</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">Creditor</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2 text-right">Limit</th>
                  <th className="px-3 py-2 text-right">Past due</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last reported</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Review</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-slate-900">{a.creditorName}</p>
                      <p className="text-xs text-slate-500">{a.maskedAccountNumber ?? '—'}{a.isUnfamiliar && <span className="ml-2 text-amber-700">Unfamiliar</span>}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{ACCOUNT_TYPE_LABEL[a.accountType]}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(a.balance)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(a.creditLimit)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${a.pastDue ? 'text-red-700' : ''}`}>{money(a.pastDue)}</td>
                    <td className="px-3 py-2.5"><AccountStatusBadge status={a.status} /></td>
                    <td className="px-3 py-2.5 text-slate-700">{fmtDate(a.lastReportedDate)}</td>
                    <td className="px-3 py-2.5">
                      {a.reportId ? <Link to={`/reports/${a.reportId}`}><BureauBadge bureau={a.bureau} /></Link> : <BureauBadge bureau={a.bureau} />}
                    </td>
                    <td className="px-3 py-2.5"><ReviewStateBadge state={a.reviewState} /></td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
                        {a.source === 'MANUAL' && (
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(a)} aria-label="Delete">
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <AccountEditor account={editing === 'new' ? null : editing} clientId={clientId ?? undefined} onClose={() => setEditing(null)} />}
      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete this account?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirmDelete) return;
                await deleteManualAccount(confirmDelete.id);
                setConfirmDelete(null);
                toast.success('Account deleted.');
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Only manually added accounts can be deleted. Extracted accounts stay linked to their report as evidence.</p>
      </Dialog>
    </div>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <div className="px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </Card>
  );
}
