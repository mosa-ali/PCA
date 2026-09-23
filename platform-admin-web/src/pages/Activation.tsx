import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
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
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // The enrollment URI is a SECRET-BEARING value: anyone who scans or reads it
  // holds the TOTP secret. It was previously rendered in a permanently visible
  // readOnly textarea, which put the secret on screen for every shoulder, screen
  // share and screenshot. It is now revealed only on explicit request.
  const [uriRevealed, setUriRevealed] = useState(false);

  // DEPENDENCIES ARE [token] ONLY, AND THAT IS LOAD-BEARING.
  //
  // This effect used to depend on `t` as well, and react-i18next hands back a
  // NEW `t` on every language change. Switching language on this page therefore
  // re-ran `start`, which on the backend goes through beginMfa's single-winner
  // guard: the second call is refused, the client maps that to
  // activation.invalid, and a parent who merely switched to a language they
  // read better was told their activation link was invalid -- mid-ceremony,
  // with the enrollment secret already issued. The error is stored as a KEY and
  // translated at render, so the copy still follows the active language without
  // anything language-dependent inside the dep array.
  useEffect(() => {
    window.history.replaceState({}, document.title, `${window.location.pathname}`);
    if (!token) { setErrorKey('activation.invalid'); setBusy(false); return; }
    platformAdminActivationApi.start(token).then((result) => setOtpauthUri(result.otpauthUri)).catch(() => setErrorKey('activation.invalid')).finally(() => setBusy(false));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setErrorKey(null);
    try { await platformAdminActivationApi.complete(token, password, totpCode); navigate('/login', { replace: true }); }
    catch (err) { setErrorKey(err instanceof PlatformAdminApiError ? 'activation.invalid' : 'activation.invalid'); }
    finally { setBusy(false); }
  };
  return <div className="login-page"><div className="login-language-bar"><LanguageSwitcher /></div><form className="card login-card" onSubmit={submit} noValidate>
    <h1>{t('activation.title')}</h1>
    {busy && !otpauthUri && !errorKey ? <p>{t('activation.loading')}</p> : null}
    {otpauthUri && <><p>{t('activation.instructions')}</p>
      {/* Rendered entirely in this browser from the URI already returned by the
          authorized activation call. QRCodeSVG draws the modules itself -- no
          image URL, no remote renderer, and the URI never leaves the page. The
          group is labelled so the code is not an unlabelled graphic, and the
          SVG inside is hidden from assistive tech so the URI is announced once
          via the label rather than as a second, meaningless image. The textual
          instructions above remain the primary content: a QR is not usable by
          every screen reader or low-vision user, and the manual reveal below is
          the documented fallback. */}
      <div role="img" aria-label={t('activation.qrAlt')}>
        <QRCodeSVG value={otpauthUri} size={176} level="M" aria-hidden="true" focusable="false" />
      </div>
      <p>{t('activation.qrHint')}</p>
      {uriRevealed ? <><label htmlFor="activation-uri">{t('activation.uri')}</label><textarea id="activation-uri" readOnly value={otpauthUri} rows={3} /><button type="button" className="btn" onClick={() => setUriRevealed(false)}>{t('activation.hideUri')}</button></> : <button type="button" className="btn" onClick={() => setUriRevealed(true)}>{t('activation.showUri')}</button>}
    </>}
    <label htmlFor="activation-password">{t('activation.password')}</label><input id="activation-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={(e) => setPassword(e.target.value)} />
    <label htmlFor="activation-totp">{t('activation.totp')}</label><input id="activation-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    {errorKey && <p role="alert" className="field-error">{t(errorKey)}</p>}
    <button type="submit" className="btn btn-primary" disabled={busy || !otpauthUri || password.length < 12 || totpCode.length !== 6}>{t('activation.submit')}</button>
  </form></div>;
}
