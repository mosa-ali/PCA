// Locale-file contracts that the shipped copy must keep holding:
//
//  1. No developer-facing marker ("(dev stub)", "TODO", "(dev)", ...) may ever
//     be part of a string a real user reads. `stepUp.confirm` was
//     "Re-authenticate (dev stub)" on the PRIMARY button of the step-up modal,
//     and StepUpProvider is mounted app-wide in main.tsx with no fixture/demo
//     gate at all, so every real parent performing a sensitive action saw it.
//  2. No value may put two interpolated NUMERIC runs on either side of a
//     bidi-neutral separator. Under an RTL paragraph UAX#9 resolves that
//     neutral to R and reverses the run, so "{{start}} - {{end}}" displayed a
//     21:30-07:00 bedtime window to an Arabic parent with the times swapped.
//  3. Keys that pages look up unconditionally must actually exist in BOTH
//     locales (devicesTable.removeRequestFailed existed in neither).
import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

function flatten(value: unknown, prefix = '', result: Record<string, string> = {}): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  } else {
    result[prefix] = String(value);
  }
  return result;
}

const EN = flatten(en);
const AR = flatten(ar);

const DEVELOPER_MARKERS: { label: string; pattern: RegExp }[] = [
  { label: 'dev stub', pattern: /dev\s*stub/i },
  { label: '(dev)', pattern: /\(\s*dev\s*\)/i },
  { label: 'TODO', pattern: /\bTODO\b/ },
  { label: 'FIXME', pattern: /\bFIXME\b/ },
  { label: 'XXX', pattern: /\bXXX\b/ },
  { label: 'placeholder', pattern: /placeholder/i },
  { label: 'lorem ipsum', pattern: /lorem ipsum/i },
  { label: 'نموذج تطوير', pattern: /نموذج تطوير/ },
];

describe('shipped locale copy carries no developer-facing markers', () => {
  for (const [name, locale] of [['en', EN], ['ar', AR]] as const) {
    it(`${name}.json has no developer marker in any value`, () => {
      const offenders: string[] = [];
      for (const [key, value] of Object.entries(locale)) {
        for (const marker of DEVELOPER_MARKERS) {
          if (marker.pattern.test(value)) offenders.push(`${key} -> "${value}" (${marker.label})`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  it('the step-up modal primary button is honest production copy', () => {
    expect(EN['stepUp.confirm']).toBe('Re-authenticate');
    expect(AR['stepUp.confirm']).toBe('إعادة المصادقة');
  });
});

// A value shaped `{{a}}<neutral>{{b}}` is only a bug when BOTH interpolated
// values are numeric runs. This is the one key where they are not:
// `subscription.checkoutReturn.providerStatus` interpolates a payment-provider
// status word (a strong-L run like "SUCCEEDED") next to a formatted amount, so
// N1/N2 never resolve the gap into a reversal of the two. It is listed
// explicitly rather than silently skipped.
const BIDI_NEUTRAL_GAP_ALLOWLIST = new Set(['subscription.checkoutReturn.providerStatus']);

function unanchoredPlaceholderPairs(locale: Record<string, string>): string[] {
  const placeholder = /\{\{\s*[^}]+?\s*\}\}/g;
  const offenders: string[] = [];
  for (const [key, value] of Object.entries(locale)) {
    if (BIDI_NEUTRAL_GAP_ALLOWLIST.has(key)) continue;
    const matches = [...value.matchAll(placeholder)];
    for (let i = 0; i + 1 < matches.length; i += 1) {
      const gap = value.slice(
        (matches[i].index ?? 0) + matches[i][0].length,
        matches[i + 1].index ?? 0,
      );
      // A strong-directional letter (Latin or Arabic) between the two runs is
      // what stops the neutral from taking the paragraph direction and
      // reordering them.
      if (gap.length > 0 && !/\p{L}/u.test(gap)) offenders.push(`${key} -> "${value}"`);
    }
  }
  return offenders;
}

describe('no interpolated numeric runs flank a bare bidi neutral', () => {
  // Scanned for the RTL locale only, on purpose. The reversal this guards
  // against is a property of the PARAGRAPH direction, not of the string: in an
  // LTR paragraph (every locale isRtl() reports false for, which is how
  // applyDocumentDirection sets document dir) the neutral resolves L and the
  // two runs keep their logical order. en.json's
  // `screenTime.nightProtectionWindow` is therefore correct as
  // "{{start}} - {{end}}" and is deliberately left alone; only the Arabic
  // value needed restructuring. A new RTL locale would be added to this list.
  it('ar.json has none', () => {
    expect(unanchoredPlaceholderPairs(AR)).toEqual([]);
  });

  it('the Arabic night-protection window names its start and end explicitly', () => {
    const value = AR['screenTime.nightProtectionWindow'];
    // "from {{start}} to {{end}}" -- the words are what make the start time
    // unambiguously first once UAX#9 reverses the RTL line.
    expect(value).toBe('من {{start}} إلى {{end}}');
    expect(value.indexOf('{{start}}')).toBeLessThan(value.indexOf('{{end}}'));
  });
});

describe('keys pages look up unconditionally exist in both locales', () => {
  const REQUIRED = [
    'devicesTable.removeRequestFailed',
    'devicesTable.osFamily.ANDROID',
    'devicesTable.osFamily.IOS',
    'deleteNow.deliveryStatusValue.DELETE_PENDING_REMOTE_DEVICE',
    'requestsPage.types.BONUS_TIME',
    'requestsPage.types.INSTALL_APPROVAL',
    'requestsPage.decisionCancelled',
    'shell.primaryNav',
    'settings.loadPreferencesFailed',
    'settings.saveLanguageFailed',
    'errors.cryptoReviewRequired',
    'errors.endpointNotTrusted',
    'errors.serviceUnavailable',
    'errors.unknown',
  ];

  for (const key of REQUIRED) {
    it(`${key} is present and non-empty in en and ar`, () => {
      expect(EN[key]?.trim(), `en ${key}`).toBeTruthy();
      expect(AR[key]?.trim(), `ar ${key}`).toBeTruthy();
      // Arabic must be a real translation, never the English text copied over.
      expect(AR[key], `ar ${key} is not the English string`).not.toBe(EN[key]);
    });
  }
});
