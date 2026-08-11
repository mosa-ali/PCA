import { useTranslation } from 'react-i18next';
import { isRtl } from '../../i18n';
import { sanitizePlainText } from '../../security/sanitizeText';
import type { PreviewSurface } from '../../domain/wellbeing';

interface MessagePreviewProps {
  text: string;
  languageTag: 'en' | 'ar';
  surface: PreviewSurface;
}

/**
 * Renders a delivery preview. No ordinary wellbeing message previews as a
 * full-screen interruption -- every surface below is a small card,
 * standard-sized notification, or redacted lock-screen line. Full-screen
 * impersonation/system-warning-style behaviour is intentionally not
 * implemented anywhere in this component set.
 */
export function MessagePreview({ text, languageTag, surface }: MessagePreviewProps) {
  const { t } = useTranslation();
  const dir = isRtl(languageTag) ? 'rtl' : 'ltr';
  const safeText = sanitizePlainText(text);

  const content = (() => {
    switch (surface) {
      case 'IN_APP_CARD':
        return (
          <div className="preview-card" dir={dir} lang={languageTag}>
            <p style={{ margin: 0 }}>{safeText}</p>
          </div>
        );
      case 'STANDARD_NOTIFICATION':
        return (
          <div className="preview-notification" dir={dir} lang={languageTag}>
            <strong>{t('app.name')}</strong>
            <p style={{ margin: '0.25rem 0 0' }}>{safeText}</p>
          </div>
        );
      case 'LOCK_SCREEN_REDACTED':
        return (
          <div className="preview-lockscreen" dir={dir} lang={languageTag}>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>New message available</p>
            <p style={{ margin: 0, fontSize: '0.7rem', opacity: 0.7 }}>Unlock to view</p>
          </div>
        );
      case 'MOBILE_VIEWPORT':
        return (
          <div className="preview-mobile-frame" dir={dir} lang={languageTag}>
            <div className="preview-card">
              <p style={{ margin: 0 }}>{safeText}</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  })();

  return <div className="preview-frame">{content}</div>;
}
