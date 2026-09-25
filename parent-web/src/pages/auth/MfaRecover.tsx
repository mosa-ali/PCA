import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';
import { formatDateTime } from '../../i18n/formatters';

/**
 * PCA-DEC-037 lost-authenticator recovery.
 *
 *  1. email + password -> the server emails a recovery code IF the details
 *     match an account with an authenticator app. The page shows the same
 *     generic confirmation whatever happened (never an account/password
 *     oracle).
 *  2. the emailed code starts a database-backed 24-hour hold and revokes all
 *     sessions. After the deadline, a fresh code is required before the old
 *     factor is removed and a new-enrollment ticket is issued.
 */
export default function MfaRecover() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const location = useLocation();
  const navigate = useNavigate();
  const prefillEmail = (location.state as { email?: unknown } | null)?.email;

  const [email, setEmail] = useState(typeof prefillEmail === 'string' ? prefillEmail : '');
  const [password, setPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryAvailableAt, setRecoveryAvailableAt] = useState<string | null>(null);

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await clients.serviceAuth.requestMfaRecovery(email, password);
      setCodeSent(true);
      setCode('');
    } catch (err) {
      if (err instanceof ServiceAuthError && err.code === 'RATE_LIMITED') setError(t('auth.rateLimited'));
      else setError(t('auth.genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCodeInvalid(false);
    setSubmitting(true);
    try {
      const result = await clients.serviceAuth.completeMfaRecovery(email, password, code);
      setPassword('');
      setCode('');
      if (result.status === 'MFA_RECOVERY_PENDING') {
        setRecoveryAvailableAt(result.recoveryAvailableAt);
        setCodeSent(false);
        setSubmitting(false);
        return;
      }
      navigate('/mfa/setup', { replace: true, state: { email } });
    } catch (err) {
      if (err instanceof ServiceAuthError) {
        if (err.code === 'RATE_LIMITED') setError(t('auth.rateLimited'));
        else if (err.code === 'INVALID_CREDENTIALS') {
          setError(t('mfa.recover.invalidCode'));
          setCodeInvalid(true);
        } else setError(t('auth.genericError'));
      } else {
        setError(t('auth.genericError'));
      }
      setSubmitting(false);
    }
  }

  const consequences = (
    <div className="field-warning" role="note">
      <p>{t('mfa.recover.consequences')}</p>
    </div>
  );

  if (recoveryAvailableAt) {
    return (
      <section aria-labelledby="mfa-recover-title" className="auth-page">
        <h1 id="mfa-recover-title">{t('mfa.recover.title')}</h1>
        <p role="status">{t('mfa.recover.pending', { date: formatDateTime(recoveryAvailableAt, i18n.language) })}</p>
        <p>{t('mfa.recover.pendingNextStep')}</p>
        <button type="button" className="btn" onClick={() => setRecoveryAvailableAt(null)}>
          {t('mfa.recover.continueAfterHold')}
        </button>
        <p><Link to="/login">{t('auth.backToLogin')}</Link></p>
      </section>
    );
  }

  if (codeSent) {
    return (
      <section aria-labelledby="mfa-recover-title" className="auth-page">
        <h1 id="mfa-recover-title">{t('mfa.recover.title')}</h1>
        <p role="status">{t('mfa.recover.sentBody')}</p>
        {consequences}
        <form onSubmit={handleComplete} noValidate>
          <div className="field">
            <label htmlFor="mfa-recover-code">{t('mfa.recover.codeLabel')}</label>
            <input
              id="mfa-recover-code"
              name="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              aria-describedby={error ? 'mfa-recover-error' : undefined}
              aria-invalid={codeInvalid || undefined}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          {error && (
            <p id="mfa-recover-error" role="alert" className="field-error">
              {error}
            </p>
          )}
          <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
            {t('mfa.recover.completeSubmit')}
          </button>
        </form>
        <p>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="mfa-recover-title" className="auth-page">
      <h1 id="mfa-recover-title">{t('mfa.recover.title')}</h1>
      <p>{t('mfa.recover.body')}</p>
      {consequences}
      <form onSubmit={handleRequest} noValidate>
        <div className="field">
          <label htmlFor="mfa-recover-email">{t('auth.emailLabel')}</label>
          <input
            id="mfa-recover-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={error ? 'mfa-recover-error' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="mfa-recover-password">{t('auth.passwordLabel')}</label>
          <input
            id="mfa-recover-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={error ? 'mfa-recover-error' : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p id="mfa-recover-error" role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
          {t('mfa.recover.requestSubmit')}
        </button>
      </form>
      <p>
        <Link to="/login">{t('auth.backToLogin')}</Link>
      </p>
    </section>
  );
}
