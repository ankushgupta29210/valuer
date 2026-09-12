import { useState, type FormEvent } from 'react';
import { Plus, Receipt, Trash2 } from 'lucide-react';
import { BILL_CATEGORIES, BILL_CATEGORY_LABEL, billInputSchema, type Account, type Bill } from '@valeur/shared';
import { useClientContext } from '@/lib/clientContext';
import { addBill, deleteBill, updateBill, useClientCollection } from '@/lib/data';
import { money } from '@/lib/format';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Dialog, EmptyState, Input, LoadingBlock, PageHeader, Select, Textarea, toast } from '@/components/ui';

const num = (v: string) => (v.trim() === '' ? null : Number(v));

export default function BillsPage() {
  const { clientId } = useClientContext();
  const bills = useClientCollection<Bill>('bills', clientId, [], 'none');
  const accounts = useClientCollection<Account>('accounts', clientId);
  const [editing, setEditing] = useState<Bill | 'new' | null>(null);
  const today = new Date().getDate();
  const sorted = [...bills.data].sort((a, b) => ((a.dueDay - today + 31) % 31) - ((b.dueDay - today + 31) % 31));
  const monthly = bills.data.filter((b) => b.status === 'ACTIVE').reduce((s, b) => s + (b.recurringAmount ?? b.currentAmount ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bills and obligations"
        description="Track due dates, autopay, and minimums so nothing slips. Valeur never asks for passwords and never makes payments."
        action={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add bill</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-6 px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Active monthly obligations</p>
            <p className="mt-1 text-2xl font-semibold">{money(monthly)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">On autopay</p>
            <p className="mt-1 text-2xl font-semibold">{bills.data.filter((b) => b.autopay && b.status === 'ACTIVE').length} / {bills.data.filter((b) => b.status === 'ACTIVE').length}</p>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Upcoming" description="Sorted by the next due day." />
        {bills.loading ? (
          <LoadingBlock />
        ) : bills.error ? (
          <div className="p-5"><Alert tone="error">{bills.error}</Alert></div>
        ) : sorted.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="No bills tracked yet" description="Add recurring bills so due dates show up on your dashboard." action={<Button variant="secondary" onClick={() => setEditing('new')}>Add bill</Button>} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {sorted.map((b) => {
              const daysUntil = (b.dueDay - today + 31) % 31;
              const acct = accounts.data.find((a) => a.id === b.accountId);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-50 text-brand-800">
                    <span className="text-[10px] uppercase">Day</span>
                    <span className="text-lg font-semibold leading-none">{b.dueDay}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{b.name}</p>
                    <p className="text-xs text-slate-500">
                      {BILL_CATEGORY_LABEL[b.category]}
                      {acct ? ` · linked to ${acct.creditorName}` : ''}
                      {b.minimumAmount != null ? ` · minimum ${money(b.minimumAmount)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">{money(b.currentAmount ?? b.recurringAmount)}</p>
                    <p className="text-xs text-slate-500">{b.status !== 'ACTIVE' ? b.status.toLowerCase() : daysUntil === 0 ? 'due today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`}</p>
                  </div>
                  {b.autopay ? <Badge tone="green">Autopay</Badge> : <Badge tone="amber">Manual pay</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>Edit</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing && clientId && <BillEditor bill={editing === 'new' ? null : editing} clientId={clientId} accounts={accounts.data} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BillEditor({ bill, clientId, accounts, onClose }: { bill: Bill | null; clientId: string; accounts: Account[]; onClose: () => void }) {
  const [form, setForm] = useState({
    name: bill?.name ?? '',
    category: bill?.category ?? 'CREDIT_CARD',
    dueDay: bill?.dueDay?.toString() ?? '1',
    recurringAmount: bill?.recurringAmount?.toString() ?? '',
    minimumAmount: bill?.minimumAmount?.toString() ?? '',
    currentAmount: bill?.currentAmount?.toString() ?? '',
    autopay: bill?.autopay ?? false,
    accountId: bill?.accountId ?? '',
    status: bill?.status ?? 'ACTIVE',
    notes: bill?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = billInputSchema.safeParse({
      name: form.name,
      category: form.category,
      dueDay: Number(form.dueDay),
      recurringAmount: num(form.recurringAmount),
      minimumAmount: num(form.minimumAmount),
      currentAmount: num(form.currentAmount),
      autopay: form.autopay,
      accountId: form.accountId || null,
      status: form.status,
      notes: form.notes || null,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path.join('.')] = i.message;
      setErrors(errs);
      return;
    }
    setBusy(true);
    try {
      if (bill) await updateBill(bill.id, parsed.data);
      else await addBill(clientId, parsed.data);
      toast.success(bill ? 'Bill updated.' : 'Bill added.');
      onClose();
    } catch {
      toast.error('Could not save the bill.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={bill ? 'Edit bill' : 'Add a bill'}
      footer={
        <>
          {bill && (
            <Button variant="ghost" type="button" onClick={() => setConfirmDelete(true)} className="mr-auto text-red-700">
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button form="bill-form" type="submit" loading={busy}>Save</Button>
        </>
      }
    >
      {confirmDelete ? (
        <div className="space-y-3">
          <p className="text-sm">Delete this bill? This cannot be undone.</p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={async () => { if (bill) await deleteBill(bill.id); toast.success('Bill deleted.'); onClose(); }}>Yes, delete</Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>No</Button>
          </div>
        </div>
      ) : (
        <form id="bill-form" onSubmit={onSubmit} className="space-y-4">
          <Input label="Name" required value={form.name} onChange={set('name')} error={errors.name} placeholder="e.g. TD Visa, Rent, Rogers" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Category" options={BILL_CATEGORIES.map((c) => ({ value: c, label: BILL_CATEGORY_LABEL[c] }))} value={form.category} onChange={set('category')} />
            <Input label="Due day of month" type="number" min={1} max={31} required value={form.dueDay} onChange={set('dueDay')} error={errors.dueDay} />
            <Input label="Usual amount" type="number" step="0.01" min={0} value={form.recurringAmount} onChange={set('recurringAmount')} error={errors.recurringAmount} />
            <Input label="Minimum payment" type="number" step="0.01" min={0} value={form.minimumAmount} onChange={set('minimumAmount')} error={errors.minimumAmount} />
            <Input label="Current amount owing" type="number" step="0.01" min={0} value={form.currentAmount} onChange={set('currentAmount')} error={errors.currentAmount} />
            <Select label="Linked account" placeholder="None" options={accounts.map((a) => ({ value: a.id, label: `${a.creditorName} ${a.maskedAccountNumber ?? ''}` }))} value={form.accountId} onChange={set('accountId')} />
            <Select label="Status" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'PAUSED', label: 'Paused' }, { value: 'CLOSED', label: 'Closed' }]} value={form.status} onChange={set('status')} />
          </div>
          <Checkbox label="Autopay is set up" description="Just a reminder for you — Valeur does not connect to your bank." checked={form.autopay} onChange={set('autopay')} />
          <Textarea label="Notes" value={form.notes} onChange={set('notes')} />
        </form>
      )}
    </Dialog>
  );
}
