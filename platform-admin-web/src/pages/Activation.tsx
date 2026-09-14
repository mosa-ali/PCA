import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { platformAdminActivationApi } from '../api/platformAdminActivationClient';
import { PlatformAdminApiError } from '../api/platformAdminAuthClient';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';

export default function Activation() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    window.history.replaceState({}, document.title, `${window.location.pathname}`);
    if (!token) { setError(t('activation.invalid')); setBusy(false); return; }
    platformAdminActivationApi.start(token).then((result) => setOtpauthUri(result.otpauthUri)).catch(() => setError(t('activation.invalid'))).finally(() => setBusy(false));
  }, [token, t]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await platformAdminActivationApi.complete(token, password, totpCode); navigate('/login', { replace: true }); }
    catch (err) { setError(err instanceof PlatformAdminApiError ? t('activation.invalid') : t('activation.invalid')); }
    finally { setBusy(false); }
  };
  return <div className="login-page"><div className="login-language-bar"><LanguageSwitcher /></div><form className="card login-card" onSubmit={submit} noValidate>
    <h1>{t('activation.title')}</h1>
    {busy && !otpauthUri && !error ? <p>{t('activation.loading')}</p> : null}
    {otpauthUri && <><p>{t('activation.instructions')}</p><label htmlFor="activation-uri">{t('activation.uri')}</label><textarea id="activation-uri" readOnly value={otpauthUri} rows={3} /></>}
    <label htmlFor="activation-password">{t('activation.password')}</label><input id="activation-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={(e) => setPassword(e.target.value)} />
    <label htmlFor="activation-totp">{t('activation.totp')}</label><input id="activation-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    {error && <p role="alert" className="field-error">{error}</p>}
    <button type="submit" className="btn btn-primary" disabled={busy || !otpauthUri || password.length < 12 || totpCode.length !== 6}>{t('activation.submit')}</button>
  </form></div>;
}
