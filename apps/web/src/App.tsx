import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui';
import LoginPage from './pages/Login';
import SignupPage from './pages/Signup';
import ForgotPasswordPage from './pages/ForgotPassword';
import OnboardingPage from './pages/Onboarding';
import DashboardPage from './pages/Dashboard';
import AccountsPage from './pages/Accounts';
import BillsPage from './pages/Bills';
import ReportsPage from './pages/Reports';
import ReportDetailPage from './pages/ReportDetail';
import ComparePage from './pages/Compare';
import DiagnosePage from './pages/Diagnose';
import PlanPage from './pages/Plan';
import LettersPage from './pages/Letters';
import DisputeDetailPage from './pages/DisputeDetail';
import CoachPage from './pages/Coach';
import SettingsPage from './pages/Settings';
import AdvisorPage from './pages/Advisor';
import AdminPage from './pages/Admin';

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading, profile, profileLoading } = useAuth();
  const location = useLocation();
  if (loading || (user && profileLoading)) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!profile && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return children;
}

function RequireRole({ roles, children }: { roles: string[]; children: JSX.Element }) {
  const { role } = useAuth();
  if (!roles.includes(role)) return <Navigate to="/" replace />;
  return children;
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
      <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:reportId" element={<ReportDetailPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="bills" element={<BillsPage />} />
        <Route path="diagnose" element={<DiagnosePage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="plan" element={<PlanPage />} />
        <Route path="letters" element={<LettersPage />} />
        <Route path="disputes/:disputeId" element={<DisputeDetailPage />} />
        <Route path="coach" element={<CoachPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="advisor" element={<RequireRole roles={['advisor', 'admin']}><AdvisorPage /></RequireRole>} />
        <Route path="admin" element={<RequireRole roles={['admin']}><AdminPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
