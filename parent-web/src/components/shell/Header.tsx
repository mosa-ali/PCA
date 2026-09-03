import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { LanguageSwitch } from './LanguageSwitch';
import { NotificationsBell } from './NotificationsBell';
import { ProfileMenu } from './ProfileMenu';
import type { FamilyRole } from '../../domain/roles';

interface HeaderProps {
  onToggleSidebar: () => void;
  onToggleDrawer: () => void;
  sidebarCollapsed: boolean;
  /** Whether the mobile navigation drawer is currently open. */
  drawerOpen?: boolean;
  /** Lets AppLayout restore focus here when the drawer is closed. */
  drawerToggleRef?: RefObject<HTMLButtonElement>;
}

const DEMO_ROLES: FamilyRole[] = ['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD'];

/** Vertical arrow into a tray. Non-directional: it does NOT mirror under RTL. */
function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3.75v10.5m0 0 3.75-3.75M12 14.25 8.25 10.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.75 15.5v2.75a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V15.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Global header. Start -> end (the whole row mirrors under RTL because it is
 * flex, and every offset inside it is a logical property):
 *
 *   [drawer toggle <=900px] [collapse toggle >900px] [brand] --spacer--
 *   [demo role, fixture mode only] [Download App] [language] [bell] [profile]
 *
 * DOWNLOAD APP IS ALWAYS RENDERED. It is a global, permanent header action and
 * is NEVER conditional on an env var: it previously disappeared entirely
 * whenever `config.androidAppDownloadUrl` was unset, which is every
 * environment in this repository, so the console's most prominent call to
 * action simply did not exist.
 *
 * What it must never become is a fabricated link. It therefore does not point
 * at a store at all: it is an in-app `<Link>` to /download, an internal page
 * that states, per platform and in plain language, exactly what is available
 * today (see pages/download/DownloadApp.tsx). The Android download URL is read
 * THERE, not here, so no env value can reach an `href` in this row.
 *
 * The action carries no platform in its label for the same reason: iOS is
 * post-V1 (the backend refuses `platform=IOS` with
 * PLATFORM_ENROLLMENT_UNAVAILABLE) and the page says so honestly rather than
 * the header implying an Android-only product.
 *
 * The old header held only a hamburger, the product name, and two unstyled
 * `<select>`s. The language `<select>` in particular had no CSS rule at all
 * and rendered at near-invisible contrast; it is now the `LanguageSwitch`
 * segmented control.
 */
export function Header({
  onToggleSidebar,
  onToggleDrawer,
  sidebarCollapsed,
  drawerOpen = false,
  drawerToggleRef,
}: HeaderProps) {
  const { t } = useTranslation();
  const { session, isFixtureBacked, setDemoRole } = useAuth();

  return (
    <header className="app-header">
      <button
        ref={drawerToggleRef}
        type="button"
        className="icon-btn mobile-only"
        aria-label={drawerOpen ? t('shell.closeMenu') : t('shell.openMenu')}
        aria-controls="app-sidebar"
        aria-expanded={drawerOpen}
        onClick={onToggleDrawer}
      >
        <span aria-hidden="true">≡</span>
      </button>
      <button
        type="button"
        className="icon-btn desktop-only"
        aria-label={sidebarCollapsed ? t('shell.expandSidebar') : t('shell.toggleSidebar')}
        aria-expanded={!sidebarCollapsed}
        aria-controls="app-sidebar"
        onClick={onToggleSidebar}
      >
        <span aria-hidden="true">☰</span>
      </button>
      {/*
        The brand IS the spacer. `.app-brand` already carries `min-width: 0`
        with `overflow: hidden`, so giving it the growth the separate
        `.spacer` div used to provide costs one fewer flex item and one fewer
        8px gap.

        That 8px is not cosmetic. Measured in a real browser at a 320px
        viewport with the Download action configured, the header's controls
        plus their gaps came to a scrollWidth of 344. This change and the
        language options' 36px inline minimum together bring it to exactly
        320 -- no overflow, and no slack either. Anything further added to
        this row needs the stylesheet's mobile gap/padding revisited first;
        raised as a request rather than solved with more inline overrides.
      */}
      <strong className="app-brand" style={{ flex: 1 }}>
        {/* The short form keeps the header from being crowded out by the
            wordmark once the row also carries a download action, a language
            control, a bell and a profile control. */}
        <span className="desktop-only">{t('app.name')}</span>
        <span className="mobile-only">{t('app.nameShort')}</span>
      </strong>
      {isFixtureBacked && (
        // Unchanged gate: this is a dev/demo affordance and never renders
        // against a real backend. `desktop-only` keeps it from competing for
        // room with the real product controls on a phone.
        //
        // The class sits on a WRAPPER, not on the <label>. `.app-header label`
        // in global.css sets `display: inline-flex` and, at specificity 0-1-1,
        // beats `.desktop-only { display: none }` at 0-1-0 -- so the label
        // stayed visible and 131px wide at a 320px viewport, overflowing the
        // header. Measured, not theorised: it is invisible on the live QA
        // stack because demo mode is off there, and only the fixture-backed
        // e2e build exposes it.
        <span className="desktop-only">
          <label>
            <span className="visually-hidden">{t('shell.demoRoleSwitcher')}</span>
            <select
              className="header-select"
              aria-label={t('shell.demoRoleSwitcher')}
              value={session?.role ?? 'OWNER'}
              onChange={(e) => setDemoRole(e.target.value as FamilyRole)}
            >
              {DEMO_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r.toLowerCase()}`)}
                </option>
              ))}
            </select>
          </label>
        </span>
      )}
      {/* No condition. See the note above: this action is global and permanent,
          and it navigates in-app, so there is nothing here that can be dead or
          fabricated. The accessible name is the same string as the visible
          label (WCAG 2.5.3), and stays attached below 900px where the label
          itself is hidden and only the icon remains. */}
      <Link
        className="btn btn-secondary btn-download-app"
        to="/download"
        aria-label={t('shell.downloadApp')}
      >
        <DownloadIcon />
        {/* Icon-only below 900px; the accessible name above is unchanged. */}
        <span className="desktop-only">{t('shell.downloadApp')}</span>
      </Link>
      <LanguageSwitch />
      <NotificationsBell />
      {session && <ProfileMenu session={session} />}
    </header>
  );
}
