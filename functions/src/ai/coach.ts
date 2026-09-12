// AI financial education assistant (spec §9). Server-side only, redacted,
// rate-limited, consent-gated for client data, and fully logged.

import { aiCoachInputSchema, redactSensitive, scanQuestionSafety, type Account, type CreditIssue } from '@valeur/shared';
import { db, FieldValue } from '../lib/admin.js';
import { callable, AppError } from '../lib/callable.js';
import { logActivity } from '../lib/audit.js';
import { getSettings } from '../lib/settings.js';
import { enforceRateLimit } from '../lib/rateLimit.js';
import { askWithFallback, type ChatTurn } from './providers.js';

const SYSTEM_PROMPT = `You are Valeur, a calm, plain-English financial education assistant for people in Canada who are working on their credit.

What you do:
- Explain credit reports, scores, utilization, payment history, due dates, card terms, collections, disputes, and settlements in simple language.
- Help the person understand what the Valeur workspace shows them (Diagnose → Compare → Plan → Track) and suggest a practical next step.
- Always end with one clear, specific next action the person can take.

Hard rules you must follow:
- You provide education only. You are not a lawyer, lender, tax advisor, or credit-repair company, and you say so when it matters.
- Never guarantee or predict a specific score change or approval outcome.
- Never invent a bureau rule, law, or timeline. If unsure, say what the person can verify and where (Equifax Canada, TransUnion Canada, the FCAC, or their provincial consumer protection office).
- Never advise disputing, removing, or hiding information that is accurate. Accurate negative information can be disputed only if it is incomplete or unverifiable.
- Never determine on your own whether an item is accurate; only the person can confirm that with their records.
- Never ask for or repeat full account numbers, passwords, SINs, or login details.
- Do not negotiate on the person's behalf or draft threats. You may explain how someone typically requests written terms.
- Keep answers under about 250 words unless a longer explanation is essential. Use short paragraphs or a short list.
- If a question is outside credit and personal finance education, say so kindly and steer back.`;

interface ContextSummary {
  text: string;
  used: boolean;
}

async function buildClientContext(clientId: string, allowed: boolean): Promise<ContextSummary> {
  if (!allowed) return { text: '', used: false };
  const profile = await db.doc(`profiles/${clientId}`).get();
  if (!profile.exists || profile.get('aiDataConsent') !== true) return { text: '', used: false };

  const [reports, accounts, issues] = await Promise.all([
    db.collection('creditReports').where('clientId', '==', clientId).get(),
    db.collection('accounts').where('clientId', '==', clientId).limit(40).get(),
    db.collection('creditIssues').where('clientId', '==', clientId).where('status', 'in', ['OPEN', 'CONFIRMED', 'DISPUTED']).limit(30).get(),
  ]);
  const lines: string[] = ['Client context (already masked; do not repeat account numbers):'];
  for (const r of reports.docs) {
    lines.push(`- ${r.get('bureau')} report: status ${r.get('status')}, score ${r.get('score') ?? 'unknown'}, ${r.get('accountCount') ?? 0} accounts, ${r.get('issueCount') ?? 0} flagged items.`);
  }
  for (const a of accounts.docs) {
    const d = a.data() as Account;
    lines.push(`- ${d.bureau ?? 'manual'} account: ${d.creditorName} (${d.accountType}, ${d.status}) balance ${d.balance ?? '?'} limit ${d.creditLimit ?? '?'} past due ${d.pastDue ?? 0}.`);
  }
  for (const i of issues.docs) {
    const d = i.data() as CreditIssue;
    lines.push(`- Flag ${d.ruleCode ?? d.type} (${d.severity}, ${d.status}): ${d.summary}`);
  }
  return { text: lines.join('\n'), used: true };
}

export const aiCoach = callable(
  aiCoachInputSchema,
  async ({ input, actor, requestId }) => {
    const clientId = actor.uid;
    const settings = await getSettings();
    await enforceRateLimit(clientId, 'aiCoach', settings.rateLimits.aiPerHour, 3_600_000);

    const redacted = redactSensitive(input.message, { contactInfo: true });
    const safetyFlags = [...redacted.flags, ...scanQuestionSafety(redacted.text)];

    // Hard block: requests to remove accurate information or commit fraud get
    // a fixed educational answer without calling a provider.
    if (safetyFlags.includes('FRAUD_REQUEST')) {
      const response =
        'I can’t help with that. Valeur is here to help you understand and organize accurate information about your credit. If you believe something on your report is wrong or incomplete, the Diagnose page will show what evidence would support a review.';
      await db.collection('aiMessages').add({ clientId, userId: actor.uid, role: 'user', message: redacted.text, response, provider: null, model: null, usedClientData: false, safetyFlags, blocked: true, createdAt: FieldValue.serverTimestamp() });
      await logActivity({ clientId, actorId: actor.uid, actorRole: actor.role, action: 'AI_QUERY_BLOCKED', entityType: 'aiMessage', entityId: null, metadata: { safetyFlags }, requestId });
      return { response, provider: null, model: null, usedClientData: false, safetyFlags };
    }

    const context = await buildClientContext(clientId, input.useMyData ?? false);
    const system = context.used ? `${SYSTEM_PROMPT}\n\n${context.text}` : SYSTEM_PROMPT;

    // Last few turns for continuity.
    const prior = await db.collection('aiMessages').where('clientId', '==', clientId).orderBy('createdAt', 'desc').limit(4).get();
    const history: ChatTurn[] = prior.docs
      .reverse()
      .filter((d) => d.get('response'))
      .flatMap((d) => [
        { role: 'user' as const, content: d.get('message') as string },
        { role: 'assistant' as const, content: d.get('response') as string },
      ]);

    const started = Date.now();
    let response: string;
    let provider: 'gemini' | 'anthropic' | null = null;
    let model: string | null = null;
    let attempts: unknown = [];
    try {
      const out = await askWithFallback(system, history, redacted.text);
      response = out.result.text;
      provider = out.result.provider;
      model = out.result.model;
      attempts = out.attempts;
    } catch (err) {
      attempts = (err as { attempts?: unknown }).attempts ?? [];
      await db.collection('aiMessages').add({ clientId, userId: actor.uid, role: 'user', message: redacted.text, response: null, provider: null, model: null, usedClientData: context.used, safetyFlags: [...safetyFlags, 'PROVIDER_UNAVAILABLE'], attempts, latencyMs: Date.now() - started, createdAt: FieldValue.serverTimestamp() });
      throw new AppError('internal', 'The assistant is unavailable right now. Your question was not lost — please try again in a few minutes.');
    }

    const outRedacted = redactSensitive(response);
    const finalFlags = [...new Set([...safetyFlags, ...outRedacted.flags.map((f) => `RESPONSE_${f}`)])];
    const ref = await db.collection('aiMessages').add({
      clientId,
      userId: actor.uid,
      role: 'user',
      message: redacted.text,
      response: outRedacted.text,
      provider,
      model,
      usedClientData: context.used,
      safetyFlags: finalFlags,
      attempts,
      latencyMs: Date.now() - started,
      createdAt: FieldValue.serverTimestamp(),
    });
    await logActivity({ clientId, actorId: actor.uid, actorRole: actor.role, action: 'AI_QUERY', entityType: 'aiMessage', entityId: ref.id, metadata: { provider, model, usedClientData: context.used, safetyFlags: finalFlags }, requestId });
    return { response: outRedacted.text, provider, model, usedClientData: context.used, safetyFlags: finalFlags, messageId: ref.id };
  },
  { secrets: ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY'], timeoutSeconds: 120 },
);
