import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
export function money(n: number | null | undefined): string {
  return n == null ? '—' : cad.format(n);
}

export function fmtDate(v: unknown): string {
  if (!v) return '—';
  if (typeof v === 'string') {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const ts = v as { toDate?: () => Date };
  if (ts.toDate) return ts.toDate().toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  return '—';
}

export function fmtDateTime(v: unknown): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : (v as { toDate?: () => Date }).toDate?.();
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function relative(v: unknown): string {
  const d = typeof v === 'string' ? new Date(v) : (v as { toDate?: () => Date })?.toDate?.();
  if (!d) return '—';
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
