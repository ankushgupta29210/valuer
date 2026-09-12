import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authActions, isDemo } from '@/lib/auth';
import { Alert, Button, Input } from '@/components/ui';
import { AuthLayout, friendlyAuthError } from './AuthLayout';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authActions.signIn(email, password);
      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your Valeur workspace.">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
        <div className="flex justify-between text-sm">
          <Link to="/forgot-password">Forgot password?</Link>
          <Link to="/signup">Create an account</Link>
        </div>
      </form>
      {isDemo && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">Demo mode</p>
          <p className="mt-0.5 text-xs text-amber-800">Sample data only, stored in this browser. Jump straight in as:</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(['client', 'advisor', 'admin'] as const).map((k) => (
              <Button key={k} variant="outline" size="sm" type="button" onClick={() => { authActions.demoQuickLogin(k); navigate('/', { replace: true }); }} className="capitalize">
                {k}
              </Button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
