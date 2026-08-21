import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/shell/AppLayout';
import Dashboard from './pages/Dashboard';
import ChildrenList from './pages/children/ChildrenList';
import ChildLayout from './pages/children/ChildLayout';
import ChildOverview from './pages/children/ChildOverview';
import ScreenTimePage from './pages/children/ScreenTimePage';
import AppsPage from './pages/children/AppsPage';
import WebProtectionPage from './pages/children/WebProtectionPage';
import YouTubePage from './pages/children/YouTubePage';
import LocationPage from './pages/children/LocationPage';
import EyeProtectionPage from './pages/children/EyeProtectionPage';
import PrayerPage from './pages/children/PrayerPage';
import ChildWellbeingPage from './pages/children/ChildWellbeingPage';
import Requests from './pages/Requests';
import Members from './pages/family/Members';
import RolesMatrix from './pages/family/RolesMatrix';
import Devices from './pages/family/Devices';
import Retention from './pages/privacy/Retention';
import Export from './pages/privacy/Export';
import DeleteNow from './pages/privacy/DeleteNow';
import Transparency from './pages/privacy/Transparency';
import PermissionsPolicy from './pages/privacy/PermissionsPolicy';
import ActivityTimelinePage from './pages/children/ActivityTimelinePage';
import ProtectionStatus from './pages/security/ProtectionStatus';
import Recovery from './pages/security/Recovery';
import Audit from './pages/security/Audit';
import TrustedBrowser from './pages/security/TrustedBrowser';
import WellbeingAdmin from './pages/wellbeing/WellbeingAdmin';
import Notifications from './pages/Notifications';
import Subscription from './pages/Subscription';
import DeviceIncreaseRequest from './pages/billing/DeviceIncreaseRequest';
import ParentMemberIncreaseRequest from './pages/billing/ParentMemberIncreaseRequest';
import Invoices from './pages/billing/Invoices';
import InvoiceDetail from './pages/billing/InvoiceDetail';
import CheckoutReturn from './pages/billing/CheckoutReturn';
import Settings from './pages/Settings';
import NotPermitted from './pages/NotPermitted';
import NotFound from './pages/NotFound';
import Register from './pages/auth/Register';
import VerifyEmail from './pages/auth/VerifyEmail';
import Login from './pages/auth/Login';
import { RouteGuard } from './rbac/RouteGuard';

export default function App() {
  return (
    <Routes>
      {/* PCA-AUTH-SESSION-1: unauthenticated auth pages, deliberately outside
          AppLayout's chrome (no family-scoped nav/shell makes sense before a
          session exists). */}
      <Route path="register" element={<Register />} />
      <Route path="verify-email" element={<VerifyEmail />} />
      <Route path="login" element={<Login />} />

      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />

        <Route path="children" element={<ChildrenList />} />
        <Route path="children/:childId" element={<ChildLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<ChildOverview />} />
          <Route
            path="screen-time"
            element={
              <RouteGuard action="EDIT_CHILD_POLICY">
                <ScreenTimePage />
              </RouteGuard>
            }
          />
          <Route
            path="apps"
            element={
              <RouteGuard action="EDIT_CHILD_POLICY">
                <AppsPage />
              </RouteGuard>
            }
          />
          <Route path="web-protection" element={<WebProtectionPage />} />
          <Route path="youtube" element={<YouTubePage />} />
          <Route path="location" element={<LocationPage />} />
          <Route path="eye-protection" element={<EyeProtectionPage />} />
          <Route path="prayer" element={<PrayerPage />} />
          <Route path="wellbeing-messages" element={<ChildWellbeingPage />} />
          <Route path="activity" element={<ActivityTimelinePage />} />
        </Route>

        <Route path="requests" element={<Requests />} />

        <Route path="family/members" element={<Members />} />
        <Route path="family/roles" element={<RolesMatrix />} />
        <Route path="family/devices" element={<Devices />} />

        <Route
          path="privacy/retention"
          element={
            <RouteGuard action="CHANGE_RETENTION">
              <Retention />
            </RouteGuard>
          }
        />
        <Route
          path="privacy/export"
          element={
            <RouteGuard action="EXPORT_DATA">
              <Export />
            </RouteGuard>
          }
        />
        <Route
          path="privacy/delete"
          element={
            <RouteGuard action="DELETE_HISTORY">
              <DeleteNow />
            </RouteGuard>
          }
        />
        <Route path="privacy/transparency" element={<Transparency />} />
        <Route path="privacy/permissions" element={<PermissionsPolicy />} />

        <Route path="security/status" element={<ProtectionStatus />} />
        <Route path="security/trusted-browser" element={<TrustedBrowser />} />
        <Route
          path="security/recovery"
          element={
            <RouteGuard action="REVEAL_RECOVERY_MATERIAL">
              <Recovery />
            </RouteGuard>
          }
        />
        <Route path="security/audit" element={<Audit />} />

        <Route
          path="wellbeing-messages"
          element={
            <RouteGuard action="MANAGE_WELLBEING_MESSAGES">
              <WellbeingAdmin />
            </RouteGuard>
          }
        />

        <Route path="notifications" element={<Notifications />} />
        <Route
          path="subscription"
          element={
            <RouteGuard action="VIEW_BILLING">
              <Subscription />
            </RouteGuard>
          }
        />
        <Route
          path="subscription/increase-devices"
          element={
            <RouteGuard action="REQUEST_DEVICE_INCREASE">
              <DeviceIncreaseRequest />
            </RouteGuard>
          }
        />
        <Route
          path="subscription/increase-parent-members"
          element={
            <RouteGuard action="REQUEST_PARENT_MEMBER_INCREASE">
              <ParentMemberIncreaseRequest />
            </RouteGuard>
          }
        />
        <Route
          path="subscription/invoices"
          element={
            <RouteGuard action="VIEW_BILLING">
              <Invoices />
            </RouteGuard>
          }
        />
        <Route
          path="subscription/invoices/:invoiceId"
          element={
            <RouteGuard action="VIEW_BILLING">
              <InvoiceDetail />
            </RouteGuard>
          }
        />
        <Route
          path="subscription/checkout-return"
          element={
            <RouteGuard action="VIEW_BILLING">
              <CheckoutReturn />
            </RouteGuard>
          }
        />
        <Route path="settings" element={<Settings />} />
        <Route path="not-permitted" element={<NotPermitted />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
