import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { FamilyAction } from '../domain/roles';
import { evaluatePermission } from '../domain/roles';
import { useCurrentRole } from '../state/AuthContext';

interface RouteGuardProps {
  action: FamilyAction;
  children: ReactNode;
}

/**
 * Route-level RBAC enforcement. This is what stops a Viewer from reaching
 * an edit page via a direct/deep link even though the nav link is hidden --
 * the guard checks role on every render of the route, not just at
 * navigation-link render time (docs/architecture/18_PARENT_CONTROL_PANEL_RBAC.md
 * Section 6: "Test every role/action pair, direct deep link").
 */
export function RouteGuard({ action, children }: RouteGuardProps) {
  const role = useCurrentRole();
  const location = useLocation();
  const result = evaluatePermission(role, action);

  if (!result.allowed) {
    return (
      <Navigate
        to="/not-permitted"
        replace
        state={{ from: location.pathname, reason: result.reason, action }}
      />
    );
  }

  return <>{children}</>;
}
