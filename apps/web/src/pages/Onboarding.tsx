import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { profileSchema } from '@valeur/shared';
import { useAuth } from '@/lib/auth';
import { saveProfile } from '@/lib/data';
import { Alert, Button, Checkbox, Input, Select } from '@/components/ui';
import { AuthLayout } from './AuthLayout';

const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'].map((p) => ({ value: p, label: p }));

export default function OnboardingPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as { fullName?: string; consent?: boolean } | null) ?? {};
  const [form, setForm] = useState({
    fullName: profile?.fullName ?? state.fullName ?? user?.displayName ?? '',
    phone: '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
  });
  const [consent, setConsent] = useState(!!state.consent);
  const [aiConsent, setAiConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile) navigate('/', { replace: true });
  }, [profile, navigate]);
  if (profile) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    if (!consent) {
      setError('Please acknowledge how Valeur handles your information to continue.');
      return;
    }
    const parsed = profileSchema.safeParse({
      fullName: form.fullName,
      email: user.email,
      phone: form.phone || null,
      address: form.address || null,
      city: form.city || null,
      province: form.province || null,
      postalCode: form.postalCode || null,
      consentAt: new Date().toISOString(),
      aiDataConsent: aiConsent,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path.join('.')] = i.message;
      setErrors(errs);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveProfile(user.uid, user.email, parsed.data, true);
      navigate('/', { replace: true });
    } catch {
      setError('We could not save your profile. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthLayout title="Set up your profile" subtitle="Your mailing details are used only on letters you choose to generate. Everything else is optional.">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Full name" required value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
        <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} error={errors.phone} />
        <Input label="Street address" value={form.address} onChange={set('address')} error={errors.address} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Input label="City" value={form.city} onChange={set('city')} className="col-span-2 sm:col-span-1" />
          <Select label="Province" options={PROVINCES} placeholder="—" value={form.province} onChange={set('province')} error={errors.province} />
          <Input label="Postal code" value={form.postalCode} onChange={set('postalCode')} error={errors.postalCode} placeholder="A1A 1A1" />
        </div>
        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <Checkbox
            label="I understand how Valeur handles my information"
            description="Private workspace; no bank passwords; masked account numbers; nothing sent externally without my approval; export or delete anytime."
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <Checkbox
            label="Allow the Ask Valeur assistant to use my report and account data"
            description="Optional. Only masked summaries are shared with the AI provider, and you can change this in Settings."
            checked={aiConsent}
            onChange={(e) => setAiConsent(e.target.checked)}
          />
        </div>
        <Button type="submit" className="w-full" loading={busy}>
          Continue to my dashboard
        </Button>
      </form>
    </AuthLayout>
  );
}
