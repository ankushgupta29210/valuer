import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authActions } from '@/lib/auth';
import { Alert, Button, Input } from '@/components/ui';
import { AuthLayout, friendlyAuthError } from './AuthLayout';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authActions.resetPassword(email);
      setSent(true);
    } catch (err) {
      // Do not reveal whether the email exists.
      if ((err as { code?: string }).code === 'auth/user-not-found') setSent(true);
      else setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a link to choose a new password.">
      {sent ? (
        <Alert tone="success" title="Check your inbox">If an account exists for {email}, a reset link is on its way.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}
