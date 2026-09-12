import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { limit } from 'firebase/firestore';
import { MessageCircle, Send } from 'lucide-react';
import type { AiMessage } from '@valeur/shared';
import { useAuth } from '@/lib/auth';
import { useClientContext } from '@/lib/clientContext';
import { useClientCollection } from '@/lib/data';
import { api, CallableError } from '@/lib/callables';
import { fmtDateTime } from '@/lib/format';
import { Alert, Button, Card, CardBody, Checkbox, EmptyState, PageHeader, Textarea } from '@/components/ui';

const SUGGESTIONS = [
  'What does credit utilization mean and how is it calculated?',
  'How long does a late payment usually stay on a Canadian credit report?',
  'What should I ask a collection agency for in writing before paying?',
  'What is the difference between Equifax and TransUnion?',
];

export default function CoachPage() {
  const { profile } = useAuth();
  const { clientId, isOwnCase } = useClientContext();
  const history = useClientCollection<AiMessage>('aiMessages', clientId, [limit(30)]);
  const [message, setMessage] = useState('');
  const [useMyData, setUseMyData] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const thread = [...history.data].reverse();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.length, pending]);

  async function send(e?: FormEvent, text?: string) {
    e?.preventDefault();
    const q = (text ?? message).trim();
    if (!q || pending) return;
    setPending(q);
    setMessage('');
    setError(null);
    try {
      await api.aiCoach(q, useMyData && !!profile?.aiDataConsent);
    } catch (err) {
      setError(err instanceof CallableError ? err.message : 'The assistant is unavailable right now.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      <PageHeader title="Ask Valeur" description="Plain-English answers about credit reports, utilization, due dates, card terms, and your Valeur workflow. Educational only — not legal, tax, lending, or guaranteed credit-repair advice." />
      {!isOwnCase && <Alert tone="info">The assistant is available to the client only. You can read their history here.</Alert>}

      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {history.loading ? null : thread.length === 0 && !pending ? (
            <EmptyState
              icon={<MessageCircle className="h-5 w-5" />}
              title="What would you like to understand better?"
              description="Try one of these to get started."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(undefined, s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50" disabled={!isOwnCase}>
                      {s}
                    </button>
                  ))}
                </div>
              }
            />
          ) : (
            <div className="space-y-4">
              {thread.map((m) => (
                <div key={m.id} className="space-y-2">
                  <Bubble side="user" text={m.message} meta={fmtDateTime(m.createdAt)} />
                  {m.response ? (
                    <Bubble side="assistant" text={m.response} meta={`${m.provider === 'anthropic' ? 'Claude' : 'Gemini'}${m.usedClientData ? ' · used your data' : ''}${m.safetyFlags?.length ? ` · ${m.safetyFlags.length} note${m.safetyFlags.length === 1 ? '' : 's'}` : ''}`} />
                  ) : (
                    <Bubble side="assistant" text="(No answer was recorded for this question.)" meta="" muted />
                  )}
                </div>
              ))}
              {pending && (
                <div className="space-y-2">
                  <Bubble side="user" text={pending} meta="just now" />
                  <div className="flex items-center gap-2 text-sm text-slate-500"><span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" /> Thinking…</div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        <CardBody className="border-t border-slate-100">
          {error && <Alert tone="error" className="mb-3">{error}</Alert>}
          <form onSubmit={send} className="space-y-2">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask a question…" rows={2} disabled={!isOwnCase || !!pending} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Checkbox
                label="Use my reports and accounts for context"
                description={profile?.aiDataConsent ? 'Masked summaries only.' : <>Turn this on in <Link to="/settings">Settings</Link> first.</>}
                checked={useMyData && !!profile?.aiDataConsent}
                disabled={!profile?.aiDataConsent || !isOwnCase}
                onChange={(e) => setUseMyData(e.target.checked)}
              />
              <Button type="submit" disabled={!message.trim() || !isOwnCase} loading={!!pending}><Send className="h-4 w-4" /> Send</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function Bubble({ side, text, meta, muted }: { side: 'user' | 'assistant'; text: string; meta: string; muted?: boolean }) {
  return (
    <div className={`flex ${side === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${side === 'user' ? 'bg-brand-700 text-white' : muted ? 'bg-slate-50 text-slate-500' : 'bg-slate-100 text-slate-800'}`}>
        <p className="whitespace-pre-wrap">{text}</p>
        {meta && <p className={`mt-1 text-[10px] ${side === 'user' ? 'text-brand-100' : 'text-slate-500'}`}>{meta}</p>}
      </div>
    </div>
  );
}
