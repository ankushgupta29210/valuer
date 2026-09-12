import { Link } from 'react-router-dom';
import { where, limit } from '@/lib/query';
import { ArrowRight, FileUp, Stethoscope, GitCompare, ClipboardList, Mail } from 'lucide-react';
import type { ActivityLog, CreditIssue, CreditReport, Dispute, Settlement, ActionPlan, Bill } from '@valeur/shared';
import { useClientContext } from '@/lib/clientContext';
import { useClientCollection } from '@/lib/data';
import { fmtDate, fmtDateTime, relative, titleCase } from '@/lib/format';
import { Card, CardBody, CardHeader, Button, LoadingBlock, EmptyState, Alert } from '@/components/ui';
import { ReportStatusBadge, DisputeStatusBadge, SeverityBadge } from '@/components/StatusBadge';

export default function DashboardPage() {
  const { clientId, isOwnCase } = useClientContext();
  const reports = useClientCollection<CreditReport>('creditReports', clientId);
  const issues = useClientCollection<CreditIssue>('creditIssues', clientId);
  const disputes = useClientCollection<Dispute>('disputes', clientId);
  const settlements = useClientCollection<Settlement>('settlements', clientId);
  const plans = useClientCollection<ActionPlan>('actionPlans', clientId);
  const bills = useClientCollection<Bill>('bills', clientId, [where('status', '==', 'ACTIVE')], 'none');
  const activity = useClientCollection<ActivityLog>('activityLogs', clientId, [limit(8)]);

  const loading = reports.loading || issues.loading || disputes.loading;
  const latest = (bureau: 'EQUIFAX' | 'TRANSUNION') => reports.data.find((r) => r.bureau === bureau);
  const eq = latest('EQUIFAX');
  const tu = latest('TRANSUNION');
  const openIssues = issues.data.filter((i) => i.status === 'OPEN');
  const confirmed = issues.data.filter((i) => i.status === 'CONFIRMED');
  const activeDisputes = disputes.data.filter((d) => !['CLOSED'].includes(d.status));
  const activeSettlements = settlements.data.filter((s) => !['PAID', 'DECLINED'].includes(s.status));
  const reviewReports = reports.data.filter((r) => ['REVIEW_REQUIRED', 'OCR_REQUIRED', 'FAILED'].includes(r.status));
  const openSteps = plans.data.flatMap((p) => p.steps.filter((s) => s.status === 'TODO' || s.status === 'IN_PROGRESS').map((s) => ({ ...s, plan: p.title })));
  const today = new Date().getDate();
  const upcomingBills = bills.data.filter((b) => b.dueDay >= today && b.dueDay <= today + 7);

  // Next useful action, in plain English (spec §1.2).
  const nextStep = (() => {
    if (reports.data.length === 0) return { text: 'Upload your Equifax or TransUnion report to start the diagnosis.', to: '/reports', icon: <FileUp className="h-4 w-4" /> };
    if (reviewReports.length) return { text: `Review ${reviewReports.length === 1 ? 'a report' : `${reviewReports.length} reports`} that need your attention.`, to: '/reports', icon: <FileUp className="h-4 w-4" /> };
    if (openIssues.length) return { text: `Look at ${openIssues.length} flagged item${openIssues.length === 1 ? '' : 's'} and decide whether each deserves review.`, to: '/diagnose', icon: <Stethoscope className="h-4 w-4" /> };
    if (!eq || !tu) return { text: `Upload your ${eq ? 'TransUnion' : 'Equifax'} report to compare both bureaus.`, to: '/reports', icon: <GitCompare className="h-4 w-4" /> };
    if (confirmed.length) return { text: `${confirmed.length} confirmed item${confirmed.length === 1 ? ' is' : 's are'} ready to be added to a dispute package.`, to: '/letters', icon: <Mail className="h-4 w-4" /> };
    if (openSteps.length) return { text: `Next in your plan: ${openSteps[0].title}`, to: '/plan', icon: <ClipboardList className="h-4 w-4" /> };
    return { text: 'You are up to date. Add an action plan step or check your bills.', to: '/plan', icon: <ClipboardList className="h-4 w-4" /> };
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1>{isOwnCase ? 'Your credit workspace' : 'Client dashboard'}</h1>
        <p className="mt-1 text-sm text-slate-600">Diagnose → Compare → Plan → Track. Calm, practical steps — no promises, no surprises.</p>
      </div>

      <Card className="border-brand-200 bg-brand-50/60">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-white p-2 text-brand-700 shadow-sm">{nextStep.icon}</div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Next useful step</p>
              <p className="text-sm font-medium text-slate-900">{nextStep.text}</p>
            </div>
          </div>
          <Link to={nextStep.to}>
            <Button size="sm">
              Go <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {(['EQUIFAX', 'TRANSUNION'] as const).map((b) => {
          const r = b === 'EQUIFAX' ? eq : tu;
          return (
            <Card key={b}>
              <CardBody>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{b === 'EQUIFAX' ? 'Equifax' : 'TransUnion'}</p>
                    {reports.loading ? (
                      <div className="mt-2 h-8 w-20 animate-pulse rounded bg-slate-200" />
                    ) : r ? (
                      <p className="mt-1 text-3xl font-semibold text-slate-900">{r.score ?? <span className="text-base font-medium text-slate-500">Score not found</span>}</p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">No report uploaded yet</p>
                    )}
                  </div>
                  {r && <ReportStatusBadge status={r.status} />}
                </div>
                {r && (
                  <p className="mt-2 text-xs text-slate-500">
                    Uploaded {relative(r.createdAt)}{r.reportDate ? ` · report dated ${fmtDate(r.reportDate)}` : ''} · {r.accountCount ?? 0} accounts
                  </p>
                )}
                {!r && !reports.loading && (
                  <Link to="/reports" className="mt-2 inline-block text-sm">Upload {b === 'EQUIFAX' ? 'Equifax' : 'TransUnion'} report →</Link>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open review items" value={openIssues.length} to="/diagnose" loading={issues.loading} />
        <StatCard label="Active disputes" value={activeDisputes.length} to="/letters" loading={disputes.loading} />
        <StatCard label="Settlement plans" value={activeSettlements.length} to="/plan" loading={settlements.loading} />
        <StatCard label="Bills due in 7 days" value={upcomingBills.length} to="/bills" loading={bills.loading} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Flagged items" description="Patterns Valeur noticed. You decide what each one means." action={<Link to="/diagnose" className="text-sm">View all</Link>} />
          {issues.loading ? (
            <LoadingBlock />
          ) : openIssues.length === 0 ? (
            <EmptyState title="Nothing waiting for review" description={reports.data.length ? 'Upload a newer report any time to re-run the checks.' : 'Upload a report to run the diagnostic checks.'} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {openIssues.slice(0, 5).map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{i.summary}</p>
                    <p className="text-xs text-slate-500">{titleCase(i.ruleCode ?? i.type)}</p>
                  </div>
                  <SeverityBadge severity={i.severity} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Disputes" description="Packages you have prepared or sent." action={<Link to="/letters" className="text-sm">View all</Link>} />
          {disputes.loading ? (
            <LoadingBlock />
          ) : disputes.data.length === 0 ? (
            <EmptyState title="No disputes yet" description="Confirm an item on the Diagnose page, then build a bureau-specific package." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {disputes.data.slice(0, 5).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <Link to={`/disputes/${d.id}`} className="min-w-0 text-sm font-medium text-slate-900 hover:underline">
                    {d.bureau === 'EQUIFAX' ? 'Equifax' : 'TransUnion'} · {d.issueIds.length} item{d.issueIds.length === 1 ? '' : 's'}
                    {d.responseDueAt && d.status === 'SENT' && <span className="block text-xs font-normal text-slate-500">Response expected by {fmtDate(d.responseDueAt)}</span>}
                  </Link>
                  <DisputeStatusBadge status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Progress timeline" description="Recent activity on this case." />
        {activity.loading ? (
          <LoadingBlock />
        ) : activity.error ? (
          <CardBody><Alert tone="error">{activity.error}</Alert></CardBody>
        ) : activity.data.length === 0 ? (
          <EmptyState title="No activity yet" description="Actions like uploads, corrections, and approvals will appear here." />
        ) : (
          <ol className="divide-y divide-slate-100">
            {activity.data.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-900">{titleCase(a.action)}</p>
                  <p className="text-xs text-slate-500">{fmtDateTime(a.createdAt)} · {a.entityType}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      {loading && <p className="sr-only">Loading</p>}
    </div>
  );
}

function StatCard({ label, value, to, loading }: { label: string; value: number; to: string; loading: boolean }) {
  return (
    <Link to={to}>
      <Card className="transition-colors hover:border-brand-300">
        <CardBody>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          {loading ? <div className="mt-2 h-7 w-10 animate-pulse rounded bg-slate-200" /> : <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>}
        </CardBody>
      </Card>
    </Link>
  );
}
