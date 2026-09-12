import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Profile, Role } from '@valeur/shared';
import { auth, db } from './firebase';
import { isDemo, demoStore, nowIso } from './demo/store';
import { ensureDemoSeeded, DEMO_USERS } from './demo/seed';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

interface AuthState {
  user: AuthUser | null;
  role: Role;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  refreshClaims: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

// ---------- backend-neutral auth actions ----------
export const authActions = {
  async signIn(email: string, password: string): Promise<void> {
    if (isDemo) {
      ensureDemoSeeded();
      const user = demoStore.list<{ id: string; email: string }>('users').find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      if (!user || password.length < 1) throw Object.assign(new Error('bad credentials'), { code: 'auth/invalid-credential' });
      demoStore.setSessionUid(user.id);
      return;
    }
    await signInWithEmailAndPassword(auth, email.trim(), password);
  },
  async signUp(email: string, password: string, fullName: string): Promise<void> {
    if (isDemo) {
      ensureDemoSeeded();
      if (demoStore.list<{ email: string }>('users').some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
        throw Object.assign(new Error('exists'), { code: 'auth/email-already-in-use' });
      }
      const uid = demoStore.add('users', { email: email.trim(), fullName, role: 'client', disabled: false });
      demoStore.setSessionUid(uid);
      return;
    }
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(cred.user, { displayName: fullName });
    await cred.user.getIdToken(true);
  },
  async signOut(): Promise<void> {
    if (isDemo) {
      demoStore.setSessionUid(null);
      return;
    }
    await signOut(auth);
  },
  async resetPassword(email: string): Promise<void> {
    if (isDemo) return;
    await sendPasswordResetEmail(auth, email.trim());
  },
  /** Demo only: sign in as one of the sample users. */
  demoQuickLogin(kind: keyof typeof DEMO_USERS) {
    ensureDemoSeeded();
    demoStore.setSessionUid(DEMO_USERS[kind].uid);
  },
};

// ---------- provider ----------
export function AuthProvider({ children }: { children: ReactNode }) {
  return isDemo ? <DemoAuthProvider>{children}</DemoAuthProvider> : <FirebaseAuthProvider>{children}</FirebaseAuthProvider>;
}

function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('client');
  const [loading, setLoading] = useState(true);
  // Track which uid the loaded profile belongs to so a freshly signed-in
  // user is treated as "profile loading" until the snapshot for *their* uid
  // arrives (avoids a one-render bounce to /onboarding).
  const [profileState, setProfileState] = useState<{ uid: string | null; profile: Profile | null; loaded: boolean }>({ uid: null, profile: null, loaded: false });

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    const unsubToken = onIdTokenChanged(auth, async (u) => {
      if (!u) {
        setRole('client');
        return;
      }
      const token = await u.getIdTokenResult();
      setRole(((token.claims.role as Role | undefined) ?? 'client'));
    });
    return () => {
      unsubAuth();
      unsubToken();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setProfileState({ uid: null, profile: null, loaded: true });
      return;
    }
    const uid = user.uid;
    const unsub = onSnapshot(
      doc(db, 'profiles', uid),
      (snap) => setProfileState({ uid, profile: snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Profile, 'id'>) }) : null, loaded: true }),
      () => setProfileState({ uid, profile: null, loaded: true }),
    );
    return unsub;
  }, [user]);
  const profile = user && profileState.uid === user.uid ? profileState.profile : null;
  const profileLoading = !!user && !(profileState.uid === user.uid && profileState.loaded);

  const value = useMemo<AuthState>(
    () => ({
      user: user ? { uid: user.uid, email: user.email, displayName: user.displayName } : null,
      role,
      profile,
      loading,
      profileLoading,
      refreshClaims: async () => {
        if (!auth.currentUser) return;
        const token = await auth.currentUser.getIdTokenResult(true);
        setRole(((token.claims.role as Role | undefined) ?? 'client'));
      },
    }),
    [user, role, profile, loading, profileLoading],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function DemoAuthProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    ensureDemoSeeded();
    setTick((t) => t + 1);
    return demoStore.subscribe(() => setTick((t) => t + 1));
  }, []);

  const value = useMemo<AuthState>(() => {
    void tick;
    const uid = demoStore.getSessionUid();
    const u = uid ? demoStore.get<{ id: string; email: string; fullName: string | null; role: Role }>(`users/${uid}`) : null;
    const profile = uid ? demoStore.get<Profile>(`profiles/${uid}`) : null;
    return {
      user: u ? { uid: u.id, email: u.email, displayName: u.fullName } : null,
      role: u?.role ?? 'client',
      profile,
      loading: false,
      profileLoading: false,
      refreshClaims: async () => setTick((t) => t + 1),
    };
  }, [tick]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

export { isDemo, nowIso };
