// Shared account form: corrections to extracted accounts (via callable, so
// the change is audited) and manual accounts (direct write allowed by rules).

import { useState, type FormEvent } from 'react';
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, ACCOUNT_STATUS_LABEL, ACCOUNT_TYPE_LABEL, manualAccountSchema, accountCorrectionSchema, type Account, type Bureau } from '@valeur/shared';
import { api, CallableError } from '@/lib/callables';
import { addManualAccount, updateManualAccount } from '@/lib/data';
import { Alert, Button, Checkbox, Dialog, Input, Select, Textarea, toast } from '@/components/ui';

interface Props {
  account?: Account | null;
  clientId?: string;
  onClose: () => void;
}

const num = (v: string) => (v.trim() === '' ? null : Number(v));

export function AccountEditor({ account, clientId, onClose }: Props) {
  const isManual = !account || account.source === 'MANUAL';
  const [form, setForm] = useState({
    creditorName: account?.creditorName ?? '',
    maskedAccountNumber: account?.maskedAccountNumber ?? '',
    accountType: account?.accountType ?? 'CREDIT_CARD',
    status: account?.status ?? 'OPEN',
    balance: account?.balance?.toString() ?? '',
    pastDue: account?.pastDue?.toString() ?? '',
    creditLimit: account?.creditLimit?.toString() ?? '',
    openedDate: account?.openedDate ?? '',
    lastReportedDate: account?.lastReportedDate ?? '',
    bureau: (account?.bureau ?? '') as Bureau | '',
    isUnfamiliar: account?.isUnfamiliar ?? false,
    notes: account?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    const values = {
      creditorName: form.creditorName,
      maskedAccountNumber: form.maskedAccountNumber || null,
      accountType: form.accountType,
      status: form.status,
      balance: num(form.balance),
      pastDue: num(form.pastDue),
      creditLimit: num(form.creditLimit),
      openedDate: form.openedDate || null,
      lastReportedDate: form.lastReportedDate || null,
      isUnfamiliar: form.isUnfamiliar,
      notes: form.notes || null,
    };
    const parsed = isManual ? manualAccountSchema.safeParse({ ...values, bureau: form.bureau || null }) : accountCorrectionSchema.safeParse(values);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path.join('.')] = i.message;
      setErrors(errs);
      return;
    }
    setBusy(true);
    try {
      if (!account) {
        if (!clientId) throw new Error('no client');
        await addManualAccount(clientId, { ...parsed.data, isUnfamiliar: form.isUnfamiliar, paymentHistoryText: null });
        toast.success('Account added.');
      } else if (isManual) {
        await updateManualAccount(account.id, parsed.data as Partial<Account>);
        toast.success('Account updated.');
      } else {
        await api.updateAccount(account.id, parsed.data as Record<string, unknown>);
        toast.success('Correction saved and recorded.');
      }
      onClose();
    } catch (err) {
      if (err instanceof CallableError) {
        setErrors(err.fieldErrors());
        setError(err.message);
      } else setError('Could not save the account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={account ? (isManual ? 'Edit account' : 'Correct extracted details') : 'Add an account'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
          <Button form="account-form" type="submit" loading={busy}>Save</Button>
        </>
      }
    >
      <form id="account-form" onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {!isManual && <Alert tone="info">Corrections are saved as an audited update. The original extracted text stays attached for reference.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Creditor" required value={form.creditorName} onChange={set('creditorName')} error={errors.creditorName} />
          <Input label="Account number (masked)" placeholder="****1234" hint="Only the last four digits. Never enter a full number." value={form.maskedAccountNumber} onChange={set('maskedAccountNumber')} error={errors.maskedAccountNumber} />
          <Select label="Type" options={ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }))} value={form.accountType} onChange={set('accountType')} error={errors.accountType} />
          <Select label="Status" options={ACCOUNT_STATUSES.map((s) => ({ value: s, label: ACCOUNT_STATUS_LABEL[s] }))} value={form.status} onChange={set('status')} error={errors.status} />
          <Input label="Balance" type="number" step="0.01" min="0" value={form.balance} onChange={set('balance')} error={errors.balance} />
          <Input label="Past due" type="number" step="0.01" min="0" value={form.pastDue} onChange={set('pastDue')} error={errors.pastDue} />
          <Input label="Credit limit" type="number" step="0.01" min="0" value={form.creditLimit} onChange={set('creditLimit')} error={errors.creditLimit} />
          {isManual && (
            <Select label="Bureau source" placeholder="Not from a bureau" options={[{ value: 'EQUIFAX', label: 'Equifax' }, { value: 'TRANSUNION', label: 'TransUnion' }]} value={form.bureau} onChange={set('bureau')} hint="Set this if you are entering an account from a report Valeur could not read." />
          )}
          <Input label="Opened" type="date" value={form.openedDate} onChange={set('openedDate')} error={errors.openedDate} />
          <Input label="Last reported" type="date" value={form.lastReportedDate} onChange={set('lastReportedDate')} error={errors.lastReportedDate} />
        </div>
        <Checkbox label="I do not recognize this account" description="Valeur will flag it for review and suggest what evidence to gather." checked={form.isUnfamiliar} onChange={set('isUnfamiliar')} />
        <Textarea label="Notes" value={form.notes} onChange={set('notes')} error={errors.notes} />
      </form>
    </Dialog>
  );
}
