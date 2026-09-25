import { LanguageSwitch } from '../shell/LanguageSwitch';

/**
 * The language control for the authentication / onboarding surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * `LanguageSwitch` has always been mounted -- but only inside
 * `components/shell/Header.tsx`, which is the authenticated family-console
 * chrome. None of the auth screens render that header, so before this
 * component the switcher was reachable everywhere EXCEPT the screens a new
 * parent sees first. A parent who cannot read English had no way to change
 * language until after they had already signed in: they had to negotiate
 * registration, email verification, password reset and authenticator setup
 * in a language they may not read, and only then discover the control.
 *
 * This is the shared control for those screens, deliberately ONE component
 * rather than the same markup repeated into nine page sections. It does not
 * reimplement any switching logic: it renders the existing `LanguageSwitch`,
 * which already owns the accessible name (`role="group"` + group label), the
 * per-option `lang` attribute (without it a screen reader pronounces
 * "العربية" with an English voice), the `aria-pressed` current-state signal,
 * and the approved persistence path (`i18n.changeLanguage` with
 * `caches: ['localStorage']`, see src/i18n/index.ts).
 *
 * FOUR PROPERTIES THIS MUST KEEP, because it sits inside forms that hold a
 * half-finished sign-in or setup:
 *  - It never unmounts the page. `i18n.changeLanguage` triggers a re-render,
 *    not a remount, and nothing here passes `key={i18n.language}` -- so
 *    whatever the parent has already typed (email, password, one-time code)
 *    and whatever step the flow is on survive the switch.
 *  - It never navigates, and never reloads. A reload here would discard the
 *    in-memory authenticator enrollment secret and restart the setup.
 *  - It never touches the session. It issues no request, so it can neither
 *    invalidate the session cookie nor consume a step-up challenge.
 *  - It is not a form control. It renders no `input`, so it cannot be
 *    submitted, validated, or mistaken for a field by implicit submission.
 *
 * It carries no account-level preference: the saved `parentPreferences.language`
 * is still owned by Settings, exactly as the header switch documents, so
 * changing language here can never fail on an unreachable backend.
 */
export function AuthPageLanguage() {
  return (
    <div className="auth-page-lang">
      <LanguageSwitch />
    </div>
  );
}
