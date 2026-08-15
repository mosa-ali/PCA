import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isBillingPermitted, type BillingOperation } from '../domain/billingRbac';
import { useCurrentRoles } from '../state/AuthContext';

interface BillingRouteGuardProps {
  operation: BillingOperation;
  children: ReactNode;
}

/** Same role as RouteGuard but checks the finer-grained billing/rbac.ts operation vocabulary (backend/src/billing/rbac.ts) instead of platformadmin/auth/rbacPolicy.ts's coarse ADMINISTER_BILLING. Usability hint only -- server remains authoritative. */
export function BillingRouteGuard({ operation, children }: BillingRouteGuardProps) {
  const roles = useCurrentRoles();
  const location = useLocation();

  if (!isBillingPermitted(roles, operation)) {
    return <Navigate to="/not-permitted" replace state={{ from: location.pathname, operation }} />;
  }

  return <>{children}</>;
}
