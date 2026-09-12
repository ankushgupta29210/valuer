// Redaction helpers used before anything is sent to an AI provider or written
// to a log (spec §9, §11).

const FULL_NUMBER_RE = /\b\d(?:[ -]?\d){11,18}\b/g; // card / account numbers
const SIN_RE = /\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g; // Canadian SIN
const TOKEN_RE = /\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,})\b/g;
const PASSWORD_LINE_RE = /(password|passcode|pin)\s*[:=]\s*\S+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /\b(?:\+?1[ -.]?)?\(?\d{3}\)?[ -.]?\d{3}[ -.]?\d{4}\b/g;

export interface RedactionResult {
  text: string;
  flags: string[];
}

export function redactSensitive(input: string, opts: { contactInfo?: boolean } = {}): RedactionResult {
  const flags = new Set<string>();
  let text = input;

  text = text.replace(TOKEN_RE, () => {
    flags.add('TOKEN_REDACTED');
    return '[redacted-token]';
  });
  text = text.replace(PASSWORD_LINE_RE, (_, k: string) => {
    flags.add('PASSWORD_REDACTED');
    return `${k}: [redacted]`;
  });
  text = text.replace(FULL_NUMBER_RE, (m) => {
    flags.add('ACCOUNT_NUMBER_REDACTED');
    const digits = m.replace(/\D/g, '');
    return `****${digits.slice(-4)}`;
  });
  text = text.replace(SIN_RE, () => {
    flags.add('SIN_REDACTED');
    return '[redacted-sin]';
  });
  if (opts.contactInfo) {
    text = text.replace(EMAIL_RE, () => {
      flags.add('EMAIL_REDACTED');
      return '[email]';
    });
    text = text.replace(PHONE_RE, () => {
      flags.add('PHONE_REDACTED');
      return '[phone]';
    });
  }
  return { text, flags: [...flags] };
}

/** Mask everything except the last four digits. */
export function maskAccountNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return raw.replace(/[0-9]/g, '*');
  return `****${digits.slice(-4)}`;
}

// Prompt-content safety: questions Valeur must not answer as if it were a
// lender, lawyer, or credit-repair company.
const BLOCKED_PATTERNS: { re: RegExp; flag: string }[] = [
  { re: /\b(remove|delete|erase)\b.*\b(accurate|true|real|legit)\b/i, flag: 'REQUEST_TO_REMOVE_ACCURATE_INFO' },
  { re: /\bguarantee\b.*\b(score|approval)\b/i, flag: 'GUARANTEE_REQUEST' },
  { re: /\b(fake|forge|falsify)\b/i, flag: 'FRAUD_REQUEST' },
];

export function scanQuestionSafety(question: string): string[] {
  return BLOCKED_PATTERNS.filter((p) => p.re.test(question)).map((p) => p.flag);
}
