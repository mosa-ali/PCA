import type { ReactNode } from 'react';
import { isPermitted, type PlatformAdminOperation } from '../domain/roles';
import { useCurrentRoles } from '../state/AuthContext';

interface PermissionGateProps {
  operation: PlatformAdminOperation;
  children: ReactNode;
  /** Rendered instead of nothing when denied, e.g. a disabled button with a tooltip. Omit to render nothing. */
  fallback?: ReactNode;
}

/** In-page RBAC hint (hide/disable a single action, not a whole route). Same "usability only, server is authority" caveat as RouteGuard. */
export function PermissionGate({ operation, children, fallback = null }: PermissionGateProps) {
  const roles = useCurrentRoles();
  return isPermitted(roles, operation) ? <>{children}</> : <>{fallback}</>;
}
