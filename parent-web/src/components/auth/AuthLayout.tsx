import { Outlet } from 'react-router-dom';
import { AuthPageLanguage } from './AuthPageLanguage';

/**
 * The shared layout for the authentication / onboarding surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * `LanguageSwitch` has always been mounted -- but only inside
 * `components/shell/Header.tsx`, which is the AUTHENTICATED family-console
 * chrome. None of the auth screens render that header, so before this layout
 * the switcher was reachable everywhere EXCEPT the screens a parent meets
 * first: registration, email verification, login, login step-up, password
 * reset and authenticator setup all had to be negotiated in whatever
 * language the browser detected, with no way out until AFTER signing in.
 *
 * It is a LAYOUT ROUTE (`<Route element={<AuthLayout />}>`), not six copies of
 * a control inserted into six pages, for the same reason `AppLayout` is a
 * layout route: the chrome belongs to the surface, not to each page. Adding
 * auth screens later cannot forget it.
 *
 * It renders NO wrapper element of its own -- just a fragment -- so each page
 * keeps `className="auth-page"` as its own root element. That matters:
 * global.css styles `.auth-page > form` with a direct-child selector, so an
 * intermediate wrapper would silently drop every auth form's card styling.
 *
 * A reload here would be destructive rather than cosmetic: authenticator
 * setup holds its one-time enrollment secret in component MEMORY ONLY (it is
 * never persisted), so reloading mid-setup would discard it and restart the
 * setup. `AuthPageLanguage` switches via `i18n.changeLanguage`, which is a
 * re-render and not a remount, so entered values and the current step
 * survive -- asserted in tests/component/AuthLayout.test.tsx.
 */
export function AuthLayout() {
  return (
    <>
      <AuthPageLanguage />
      <Outlet />
    </>
  );
}
