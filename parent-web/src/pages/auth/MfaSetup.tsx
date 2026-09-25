import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import type { MfaEnrollmentStart } from '../../api/interfaces';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';
import { useAuth } from '../../state/AuthContext';
import { TotpQrCode } from '../../components/auth/TotpQrCode';
import { safeReturnPath } from './Login';

/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP": easier to read aloud and to type into an app by hand. */
function groupSecret(secret: string): string {
  return (secret.replace(/\s+/g, '').match(/.{1,4}/g) ?? []).join(' ');
}

interface MfaSetupLocationState {
  email?: unknown;
  from?: unknown;
}

/**
 * PCA-DEC-037 authenticator-app setup. Two ways in:
 *  - TICKET mode (no session): the grace period is over, or the parent just
 *    completed lost-authenticator recovery. The server has set a short-lived
 *    HttpOnly enrollment ticket; confirming the app signs this browser in.
 *  - SESSION mode: a signed-in parent setting the app up voluntarily during
 *    the grace period (or the rare SETUP_REQUIRED session).
 * Both start with email + password re-authentication.
 *
 * SECRET HANDLING: the otpauth URI and the secret are held in this
 * component's state ONLY. They are never written to localStorage,
 * sessionStorage, IndexedDB, a cookie, the URL or the console, the QR code is
 * drawn locally (TotpQrCode), and both are dropped from state on success and
 * when the page unmounts.
 */
export default function MfaSetup() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const location = useLocation();
  const navigate = useNavigate();
  const { session, loading, refreshSession } = useAuth();
  const locationState = (location.state as MfaSetupLocationState | null) ?? null;

  const [email, setEmail] = useState(typeof locationState?.email === 'string' ? locationState.email : '');
  const [password, setPassword] = useState('');
  const [enrollment, setEnrollment] = useState<MfaEnrollmentStart | null>(null);
  const [code, setCode] = useState('');
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  // Drop the enrollment material (and the password) when the page goes away.
  useEffect(
    () => () => {
      setEnrollment(null);
      setPassword('');
    },
    [],
  );

  if (loading) return null;
  const sessionMode = session !== null;

  function handleError(err: unknown) {
    if (err instanceof ServiceAuthError) {
      if (err.code === 'INVALID_MFA_CODE') {
        setError(t('mfa.invalidCode'));
        setCodeInvalid(true);
      } else if (err.code === 'MFA_LOCKED') setError(t('mfa.locked'));
      else if (err.code === 'RATE_LIMITED') setError(t('auth.rateLimited'));
      else if (err.code === 'INVALID_CREDENTIALS') setError(sessionMode ? t('auth.invalidCredentials') : t('mfa.setup.credentialsOrExpired'));
      else if (err.code === 'SESSION_EXPIRED') {
        setExpired(true);
        setError(t('mfa.sessionExpired'));
      } else setError(t('auth.genericError'));
    } else {
      setError(t('auth.genericError'));
    }
  }

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const started = await clients.serviceAuth.startMfaEnrollment(email, password);
      setPassword('');
      setEnrollment(started);
      setCode('');
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
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
      const result = await clients.serviceAuth.confirmMfaEnrollment(email, code);
      setEnrollment(null);
      setCode('');
      if (!sessionMode || result.sessionEstablished) {
        // Ticket path: the server has just set the session cookies. A full
        // navigation lets AuthProvider pick them up.
        window.location.assign('/dashboard');
        return;
      }
      refreshSession();
      navigate(safeReturnPath(locationState?.from), { replace: true });
    } catch (err) {
      setCode('');
      handleError(err);
      setSubmitting(false);
    }
  }

  const appsNote = <p>{t('mfa.setup.appsNote')}</p>;

  if (enrollment) {
    return (
      <section aria-labelledby="mfa-setup-title" className="auth-page">
        <h1 id="mfa-setup-title">{t('mfa.setup.title')}</h1>
        {appsNote}
        <h2>{t('mfa.setup.scanTitle')}</h2>
        <TotpQrCode value={enrollment.otpauthUri} title={t('mfa.setup.qrLabel')} />
        <details className="mfa-manual-key" data-testid="mfa-manual-key">
          <summary>{t('mfa.setup.cantScan')}</summary>
          <p>{t('mfa.setup.manualBody')}</p>
          <p>
            <span className="text-muted">{t('mfa.setup.manualKeyLabel')}</span>{' '}
            <bdi className="mfa-secret" dir="ltr" translate="no" data-testid="mfa-manual-secret">
              {groupSecret(enrollment.secret)}
            </bdi>
          </p>
        </details>
        <h2>{t('mfa.setup.confirmTitle')}</h2>
        <p>{t('mfa.setup.confirmBody')}</p>
        <form onSubmit={handleConfirm} noValidate>
          <div className="field">
            <label htmlFor="mfa-setup-code">{t('mfa.codeLabel')}</label>
            <input
              id="mfa-setup-code"
              name="totp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              aria-describedby={error ? 'mfa-setup-error' : undefined}
              aria-invalid={codeInvalid || undefined}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          {error && (
            <p id="mfa-setup-error" role="alert" className="field-error">
              {error}
            </p>
          )}
          <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
            {t('mfa.setup.confirmSubmit')}
          </button>
        </form>
        {expired && (
          <p>
            <Link to="/login">{t('auth.backToLogin')}</Link>
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="mfa-setup-title" className="auth-page">
      <h1 id="mfa-setup-title">{t('mfa.setup.title')}</h1>
      {!sessionMode && <p>{t('mfa.setup.requiredNotice')}</p>}
      <p>{t('mfa.setup.intro')}</p>
      {appsNote}
      <p>{t('mfa.setup.reauthBody')}</p>
      <form onSubmit={handleStart} noValidate>
        <div className="field">
          <label htmlFor="mfa-setup-email">{t('auth.emailLabel')}</label>
          <input
            id="mfa-setup-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={error ? 'mfa-setup-error' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="mfa-setup-password">{t('auth.passwordLabel')}</label>
          <input
            id="mfa-setup-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={error ? 'mfa-setup-error' : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p id="mfa-setup-error" role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
          {t('mfa.setup.continue')}
        </button>
      </form>
      {sessionMode ? (
        session.mfa.status !== 'SETUP_REQUIRED' && (
          <p>
            <Link to={safeReturnPath(locationState?.from)}>{t('mfa.setup.notNow')}</Link>
          </p>
        )
      ) : (
        <p>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </p>
      )}
    </section>
  );
}
