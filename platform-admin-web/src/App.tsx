import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './components/shell/AppLayout';
import { RequireSession } from './rbac/RequireSession';
import { RouteGuard } from './rbac/RouteGuard';
import { BillingRouteGuard } from './rbac/BillingRouteGuard';
import { SettlementRouteGuard } from './rbac/SettlementRouteGuard';
import Login from './pages/Login';
import Activation from './pages/Activation';
import Dashboard from './pages/Dashboard';
import AccountDetail from './pages/accounts/AccountDetail';
import BillingInvoices from './pages/billing/BillingInvoices';
import BillingPayments from './pages/billing/BillingPayments';
import SettlementAccounts from './pages/billing/SettlementAccounts';
import SettlementBatches from './pages/billing/SettlementBatches';
import SettlementReconciliation from './pages/billing/SettlementReconciliation';
import AdminUsers from './pages/AdminUsers';
import Audit from './pages/Audit';
import Settings from './pages/Settings';
import NotPermitted from './pages/NotPermitted';
import NotFound from './pages/NotFound';
import EnrollmentManagement from './pages/EnrollmentManagement';
import CommercialPricing from './pages/CommercialPricing';

function LegacyWorkspaceRedirect({ workspace, tab }: { workspace: string; tab: string }) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  search.set('tab', tab);
  return <Navigate to={`/${workspace}?${search.toString()}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="activate" element={<Activation />} />

      <Route
        element={
          <RequireSession>
            <AppLayout />
          </RequireSession>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />

        <Route
          path="dashboard"
          element={
            <RouteGuard operation="VIEW_PLATFORM_DASHBOARD">
              <Dashboard />
            </RouteGuard>
          }
        />

        <Route path="enrollment-management" element={<RouteGuard operation="VIEW_SUPPORT_ACCOUNT_METADATA"><EnrollmentManagement /></RouteGuard>} />
        <Route path="commercial-pricing" element={<CommercialPricing />} />
        <Route path="accounts" element={<LegacyWorkspaceRedirect workspace="enrollment-management" tab="accounts" />} />
        <Route
          path="accounts/:id"
          element={
            <RouteGuard operation="VIEW_SUPPORT_ACCOUNT_METADATA">
              <AccountDetail />
            </RouteGuard>
          }
        />

        <Route path="entitlements" element={<LegacyWorkspaceRedirect workspace="enrollment-management" tab="entitlements" />} />
        <Route path="entitlement-requests" element={<LegacyWorkspaceRedirect workspace="enrollment-management" tab="requests" />} />

        <Route path="complimentary-capacity" element={<LegacyWorkspaceRedirect workspace="enrollment-management" tab="complimentary-capacity" />} />

        <Route path="free-access-policy" element={<LegacyWorkspaceRedirect workspace="commercial-pricing" tab="free-access-policy" />} />

        <Route path="billing/plans" element={<LegacyWorkspaceRedirect workspace="commercial-pricing" tab="plans" />} />
        <Route path="billing/pricing" element={<LegacyWorkspaceRedirect workspace="commercial-pricing" tab="price-book" />} />
        <Route path="billing/quotes" element={<LegacyWorkspaceRedirect workspace="commercial-pricing" tab="custom-quotes" />} />
        <Route
          path="billing/invoices"
          element={
            <BillingRouteGuard operation="VIEW_BILLING_RECORDS">
              <BillingInvoices />
            </BillingRouteGuard>
          }
        />
        <Route
          path="billing/payments"
          element={
            <BillingRouteGuard operation="VIEW_BILLING_RECORDS">
              <BillingPayments />
            </BillingRouteGuard>
          }
        />
        <Route
          path="settlement/accounts"
          element={
            <SettlementRouteGuard operation="VIEW_SETTLEMENT_RECORDS">
              <SettlementAccounts />
            </SettlementRouteGuard>
          }
        />
        <Route
          path="settlement/batches"
          element={
            <SettlementRouteGuard operation="VIEW_SETTLEMENT_RECORDS">
              <SettlementBatches />
            </SettlementRouteGuard>
          }
        />
        <Route
          path="settlement/reconciliation"
          element={
            <SettlementRouteGuard operation="VIEW_SETTLEMENT_RECORDS">
              <SettlementReconciliation />
            </SettlementRouteGuard>
          }
        />

        <Route
          path="admin-users"
          element={
            <RouteGuard operation="VIEW_ADMIN_ACCOUNTS">
              <AdminUsers />
            </RouteGuard>
          }
        />

        <Route
          path="audit"
          element={
            <RouteGuard operation="VIEW_AUDIT_LOG_OWN">
              <Audit />
            </RouteGuard>
          }
        />

        <Route
          path="settings"
          element={
            // The settings console is an administrative control surface, not
            // support-scoped metadata. Keep the route itself restricted to
            // APP_OWNER/PLATFORM_ADMIN; the sensitive PAYMENT_PROVIDER
            // mutations remain APP_OWNER-only inside Settings.tsx and at the
            // backend authorization layer.
            <RouteGuard operation="ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS">
              <Settings />
            </RouteGuard>
          }
        />

        <Route path="not-permitted" element={<NotPermitted />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
