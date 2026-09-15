import type { ReactNode } from 'react';
import { useHeroParallax } from '@/lib/useHeroParallax';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const scene = useHeroParallax<HTMLDivElement>();

  return (
    <div ref={scene} className="hero-scene relative flex min-h-screen flex-col overflow-hidden bg-slate-50">
      <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="hero-beam pointer-events-none absolute inset-0" aria-hidden />

      <div className="hero-copy relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative flex h-64 w-64 items-center justify-center">
            <span className="hero-halo pointer-events-none absolute inset-0 m-auto h-48 w-48 border-brand-200" aria-hidden />
            <span className="hero-halo-reverse pointer-events-none absolute inset-0 m-auto h-64 w-64 border-accent-500/30" aria-hidden />
            <img
              src={`${import.meta.env.BASE_URL}valeur-logo.png`}
              alt="Valeur — Understand. Resolve. Rebuild."
              className="hero-logo relative w-56 max-w-full"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">Clearer credit decisions, one manageable step at a time.</p>
        </div>
        <div className="hero-card-near panel p-6 sm:p-8">
          <h1 className="text-xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          Valeur provides independent, plain-English education and decision support. It is not a promise of score increases, debt relief, or removal of accurate information.
        </p>
      </div>
    </div>
  );
}

export function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password combination was not recognized.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Please choose a longer password (at least 8 characters).';
    case 'auth/invalid-email':
      return 'That email address does not look right.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'We could not reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
