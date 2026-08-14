/* eslint-disable react-refresh/only-export-components -- context module intentionally exports hooks alongside the provider */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { platformAdminAuthClient, PlatformAdminApiError } from '../api/platformAdminAuthClient';
import type { PlatformAdminRole } from '../domain/roles';
import { isKnownRole } from '../domain/roles';
import { secureSession } from '../security/secureSession';

export type LoginStage = 'CREDENTIALS' | 'DONE';
export type SignOutReason = 'EXPIRED' | 'REVOKED' | null;

interface AuthState {
  status: 'SIGNED_OUT' | 'SIGNED_IN';
  adminId: string | null;
  roles: PlatformAdminRole[];
  sessionExpiresAt: string | null;
  signOutReason: SignOutReason;
}

interface AuthContextValue extends AuthState {
  /** Single-step login: the backend requires email+password+totpCode together (no separate challenge round-trip) -- see platformAdminAuthRoutes.ts. */
  login: (email: string, password: string, totpCode: string) => Promise<void>;
  logout: () => Promise<void>;
  revokeAllSessions: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const initialState: AuthState = { status: 'SIGNED_OUT', adminId: null, roles: [], sessionExpiresAt: null, signOutReason: null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  const clearToSignedOut = useCallback((reason: SignOutReason = null) => {
    secureSession.clear();
    setState({ ...initialState, signOutReason: reason });
  }, []);

  const refreshIdentity = useCallback(
    async (wasAlreadySignedIn = false) => {
      if (!secureSession.get() || secureSession.isExpired()) {
        clearToSignedOut(wasAlreadySignedIn ? 'EXPIRED' : null);
        return;
      }
      try {
        const who = await platformAdminAuthClient.whoami();
        const roles = who.roles.filter(isKnownRole);
        setState({
          status: 'SIGNED_IN',
          adminId: who.adminId,
          roles,
          sessionExpiresAt: who.sessionExpiresAt ?? null,
          signOutReason: null,
        });
      } catch (error) {
        if (error instanceof PlatformAdminApiError && (error.status === 401 || error.status === 403)) {
          clearToSignedOut(wasAlreadySignedIn ? 'REVOKED' : null);
          return;
        }
        throw error;
      }
    },
    [clearToSignedOut],
  );

  // Mount-time validation: if a session token is already present when this
  // provider mounts (e.g. a fast SPA remount that never touched
  // secureSession itself, or a test harness pre-seeding a token), establish
  // SIGNED_IN by asking the server whoami owns it rather than assuming a
  // stored token is automatically valid.
  useEffect(() => {
    if (secureSession.get() && state.status === 'SIGNED_OUT') {
      void refreshIdentity(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only
  }, []);

  // Session-expiry watch: a Platform Administration session must never
  // silently keep acting as authenticated past its server-issued expiry
  // (mission Section 9 "session expiry handling"). Re-validates with the
  // server (not just the locally-cached expiresAt) so a server-initiated
  // revocation (PCA-ADD-PA-019) is caught within a bounded window too.
  useEffect(() => {
    const interval = setInterval(() => {
      if (state.status === 'SIGNED_IN') {
        void refreshIdentity(true);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [state.status, refreshIdentity]);

  const login = useCallback(
    async (email: string, password: string, totpCode: string) => {
      const result = await platformAdminAuthClient.login(email, password, totpCode);
      secureSession.set(result.sessionToken, result.expiresAt);
      await refreshIdentity();
    },
    [refreshIdentity],
  );

  const logout = useCallback(async () => {
    try {
      await platformAdminAuthClient.logout();
    } finally {
      clearToSignedOut(null);
    }
  }, [clearToSignedOut]);

  const revokeAllSessions = useCallback(async () => {
    await platformAdminAuthClient.revokeAllSessions();
    clearToSignedOut();
  }, [clearToSignedOut]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, revokeAllSessions, refreshIdentity }),
    [state, login, logout, revokeAllSessions, refreshIdentity],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useCurrentRoles(): PlatformAdminRole[] {
  return useAuth().roles;
}
