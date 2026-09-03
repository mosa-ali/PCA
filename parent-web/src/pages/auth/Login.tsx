import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';

/**
 * Same-origin absolute path: exactly ONE leading slash. The negative
 * lookahead is the whole point -- see `safeReturnPath` below for why a
 * second slash (or a backslash) makes it an off-origin URL, not a path.
 */
const SAFE_RETURN_PATH = /^\/(?![/\\])/;

/**
 * True if `value` contains any C0 control character or DEL. Written as an
 * explicit scan rather than a regex character class so that no control byte
 * ever has to appear literally in this source file.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Post-login return target, hardened against an open redirect.
 *
 * `from` is NOT trusted input. `components/shell/AppLayout.tsx`'s auth gate
 * writes it as the raw `location.pathname` of whatever URL the visitor asked
 * for, and `App.tsx`'s `path="*"` catch-all route sits INSIDE that same
 * AppLayout-gated block -- so any unmatched path at all reaches the gate and
 * ends up in `location.state.from`.
 *
 * That matters because a pathname is not necessarily a same-origin path:
 *   new URL('https://parent.pca.app//evil.com/x').pathname === '//evil.com/x'
 *   new URL('//evil.com/x', 'https://parent.pca.app').href === 'https://evil.com/x'
 * So handing `from` straight to `window.location.assign` lets an attacker
 * send a victim to `https://parent.pca.app//evil.com/x`, have them
 * authenticate on the GENUINE login page at the GENUINE origin, and land on
 * `https://evil.com/x` -- a redirect that both starts and ends looking
 * legitimate.
 *
 * Three shapes are rejected, all verified against the real URL parser:
 *  - `//evil.com/x`   protocol-relative; resolves to https://evil.com/x
 *  - `/\evil.com/x`   browsers normalise `\` to `/`; also https://evil.com/x
 *  - `/<TAB>/evil.com/x` (and LF/CR) the URL parser STRIPS tab/LF/CR before
 *    resolving, so this is `//evil.com/x` by the time it is navigated. Rather
 *    than filter those characters out, any C0 control character is rejected
 *    outright -- none is ever legitimate in a path this app itself produced.
 * Anything that is not a plain single-slash path (an absolute URL, a
 * `javascript:` URL, a bare relative segment, a non-string) falls back to
 * '/dashboard'.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure function, not a component: exported so the open-redirect guard is unit-testable directly (tests/unit/loginReturnPathSafety.test.ts)
export function safeReturnPath(from: unknown): string {
  if (typeof from !== 'string') return '/dashboard';
  if (!SAFE_RETURN_PATH.test(from)) return '/dashboard';
  if (hasControlCharacter(from)) return '/dashboard';
  return from;
}

/**
 * PCA-AUTH-SESSION-1 -- sign-in against an already-VERIFIED account
 * (email + password). A full page navigation is used after success so
 * AuthProvider's mount-time getSession() call picks up the freshly issued
 * pca_family_session cookie.
 */
export default function Login() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await clients.serviceAuth.signIn(email, password);
      // NEVER pass `from` through unvalidated -- see safeReturnPath above.
      window.location.assign(safeReturnPath((location.state as { from?: unknown } | null)?.from));
    } catch (err) {
      if (err instanceof ServiceAuthError) {
        if (err.code === 'RATE_LIMITED') setError(t('auth.rateLimited'));
        else if (err.code === 'INVALID_CREDENTIALS') setError(t('auth.invalidCredentials'));
        else setError(t('auth.genericError'));
      } else {
        setError(t('auth.genericError'));
      }
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="login-title" className="auth-page">
      <h1 id="login-title">{t('auth.loginTitle')}</h1>
      <p>{t('auth.loginBody')}</p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="login-email">{t('auth.emailLabel')}</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={error ? 'login-error' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="login-password">{t('auth.passwordLabel')}</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={error ? 'login-error' : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p id="login-error" role="alert" className="field-error">
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
          {t('auth.loginSubmit')}
        </button>
      </form>
      <p>
        <Link to="/forgot-password">{t('auth.forgotPasswordLink')}</Link>
      </p>
      <p>
        {t('auth.needAccount')} <Link to="/register">{t('auth.registerLink')}</Link>
      </p>
    </section>
  );
}
