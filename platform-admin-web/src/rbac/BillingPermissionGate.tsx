import type { ReactNode } from 'react';
import { isBillingPermitted, type BillingOperation } from '../domain/billingRbac';
import { useCurrentRoles } from '../state/AuthContext';

interface BillingPermissionGateProps {
  operation: BillingOperation;
  children: ReactNode;
  fallback?: ReactNode;
}

/** In-page RBAC hint for the finer-grained billing operation vocabulary. Same "usability only" caveat as PermissionGate. */
export function BillingPermissionGate({ operation, children, fallback = null }: BillingPermissionGateProps) {
  const roles = useCurrentRoles();
  return isBillingPermitted(roles, operation) ? <>{children}</> : <>{fallback}</>;
}
