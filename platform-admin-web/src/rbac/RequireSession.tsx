import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';

/**
 * Root gate for every authenticated route: an unauthenticated, expired, or
 * revoked Platform Administration session must never render the shell or
 * any page inside it (mission Section 24 route-security test list).
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status !== 'SIGNED_IN') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
