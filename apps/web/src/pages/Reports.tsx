import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Trash2, RefreshCw } from 'lucide-react';
import type { Bureau, CreditReport } from '@valeur/shared';
import { useClientContext } from '@/lib/clientContext';
import { deleteReport, uploadCreditReport, useClientCollection, useSettings } from '@/lib/data';
import { api, CallableError } from '@/lib/callables';
import { fmtDate, pct, relative } from '@/lib/format';
import { Alert, Button, Card, CardBody, CardHeader, Dialog, EmptyState, LoadingBlock, PageHeader, Select, toast } from '@/components/ui';
import { ReportStatusBadge, BureauBadge } from '@/components/StatusBadge';

export default function ReportsPage() {
  const { clientId, isOwnCase } = useClientContext();
  const settings = useSettings();
  const reports = useClientCollection<CreditReport>('creditReports', clientId);
  const [bureau, setBureau] = useState<Bureau | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CreditReport | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<() => void>(() => {});

  function chooseFile(f: File | null) {
    setError(null);
    if (!f) return setFile(null);
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose the PDF report downloaded from Equifax or TransUnion.');
      return;
    }
    if (f.size > settings.maxUploadBytes) {
      setError(`That file is larger than the ${Math.round(settings.maxUploadBytes / 1024 / 1024)} MB limit.`);
      return;
    }
    setFile(f);
  }

  async function upload() {
    if (!clientId || !bureau || !file) return;
    setProgress(0);
    setError(null);
    const { promise, cancel } = uploadCreditReport(clientId, bureau, file, setProgress);
    cancelRef.current = cancel;
    try {
      await promise;
      toast.success('Report uploaded. Valeur is reading it now.');
      setFile(null);
      setBureau('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setError(code.includes('canceled') ? 'Upload cancelled.' : code.includes('unauthorized') ? 'The file was rejected. Make sure it is a PDF under the size limit.' : 'The upload failed. Please try again.');
    } finally {
      setProgress(null);
    }
  }

  async function reparse(r: CreditReport) {
    setBusyId(r.id);
    try {
      await api.reparseReport(r.id);
      toast.success('Re-reading the report.');
    } catch (err) {
      toast.error(err instanceof CallableError ? err.message : 'Could not re-run the parser.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Credit reports" description="Upload the PDF you downloaded from each bureau. Valeur reads it on the server, keeps the original private, and shows you where every value came from." />

      {isOwnCase && (
        <Card>
          <CardHeader title="Upload a report" description="Equifax and TransUnion Canada consumer disclosure PDFs. Image-only scans will be flagged for manual entry." />
          <CardBody className="space-y-4">
            {error && <Alert tone="error">{error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <Select label="Bureau" required value={bureau} onChange={(e) => setBureau(e.target.value as Bureau | '')} placeholder="Choose a bureau" options={[{ value: 'EQUIFAX', label: 'Equifax' }, { value: 'TRANSUNION', label: 'TransUnion' }]} />
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">PDF file</label>
                <div
                  className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-4 py-6 text-center hover:border-brand-400"
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    chooseFile(e.dataTransfer.files[0] ?? null);
                  }}
                >
                  <FileUp className="h-6 w-6 text-brand-600" />
                  <p className="mt-2 text-sm text-slate-700">{file ? file.name : 'Drop a PDF here or click to choose'}</p>
                  <p className="text-xs text-slate-500">Up to {Math.round(settings.maxUploadBytes / 1024 / 1024)} MB · PDF only</p>
                  <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />
                </div>
              </div>
            </div>
            {progress != null && (
              <div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">Uploading… {progress}%</p>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={upload} disabled={!bureau || !file} loading={progress != null}>
                Upload and read report
              </Button>
              {progress != null && (
                <Button variant="ghost" onClick={() => cancelRef.current()}>
                  Cancel
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Your reports" />
        {reports.loading ? (
          <LoadingBlock />
        ) : reports.error ? (
          <CardBody><Alert tone="error">{reports.error}</Alert></CardBody>
        ) : reports.data.length === 0 ? (
          <EmptyState icon={<FileUp className="h-5 w-5" />} title="No reports yet" description="Upload your first bureau PDF above to start the diagnosis." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {reports.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <BureauBadge bureau={r.bureau} />
                    <Link to={`/reports/${r.id}`} className="truncate text-sm font-medium text-slate-900 hover:underline">
                      {r.fileName}
                    </Link>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Uploaded {relative(r.createdAt)}
                    {r.reportDate ? ` · dated ${fmtDate(r.reportDate)}` : ''}
                    {r.score != null ? ` · score ${r.score}` : ''}
                    {r.accountCount != null ? ` · ${r.accountCount} accounts` : ''}
                    {r.parserConfidence != null ? ` · confidence ${pct(r.parserConfidence)}` : ''}
                  </p>
                  {r.errorMessage && ['REVIEW_REQUIRED', 'OCR_REQUIRED', 'FAILED'].includes(r.status) && <p className="mt-1 text-xs text-amber-800">{r.errorMessage}</p>}
                </div>
                <ReportStatusBadge status={r.status} />
                <div className="flex gap-1">
                  {r.status !== 'PARSING' && r.status !== 'UPLOADED' && (
                    <Button variant="ghost" size="sm" onClick={() => reparse(r)} loading={busyId === r.id} title="Re-read report">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  )}
                  {isOwnCase && (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(r)} title="Delete report">
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete this report?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirmDelete) return;
                await deleteReport(confirmDelete.id);
                setConfirmDelete(null);
                toast.success('Report deleted.');
              }}
            >
              Delete report
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          The report record will be removed. Accounts and flagged items extracted from it stay in place so your history is not lost; you can delete those individually.
        </p>
      </Dialog>
    </div>
  );
}
