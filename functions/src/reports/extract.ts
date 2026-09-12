// Text-based extraction for Equifax / TransUnion Canada consumer reports
// (spec §5). This is deliberately heuristic and conservative: every value we
// pull carries a per-field confidence plus the page and source text it came
// from, and anything uncertain is left for manual review rather than guessed.
//
// Layouts vary between report versions, so the extractor works on label
// patterns rather than fixed positions. Add new label variants to the tables
// below as real samples come in.

import type { AccountStatus, AccountType, Bureau } from '@valeur/shared';
import { maskAccountNumber } from '@valeur/shared';

export interface PageText {
  page: number;
  text: string;
}

export interface ExtractedAccount {
  creditorName: string;
  maskedAccountNumber: string | null;
  accountType: AccountType;
  status: AccountStatus;
  balance: number | null;
  pastDue: number | null;
  creditLimit: number | null;
  openedDate: string | null;
  lastReportedDate: string | null;
  paymentHistoryText: string | null;
  sourcePage: number;
  sourceText: string;
  fieldConfidence: Record<string, number>;
}

export interface ExtractionResult {
  score: number | null;
  scoreSourcePage: number | null;
  scoreSourceText: string | null;
  reportDate: string | null;
  accounts: ExtractedAccount[];
  confidence: number;
  notes: string[];
}

// ---------- label tables ----------

const LABELS = {
  accountNumber: /(?:account|acct\.?)\s*(?:number|no\.?|#)\s*[:\-]?\s*([A-Z0-9*xX#\-\s]{4,30})/i,
  balance: /(?:current\s+)?balance\s*(?:owed|amount)?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
  pastDue: /(?:past\s*due|amount\s+past\s+due|overdue)\s*(?:amount)?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
  creditLimit: /(?:credit\s+limit|high\s+credit|limit|original\s+amount|high\s+balance)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
  opened: /(?:date\s+opened|opened|open\s+date)\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}[-/]\d{2}(?:[-/]\d{2})?|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|[A-Za-z]{3,9}\s+\d{4})/i,
  reported: /(?:date\s+reported|last\s+reported|reported|date\s+of\s+last\s+activity|last\s+updated|as\s+of)\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}[-/]\d{2}(?:[-/]\d{2})?|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|[A-Za-z]{3,9}\s+\d{4})/i,
  status: /(?:account\s+)?status\s*[:\-]?\s*([A-Za-z0-9 ,\-/]{3,60})/i,
  type: /(?:account\s+type|type\s+of\s+account|type|loan\s+type)\s*[:\-]?\s*([A-Za-z ,\-/]{3,40})/i,
  paymentHistory: /(?:payment\s+history|payment\s+pattern|payment\s+status)\s*[:\-]?\s*([^\n]{3,200})/i,
};

const SCORE_PATTERNS = [
  /(?:equifax|transunion|credit|risk|ers\s*2\.0|beacon|fico)[^\n]{0,40}?score[^\n]{0,30}?\b([3-8]\d{2}|900)\b/i,
  /score\s*[:\-]?\s*\b([3-8]\d{2}|900)\b/i,
  /\b([3-8]\d{2}|900)\b\s*(?:out of|\/)\s*900/i,
];

const REPORT_DATE_PATTERNS = [
  /(?:report\s+date|date\s+of\s+report|report\s+generated|as\s+of|date\s+issued|printed\s+on)\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/i,
];

// Section headers that start the tradeline area of a report. Text before the
// first one is ignored for account extraction to avoid pulling scores or
// personal info in as "accounts".
const TRADELINE_SECTION_RE = /(?:credit\s+accounts?|trade\s*lines?|tradelines|accounts?\s+(?:information|summary|details)|credit\s+history|revolving\s+accounts|installment\s+accounts|open\s+accounts|closed\s+accounts|collections?)/i;

// Lines that are only a section heading (never a creditor name).
const SECTION_HEADER_LINE_RE = /^(?:credit\s+accounts?|trade\s*lines?|tradelines|accounts?\s+(?:information|summary|details)|credit\s+history|revolving\s+accounts|installment\s+accounts|open\s+accounts|closed\s+accounts|collections?|public\s+records|inquiries)\s*$/i;

// A tradeline block is expected to contain at least two of these signals.
const BLOCK_SIGNALS = [LABELS.accountNumber, LABELS.balance, LABELS.opened, LABELS.reported, LABELS.status, LABELS.creditLimit];

// Lines that are creditor names tend to be short, uppercase-heavy, and not a
// label line.
const LABEL_LINE_RE = /^(?:account|acct|balance|past\s*due|credit\s+limit|high\s+credit|date|opened|reported|status|type|payment|months?|terms?|limit|amount|responsibility|remarks?|comments?)\b/i;

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

// ---------- helpers ----------

export function parseMoney(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\./g, '');
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/](\d{2})(?:[-/](\d{2}))?$/))) return `${m[1]}-${m[2]}-${m[3] ?? '01'}`;
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/))) {
    // Canadian reports are inconsistent between DD/MM and MM/DD; prefer the
    // interpretation that yields a valid month.
    let a = Number(m[1]);
    let b = Number(m[2]);
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    if (a > 12 && b <= 12) [a, b] = [b, a];
    return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/))) {
    const mm = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[2].padStart(2, '0')}`;
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{4})$/))) {
    const mm = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mm) return `${m[2]}-${mm}-01`;
  }
  return null;
}

export function normalizeStatus(raw: string | null | undefined): { status: AccountStatus; confidence: number } {
  const s = (raw ?? '').toLowerCase();
  if (!s) return { status: 'UNKNOWN', confidence: 0 };
  if (/collection|recovery/.test(s)) return { status: 'COLLECTION', confidence: 0.9 };
  if (/charge[\s-]?off|charged[\s-]?off|write[\s-]?off|written[\s-]?off|bad debt/.test(s)) return { status: 'CHARGE_OFF', confidence: 0.9 };
  if (/past[\s-]?due|delinquent|overdue/.test(s)) return { status: 'PAST_DUE', confidence: 0.85 };
  if (/late|30|60|90|120/.test(s)) return { status: 'LATE', confidence: 0.75 };
  if (/paid as agreed|as agreed|good standing|current|too new/.test(s)) return { status: 'OPEN', confidence: 0.85 };
  if (/closed.*paid|paid.*closed|paid in full|settled|zero balance/.test(s)) return { status: 'PAID', confidence: 0.85 };
  if (/closed|inactive/.test(s)) return { status: 'CLOSED', confidence: 0.85 };
  if (/\bpaid\b/.test(s)) return { status: 'PAID', confidence: 0.8 };
  if (/\bopen\b|\bok\b|\bactive\b/.test(s)) return { status: 'OPEN', confidence: 0.85 };
  return { status: 'UNKNOWN', confidence: 0.3 };
}

export function normalizeType(raw: string | null | undefined, creditor: string): { type: AccountType; confidence: number } {
  const s = `${raw ?? ''} ${creditor}`.toLowerCase();
  if (/collection|agency|recovery/.test(s)) return { type: 'COLLECTION', confidence: 0.85 };
  if (/mortgage/.test(s)) return { type: 'MORTGAGE', confidence: 0.9 };
  if (/student|osap|canada student|nslsc/.test(s)) return { type: 'STUDENT_LOAN', confidence: 0.9 };
  if (/auto|vehicle|car loan|lease/.test(s)) return { type: 'AUTO_LOAN', confidence: 0.85 };
  if (/line of credit|loc\b|heloc|revolving line/.test(s)) return { type: 'LINE_OF_CREDIT', confidence: 0.85 };
  if (/credit card|revolving|visa|mastercard|amex|american express|card/.test(s)) return { type: 'CREDIT_CARD', confidence: 0.85 };
  if (/telecom|rogers|bell|telus|fido|koodo|freedom|videotron|wireless|mobility/.test(s)) return { type: 'TELECOM', confidence: 0.8 };
  if (/hydro|utility|utilities|gas|enbridge|energy|water/.test(s)) return { type: 'UTILITY', confidence: 0.75 };
  if (/instal|loan|financ/.test(s)) return { type: 'LOAN', confidence: 0.75 };
  return { type: 'OTHER', confidence: raw ? 0.4 : 0.2 };
}

function firstMatch(re: RegExp, text: string): string | null {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function guessCreditorName(block: string): { name: string; confidence: number } {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    if (LABEL_LINE_RE.test(line)) continue;
    if (SECTION_HEADER_LINE_RE.test(line)) continue;
    if (/^\$?[\d,.\s]+$/.test(line)) continue;
    if (line.length < 3 || line.length > 60) continue;
    const letters = line.replace(/[^A-Za-z]/g, '').length;
    if (letters < 3) continue;
    const upperRatio = line.replace(/[^A-Z]/g, '').length / Math.max(1, letters);
    return { name: line.replace(/\s{2,}/g, ' '), confidence: upperRatio > 0.6 ? 0.8 : 0.6 };
  }
  return { name: 'Unknown creditor', confidence: 0.1 };
}

// Split page text into candidate tradeline blocks. A block starts at a line
// that looks like a creditor heading and ends before the next such heading.
function splitBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  const isHeading = (l: string) =>
    l.trim().length >= 3 &&
    l.trim().length <= 60 &&
    !LABEL_LINE_RE.test(l.trim()) &&
    /[A-Za-z]{3}/.test(l) &&
    !/[:$]/.test(l) &&
    l.trim().replace(/[^A-Z]/g, '').length / Math.max(1, l.trim().replace(/[^A-Za-z]/g, '').length) > 0.6;

  for (const line of lines) {
    if (isHeading(line) && current.length > 0 && BLOCK_SIGNALS.filter((re) => re.test(current.join('\n'))).length >= 2) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks.filter((b) => BLOCK_SIGNALS.filter((re) => re.test(b)).length >= 2);
}

// ---------- main entry ----------

export function extractReport(pages: PageText[], bureau: Bureau): ExtractionResult {
  const notes: string[] = [];
  const fullText = pages.map((p) => p.text).join('\n');

  // Score
  let score: number | null = null;
  let scoreSourcePage: number | null = null;
  let scoreSourceText: string | null = null;
  outer: for (const p of pages) {
    for (const re of SCORE_PATTERNS) {
      const m = p.text.match(re);
      if (m) {
        score = Number(m[1]);
        scoreSourcePage = p.page;
        scoreSourceText = m[0].slice(0, 200);
        break outer;
      }
    }
  }
  if (score == null) notes.push(`No ${bureau === 'EQUIFAX' ? 'Equifax' : 'TransUnion'} score was found in the text. Enter it manually if it appears on the report.`);

  // Report date
  let reportDate: string | null = null;
  for (const re of REPORT_DATE_PATTERNS) {
    const m = fullText.match(re);
    if (m) {
      reportDate = parseDate(m[1]);
      if (reportDate) break;
    }
  }

  // Accounts
  const accounts: ExtractedAccount[] = [];
  for (const p of pages) {
    let text = p.text;
    const sectionIdx = text.search(TRADELINE_SECTION_RE);
    if (sectionIdx > 0 && p.page === 1) text = text.slice(sectionIdx);
    for (const block of splitBlocks(text)) {
      const creditor = guessCreditorName(block);
      const rawNumber = firstMatch(LABELS.accountNumber, block);
      const masked = rawNumber ? maskAccountNumber(rawNumber) : null;
      const balanceRaw = firstMatch(LABELS.balance, block);
      const pastDueRaw = firstMatch(LABELS.pastDue, block);
      const limitRaw = firstMatch(LABELS.creditLimit, block);
      const openedRaw = firstMatch(LABELS.opened, block);
      const reportedRaw = firstMatch(LABELS.reported, block);
      const statusRaw = firstMatch(LABELS.status, block);
      const typeRaw = firstMatch(LABELS.type, block);
      const history = firstMatch(LABELS.paymentHistory, block);

      const status = normalizeStatus(statusRaw ?? history);
      const type = normalizeType(typeRaw, creditor.name);
      const balance = parseMoney(balanceRaw);
      const openedDate = parseDate(openedRaw);
      const lastReportedDate = parseDate(reportedRaw);

      const fieldConfidence: Record<string, number> = {
        creditorName: creditor.confidence,
        maskedAccountNumber: masked ? 0.8 : 0,
        balance: balance != null ? 0.85 : 0,
        pastDue: pastDueRaw ? 0.8 : 0.7, // absence usually means $0
        creditLimit: limitRaw ? 0.8 : 0.6, // many account types have no limit
        openedDate: openedDate ? 0.8 : openedRaw ? 0.4 : 0,
        lastReportedDate: lastReportedDate ? 0.8 : reportedRaw ? 0.4 : 0,
        status: status.confidence,
        accountType: type.confidence,
      };

      accounts.push({
        creditorName: creditor.name,
        maskedAccountNumber: masked,
        accountType: type.type,
        status: status.status,
        balance,
        pastDue: parseMoney(pastDueRaw) ?? (balance != null ? 0 : null),
        creditLimit: parseMoney(limitRaw),
        openedDate,
        lastReportedDate,
        paymentHistoryText: history ? history.slice(0, 500) : null,
        sourcePage: p.page,
        sourceText: block.slice(0, 4000),
        fieldConfidence,
      });
    }
  }

  if (accounts.length === 0) {
    notes.push('No accounts could be read from the text. The report may use a layout Valeur does not recognize yet; add accounts manually or contact support with the report version.');
  }

  // Overall confidence: mean of the core fields across accounts, discounted
  // if the score is missing.
  const core = ['creditorName', 'balance', 'status', 'lastReportedDate'];
  const perAccount = accounts.map((a) => core.reduce((s, f) => s + (a.fieldConfidence[f] ?? 0), 0) / core.length);
  let confidence = perAccount.length ? perAccount.reduce((a, b) => a + b, 0) / perAccount.length : 0;
  if (score == null) confidence *= 0.8;
  confidence = Math.round(confidence * 100) / 100;

  return { score, scoreSourcePage, scoreSourceText, reportDate, accounts, confidence, notes };
}
