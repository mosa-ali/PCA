/* eslint-disable react-refresh/only-export-components -- context module intentionally exports hooks alongside the provider */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getApiClients } from '../api/client';
import type { AuthenticatedSession } from '../api/interfaces';
import type { FamilyRole } from '../domain/roles';
import { getDevRole, setDevRole, subscribeDevState } from '../api/dev/devState';

interface AuthContextValue {
  session: AuthenticatedSession | null;
  loading: boolean;
  isFixtureBacked: boolean;
  /** Dev-only convenience to demo RBAC by switching the active role. */
  setDemoRole: (role: FamilyRole) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const clients = getApiClients();
  const [session, setSession] = useState<AuthenticatedSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    clients.serviceAuth.getSession().then((s) => {
      setSession(s);
      setLoading(false);
    });
  }, [clients]);

  useEffect(() => {
    refresh();
    return subscribeDevState(refresh);
  }, [refresh]);

  const setDemoRole = useCallback((role: FamilyRole) => {
    setDevRole(role);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, isFixtureBacked: clients.isFixtureBacked, setDemoRole }),
    [session, loading, clients.isFixtureBacked, setDemoRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useCurrentRole(): FamilyRole {
  const { session } = useAuth();
  return session?.role ?? getDevRole();
}
