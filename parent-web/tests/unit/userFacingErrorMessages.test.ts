// The error copy a parent reads must never be developer prose with internal
// identifiers in it, and must never be hardcoded English. These are the three
// concrete error types this app can actually produce on a data-load path, with
// their real messages (see the classes themselves) asserted as NOT being what
// the user is shown -- while still being available as diagnostics.
import { describe, expect, it } from 'vitest';
import i18n from '../../src/i18n';
import {
  describeUserFacingError,
  errorDiagnosticDetail,
  userFacingErrorKey,
} from '../../src/i18n/errorMessages';
import { EndpointNotTrustedError } from '../../src/api/familyDataAccessErrors';
import { ServiceUnavailableError } from '../../src/api/unavailable';
import { CryptoReviewRequiredError } from '@pca/parent-sdk-browser-runtime';

const t = i18n.getFixedT('en');
const tAr = i18n.getFixedT('ar');

describe('describeUserFacingError', () => {
  it('maps the crypto-review gate without leaking the internal source path', () => {
    const error = new CryptoReviewRequiredError('EnvelopeDecryptor.decrypt');
    expect(error.message).toContain('src/cryptoGate.ts');

    expect(userFacingErrorKey(error)).toBe('errors.cryptoReviewRequired');
    const shown = describeUserFacingError(error, t);
    expect(shown).toBe(t('errors.cryptoReviewRequired'));
    expect(shown).not.toContain('cryptoGate.ts');
    expect(shown).not.toContain('EnvelopeDecryptor');
  });

  it('maps the untrusted-browser-endpoint error without leaking the operation name or enum state', () => {
    const error = new EndpointNotTrustedError('BROWSER_NOT_TRUSTED', 'ParentFamilyDataGateway.getDashboard');
    expect(error.message).toContain('BROWSER_NOT_TRUSTED');
    expect(error.message).toContain('ParentFamilyDataGateway.getDashboard');

    const shown = describeUserFacingError(error, t);
    expect(shown).toBe(t('errors.endpointNotTrusted'));
    expect(shown).not.toContain('BROWSER_NOT_TRUSTED');
    expect(shown).not.toContain('ParentFamilyDataGateway');
  });

  it('maps the not-implemented backend error without leaking the interface name or repo pointer', () => {
    const error = new ServiceUnavailableError('FamilyAuthorityGateway.listMembers');
    expect(error.message).toContain('FamilyAuthorityGateway.listMembers');
    expect(error.message).toContain('src/api/client.ts');

    const shown = describeUserFacingError(error, t);
    expect(shown).toBe(t('errors.serviceUnavailable'));
    expect(shown).not.toContain('FamilyAuthorityGateway');
    expect(shown).not.toContain('src/api/client.ts');
  });

  it('falls back to a localized generic sentence for an unknown error, never to err.message', () => {
    const error = new Error('Request not found.');
    expect(userFacingErrorKey(error)).toBeNull();
    expect(describeUserFacingError(error, t)).toBe(t('errors.unknown'));
    expect(describeUserFacingError(error, t)).not.toContain('Request not found');
  });

  it('falls back for a non-Error throwable too (the old hardcoded "Unknown error" literal)', () => {
    expect(describeUserFacingError('boom', t)).toBe(t('errors.unknown'));
    expect(describeUserFacingError(undefined, t)).toBe(t('errors.unknown'));
  });

  it('is actually localized -- Arabic copy differs from English for every mapped case', () => {
    const cases: unknown[] = [
      new CryptoReviewRequiredError('EnvelopeDecryptor.decrypt'),
      new EndpointNotTrustedError('BROWSER_NOT_TRUSTED', 'ParentFamilyDataGateway.getDashboard'),
      new ServiceUnavailableError('FamilyAuthorityGateway.listMembers'),
      new Error('anything else'),
    ];
    for (const error of cases) {
      expect(describeUserFacingError(error, tAr)).not.toBe(describeUserFacingError(error, t));
      expect(describeUserFacingError(error, tAr)).toMatch(/\p{Script=Arabic}/u);
    }
  });

  it('keeps the developer diagnostic available rather than deleting it', () => {
    const error = new ServiceUnavailableError('FamilyAuthorityGateway.listMembers');
    const detail = errorDiagnosticDetail(error);
    expect(detail).toContain('ServiceUnavailableError');
    expect(detail).toContain('FamilyAuthorityGateway.listMembers');
  });
});
