import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';

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
      const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
      window.location.assign(from);
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
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="login-email">{t('auth.emailLabel')}</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" style={{ color: 'var(--color-danger, #b00020)' }}>
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={submitting}>
          {t('auth.loginSubmit')}
        </button>
      </form>
      <p>
        {t('auth.needAccount')} <Link to="/register">{t('auth.registerLink')}</Link>
      </p>
    </section>
  );
}
