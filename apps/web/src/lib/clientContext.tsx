// Which client's case is currently being viewed. For clients this is always
// their own uid. Advisors/admins can switch into an assigned client's case
// from the advisor workspace; every page then reads that clientId.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth';

interface ClientCtx {
  clientId: string | null;
  clientName: string | null;
  isOwnCase: boolean;
  select: (id: string, name: string | null) => void;
  clear: () => void;
}
const Ctx = createContext<ClientCtx | null>(null);

export function ClientContextProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selected, setSelected] = useState<{ id: string; name: string | null } | null>(() => {
    try {
      const raw = sessionStorage.getItem('valeur.case');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const value = useMemo<ClientCtx>(() => {
    const clientId = selected?.id ?? user?.uid ?? null;
    return {
      clientId,
      clientName: selected?.name ?? null,
      isOwnCase: !!user && clientId === user.uid,
      select: (id, name) => {
        setSelected({ id, name });
        sessionStorage.setItem('valeur.case', JSON.stringify({ id, name }));
      },
      clear: () => {
        setSelected(null);
        sessionStorage.removeItem('valeur.case');
      },
    };
  }, [selected, user]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientContext(): ClientCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClientContext must be used inside ClientContextProvider');
  return v;
}
