import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { ArrowLeft, Download, Printer, RefreshCw } from 'lucide-react';
import { DELIVERY_METHODS, DISPUTE_APPROVAL_STATEMENT, DISPUTE_TRANSITIONS, DISPUTE_STATUS_LABEL, REQUESTED_ACTION_TEXT, type Account, type CreditIssue, type Dispute, type DisputeItem, type DisputeStatus, type Letter } from '@valeur/shared';
import { storage } from '@/lib/firebase';
import { useClientContext } from '@/lib/clientContext';
import { useCollection, useDoc } from '@/lib/data';
import { api, CallableError } from '@/lib/callables';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Input, LoadingBlock, Select, Textarea, toast } from '@/components/ui';
import { DisputeStatusBadge, BureauBadge } from '@/components/StatusBadge';
import { LetterBody, RecipientBox, downloadText, printText } from '@/components/LetterViewer';

export default function DisputeDetailPage() {
  const { disputeId } = useParams();
  const { isOwnCase } = useClientContext();
  const dispute = useDoc<Dispute>(disputeId ? `disputes/${disputeId}` : null);
  const letter = useDoc<Letter>(dispute.data?.letterId ? `letters/${dispute.data.letterId}` : null);
  const clientId = dispute.data?.clientId ?? '';
  const items = useCollection<DisputeItem>('disputeItems', [where('clientId', '==', clientId), where('disputeId', '==', disputeId ?? '')], [disputeId, clientId], !!disputeId && !!clientId);
  const issues = useCollection<CreditIssue>('creditIssues', [where('clientId', '==', clientId), where('disputeId', '==', disputeId ?? '')], [disputeId, clientId], !!disputeId && !!clientId);
  const accounts = useCollection<Account>('accounts', [where('clientId', '==', clientId)], [clientId], !!clientId);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState('ONLINE');
  const [tracking, setTracking] = useState('');
  const [nextStatus, setNextStatus] = useState<DisputeStatus | ''>('');
  const [summary, setSummary] = useState('');
  const [responseFile, setResponseFile] = useState<File | null>(null);

  if (dispute.loading) return <LoadingBlock rows={6} />;
  if (dispute.error || !dispute.data) return <Alert tone="error">{dispute.error ?? 'This dispute could not be found.'}</Alert>;
  const d = dispute.data;
  const l = letter.data;
  const transitions = (DISPUTE_TRANSITIONS[d.status] ?? []).filter((s) => s !== 'SENT' && s !== 'DRAFT');

  async function run<T>(fn: () => Promise<T>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof CallableError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function transition() {
    if (!nextStatus) return;
    let responseFilePath: string | undefined;
    if (nextStatus === 'RESPONSE_RECEIVED' && responseFile) {
      responseFilePath = `dispute-responses/${d.clientId}/${d.id}/${Date.now()}-${responseFile.name}`;
      await uploadBytes(storageRef(storage, responseFilePath), responseFile, { contentType: responseFile.type });
    }
    await run(() => api.updateDisputeStatus({ disputeId: d.id, status: nextStatus, responseSummary: summary || undefined, responseFilePath }), `Marked ${DISPUTE_STATUS_LABEL[nextStatus].toLowerCase()}.`);
    setNextStatus('');
    setSummary('');
    setResponseFile(null);
  }

  return (
    <div className="space-y-6">
      <Link to="/letters" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> All disputes</Link>
      <div className="flex flex-wrap items-center gap-2">
        <BureauBadge bureau={d.bureau} />
        <h1 className="text-xl">{d.subject}</h1>
        <DisputeStatusBadge status={d.status} />
      </div>

      <ol className="flex flex-wrap gap-2 text-xs">
        {(['DRAFT', 'READY', 'SENT', 'RESPONSE_RECEIVED', 'CLOSED'] as DisputeStatus[]).map((s, i) => {
          const order = ['DRAFT', 'READY', 'SENT', 'INVESTIGATING', 'RESPONSE_RECEIVED', 'ESCALATED', 'CLOSED'];
          const reached = order.indexOf(d.status) >= order.indexOf(s);
          return (
            <li key={s} className={`flex items-center gap-2 rounded-full px-3 py-1 ${reached ? 'bg-brand-700 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>
              <span className="font-semibold">{i + 1}</span> {DISPUTE_STATUS_LABEL[s]}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Items in this package" description="Only confirmed items from this bureau." />
            <ul className="divide-y divide-slate-100">
              {items.data.map((it, idx) => {
                const issue = issues.data.find((i) => i.id === it.issueId);
                const acct = accounts.data.find((a) => a.id === it.accountId);
                return (
                  <li key={it.id} className="px-5 py-3 text-sm">
                    <p className="font-medium text-slate-900">{idx + 1}. {acct?.creditorName ?? 'Account'} {acct?.maskedAccountNumber ?? ''}</p>
                    <p className="text-slate-700">{issue?.summary}</p>
                    <p className="text-xs text-slate-500">{REQUESTED_ACTION_TEXT[it.requestedAction]}{issue?.sourcePage ? ` · source page ${issue.sourcePage}` : ''}</p>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Letter draft"
              action={
                <div className="flex gap-1">
                  {l && <Button size="sm" variant="ghost" onClick={() => downloadText(`dispute-${d.bureau.toLowerCase()}-${d.id}.txt`, l.body)}><Download className="h-4 w-4" /></Button>}
                  {l && <Button size="sm" variant="ghost" onClick={() => printText(l.subject, l.body)}><Printer className="h-4 w-4" /></Button>}
                  {d.status === 'DRAFT' && <Button size="sm" variant="ghost" loading={busy} onClick={() => run(() => api.generateLetter({ type: 'DISPUTE', disputeId: d.id }), 'Letter regenerated.')}><RefreshCw className="h-4 w-4" /></Button>}
                </div>
              }
            />
            <CardBody className="space-y-4">
              {letter.loading ? <LoadingBlock /> : l ? (
                <>
                  <LetterBody body={l.body} />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Attachments checklist</p>
                    <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">{l.attachmentsChecklist.map((a) => <li key={a}>{a}</li>)}</ul>
                  </div>
                  <RecipientBox letter={l} />
                </>
              ) : (
                <Alert tone="warning">No letter has been generated yet.</Alert>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {d.status === 'DRAFT' && (
            <Card>
              <CardHeader title="Review and approve" description="Required before the package can be marked ready." />
              <CardBody className="space-y-3">
                {!isOwnCase && <Alert tone="info">Only the client can approve. Staff may prepare and correct the package.</Alert>}
                <Checkbox label={DISPUTE_APPROVAL_STATEMENT} checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} disabled={!isOwnCase} />
                <Button className="w-full" disabled={!reviewed || !isOwnCase || !l} loading={busy} onClick={() => run(() => api.approveDispute(d.id, DISPUTE_APPROVAL_STATEMENT), 'Approved. The package is ready for you to submit.')}>Approve package</Button>
              </CardBody>
            </Card>
          )}
          {d.status === 'READY' && (
            <Card>
              <CardHeader title="Submit it yourself, then record it" description={`Approved ${fmtDateTime(d.clientApprovedAt)}.`} />
              <CardBody className="space-y-3">
                <p className="text-sm text-slate-700">Download or print the letter, gather the attachments, and submit it through the channel shown in the recipient box. Valeur does not submit disputes automatically.</p>
                <Select label="How did you submit it?" options={DELIVERY_METHODS.map((m) => ({ value: m, label: m.charAt(0) + m.slice(1).toLowerCase() }))} value={method} onChange={(e) => setMethod(e.target.value)} disabled={!isOwnCase} />
                <Input label="Tracking or confirmation number (optional)" value={tracking} onChange={(e) => setTracking(e.target.value)} disabled={!isOwnCase} />
                <Button className="w-full" disabled={!isOwnCase} loading={busy} onClick={() => run(() => api.updateDisputeStatus({ disputeId: d.id, status: 'SENT', deliveryMethod: method as (typeof DELIVERY_METHODS)[number], trackingNumber: tracking || undefined }), 'Recorded as sent.')}>Mark as sent</Button>
                {isOwnCase && <Button className="w-full" variant="ghost" onClick={() => run(() => api.updateDisputeStatus({ disputeId: d.id, status: 'DRAFT' }), 'Back to draft.')}>Undo approval</Button>}
              </CardBody>
            </Card>
          )}
          {['SENT', 'INVESTIGATING', 'RESPONSE_RECEIVED', 'ESCALATED'].includes(d.status) && (
            <Card>
              <CardHeader title="Track the response" description={d.responseDueAt ? `Response expected by ${fmtDate(d.responseDueAt)}.` : undefined} />
              <CardBody className="space-y-3">
                <dl className="text-sm">
                  <dt className="text-xs text-slate-500">Sent</dt><dd>{fmtDate(d.sentAt)} via {d.deliveryMethod?.toLowerCase()}{d.trackingNumber ? ` · ${d.trackingNumber}` : ''}</dd>
                  {d.responseReceivedAt && <><dt className="mt-2 text-xs text-slate-500">Response received</dt><dd>{fmtDate(d.responseReceivedAt)}</dd></>}
                  {d.responseSummary && <><dt className="mt-2 text-xs text-slate-500">Outcome</dt><dd className="whitespace-pre-wrap">{d.responseSummary}</dd></>}
                </dl>
                {transitions.length > 0 && (
                  <>
                    <Select label="Update status" placeholder="Choose…" options={transitions.map((s) => ({ value: s, label: DISPUTE_STATUS_LABEL[s] }))} value={nextStatus} onChange={(e) => setNextStatus(e.target.value as DisputeStatus)} />
                    {(nextStatus === 'RESPONSE_RECEIVED' || nextStatus === 'ESCALATED' || nextStatus === 'CLOSED') && (
                      <Textarea label="What happened?" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summarize the bureau response or outcome." />
                    )}
                    {nextStatus === 'RESPONSE_RECEIVED' && (
                      <div className="space-y-1">
                        <label className="block text-sm font-medium text-slate-700">Upload the response (PDF or image)</label>
                        <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setResponseFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
                      </div>
                    )}
                    <Button className="w-full" disabled={!nextStatus} loading={busy} onClick={transition}>Save update</Button>
                  </>
                )}
              </CardBody>
            </Card>
          )}
          {d.status === 'CLOSED' && <Alert tone="success" title="Closed">{d.responseSummary ?? 'This dispute has been closed.'}</Alert>}
        </div>
      </div>
    </div>
  );
}
