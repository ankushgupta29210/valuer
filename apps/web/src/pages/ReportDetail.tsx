import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { where, orderBy } from '@/lib/query';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import type { Account, CreditIssue, CreditReport } from '@valeur/shared';
import { useDoc, useCollection } from '@/lib/data';
import { api, CallableError } from '@/lib/callables';
import { fmtDate, money, pct } from '@/lib/format';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, LoadingBlock, Stat, toast } from '@/components/ui';
import { ReportStatusBadge, BureauBadge, ReviewStateBadge, AccountStatusBadge } from '@/components/StatusBadge';
import { AccountEditor } from '@/components/AccountEditor';

interface Page { id: string; page: number; text: string }

export default function ReportDetailPage() {
  const { reportId } = useParams();
  const report = useDoc<CreditReport>(reportId ? `creditReports/${reportId}` : null);
  // Rules require clientId on every list query, so wait for the report doc.
  const clientId = report.data?.clientId ?? '';
  const accounts = useCollection<Account>('accounts', [where('clientId', '==', clientId), where('reportId', '==', reportId ?? ''), orderBy('createdAt', 'desc')], [reportId, clientId], !!reportId && !!clientId);
  const issues = useCollection<CreditIssue>('creditIssues', [where('clientId', '==', clientId), where('reportId', '==', reportId ?? '')], [reportId, clientId], !!reportId && !!clientId);
  const pages = useCollection<Page>(`creditReports/${reportId}/pages`, [orderBy('page')], [reportId], !!reportId);
  const [editing, setEditing] = useState<Account | null>(null);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  if (report.loading) return <LoadingBlock rows={6} />;
  if (report.error || !report.data) return <Alert tone="error">{report.error ?? 'This report could not be found.'}</Alert>;
  const r = report.data;
  const pageText = selectedPage != null ? pages.data.find((p) => p.page === selectedPage)?.text : null;

  async function download() {
    setDownloading(true);
    try {
      const { url } = await api.getSignedDownloadUrl(r.storagePath);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(err instanceof CallableError ? err.message : 'Could not open the file.');
    } finally {
      setDownloading(false);
    }
  }

  async function markReviewed(a: Account) {
    try {
      await api.markAccountReviewed(a.id);
    } catch (err) {
      toast.error(err instanceof CallableError ? err.message : 'Could not update.');
    }
  }

  return (
    <div className="space-y-6">
      <Link to="/reports" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> All reports
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BureauBadge bureau={r.bureau} />
            <h1 className="text-xl">{r.fileName}</h1>
            <ReportStatusBadge status={r.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">Every extracted value shows the page and text it came from. Correct anything that does not match the PDF.</p>
        </div>
        <Button variant="outline" onClick={download} loading={downloading}>
          <Download className="h-4 w-4" /> Open original PDF
        </Button>
      </div>

      {(r.status === 'REVIEW_REQUIRED' || r.status === 'OCR_REQUIRED' || r.status === 'FAILED') && (
        <Alert tone={r.status === 'FAILED' ? 'error' : 'warning'} title={r.status === 'OCR_REQUIRED' ? 'Text could not be read from this PDF' : r.status === 'FAILED' ? 'Processing failed' : 'Manual review needed'}>
          <ul className="list-disc pl-4">
            {(r.reviewNotes?.length ? r.reviewNotes : [r.errorMessage]).filter(Boolean).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          {r.status === 'OCR_REQUIRED' && (
            <p className="mt-1">
              An empty extraction does not mean the report has no accounts. <Link to="/accounts">Add accounts manually</Link> from the PDF.
            </p>
          )}
        </Alert>
      )}
      {(r.status === 'UPLOADED' || r.status === 'PARSING') && <Alert tone="info">Valeur is reading this report. This page updates automatically.</Alert>}

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Score" value={r.score ?? '—'} sub={r.scoreSourcePage ? `Page ${r.scoreSourcePage}` : 'Not found in text'} />
          <Stat label="Report date" value={fmtDate(r.reportDate)} />
          <Stat label="Accounts found" value={r.accountCount ?? 0} />
          <Stat label="Flagged items" value={r.issueCount ?? 0} />
          <Stat label="Extraction confidence" value={pct(r.parserConfidence)} sub={r.pageCount ? `${r.pageCount} pages` : undefined} />
        </CardBody>
        {r.scoreSourceText && (
          <CardBody className="border-t border-slate-100 text-xs text-slate-500">
            Score source text: <code className="rounded bg-slate-100 px-1">{r.scoreSourceText}</code>
          </CardBody>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Extracted accounts" description={`${accounts.data.filter((a) => a.reviewState === 'NEEDS_REVIEW').length} still need a look.`} />
          {accounts.loading ? (
            <LoadingBlock />
          ) : accounts.data.length === 0 ? (
            <EmptyState title="No accounts extracted" description="If the PDF lists accounts, add them manually on the Accounts page and keep this report as the source." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {accounts.data.map((a) => {
                const lowFields = Object.entries(a.fieldConfidence ?? {}).filter(([, c]) => c < 0.6).map(([f]) => f);
                const issueCount = issues.data.filter((i) => i.accountId === a.id).length;
                return (
                  <li key={a.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{a.creditorName}</p>
                        <p className="text-xs text-slate-500">
                          {a.maskedAccountNumber ?? 'No account number'} · {a.accountType.replace(/_/g, ' ').toLowerCase()}
                          {a.sourcePage ? (
                            <>
                              {' · '}
                              <button className="text-brand-700 underline" onClick={() => setSelectedPage(a.sourcePage!)}>
                                page {a.sourcePage}
                              </button>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <AccountStatusBadge status={a.status} />
                        <ReviewStateBadge state={a.reviewState} />
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-5">
                      <Field label="Balance" value={money(a.balance)} low={lowFields.includes('balance')} />
                      <Field label="Past due" value={money(a.pastDue)} low={lowFields.includes('pastDue')} />
                      <Field label="Limit" value={money(a.creditLimit)} low={lowFields.includes('creditLimit')} />
                      <Field label="Opened" value={fmtDate(a.openedDate)} low={lowFields.includes('openedDate')} />
                      <Field label="Last reported" value={fmtDate(a.lastReportedDate)} low={lowFields.includes('lastReportedDate')} />
                    </dl>
                    {a.sourceText && (
                      <details className="mt-2 text-xs text-slate-500">
                        <summary className="cursor-pointer">Source text</summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px]">{a.sourceText}</pre>
                      </details>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                        Correct details
                      </Button>
                      {a.reviewState === 'NEEDS_REVIEW' && (
                        <Button size="sm" variant="ghost" onClick={() => markReviewed(a)}>
                          Looks right
                        </Button>
                      )}
                      {issueCount > 0 && (
                        <Link to="/diagnose" className="self-center text-xs">
                          {issueCount} flagged item{issueCount === 1 ? '' : 's'} →
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:sticky lg:top-6 lg:self-start">
          <CardHeader title="Report pages" description="Text read from the PDF." />
          {pages.loading ? (
            <LoadingBlock />
          ) : pages.data.length === 0 ? (
            <EmptyState icon={<FileText className="h-5 w-5" />} title="No page text yet" />
          ) : (
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {pages.data.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPage(p.page)}
                    className={`rounded-md px-2 py-1 text-xs ${selectedPage === p.page ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                  >
                    {p.page}
                  </button>
                ))}
              </div>
              {pageText != null ? (
                <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">{pageText || '(no text on this page)'}</pre>
              ) : (
                <p className="text-xs text-slate-500">Choose a page to see its text.</p>
              )}
            </CardBody>
          )}
        </Card>
      </div>

      {editing && <AccountEditor account={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Field({ label, value, low }: { label: string; value: string; low: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={low ? 'text-amber-800' : 'text-slate-800'} title={low ? 'Low extraction confidence — please verify' : undefined}>
        {value}
        {low && ' ?'}
      </dd>
    </div>
  );
}
