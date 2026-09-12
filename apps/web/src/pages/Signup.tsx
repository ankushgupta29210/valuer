import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Alert, Button, Checkbox, Input } from '@/components/ui';
import { AuthLayout, friendlyAuthError } from './AuthLayout';

export default function SignupPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!consent) {
      setError('Please acknowledge how Valeur handles your information to continue.');
      return;
    }
    if (password.length < 8) {
      setError('Please choose a password with at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: fullName.trim() });
      // Custom claims are set by the beforeUserCreated hook; refresh so the
      // role is present on the first token.
      await cred.user.getIdToken(true);
      navigate('/onboarding', { replace: true, state: { fullName: fullName.trim(), consent: true } });
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your workspace" subtitle="A private place to understand your credit files and plan next steps.">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Full name" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" autoComplete="new-password" required hint="At least 8 characters." value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-medium text-slate-800">How Valeur handles your information</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Your reports and accounts are private to you and any advisor you are assigned to.</li>
            <li>Valeur never asks for online-banking or card passwords and never moves money.</li>
            <li>Account numbers are stored masked. You can export or delete your data at any time from Settings.</li>
            <li>Nothing is sent to a credit bureau or creditor unless you review and approve it yourself.</li>
          </ul>
        </div>
        <Checkbox label="I understand and agree to continue" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
        <p className="text-center text-sm">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
