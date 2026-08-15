import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isSettlementPermitted, type SettlementOperation } from '../domain/settlement';
import { useCurrentRoles } from '../state/AuthContext';

interface SettlementRouteGuardProps {
  operation: SettlementOperation;
  children: ReactNode;
}

/** Same role as BillingRouteGuard but checks the settlement/rbac.ts operation vocabulary (backend/src/platformadmin/auth/rbacPolicy.ts's VIEW_SETTLEMENT_RECORDS/MUTATE_SETTLEMENT_ACCOUNT/CREATE_SETTLEMENT_BATCH/RESOLVE_RECONCILIATION). Usability hint only -- server remains authoritative. */
export function SettlementRouteGuard({ operation, children }: SettlementRouteGuardProps) {
  const roles = useCurrentRoles();
  const location = useLocation();

  if (!isSettlementPermitted(roles, operation)) {
    return <Navigate to="/not-permitted" replace state={{ from: location.pathname, operation }} />;
  }

  return <>{children}</>;
}
