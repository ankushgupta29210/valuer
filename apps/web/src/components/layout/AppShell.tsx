import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CreditCard, Receipt, FileUp, GitCompare, Stethoscope, ClipboardList, Mail, MessageCircle, Settings, Users, Shield, Menu, X, LogOut,
} from 'lucide-react';
import { useAuth, authActions, isDemo } from '@/lib/auth';
import { seedDemoData } from '@/lib/demo/seed';
import { toast } from '@/components/ui';
import { cn } from '@/lib/format';
import { useClientContext } from '@/lib/clientContext';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  step?: string;
}

const clientNav: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/reports', label: 'Reports', icon: <FileUp className="h-4 w-4" />, step: 'Diagnose' },
  { to: '/accounts', label: 'Accounts', icon: <CreditCard className="h-4 w-4" /> },
  { to: '/bills', label: 'Bills', icon: <Receipt className="h-4 w-4" /> },
  { to: '/diagnose', label: 'Diagnose', icon: <Stethoscope className="h-4 w-4" /> },
  { to: '/compare', label: 'Compare', icon: <GitCompare className="h-4 w-4" />, step: 'Compare' },
  { to: '/plan', label: 'Plan', icon: <ClipboardList className="h-4 w-4" />, step: 'Plan' },
  { to: '/letters', label: 'Disputes & letters', icon: <Mail className="h-4 w-4" />, step: 'Track' },
  { to: '/coach', label: 'Ask Valeur', icon: <MessageCircle className="h-4 w-4" /> },
  { to: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

export function AppShell() {
  const { user, role, profile } = useAuth();
  const { clientId, clientName, clear } = useClientContext();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const viewingOther = clientId && clientId !== user?.uid;

  const nav: NavItem[] = [...clientNav];
  if (role === 'advisor' || role === 'admin') nav.push({ to: '/advisor', label: 'Advisor workspace', icon: <Users className="h-4 w-4" /> });
  if (role === 'admin') nav.push({ to: '/admin', label: 'Administration', icon: <Shield className="h-4 w-4" /> });

  const Sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <img src={`${import.meta.env.BASE_URL}valeur-mark.png`} alt="" className="h-9 w-9 rounded-md" />
        <div>
          <p className="text-sm font-semibold tracking-wide text-brand-900">VALEUR</p>
          <p className="text-[11px] text-slate-500">Understand. Resolve. Rebuild.</p>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {nav.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={n.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}
            >
              {n.icon}
              <span className="flex-1">{n.label}</span>
              {n.step && <span className="text-[10px] uppercase tracking-wide text-slate-400">{n.step}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-100 px-5 py-4">
        <p className="truncate text-sm font-medium text-slate-800">{profile?.fullName ?? user?.email}</p>
        <p className="text-xs capitalize text-slate-500">{role}</p>
        <button
          onClick={async () => {
            await authActions.signOut();
            navigate('/login');
          }}
          className="mt-2 flex items-center gap-2 text-xs text-slate-500 hover:text-slate-800"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">{Sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button className="absolute right-3 top-4 rounded-md p-1 text-slate-500" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {Sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {isDemo && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 px-4 py-1.5 text-xs text-slate-200 lg:px-8">
            <span>
              <strong className="text-white">Demo mode</strong> — sample data stored only in this browser. No Firebase, no real bureau data, nothing is sent anywhere.
            </span>
            <span className="flex items-center gap-2">
              <span className="text-slate-400">Switch user:</span>
              {(['client', 'advisor', 'admin'] as const).map((k) => (
                <button key={k} className={cn('rounded px-2 py-0.5 capitalize hover:bg-slate-700', role === k && 'bg-slate-700 text-white')} onClick={() => { authActions.demoQuickLogin(k); clear(); navigate('/'); }}>
                  {k}
                </button>
              ))}
              <button className="rounded px-2 py-0.5 text-amber-300 hover:bg-slate-700" onClick={() => { seedDemoData(); clear(); toast.success('Demo data reset.'); navigate('/'); }}>
                Reset data
              </button>
            </span>
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <img src={`${import.meta.env.BASE_URL}valeur-mark.png`} alt="" className="h-7 w-7" /><span className="text-sm font-semibold tracking-wide text-brand-900">VALEUR</span>
        </header>
        {viewingOther && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-900 lg:px-8">
            <span>
              Viewing case for <strong>{clientName ?? clientId}</strong>. The client remains in control of confirmations and approvals.
            </span>
            <button onClick={clear} className="font-medium underline">
              Back to my workspace
            </button>
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
