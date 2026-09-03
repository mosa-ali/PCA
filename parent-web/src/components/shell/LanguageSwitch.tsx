import { useTranslation } from 'react-i18next';
import { applyDocumentDirection } from '../../i18n';

/**
 * The global language control. It lives in the header, so it is available on
 * every page, applies app-wide, preserves the current route (nothing here
 * navigates) and flips document direction with the same
 * `applyDocumentDirection` call Settings uses.
 *
 * It replaces a bare `<select>` that had NO styling rule anywhere in
 * global.css: it inherited `color: inherit` onto browser-default chrome and
 * rendered at near-invisible contrast. The defect was legibility and control
 * quality, not placement -- the control was already here.
 *
 * A two-option segmented control rather than a `<select>`: with exactly two
 * choices it shows both languages at once, is one tap instead of two, and has
 * no OS-supplied chrome to fight (`.lang-switch` in global.css, AA at every
 * state). `aria-pressed` carries the current choice; the group carries the
 * "Language" name so a screen reader announces what the pair is for.
 *
 * `lang` on each button is mandatory: without `lang="ar"` a screen reader
 * pronounces "العربية" with the English voice.
 *
 * Persistence uses the existing, approved mechanism and nothing else --
 * `i18n.changeLanguage` writes the choice to this browser's i18next language
 * cache (`caches: ['localStorage']`, see src/i18n/index.ts), which is what
 * makes it survive a reload and take effect before React renders. The
 * account-level preference is still owned by Settings; this control does not
 * write to it, so a header switch can never fail on a backend that is
 * unreachable.
 */
const LANGUAGES = [
  // Source order is deliberate and identical in both directions: these are two
  // proper nouns, not a directional sequence, so nothing here mirrors.
  { code: 'en', short: 'EN', long: 'EN', nameKey: 'shell.languageEnglish' },
  { code: 'ar', short: 'ع', long: 'العربية', nameKey: 'shell.languageArabic' },
] as const;

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const current = i18n.language.split('-')[0];

  const choose = (code: string) => {
    if (code === current) return;
    void i18n.changeLanguage(code);
    applyDocumentDirection(code);
  };

  return (
    <div className="lang-switch" role="group" aria-label={t('shell.language')}>
      {LANGUAGES.map((language) => (
        <button
          key={language.code}
          type="button"
          className="lang-switch-option"
          lang={language.code}
          // The accessible name is the language's own endonym, so it is stable
          // whatever the viewport does to the visible label below. It also
          // contains the visible label ("English" contains "EN", "العربية"
          // contains "ع"), which is what WCAG 2.5.3 label-in-name requires.
          aria-label={t(language.nameKey)}
          aria-pressed={current === language.code}
          onClick={() => choose(language.code)}
          // `.lang-switch-option` in global.css sets only `min-block-size`, so
          // at narrow widths the short-form option collapsed to 23px wide
          // (measured in a real browser at 375px). That is under WCAG 2.2 SC
          // 2.5.8's 24px AA minimum, and the 2px gap between the two options
          // means the spacing exemption does not apply.
          //
          // 36px, matching the rule's own `min-block-size`, rather than the
          // 44px touch target. The header's budget at 320px is genuinely
          // tight: measured in a real browser with the Download action
          // configured, 44px options put the header's scrollWidth at 344
          // against a 320px viewport. 36x36 clears the AA minimum by half
          // again and brings it back inside. Raised as a request for the rule
          // itself, together with the header's mobile gap/padding.
          style={{ minInlineSize: '2.25rem' }}
        >
          {/* Narrow viewports show the short code. Both spans are always in the
              DOM and the stylesheet picks one, so the accessible name above --
              not the visible text -- is what assistive tech reads either way. */}
          <span aria-hidden="true" className="desktop-only">
            {language.long}
          </span>
          <span aria-hidden="true" className="mobile-only">
            {language.short}
          </span>
        </button>
      ))}
    </div>
  );
}
