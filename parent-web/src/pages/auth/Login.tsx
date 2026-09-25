import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';
import { formatDateTime } from '../../i18n/formatters';

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

type LoginStage = 'PASSWORD' | 'EMAIL_CODE' | 'AUTHENTICATOR_CODE';

interface LoginLocationState {
  from?: unknown;
  /** Prefilled by VerifyEmail after a successful activation (no session is established there). */
  email?: unknown;
  accountActivated?: unknown;
}

/**
 * PCA-AUTH-SESSION-1 + PCA-DEC-037 -- sign-in against an already-VERIFIED
 * account, in up to three stages:
 *   1. email + password;
 *   2a. an emailed one-time code (accounts without an authenticator app), or
 *   2b. the 6-digit code from the account's authenticator app -- sent as a
 *       SECOND /login call with the same email and password.
 * The password therefore lives in React state memory for the length of the
 * attempt; it is never written to any storage, URL or log, and it is cleared
 * as soon as the attempt ends.
 *
 * If the emailed code reports that the authenticator grace period is over,
 * the server sets an enrollment ticket instead of a session and this page
 * sends the parent straight to mandatory authenticator setup.
 *
 * A full page navigation is used after success so AuthProvider's mount-time
 * getSession() call picks up the freshly issued pca_family_session cookie.
 */
export default function Login() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = (location.state as LoginLocationState | null) ?? null;
  const accountActivated = locationState?.accountActivated === true;

  const [email, setEmail] = useState(typeof locationState?.email === 'string' ? locationState.email : '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryPendingAt, setRecoveryPendingAt] = useState<string | null>(null);
  // Switches the form between stages without a route change: the flow is one
  // continuous login attempt, not a separately-bookmarkable page -- entering a
  // code stage with no prior password step would have nothing to check against.
  const [stage, setStage] = useState<LoginStage>('PASSWORD');
  const [code, setCode] = useState('');
  const [codeInvalid, setCodeInvalid] = useState(false);

  function proceedToReturnPath() {
    setPassword('');
    // NEVER pass `from` through unvalidated -- see safeReturnPath above.
    window.location.assign(safeReturnPath(locationState?.from));
  }

  function goToMandatorySetup() {
    setPassword('');
    setCode('');
    navigate('/mfa/setup', { replace: true, state: { email } });
  }

  function showSignInError(err: unknown) {
    if (err instanceof ServiceAuthError) {
      if (err.code === 'RATE_LIMITED') setError(t('auth.rateLimited'));
      else if (err.code === 'MFA_LOCKED') setError(t('mfa.locked'));
      else if (err.code === 'INVALID_MFA_CODE') {
        setError(t('mfa.invalidCode'));
        setCodeInvalid(true);
      } else if (err.code === 'INVALID_CREDENTIALS') setError(t('auth.invalidCredentials'));
      else setError(t('auth.genericError'));
    } else {
      setError(t('auth.genericError'));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await clients.serviceAuth.signIn(email, password);
      if (result.status === 'MFA_RECOVERY_PENDING') {
        setRecoveryPendingAt(result.recoveryAvailableAt);
        setPassword('');
        setSubmitting(false);
        return;
      }
      if (result.status === 'STEP_UP_REQUIRED' || result.status === 'MFA_REQUIRED') {
        setCode('');
        setCodeInvalid(false);
        setStage(result.status === 'STEP_UP_REQUIRED' ? 'EMAIL_CODE' : 'AUTHENTICATOR_CODE');
        setSubmitting(false);
        return;
      }
      proceedToReturnPath();
    } catch (err) {
      showSignInError(err);
      setSubmitting(false);
    }
  }

  async function handleAuthenticatorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCodeInvalid(false);
    if (!/^\d{6}$/.test(code)) {
      setError(t('mfa.codeFormat'));
      setCodeInvalid(true);
      return;
    }
    setSubmitting(true);
    try {
      const result = await clients.serviceAuth.signIn(email, password, code);
      if (result.status === 'MFA_RECOVERY_PENDING') {
        setRecoveryPendingAt(result.recoveryAvailableAt);
        setPassword('');
        setCode('');
        setSubmitting(false);
        return;
      }
      if (result.status === 'AUTHENTICATED') {
        proceedToReturnPath();
        return;
      }
      // The password step is not expected to change its answer between the
      // two calls; if it does, follow the server rather than guess.
      setCode('');
      setStage(result.status === 'STEP_UP_REQUIRED' ? 'EMAIL_CODE' : 'AUTHENTICATOR_CODE');
      setSubmitting(false);
    } catch (err) {
      setCode('');
      showSignInError(err);
      setSubmitting(false);
    }
  }

  async function handleStepUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCodeInvalid(false);
    setSubmitting(true);
    try {
      const result = await clients.serviceAuth.completeLoginStepUp(email, code);
      if (result.status === 'MFA_SETUP_REQUIRED') {
        goToMandatorySetup();
        return;
      }
      proceedToReturnPath();
    } catch (err) {
      if (err instanceof ServiceAuthError) {
        if (err.code === 'RATE_LIMITED') setError(t('auth.rateLimited'));
        else if (err.code === 'INVALID_CREDENTIALS') {
          setError(t('auth.invalidCode'));
          setCodeInvalid(true);
        } else setError(t('auth.genericError'));
      } else {
        setError(t('auth.genericError'));
      }
      setSubmitting(false);
    }
  }

  async function handleResendCode() {
    setError(null);
    setCodeInvalid(false);
    setSubmitting(true);
    try {
      const result = await clients.serviceAuth.signIn(email, password);
      if (result.status === 'MFA_RECOVERY_PENDING') {
        setRecoveryPendingAt(result.recoveryAvailableAt);
        setPassword('');
        setSubmitting(false);
        return;
      }
      if (result.status === 'STEP_UP_REQUIRED') {
        setCode('');
        setSubmitting(false);
        return;
      }
      if (result.status === 'MFA_REQUIRED') {
        setCode('');
        setStage('AUTHENTICATOR_CODE');
        setSubmitting(false);
        return;
      }
      proceedToReturnPath();
    } catch (err) {
      showSignInError(err);
      setSubmitting(false);
    }
  }

  function handleBackToLogin() {
    setStage('PASSWORD');
    setPassword('');
    setCode('');
    setCodeInvalid(false);
    setError(null);
  }

  const lostAuthenticatorLink = (
    <p>
      <Link to="/mfa/recover" state={{ email }}>
        {t('auth.lostAuthenticatorLink')}
      </Link>
    </p>
  );

  if (recoveryPendingAt) {
    return (
      <section aria-labelledby="login-recovery-pending-title" className="auth-page">
        <h1 id="login-recovery-pending-title">{t('mfa.recover.title')}</h1>
        <p role="status">{t('mfa.recover.pendingLogin', { date: formatDateTime(recoveryPendingAt, i18n.language) })}</p>
        <p><Link to="/mfa/recover" state={{ email }}>{t('mfa.recover.title')}</Link></p>
      </section>
    );
  }

  if (stage === 'AUTHENTICATOR_CODE') {
    return (
      <section aria-labelledby="login-mfa-title" className="auth-page">
        <h1 id="login-mfa-title">{t('auth.loginMfaTitle')}</h1>
        <p>{t('auth.loginMfaBody')}</p>
        <form onSubmit={handleAuthenticatorSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-mfa-code">{t('mfa.codeLabel')}</label>
            <input
              id="login-mfa-code"
              name="totp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              aria-describedby={error ? 'login-mfa-error' : undefined}
              aria-invalid={codeInvalid || undefined}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>

          {error && (
            <p id="login-mfa-error" role="alert" className="field-error">
              {error}
            </p>
          )}

          <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
            {t('auth.loginStepUpSubmit')}
          </button>
        </form>
        {lostAuthenticatorLink}
        <p>
          <button type="button" className="btn" onClick={handleBackToLogin} disabled={submitting}>
            {t('auth.loginStepUpBack')}
          </button>
        </p>
      </section>
    );
  }

  if (stage === 'EMAIL_CODE') {
    return (
      <section aria-labelledby="login-step-up-title" className="auth-page">
        <h1 id="login-step-up-title">{t('auth.loginStepUpTitle')}</h1>
        <p>{t('auth.loginStepUpBody', { email })}</p>
        <form onSubmit={handleStepUpSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-step-up-code">{t('auth.codeLabel')}</label>
            <input
              id="login-step-up-code"
              name="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              aria-describedby={error ? 'login-step-up-error' : undefined}
              aria-invalid={codeInvalid || undefined}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>

          {error && (
            <p id="login-step-up-error" role="alert" className="field-error">
              {error}
            </p>
          )}

          <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
            {t('auth.loginStepUpSubmit')}
          </button>
        </form>
        <p>
          <button type="button" className="btn" onClick={handleResendCode} disabled={submitting}>
            {t('auth.loginStepUpResend')}
          </button>
        </p>
        <p>
          <button type="button" className="btn" onClick={handleBackToLogin} disabled={submitting}>
            {t('auth.loginStepUpBack')}
          </button>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="login-title" className="auth-page">
      <h1 id="login-title">{t('auth.loginTitle')}</h1>
      {accountActivated && (
        <p role="status">
          {t('auth.accountActivatedSignIn')}
        </p>
      )}
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
      {lostAuthenticatorLink}
      <p>
        {t('auth.needAccount')} <Link to="/register">{t('auth.registerLink')}</Link>
      </p>
    </section>
  );
}
