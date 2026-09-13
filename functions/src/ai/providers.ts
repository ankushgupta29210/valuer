// AI provider chain: several Gemini models first, then Anthropic Claude as a
// last resort. Each provider is tried in order until one returns a usable
// answer. Keys come from Secret Manager / env and never reach the client.

import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from 'firebase-functions/v2';
import type { AiProvider } from '@valeur/shared';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderResult {
  provider: AiProvider;
  model: string;
  text: string;
}

export interface ProviderAttempt {
  provider: AiProvider;
  model: string;
  error: string;
}

const DEFAULT_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash'];
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';
const MAX_OUTPUT_TOKENS = 1500;

function geminiModels(): string[] {
  const env = process.env.GEMINI_MODELS?.split(',').map((s) => s.trim()).filter(Boolean);
  return env && env.length ? env : DEFAULT_GEMINI_MODELS;
}

async function askGemini(model: string, system: string, history: ChatTurn[], question: string, signal: AbortSignal): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const ai = new GoogleGenAI({ apiKey });
  const contents = [
    ...history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
    { role: 'user', parts: [{ text: question }] },
  ];
  const res = await ai.models.generateContent({
    model,
    contents,
    config: { systemInstruction: system, maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4, abortSignal: signal },
  });
  const text = res.text?.trim();
  if (!text) throw new Error('empty response');
  return text;
}

async function askAnthropic(model: string, system: string, history: ChatTurn[], question: string, signal: AbortSignal): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
    { role: 'user', content: question },
  ];
  const res = await client.messages.create(
    {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
    },
    { signal },
  );
  if (res.stop_reason === 'refusal') throw new Error('provider refused');
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('empty response');
  return text;
}

export async function askWithFallback(system: string, history: ChatTurn[], question: string): Promise<{ result: ProviderResult; attempts: ProviderAttempt[] }> {
  const attempts: ProviderAttempt[] = [];
  const chain: { provider: AiProvider; model: string }[] = [
    ...geminiModels().map((model) => ({ provider: 'gemini' as const, model })),
    ...(process.env.ANTHROPIC_API_KEY ? [{ provider: 'anthropic' as const, model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL }] : []),
  ];
  if (chain.length === 0) throw new Error('No AI provider is configured.');

  for (const step of chain) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40_000);
    try {
      const text =
        step.provider === 'gemini'
          ? await askGemini(step.model, system, history, question, controller.signal)
          : await askAnthropic(step.model, system, history, question, controller.signal);
      return { result: { provider: step.provider, model: step.model, text }, attempts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ provider: step.provider, model: step.model, error: message.slice(0, 200) });
      logger.warn('ai provider failed, trying next', { provider: step.provider, model: step.model, message });
    } finally {
      clearTimeout(timer);
    }
  }
  const error = new Error('All AI providers failed.');
  (error as Error & { attempts: ProviderAttempt[] }).attempts = attempts;
  throw error;
}
