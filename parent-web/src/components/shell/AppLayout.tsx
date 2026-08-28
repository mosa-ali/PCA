import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Breadcrumb } from './Breadcrumb';
import { DemoBanner } from '../common/DemoBanner';
import { ConnectionStatusBanner } from '../common/ConnectionStatusBanner';
import { FreeAccessReminderBanner } from '../freeaccess/FreeAccessReminderBanner';
import { useAuth } from '../../state/AuthContext';

/**
 * Authentication gate for every route this layout wraps (all of them
 * except /login, /register, /verify-email -- see App.tsx). This is
 * DELIBERATELY separate from rbac/RouteGuard.tsx, which only checks
 * ROLE-based permission for specific sensitive actions and assumes a
 * session already exists. Before this gate existed, an unauthenticated
 * visitor in real (non-demo) mode could reach /dashboard and every
 * non-RouteGuard-wrapped route directly (AppLayout had no session check at
 * all), and even RouteGuard-wrapped routes were NOT actually protected:
 * useCurrentRole() falls back to the fixture module's getDevRole() default
 * of 'OWNER' whenever session is null, so an unauthenticated visitor was
 * evaluated as a full Owner rather than denied. Found via a real E2E run
 * against a live backend (a fresh, unauthenticated browser context reached
 * /dashboard directly instead of being redirected to /login) -- fixed
 * here, at the one place already shared by every protected route, rather
 * than patched per-page or by changing RouteGuard's fixture-fallback
 * semantics (which demo/dev mode legitimately still needs).
 *
 * Demo/dev mode's DevServiceAuthClient.getSession() always resolves a
 * non-null session (see api/dev/devState.ts's buildDevSession), so this
 * check is a no-op there by construction -- never a special case to
 * maintain separately from real mode.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerToggleRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);

  /*
   * Mobile drawer keyboard contract. The drawer is a fixed, off-screen panel
   * that covers the page when open, and before this it could only be dismissed
   * by pointing at the scrim: there was no Escape handler and no close control
   * anywhere inside it, so a keyboard user who opened it had no way back out.
   * Escape now closes it, focus moves to the in-drawer close button when it
   * opens, and focus returns to the header toggle that opened it when it
   * closes (never on first mount -- `drawerWasOpen` guards that).
   */
  useEffect(() => {
    if (!drawerOpen) {
      if (drawerWasOpen.current) {
        drawerWasOpen.current = false;
        drawerToggleRef.current?.focus();
      }
      return;
    }
    drawerWasOpen.current = true;
    drawerCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  if (loading) return null;
  if (session === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <a href="#main-content" className="skip-link">
        {t('app.skipToContent')}
      </a>
      <Sidebar
        collapsed={collapsed}
        drawerOpen={drawerOpen}
        onNavigate={() => setDrawerOpen(false)}
        onClose={() => setDrawerOpen(false)}
        closeButtonRef={drawerCloseRef}
      />
      {drawerOpen && (
        <div
          className="drawer-scrim"
          onClick={() => setDrawerOpen(false)}
          role="presentation"
        />
      )}
      <div className="main-column">
        <Header
          onToggleSidebar={() => setCollapsed((c) => !c)}
          onToggleDrawer={() => setDrawerOpen((d) => !d)}
          sidebarCollapsed={collapsed}
          drawerOpen={drawerOpen}
          drawerToggleRef={drawerToggleRef}
        />
        <DemoBanner />
        <ConnectionStatusBanner />
        <FreeAccessReminderBanner />
        <Breadcrumb />
        <main id="main-content" className="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
