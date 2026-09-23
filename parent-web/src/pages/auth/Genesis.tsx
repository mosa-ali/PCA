import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';
import { isFamilyReady } from '../../api/interfaces';
import { buildGenesisCompletion, createGenesisDeviceKey } from '../../security/genesisCeremony';
import { clearEndpointKey } from '../../security/trustedEndpointKeyStore';
import { useAuth } from '../../state/AuthContext';
import { safeReturnPath } from './Login';

/**
 * FAMILY GENESIS onboarding (PCA-DEC-020-R1).
 *
 * This page exists because a VERIFIED, AUTHENTICATED account is not the same
 * thing as an account that owns a family. Between those two states there is a
 * real, legitimate session with no family scope -- modelled explicitly as
 * GENESIS_REQUIRED (see api/interfaces.ts). Before this page existed, that
 * state had no destination at all: the parent either bounced back into a
 * family console that had no family to show, or was told their login had
 * failed. Neither was true.
 *
 * It is mounted OUTSIDE AppLayout on purpose. AppLayout is the family-console
 * chrome -- sidebar, child pickers, role-scoped navigation -- and none of it
 * can render meaningfully before a family exists. AppLayout is also what
 * redirects GENESIS_REQUIRED sessions here, so nesting this page inside it
 * would be a redirect loop by construction.
 *
 * Three deliberate properties:
 *  - The ceremony runs under the SAME session that started the step-up. The
 *    backend binds the challenge to the session that requested it.
 *  - No role is ever assigned client-side. The authoritative session is
 *    re-read AFTER the backend commits, and the console is entered only if it
 *    reports FAMILY_READY. A client that optimistically set
 *    role = 'ADMINISTRATOR' here would be granting itself authority the server
 *    had not yet recorded.
 *  - The device key is generated per attempt and never persisted, so a reload
 *    restarts the ceremony rather than resuming a half-written authority.
 */
type Stage = 'PASSWORD' | 'CODE' | 'CREATING' | 'AWAITING_SESSION' | 'UNAVAILABLE';

export default function Genesis() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const location = useLocation();
  const { session, loading } = useAuth();

  const returnPath = safeReturnPath((location.state as { from?: unknown } | null)?.from);

  const [stage, setStage] = useState<Stage>('PASSWORD');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeInvalid, setCodeInvalid] = useState(false);

  // An account that already owns a family has no business on this page --
  // e.g. the parent bookmarked it, or came back after completing onboarding.
  // Send it to the console rather than starting a second ceremony.
  //
  // A LOADED BUT UNAUTHENTICATED session is equally out of place. Every control
  // here submits to step-up endpoints that require a session, so rendering the
  // form just invites a 401 the parent cannot act on; there is no session to
  // onboard, so send them to sign in instead.
  useEffect(() => {
    if (loading) return;
    if (session === null) {
      window.location.assign('/login');
      return;
    }
    if (isFamilyReady(session)) {
      window.location.assign('/dashboard');
    }
  }, [loading, session]);

  async function handleStepUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await clients.serviceAuth.startGenesisStepUp(email, password);
      // The password is no longer needed once the one-time code has been
      // requested; drop it from component state rather than holding it across
      // the rest of the ceremony.
      setPassword('');
      setStage('CODE');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCodeInvalid(false);
    setSubmitting(true);
    setStage('CREATING');
    try {
      await clients.serviceAuth.completeGenesisStepUp(code);
      setCode('');

      // From here the account is authorised to run the ceremony, but no family
      // exists yet: the three signatures below are what actually create it.
      const device = await createGenesisDeviceKey();
      const challenge = await clients.serviceAuth.requestGenesisChallenge(device.publicKey, 'BROWSER');
      const completion = await buildGenesisCompletion(challenge);
      await clients.serviceAuth.completeGenesis(completion);

      // The backend has committed. The session cookie now describes a family,
      // but this component must not assume that -- it re-reads the
      // authoritative session and only then enters the console.
      const refreshed = await clients.serviceAuth.getSession();
      if (refreshed && isFamilyReady(refreshed)) {
        // Full navigation, not a router push, so AuthProvider remounts and
        // picks up the session it just re-read.
        window.location.assign(returnPath);
        return;
      }
      setStage('AWAITING_SESSION');
    } catch (err) {
      if (err instanceof ServiceAuthError && err.code === 'INVALID_CREDENTIALS') {
        setCodeInvalid(true);
        setError(t('auth.invalidCode'));
        setStage('CODE');
      } else if (err instanceof ServiceAuthError && (err.code === 'GENESIS_REJECTED' || err.code === 'NOT_IMPLEMENTED')) {
        // A rejected proof or an absent capability cannot be fixed by
        // retrying the code step -- sending the parent back there would only
        // burn another one-time code for an outcome that will not change.
        // Show the true state; sign-out stays reachable below.
        setError(messageFor(err));
        setStage('UNAVAILABLE');
      } else {
        setError(messageFor(err));
        setStage('CODE');
      }
      // The key generated for this attempt is single-use and the challenge may
      // already be consumed, so a retry must start from a fresh key rather than
      // reuse the one that just failed.
      clearEndpointKey();
    } finally {
      setSubmitting(false);
    }
  }

  function messageFor(err: unknown): string {
    if (err instanceof ServiceAuthError) {
      if (err.code === 'RATE_LIMITED') return t('auth.rateLimited');
      if (err.code === 'INVALID_CREDENTIALS') return t('auth.invalidCredentials');
      if (err.code === 'SESSION_EXPIRED') return t('serviceAuth.sessionExpired');
      if (err.code === 'NOT_IMPLEMENTED') return t('auth.genesisUnavailable');
      // The proof was rejected or the ceremony is unavailable: in both cases
      // the honest message is that setup cannot complete right now -- never
      // that the parent's session expired.
      if (err.code === 'GENESIS_REJECTED') return t('auth.genesisUnavailable');
    }
    return t('auth.genericError');
  }

  async function handleSignOut() {
    try {
      await clients.serviceAuth.signOut();
    } catch {
      // Sign-out is best-effort here: the redirect below is what actually
      // clears this page, and a failed sign-out must not trap the user on an
      // onboarding screen they cannot complete.
    }
    window.location.assign('/login');
  }

  return (
    <section aria-labelledby="genesis-title" className="auth-page">
      <h1 id="genesis-title">{t('auth.genesisTitle')}</h1>
      <p>{t('auth.genesisBody')}</p>

      {stage === 'PASSWORD' && (
        <form onSubmit={handleStepUpSubmit} noValidate>
          <p>{t('auth.genesisStepUpBody')}</p>
          <div className="field">
            <label htmlFor="genesis-email">{t('auth.emailLabel')}</label>
            <input
              id="genesis-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-describedby={error ? 'genesis-error' : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="genesis-password">{t('auth.passwordLabel')}</label>
            <input
              id="genesis-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-describedby={error ? 'genesis-error' : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p id="genesis-error" role="alert" className="field-error">
              {error}
            </p>
          )}
          <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
            {t('auth.genesisStepUpSubmit')}
          </button>
        </form>
      )}

      {stage === 'CODE' && (
        <form onSubmit={handleCodeSubmit} noValidate>
          <p>{t('auth.genesisCodeBody', { email })}</p>
          <div className="field">
            <label htmlFor="genesis-code">{t('auth.codeLabel')}</label>
            <input
              id="genesis-code"
              name="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              aria-describedby={error ? 'genesis-error' : undefined}
              aria-invalid={codeInvalid || undefined}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          {error && (
            <p id="genesis-error" role="alert" className="field-error">
              {error}
            </p>
          )}
          <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
            {t('auth.genesisCodeSubmit')}
          </button>
        </form>
      )}

      {stage === 'CREATING' && (
        <p role="status" aria-live="polite">
          {t('auth.genesisCreating')}
        </p>
      )}

      {stage === 'AWAITING_SESSION' && (
        <>
          <p role="status" aria-live="polite">
            {t('auth.genesisStillPending')}
          </p>
          {error && (
            <p id="genesis-error" role="alert" className="field-error">
              {error}
            </p>
          )}
        </>
      )}

      {stage === 'UNAVAILABLE' && (
        <p id="genesis-error" role="alert" className="field-error">
          {error}
        </p>
      )}

      <p>
        <button type="button" className="btn-inline" onClick={handleSignOut}>
          {t('auth.genesisSignOut')}
        </button>
      </p>
    </section>
  );
}
