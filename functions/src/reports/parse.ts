// Report parsing pipeline (spec §5). Triggered by Storage upload; also
// runnable on demand via reparseReport.

import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
// pdf-parse's index.js runs a self-test when loaded outside CommonJS; import
// the library entry point directly to avoid it.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { runRules, type Bureau, type ReportStatus, LOW_CONFIDENCE_THRESHOLD } from '@valeur/shared';
import { db, storage, FieldValue, nowIso } from '../lib/admin.js';
import { callable, AppError } from '../lib/callable.js';
import { loadOwned } from '../lib/access.js';
import { logActivity } from '../lib/audit.js';
import { extractReport, type PageText } from './extract.js';

const REGION = 'northamerica-northeast1';
const MIN_CHARS_PER_PAGE = 40; // below this we assume an image-only PDF
const REVIEW_CONFIDENCE = 0.55;

interface ReportDoc {
  clientId: string;
  bureau: Bureau;
  storagePath: string;
  status: ReportStatus;
}

async function extractPages(buffer: Buffer): Promise<{ pages: PageText[]; pageCount: number }> {
  const pages: PageText[] = [];
  // pdf-parse calls pagerender per page; we capture each page's text so the
  // source page of every field can be preserved.
  const result = await pdfParse(buffer, {
    pagerender: async (pageData: { pageNumber: number; getTextContent: () => Promise<{ items: { str: string; transform: number[] }[] }> }) => {
      const content = await pageData.getTextContent();
      // Group by y position so lines survive PDF text ordering.
      let lastY: number | null = null;
      let text = '';
      for (const item of content.items) {
        const y = Math.round(item.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
        else if (text && !text.endsWith('\n')) text += ' ';
        text += item.str;
        lastY = y;
      }
      pages.push({ page: pageData.pageNumber, text });
      return text;
    },
  });
  pages.sort((a, b) => a.page - b.page);
  return { pages, pageCount: result.numpages };
}

export async function processReport(reportId: string, actorId: string, actorRole: 'client' | 'advisor' | 'admin' | 'system' = 'system'): Promise<void> {
  const ref = db.doc(`creditReports/${reportId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn('processReport: report not found', { reportId });
    return;
  }
  const report = snap.data() as ReportDoc;
  const role = actorRole === 'system' ? 'admin' : actorRole;

  await ref.update({ status: 'PARSING', errorMessage: null, updatedAt: FieldValue.serverTimestamp() });
  await logActivity({ clientId: report.clientId, actorId, actorRole: role, action: 'REPORT_PARSING_STARTED', entityType: 'creditReport', entityId: reportId });

  try {
    // TODO(production): malware scan hook before reading the file.
    const [buffer] = await storage.bucket().file(report.storagePath).download();
    const { pages, pageCount } = await extractPages(buffer);

    // Store page text in a subcollection so list queries never carry it.
    const pageBatch = db.batch();
    for (const p of pages) {
      pageBatch.set(ref.collection('pages').doc(String(p.page)), { page: p.page, text: p.text, charCount: p.text.length });
    }
    await pageBatch.commit();

    const totalChars = pages.reduce((s, p) => s + p.text.trim().length, 0);
    if (pageCount > 0 && totalChars / pageCount < MIN_CHARS_PER_PAGE) {
      await ref.update({
        status: 'OCR_REQUIRED',
        pageCount,
        accountCount: 0,
        parserConfidence: 0,
        errorMessage:
          'This PDF appears to be image-only, so its text could not be read. This does not mean the report has no accounts. Please request a text-based PDF from the bureau or add accounts manually.',
        updatedAt: FieldValue.serverTimestamp(),
      });
      await logActivity({ clientId: report.clientId, actorId, actorRole: role, action: 'REPORT_OCR_REQUIRED', entityType: 'creditReport', entityId: reportId, metadata: { pageCount } });
      return;
    }

    const extraction = extractReport(pages, report.bureau);

    // Replace previously extracted accounts and rule-generated issues for this
    // report so a re-parse is idempotent; manual corrections are preserved by
    // only touching accounts still in NEEDS_REVIEW state.
    const existingAccounts = await db.collection('accounts').where('reportId', '==', reportId).get();
    const existingIssues = await db.collection('creditIssues').where('reportId', '==', reportId).where('origin', '==', 'RULE').where('status', '==', 'OPEN').get();
    const batch = db.batch();
    for (const d of existingAccounts.docs) {
      if (d.get('reviewState') === 'NEEDS_REVIEW') batch.delete(d.ref);
    }
    for (const d of existingIssues.docs) batch.delete(d.ref);

    const accountRefs: { id: string; data: (typeof extraction.accounts)[number] }[] = [];
    for (const a of extraction.accounts) {
      const aref = db.collection('accounts').doc();
      const lowConf = Object.values(a.fieldConfidence).some((c) => c < LOW_CONFIDENCE_THRESHOLD);
      batch.set(aref, {
        clientId: report.clientId,
        reportId,
        bureau: report.bureau,
        source: 'EXTRACTED',
        ...a,
        reviewState: lowConf ? 'NEEDS_REVIEW' : 'NEEDS_REVIEW', // everything extracted starts as needing a human look
        isUnfamiliar: false,
        notes: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      accountRefs.push({ id: aref.id, data: a });
    }

    const issues = runRules(
      accountRefs.map(({ id, data }) => ({
        id,
        ...data,
        isUnfamiliar: false,
      })),
    );
    for (const issue of issues) {
      const iref = db.collection('creditIssues').doc();
      batch.set(iref, {
        clientId: report.clientId,
        reportId,
        accountId: issue.accountId,
        bureau: report.bureau,
        origin: 'RULE',
        ruleCode: issue.ruleCode,
        type: issue.ruleCode,
        severity: issue.severity,
        status: 'OPEN',
        summary: issue.summary,
        whyItMatters: issue.whyItMatters,
        evidenceNeeded: issue.evidenceNeeded,
        evidenceNotes: null,
        sourcePage: issue.sourcePage,
        sourceText: issue.sourceText,
        relatedAccountIds: issue.relatedAccountIds ?? [],
        confirmedAt: null,
        confirmedBy: null,
        resolvedAt: null,
        disputeId: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const needsReview = extraction.confidence < REVIEW_CONFIDENCE || extraction.score == null || extraction.accounts.length === 0;
    const status: ReportStatus = needsReview ? 'REVIEW_REQUIRED' : 'PARSED';
    const notes = [...extraction.notes];
    if (extraction.confidence < REVIEW_CONFIDENCE) {
      notes.push(`Extraction confidence is ${Math.round(extraction.confidence * 100)}%. Please check each account against the report pages.`);
    }

    batch.update(ref, {
      status,
      score: extraction.score,
      scoreSourcePage: extraction.scoreSourcePage,
      scoreSourceText: extraction.scoreSourceText,
      reportDate: extraction.reportDate,
      parserConfidence: extraction.confidence,
      pageCount,
      accountCount: extraction.accounts.length,
      issueCount: issues.length,
      reviewNotes: notes,
      errorMessage: needsReview ? notes.join(' ') : null,
      parsedAt: nowIso(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    await logActivity({
      clientId: report.clientId,
      actorId,
      actorRole: role,
      action: needsReview ? 'REPORT_REVIEW_REQUIRED' : 'REPORT_PARSED',
      entityType: 'creditReport',
      entityId: reportId,
      metadata: { accounts: extraction.accounts.length, issues: issues.length, confidence: extraction.confidence, score: extraction.score },
    });
    if (issues.length) {
      await logActivity({ clientId: report.clientId, actorId, actorRole: role, action: 'ISSUES_DETECTED', entityType: 'creditReport', entityId: reportId, metadata: { count: issues.length, codes: issues.map((i) => i.ruleCode) } });
    }
  } catch (err) {
    logger.error('processReport failed', { reportId, err });
    await ref.update({
      status: 'FAILED',
      errorMessage: 'Valeur could not process this file. Make sure it is the original PDF downloaded from the bureau and try again.',
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logActivity({ clientId: report.clientId, actorId, actorRole: role, action: 'REPORT_PARSE_FAILED', entityType: 'creditReport', entityId: reportId, metadata: { message: (err as Error).message } });
  }
}

// Storage trigger: credit-reports/{clientId}/{reportId}.pdf
export const parseCreditReport = onObjectFinalized({ region: REGION, memory: '1GiB', timeoutSeconds: 300 }, async (event) => {
  const path = event.data.name ?? '';
  const m = path.match(/^credit-reports\/([^/]+)\/([^/]+)\.pdf$/);
  if (!m) return;
  const [, clientId, reportId] = m;
  if (event.data.contentType !== 'application/pdf') {
    logger.warn('non-pdf upload ignored', { path, contentType: event.data.contentType });
    return;
  }
  // The client creates the report doc before uploading; wait briefly in case
  // the write is still landing.
  const ref = db.doc(`creditReports/${reportId}`);
  for (let i = 0; i < 5; i++) {
    const snap = await ref.get();
    if (snap.exists) {
      if (snap.get('clientId') !== clientId) {
        logger.error('report/client mismatch', { path, reportId });
        return;
      }
      await ref.update({ fileSize: Number(event.data.size ?? 0), updatedAt: FieldValue.serverTimestamp() });
      await logActivity({ clientId, actorId: clientId, actorRole: 'client', action: 'REPORT_UPLOADED', entityType: 'creditReport', entityId: reportId, metadata: { path, size: event.data.size } });
      await processReport(reportId, clientId, 'client');
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  logger.warn('report doc never appeared for upload', { path });
});

export const reparseReport = callable(z.object({ reportId: z.string().min(1) }), async ({ input, actor }) => {
  const report = await loadOwned<ReportDoc>(actor, 'creditReports', input.reportId, 'report');
  if (report.status === 'PARSING') throw new AppError('failed-precondition', 'This report is already being processed.');
  await processReport(report.id, actor.uid, actor.role);
  const after = await db.doc(`creditReports/${report.id}`).get();
  return { reportId: report.id, status: after.get('status') as ReportStatus };
});
