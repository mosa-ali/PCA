import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';

/**
 * PCA-AUTH-SESSION-1 (PCA-DEC-026) self-service registration. Server
 * validates password===passwordConfirmation itself (PCA-ADD-IDENT-004) --
 * this page's own client-side check is UX-only, never trusted alone.
 */
export default function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const clients = getApiClients();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== passwordConfirmation) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      await clients.serviceAuth.register(email, password, passwordConfirmation);
      navigate('/verify-email', { state: { email } });
    } catch (err) {
      if (err instanceof ServiceAuthError && err.code === 'RATE_LIMITED') {
        setError(t('auth.rateLimited'));
      } else {
        setError(t('auth.genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="register-title" className="auth-page">
      <h1 id="register-title">{t('auth.registerTitle')}</h1>
      <p>{t('auth.registerBody')}</p>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="register-email">{t('auth.emailLabel')}</label>
        <input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="register-password">{t('auth.passwordLabel')}</label>
        <input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label htmlFor="register-password-confirmation">{t('auth.passwordConfirmationLabel')}</label>
        <input
          id="register-password-confirmation"
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={passwordConfirmation}
          onChange={(e) => setPasswordConfirmation(e.target.value)}
        />

        {error && (
          <p role="alert" style={{ color: 'var(--color-danger, #b00020)' }}>
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={submitting}>
          {t('auth.registerSubmit')}
        </button>
      </form>
      <p>
        {t('auth.haveAccount')} <Link to="/login">{t('auth.signInLink')}</Link>
      </p>
    </section>
  );
}
