import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { PlatformAdminApiError } from '../api/platformAdminAuthClient';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';

/**
 * Single-form credentials + MFA login (mission Section 5/6). The backend
 * (POST /platform-admin/auth/login) requires email, password, and totpCode
 * together in one request -- there is no separate "submit password, then
 * get challenged for a code" round trip server-side, so this form collects
 * all three before the first submit rather than fabricating an
 * intermediate challenge step the API doesn't have.
 *
 * A generic "unauthorized" response is intentionally indistinguishable
 * here between wrong password, wrong TOTP code, an expired/replayed code,
 * and a locked account -- the backend never reveals which factor failed
 * (an enumeration-resistance property this UI must not defeat by guessing).
 * Only rate-limiting (429) is a materially different, user-actionable case.
 */
export default function Login() {
  const { t } = useTranslation();
  const { status, login, signOutReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (signOutReason === 'EXPIRED') setError(t('shell.sessionExpired'));
    if (signOutReason === 'REVOKED') setError(t('shell.sessionRevoked'));
  }, [signOutReason, t]);

  if (status === 'SIGNED_IN') {
    const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password, totpCode);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof PlatformAdminApiError) {
        if (err.status === 429) setError(t('login.errorRateLimited'));
        else setError(t('login.errorUnauthorized'));
      } else {
        setError(t('login.errorGeneric'));
      }
      setTotpCode('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-language-bar">
        <LanguageSwitcher />
      </div>
      <form className="card login-card" onSubmit={handleSubmit} noValidate>
        <h1>{t('login.title')}</h1>
        <p className="login-subtitle">{t('login.subtitle')}</p>

        <label htmlFor="login-email">{t('login.emailLabel')}</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="login-password">{t('login.passwordLabel')}</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label htmlFor="login-totp">{t('login.totpLabel')}</label>
        <input
          id="login-totp"
          name="totpCode"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={totpCode}
          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
          aria-describedby="login-totp-hint"
        />
        <p id="login-totp-hint" className="field-hint">
          {t('login.totpHint')}
        </p>

        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={submitting || totpCode.length !== 6}>
          {submitting ? t('login.submitting') : t('login.submit')}
        </button>

        <p className="login-mfa-note">{t('login.noSkipMfa')}</p>
      </form>
    </div>
  );
}
