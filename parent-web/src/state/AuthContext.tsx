/* eslint-disable react-refresh/only-export-components -- context module intentionally exports hooks alongside the provider */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  // Guards against setting state from a getSession() resolution that lands
  // after this provider has unmounted (e.g. React 18 test teardown racing an
  // in-flight promise) -- avoids an unhandled "window is not defined" style
  // rejection/state-update-after-unmount without hiding a real error.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    clients.serviceAuth
      .getSession()
      .then((s) => {
        if (!mountedRef.current) return;
        setSession(s);
        setLoading(false);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        // Fail closed: a session check that REJECTS (network failure, backend
        // outage, an unexpected non-401 status -- see
        // RealServiceAuthClient.getSession()'s own throws) must never be
        // treated differently from an explicit "not authenticated" (401 ->
        // null) response by omission. Before this handler existed, a
        // rejection here left `loading` stuck at `true` forever (nothing
        // ever called setLoading(false)), so AppLayout's `if (loading) return
        // null` rendered a permanently blank, unrecoverable page instead of
        // its normal `session === null` redirect to /login -- plus an
        // unhandled promise rejection in the console. Setting session to
        // null and clearing loading routes this through the exact same,
        // already-tested AppLayout gate as a real 401.
        setSession(null);
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
