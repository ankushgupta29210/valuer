import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { DELIVERY_METHODS, type Letter } from '@valeur/shared';
import { api, CallableError } from '@/lib/callables';
import { useClientContext } from '@/lib/clientContext';
import { fmtDate } from '@/lib/format';
import { Alert, Button, Checkbox, Dialog, Input, Select, toast } from '@/components/ui';
import { LetterStatusBadge } from './StatusBadge';

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function printText(title: string, text: string) {
  const w = window.open('', '_blank', 'noopener,width=800,height=900');
  if (!w) return;
  w.document.write(`<title>${title}</title><pre style="font: 12pt/1.5 Georgia, serif; white-space: pre-wrap; padding: 2cm;">${text.replace(/</g, '&lt;')}</pre>`);
  w.document.close();
  w.focus();
  w.print();
}

/** Standalone viewer for settlement-request letters (dispute letters live on the dispute page). */
export function LetterViewer({ letter, onClose }: { letter: Letter; onClose: () => void }) {
  const { isOwnCase } = useClientContext();
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState('MAIL');
  const [tracking, setTracking] = useState('');

  async function approve() {
    setBusy(true);
    try {
      await api.approveLetter(letter.id);
      toast.success('Letter approved and ready to send.');
    } catch (err) {
      toast.error(err instanceof CallableError ? err.message : 'Could not approve.');
    } finally {
      setBusy(false);
    }
  }
  async function markSent() {
    setBusy(true);
    try {
      await api.markLetterSent(letter.id, method as (typeof DELIVERY_METHODS)[number], tracking || undefined);
      toast.success('Recorded as sent.');
      onClose();
    } catch (err) {
      toast.error(err instanceof CallableError ? err.message : 'Could not record.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={<span className="flex items-center gap-2">{letter.subject} <LetterStatusBadge status={letter.status} /></span>} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => downloadText(`${letter.type.toLowerCase()}-${letter.id}.txt`, letter.body)}><Download className="h-4 w-4" /> Download</Button>
          <Button size="sm" variant="outline" onClick={() => printText(letter.subject, letter.body)}><Printer className="h-4 w-4" /> Print</Button>
        </div>
        <LetterBody body={letter.body} />
        <RecipientBox letter={letter} />
        {isOwnCase && letter.status === 'DRAFT' && (
          <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/50 p-4">
            <Checkbox label="I reviewed this letter and the information in it is accurate to the best of my knowledge." checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            <Button onClick={approve} disabled={!reviewed} loading={busy}>Approve — mark ready to send</Button>
          </div>
        )}
        {isOwnCase && letter.status === 'READY' && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-4">
            <p className="text-sm font-medium">After you send it yourself, record it here</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="How did you send it?" options={DELIVERY_METHODS.map((m) => ({ value: m, label: m.charAt(0) + m.slice(1).toLowerCase() }))} value={method} onChange={(e) => setMethod(e.target.value)} />
              <Input label="Tracking number (optional)" value={tracking} onChange={(e) => setTracking(e.target.value)} />
            </div>
            <Button onClick={markSent} loading={busy}>Mark as sent</Button>
          </div>
        )}
        {letter.status === 'SENT' && <Alert tone="success">Sent {fmtDate(letter.sentAt)} via {letter.deliveryMethod?.toLowerCase()}{letter.trackingNumber ? ` · tracking ${letter.trackingNumber}` : ''}. Keep proof of delivery and the response.</Alert>}
      </div>
    </Dialog>
  );
}

export function LetterBody({ body }: { body: string }) {
  return <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-5 font-serif text-sm leading-relaxed text-slate-800">{body}</pre>;
}

export function RecipientBox({ letter }: { letter: Pick<Letter, 'recipientName' | 'recipientAddress' | 'recipientUrl' | 'recipientVerifiedAt'> }) {
  return (
    <div className={`rounded-lg border p-4 text-sm ${letter.recipientVerifiedAt ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Where this goes</p>
      <p className="mt-1 font-medium text-slate-900">{letter.recipientName}</p>
      {letter.recipientAddress && <p className="whitespace-pre-line text-slate-700">{letter.recipientAddress}</p>}
      {letter.recipientUrl && <a href={letter.recipientUrl} target="_blank" rel="noreferrer" className="block break-all">{letter.recipientUrl}</a>}
      <p className="mt-1 text-xs text-slate-600">
        {letter.recipientVerifiedAt ? `Recipient details last verified ${fmtDate(letter.recipientVerifiedAt)}.` : 'Recipient details have not been verified yet. Confirm the current address or online channel before sending.'} Keep proof of delivery and any response.
      </p>
    </div>
  );
}
