import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingState } from './components/common/States';
import { AppLayout } from './components/shell/AppLayout';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ChildrenList = lazy(() => import('./pages/children/ChildrenList'));
const ChildLayout = lazy(() => import('./pages/children/ChildLayout'));
const ChildOverview = lazy(() => import('./pages/children/ChildOverview'));
const ScreenTimePage = lazy(() => import('./pages/children/ScreenTimePage'));
const AppsPage = lazy(() => import('./pages/children/AppsPage'));
const WebProtectionPage = lazy(() => import('./pages/children/WebProtectionPage'));
const YouTubePage = lazy(() => import('./pages/children/YouTubePage'));
const LocationPage = lazy(() => import('./pages/children/LocationPage'));
const EyeProtectionPage = lazy(() => import('./pages/children/EyeProtectionPage'));
const PrayerPage = lazy(() => import('./pages/children/PrayerPage'));
const ChildWellbeingPage = lazy(() => import('./pages/children/ChildWellbeingPage'));
const ActivityTimelinePage = lazy(() => import('./pages/children/ActivityTimelinePage'));
const Requests = lazy(() => import('./pages/Requests'));
const Members = lazy(() => import('./pages/family/Members'));
const RolesMatrix = lazy(() => import('./pages/family/RolesMatrix'));
const Devices = lazy(() => import('./pages/family/Devices'));
const PrivacyHub = lazy(() => import('./pages/privacy/PrivacyHub'));
const Retention = lazy(() => import('./pages/privacy/Retention'));
const Export = lazy(() => import('./pages/privacy/Export'));
const DeleteNow = lazy(() => import('./pages/privacy/DeleteNow'));
const Transparency = lazy(() => import('./pages/privacy/Transparency'));
const PermissionsPolicy = lazy(() => import('./pages/privacy/PermissionsPolicy'));
const ProtectionStatus = lazy(() => import('./pages/security/ProtectionStatus'));
const Recovery = lazy(() => import('./pages/security/Recovery'));
const Audit = lazy(() => import('./pages/security/Audit'));
const TrustedBrowser = lazy(() => import('./pages/security/TrustedBrowser'));
const Alerts = lazy(() => import('./pages/safety/Alerts'));
const ChildPickerIndex = lazy(() => import('./pages/protection/ChildPickerIndex').then((module) => ({ default: module.ChildPickerIndex })));
const WellbeingAdmin = lazy(() => import('./pages/wellbeing/WellbeingAdmin'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Subscription = lazy(() => import('./pages/Subscription'));
const DeviceIncreaseRequest = lazy(() => import('./pages/billing/DeviceIncreaseRequest'));
const ParentMemberIncreaseRequest = lazy(() => import('./pages/billing/ParentMemberIncreaseRequest'));
const Invoices = lazy(() => import('./pages/billing/Invoices'));
const InvoiceDetail = lazy(() => import('./pages/billing/InvoiceDetail'));
const CheckoutReturn = lazy(() => import('./pages/billing/CheckoutReturn'));
const DownloadApp = lazy(() => import('./pages/download/DownloadApp'));
const Settings = lazy(() => import('./pages/Settings'));
const ParentGuide = lazy(() => import('./pages/guide/ParentGuide'));
const NotPermitted = lazy(() => import('./pages/NotPermitted'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Register = lazy(() => import('./pages/auth/Register'));
const VerifyEmail = lazy(() => import('./pages/auth/VerifyEmail'));
const Login = lazy(() => import('./pages/auth/Login'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const MfaSetup = lazy(() => import('./pages/auth/MfaSetup'));
const MfaRecover = lazy(() => import('./pages/auth/MfaRecover'));
import { RouteGuard } from './rbac/RouteGuard';
import { AuthLayout } from './components/auth/AuthLayout';

export default function App() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
      {/* PCA-AUTH-SESSION-1: unauthenticated auth pages, deliberately outside
          AppLayout's chrome (no family-scoped nav/shell makes sense before a
          session exists). */}
      <Route element={<AuthLayout />}>
        <Route path="register" element={<Register />} />
        <Route path="verify-email" element={<VerifyEmail />} />
        <Route path="login" element={<Login />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        {/* Authenticator setup and lost-authenticator recovery. Setup is
            optional for a signed-in parent and ticket-based after recovery. */}
        <Route path="mfa/setup" element={<MfaSetup />} />
        <Route path="mfa/recover" element={<MfaRecover />} />
      </Route>

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

        {/* The Data & Privacy hub. It replaces five first-level sidebar rows
            with one entry point; the five routes below are UNCHANGED, keep
            their own RouteGuards, and stay directly linkable and breadcrumbed.
            Regrouping a controlled capability is allowed; removing one is
            not. */}
        <Route path="privacy" element={<PrivacyHub />} />
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

        {/* Security and protection alerts, previously reachable only by
            scrolling to the bottom of /security/status. */}
        <Route path="safety/alerts" element={<Alerts />} />

        {/* Family-level ways in to three per-child settings. No RouteGuard
            here: these pages only list children and link onward -- the guard
            that matters is the one already on each per-child destination
            (EDIT_CHILD_POLICY on children/:childId/screen-time and /apps). */}
        <Route
          path="protection/screen-time"
          element={
            <ChildPickerIndex
              titleKey="nav.screenTime"
              introKey="protectionIndex.screenTimeIntro"
              childHref={(childId) => `/children/${childId}/screen-time`}
            />
          }
        />
        <Route
          path="protection/apps-web"
          element={
            <ChildPickerIndex
              titleKey="nav.appsWeb"
              introKey="protectionIndex.appsWebIntro"
              childHref={(childId) => `/children/${childId}/apps`}
            />
          }
        />
        <Route
          path="protection/schedules"
          element={
            <ChildPickerIndex
              titleKey="nav.schedules"
              introKey="protectionIndex.schedulesIntro"
              // Night protection / quiet hours live on the child's screen-time
              // page; there is no separate schedules route to send them to.
              childHref={(childId) => `/children/${childId}/screen-time`}
            />
          }
        />

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
        {/* Where the header's always-visible "Download App" action lands. No
            RouteGuard: getting the child app is not a controlled capability,
            and the action itself is global to every signed-in role, so gating
            the destination would only produce a "Not permitted" page for a
            control the same person can see. */}
        <Route path="download" element={<DownloadApp />} />
        <Route path="settings" element={<Settings />} />
        <Route path="guide" element={<ParentGuide />} />
        <Route path="not-permitted" element={<NotPermitted />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      </Routes>
    </Suspense>
  );
}
