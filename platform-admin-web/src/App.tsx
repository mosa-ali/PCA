import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/shell/AppLayout';
import { RequireSession } from './rbac/RequireSession';
import { RouteGuard } from './rbac/RouteGuard';
import { BillingRouteGuard } from './rbac/BillingRouteGuard';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AccountsList from './pages/accounts/AccountsList';
import AccountDetail from './pages/accounts/AccountDetail';
import Entitlements from './pages/entitlements/Entitlements';
import EntitlementRequests from './pages/entitlements/EntitlementRequests';
import BillingPlans from './pages/billing/BillingPlans';
import BillingPricing from './pages/billing/BillingPricing';
import BillingQuotes from './pages/billing/BillingQuotes';
import BillingInvoices from './pages/billing/BillingInvoices';
import BillingPayments from './pages/billing/BillingPayments';
import AdminUsers from './pages/AdminUsers';
import Audit from './pages/Audit';
import Settings from './pages/Settings';
import NotPermitted from './pages/NotPermitted';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />

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

        <Route
          path="accounts"
          element={
            <RouteGuard operation="VIEW_SUPPORT_ACCOUNT_METADATA">
              <AccountsList />
            </RouteGuard>
          }
        />
        <Route
          path="accounts/:id"
          element={
            <RouteGuard operation="VIEW_SUPPORT_ACCOUNT_METADATA">
              <AccountDetail />
            </RouteGuard>
          }
        />

        <Route
          path="entitlements"
          element={
            <RouteGuard operation="VIEW_SUPPORT_ACCOUNT_METADATA">
              <Entitlements />
            </RouteGuard>
          }
        />
        <Route
          path="entitlement-requests"
          element={
            <RouteGuard operation="VIEW_SUPPORT_ACCOUNT_METADATA">
              <EntitlementRequests />
            </RouteGuard>
          }
        />

        <Route
          path="billing/plans"
          element={
            <BillingRouteGuard operation="VIEW_BILLING_RECORDS">
              <BillingPlans />
            </BillingRouteGuard>
          }
        />
        <Route
          path="billing/pricing"
          element={
            <BillingRouteGuard operation="VIEW_PRICE_BOOK">
              <BillingPricing />
            </BillingRouteGuard>
          }
        />
        <Route
          path="billing/quotes"
          element={
            <RouteGuard operation="VIEW_SUPPORT_ACCOUNT_METADATA">
              <BillingQuotes />
            </RouteGuard>
          }
        />
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
