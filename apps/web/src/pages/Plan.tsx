import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ClipboardList, Handshake, Plus, Trash2 } from 'lucide-react';
import {
  CONTACT_METHODS, SETTLEMENT_STATUSES, SETTLEMENT_STATUS_LABEL, SETTLEMENT_STATUS_MEANING, SETTLEMENT_TRANSITIONS,
  type Account, type ActionPlan, type PlanStep, type Settlement, type SettlementStatus, type Letter,
} from '@valeur/shared';
import { useClientContext } from '@/lib/clientContext';
import { deletePlan, savePlan, useClientCollection } from '@/lib/data';
import { api, CallableError } from '@/lib/callables';
import { fmtDate, money, todayIso } from '@/lib/format';
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Dialog, EmptyState, Input, LoadingBlock, PageHeader, Select, Textarea, toast } from '@/components/ui';
import { SettlementStatusBadge, LetterStatusBadge } from '@/components/StatusBadge';

export default function PlanPage() {
  const { clientId, isOwnCase } = useClientContext();
  const plans = useClientCollection<ActionPlan>('actionPlans', clientId);
  const settlements = useClientCollection<Settlement>('settlements', clientId);
  const accounts = useClientCollection<Account>('accounts', clientId);
  const letters = useClientCollection<Letter>('letters', clientId);
  const [editingPlan, setEditingPlan] = useState<ActionPlan | 'new' | null>(null);
  const [editingSettlement, setEditingSettlement] = useState<Settlement | 'new' | null>(null);

  return (
    <div className="space-y-8">
      <PageHeader title="Plan" description="Turn what you learned into a practical, low-pressure plan. Track settlement requests and written terms here — Valeur records, it never negotiates or pays." />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2>Action plans</h2>
          <Button size="sm" onClick={() => setEditingPlan('new')}><Plus className="h-4 w-4" /> New plan</Button>
        </div>
        {plans.loading ? (
          <Card><LoadingBlock /></Card>
        ) : plans.data.filter((p) => !p.archived).length === 0 ? (
          <Card><EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No plan yet" description="Start with two or three concrete steps, like gathering a statement or setting up autopay." action={<Button variant="secondary" onClick={() => setEditingPlan('new')}>Create a plan</Button>} /></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {plans.data.filter((p) => !p.archived).map((p) => (
              <PlanCard key={p.id} plan={p} clientId={clientId!} onEdit={() => setEditingPlan(p)} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2>Settlement tracking</h2>
            <p className="text-sm text-slate-600">Record your own contact with a creditor, offers received, and written terms.</p>
          </div>
          <Button size="sm" onClick={() => setEditingSettlement('new')}><Plus className="h-4 w-4" /> New settlement record</Button>
        </div>
        {settlements.loading ? (
          <Card><LoadingBlock /></Card>
        ) : settlements.data.length === 0 ? (
          <Card><EmptyState icon={<Handshake className="h-5 w-5" />} title="No settlement records" description="Create one to organize a request for written terms with a creditor or collection agency." /></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {settlements.data.map((s) => {
              const letter = letters.data.find((l) => l.settlementId === s.id);
              return (
                <Card key={s.id}>
                  <CardBody className="space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{s.creditorName}</p>
                        <p className="text-xs text-slate-500">{SETTLEMENT_STATUS_MEANING[s.status]}</p>
                      </div>
                      <SettlementStatusBadge status={s.status} />
                    </div>
                    <dl className="grid grid-cols-3 gap-2 text-sm">
                      <div><dt className="text-xs text-slate-500">Owed</dt><dd>{money(s.amountOwed)}</dd></div>
                      <div><dt className="text-xs text-slate-500">Target</dt><dd>{money(s.targetAmount)}</dd></div>
                      <div><dt className="text-xs text-slate-500">Offered</dt><dd>{money(s.offeredAmount)}</dd></div>
                    </dl>
                    {s.status === 'ACCEPTED' && !s.writtenConfirmationReceived && <Alert tone="warning">Get written confirmation before paying.</Alert>}
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingSettlement(s)}>Update</Button>
                      {letter ? (
                        <Link to="/letters" className="flex items-center gap-1 text-xs">Request letter <LetterStatusBadge status={letter.status} /></Link>
                      ) : (
                        <SettlementLetterButton settlement={s} disabled={!isOwnCase && false} />
                      )}
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {editingPlan && clientId && <PlanEditor plan={editingPlan === 'new' ? null : editingPlan} clientId={clientId} onClose={() => setEditingPlan(null)} />}
      {editingSettlement && clientId && <SettlementEditor settlement={editingSettlement === 'new' ? null : editingSettlement} clientId={clientId} accounts={accounts.data} onClose={() => setEditingSettlement(null)} />}
    </div>
  );
}

// ---------- action plans ----------

function PlanCard({ plan, clientId, onEdit }: { plan: ActionPlan; clientId: string; onEdit: () => void }) {
  const done = plan.steps.filter((s) => s.status === 'DONE').length;
  async function toggle(step: PlanStep) {
    const next = step.status === 'DONE' ? 'TODO' : 'DONE';
    const steps = plan.steps.map((s) => (s.id === step.id ? { ...s, status: next, completedAt: next === 'DONE' ? new Date().toISOString() : null } : s));
    await savePlan(clientId, { title: plan.title, goal: plan.goal ?? null, steps: steps as PlanStep[], archived: false }, plan.id);
  }
  return (
    <Card>
      <CardHeader title={plan.title} description={plan.goal ?? undefined} action={<Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>} />
      <CardBody>
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-emerald-500" style={{ width: `${plan.steps.length ? (done / plan.steps.length) * 100 : 0}%` }} />
        </div>
        <ul className="space-y-2">
          {plan.steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-sm">
              <button onClick={() => toggle(s)} className="mt-0.5 text-slate-400 hover:text-emerald-600" aria-label={s.status === 'DONE' ? 'Mark not done' : 'Mark done'}>
                {s.status === 'DONE' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={s.status === 'DONE' ? 'text-slate-400 line-through' : 'text-slate-800'}>{s.title}</p>
                {s.detail && <p className="text-xs text-slate-500">{s.detail}</p>}
                {s.dueDate && <p className="text-xs text-slate-500">Due {fmtDate(s.dueDate)}</p>}
              </div>
            </li>
          ))}
          {plan.steps.length === 0 && <li className="text-sm text-slate-500">No steps yet.</li>}
        </ul>
      </CardBody>
    </Card>
  );
}

function PlanEditor({ plan, clientId, onClose }: { plan: ActionPlan | null; clientId: string; onClose: () => void }) {
  const [title, setTitle] = useState(plan?.title ?? '');
  const [goal, setGoal] = useState(plan?.goal ?? '');
  const [steps, setSteps] = useState<PlanStep[]>(plan?.steps ?? []);
  const [busy, setBusy] = useState(false);
  const addStep = () => setSteps((s) => [...s, { id: crypto.randomUUID(), title: '', detail: null, dueDate: null, status: 'TODO', linkedType: null, linkedId: null, completedAt: null }]);
  const update = (id: string, patch: Partial<PlanStep>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast.error('Give the plan a title.');
    setBusy(true);
    try {
      await savePlan(clientId, { title: title.trim(), goal: goal || null, steps: steps.filter((s) => s.title.trim()), archived: false }, plan?.id);
      toast.success('Plan saved.');
      onClose();
    } catch {
      toast.error('Could not save the plan.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={plan ? 'Edit plan' : 'New action plan'}
      size="lg"
      footer={
        <>
          {plan && <Button variant="ghost" className="mr-auto text-red-700" onClick={async () => { await deletePlan(plan.id); onClose(); }}><Trash2 className="h-4 w-4" /> Delete</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button form="plan-form" type="submit" loading={busy}>Save plan</Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={onSubmit} className="space-y-4">
        <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mortgage-ready in 12 months" />
        <Textarea label="Goal (optional)" value={goal} onChange={(e) => setGoal(e.target.value)} />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Steps</p>
            <Button size="sm" variant="outline" type="button" onClick={addStep}><Plus className="h-4 w-4" /> Add step</Button>
          </div>
          {steps.map((s, i) => (
            <div key={s.id} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_150px_auto]">
              <Input placeholder={`Step ${i + 1}`} value={s.title} onChange={(e) => update(s.id, { title: e.target.value })} />
              <Input type="date" value={s.dueDate ?? ''} onChange={(e) => update(s.id, { dueDate: e.target.value || null })} />
              <Button type="button" size="sm" variant="ghost" onClick={() => setSteps((x) => x.filter((y) => y.id !== s.id))} aria-label="Remove step"><Trash2 className="h-4 w-4" /></Button>
              <Input className="sm:col-span-3" placeholder="Detail (optional)" value={s.detail ?? ''} onChange={(e) => update(s.id, { detail: e.target.value || null })} />
            </div>
          ))}
        </div>
      </form>
    </Dialog>
  );
}

// ---------- settlements ----------

function SettlementLetterButton({ settlement, disabled }: { settlement: Settlement; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(settlement.recipientName ?? settlement.creditorName);
  const [address, setAddress] = useState(settlement.recipientAddress ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>Draft request for written terms</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Request for written terms" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => {
        setBusy(true);
        try {
          await api.generateLetter({ type: 'SETTLEMENT_REQUEST', settlementId: settlement.id, recipientName: name, recipientAddress: address });
          toast.success('Draft letter created. Review it under Disputes & letters.');
          setOpen(false);
        } catch (err) {
          toast.error(err instanceof CallableError ? err.message : 'Could not generate the letter.');
        } finally {
          setBusy(false);
        }
      }}>Generate draft</Button></>}>
        <p className="text-sm text-slate-600">Enter the recipient exactly as it appears on your latest statement or collection notice. The letter asks for written terms; it does not admit liability or negotiate.</p>
        <Input className="mt-3" label="Recipient name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea className="mt-3" label="Mailing address" required value={address} onChange={(e) => setAddress(e.target.value)} />
      </Dialog>
    </>
  );
}

const num = (v: string) => (v.trim() === '' ? null : Number(v));

function SettlementEditor({ settlement, clientId, accounts, onClose }: { settlement: Settlement | null; clientId: string; accounts: Account[]; onClose: () => void }) {
  const s = settlement;
  const [form, setForm] = useState({
    accountId: s?.accountId ?? '',
    creditorName: s?.creditorName ?? '',
    status: (s?.status ?? 'NOT_STARTED') as SettlementStatus,
    amountOwed: s?.amountOwed?.toString() ?? '',
    targetAmount: s?.targetAmount?.toString() ?? '',
    offeredAmount: s?.offeredAmount?.toString() ?? '',
    offerDate: s?.offerDate ?? '',
    offerSource: s?.offerSource ?? '',
    acceptedTerms: s?.acceptedTerms ?? '',
    acceptedDueDate: s?.acceptedDueDate ?? '',
    writtenConfirmationReceived: s?.writtenConfirmationReceived ?? false,
    satisfiesInFull: s?.satisfiesInFull ?? false,
    remainingBalanceWaived: s?.remainingBalanceWaived ?? false,
    reportingAfterPayment: s?.reportingAfterPayment ?? '',
    paidDate: s?.paidDate ?? '',
    paymentReference: s?.paymentReference ?? '',
    declineReason: s?.declineReason ?? '',
    notes: s?.notes ?? '',
    contactDate: todayIso(),
    contactMethod: 'PHONE',
    contactNotes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const statusOptions = (s ? [s.status, ...(SETTLEMENT_TRANSITIONS[s.status] ?? [])] : SETTLEMENT_STATUSES.filter((x) => x === 'NOT_STARTED')).map((x) => ({ value: x, label: SETTLEMENT_STATUS_LABEL[x] }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    const contactLog = [...(s?.contactLog ?? [])];
    if (form.contactNotes.trim()) contactLog.push({ date: form.contactDate, method: form.contactMethod as (typeof CONTACT_METHODS)[number], notes: form.contactNotes.trim() });
    const data = {
      accountId: form.accountId || null,
      creditorName: form.creditorName,
      status: form.status,
      amountOwed: num(form.amountOwed),
      targetAmount: num(form.targetAmount),
      offeredAmount: num(form.offeredAmount),
      offerDate: form.offerDate || null,
      offerSource: form.offerSource || null,
      acceptedTerms: form.acceptedTerms || null,
      acceptedDueDate: form.acceptedDueDate || null,
      writtenConfirmationReceived: form.writtenConfirmationReceived,
      satisfiesInFull: form.satisfiesInFull,
      remainingBalanceWaived: form.remainingBalanceWaived,
      reportingAfterPayment: form.reportingAfterPayment || null,
      paidDate: form.paidDate || null,
      paymentReference: form.paymentReference || null,
      declineReason: form.declineReason || null,
      notes: form.notes || null,
      contactLog,
    };
    setBusy(true);
    try {
      await api.upsertSettlement(data, s?.id, clientId);
      toast.success('Settlement record saved.');
      onClose();
    } catch (err) {
      if (err instanceof CallableError) {
        setErrors(err.fieldErrors());
        setError(err.message);
      } else setError('Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const st = form.status;
  return (
    <Dialog open onClose={onClose} title={s ? `Update — ${s.creditorName}` : 'New settlement record'} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button form="settlement-form" type="submit" loading={busy}>Save</Button></>}>
      <form id="settlement-form" onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Alert tone="info">Before paying anything, get written confirmation of the amount, whether it satisfies the account in full, any remaining balance waiver, and how the account will be reported afterward.</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Linked account" placeholder="None" options={accounts.map((a) => ({ value: a.id, label: `${a.creditorName} ${a.maskedAccountNumber ?? ''}` }))} value={form.accountId} onChange={(e) => { const a = accounts.find((x) => x.id === e.target.value); setForm((f) => ({ ...f, accountId: e.target.value, creditorName: f.creditorName || a?.creditorName || '', amountOwed: f.amountOwed || a?.balance?.toString() || '' })); }} />
          <Input label="Creditor or agency" required value={form.creditorName} onChange={set('creditorName')} error={errors.creditorName} />
          <Select label="Status" options={statusOptions} value={form.status} onChange={set('status')} error={errors.status} />
          <Input label="Amount owed" type="number" step="0.01" min={0} value={form.amountOwed} onChange={set('amountOwed')} error={errors.amountOwed} />
          <Input label="Target amount" type="number" step="0.01" min={0} value={form.targetAmount} onChange={set('targetAmount')} error={errors.targetAmount} hint="Cannot exceed the amount owed." />
        </div>

        {(st === 'CONTACTED' || st === 'OFFER_RECEIVED' || st === 'ACCEPTED') && (
          <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium">Add a contact entry</legend>
            {errors.contactLog && <p className="text-xs text-red-600">{errors.contactLog}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Date" type="date" value={form.contactDate} onChange={set('contactDate')} />
              <Select label="Method" options={CONTACT_METHODS.map((m) => ({ value: m, label: m.replace('_', ' ').toLowerCase() }))} value={form.contactMethod} onChange={set('contactMethod')} />
            </div>
            <Textarea label="Notes" value={form.contactNotes} onChange={set('contactNotes')} placeholder="Who you spoke with and what was said." />
            {(s?.contactLog?.length ?? 0) > 0 && (
              <ul className="text-xs text-slate-600">
                {s!.contactLog.map((c, i) => <li key={i}>{fmtDate(c.date)} · {c.method.toLowerCase()} — {c.notes}</li>)}
              </ul>
            )}
          </fieldset>
        )}

        {(st === 'OFFER_RECEIVED' || st === 'ACCEPTED' || st === 'PAID') && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Offered amount" type="number" step="0.01" min={0} value={form.offeredAmount} onChange={set('offeredAmount')} error={errors.offeredAmount} />
            <Input label="Offer date" type="date" value={form.offerDate} onChange={set('offerDate')} error={errors.offerDate} />
            <Input label="Source of offer" value={form.offerSource} onChange={set('offerSource')} error={errors.offerSource} placeholder="Written letter / phone call with…" />
          </div>
        )}

        {(st === 'ACCEPTED' || st === 'PAID') && (
          <div className="space-y-3">
            <Textarea label="Exact written terms" value={form.acceptedTerms} onChange={set('acceptedTerms')} error={errors.acceptedTerms} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Payment due date" type="date" value={form.acceptedDueDate} onChange={set('acceptedDueDate')} error={errors.acceptedDueDate} />
              <Input label="How the account will be reported after payment" value={form.reportingAfterPayment} onChange={set('reportingAfterPayment')} />
            </div>
            <Checkbox label="I have written confirmation of these terms" checked={form.writtenConfirmationReceived} onChange={set('writtenConfirmationReceived')} error={errors.writtenConfirmationReceived} />
            <Checkbox label="The payment satisfies the account in full" checked={form.satisfiesInFull} onChange={set('satisfiesInFull')} />
            <Checkbox label="Any remaining balance is waived in writing" checked={form.remainingBalanceWaived} onChange={set('remainingBalanceWaived')} />
          </div>
        )}

        {st === 'PAID' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Paid date" type="date" value={form.paidDate} onChange={set('paidDate')} error={errors.paidDate} />
            <Input label="Payment reference" value={form.paymentReference} onChange={set('paymentReference')} error={errors.paymentReference} />
          </div>
        )}

        {st === 'DECLINED' && <Textarea label="Reason or next step" value={form.declineReason} onChange={set('declineReason')} error={errors.declineReason} />}

        <Textarea label="Notes" value={form.notes} onChange={set('notes')} />
      </form>
    </Dialog>
  );
}
