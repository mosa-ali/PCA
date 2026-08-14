import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isPermitted, type PlatformAdminOperation } from '../domain/roles';
import { useCurrentRoles } from '../state/AuthContext';

interface RouteGuardProps {
  operation: PlatformAdminOperation;
  children: ReactNode;
}

/**
 * Route-level RBAC hint. This stops a role from reaching an unauthorized
 * page via a direct/deep link even though the nav link is hidden -- but,
 * per mission Section 8 / PCA-ADD-PA-008, this is usability only. Every
 * request the resulting page issues is independently authorized server-
 * side; this guard's only job is to avoid rendering a broken/empty screen
 * for a role that could never use it.
 */
export function RouteGuard({ operation, children }: RouteGuardProps) {
  const roles = useCurrentRoles();
  const location = useLocation();

  if (!isPermitted(roles, operation)) {
    return <Navigate to="/not-permitted" replace state={{ from: location.pathname, operation }} />;
  }

  return <>{children}</>;
}
