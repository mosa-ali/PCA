import { describe, expect, it } from 'vitest';
import { normalizeOptionalParentPhone } from '../../src/identity/phoneNumber';

describe('normalizeOptionalParentPhone', () => {
  it('treats an omitted or blank optional phone as absent', () => {
    expect(normalizeOptionalParentPhone(undefined)).toEqual({ valid: true, value: null });
    expect(normalizeOptionalParentPhone(null)).toEqual({ valid: true, value: null });
    expect(normalizeOptionalParentPhone('   ')).toEqual({ valid: true, value: null });
  });

  it('normalizes international formatting to E.164 and leaves the country code explicit', () => {
    expect(normalizeOptionalParentPhone(' +1 (415) 555-2671 ')).toEqual({ valid: true, value: '+14155552671' });
    expect(normalizeOptionalParentPhone('0044 20 7946 0958')).toEqual({ valid: true, value: '+442079460958' });
  });

  it('accepts Arabic-Indic digits used by Arabic keyboards', () => {
    expect(normalizeOptionalParentPhone('+٩٦٧ ٧١٢ ٣٤٥ ٦٧٨')).toEqual({ valid: true, value: '+967712345678' });
    expect(normalizeOptionalParentPhone('+۹۶۷ ۷۱۲ ۳۴۵ ۶۷۸')).toEqual({ valid: true, value: '+967712345678' });
  });

  it('rejects ambiguous national numbers instead of guessing a country code', () => {
    expect(normalizeOptionalParentPhone('(415) 555-2671')).toEqual({
      valid: false,
      reason: 'international_prefix_required',
    });
  });

  it('rejects letters, extensions, malformed prefixes, and values outside E.164 length', () => {
    expect(normalizeOptionalParentPhone('+1 415 555 CALL')).toEqual({ valid: false, reason: 'invalid_characters' });
    expect(normalizeOptionalParentPhone('+1 415 555 2671 ext. 9')).toEqual({ valid: false, reason: 'invalid_characters' });
    expect(normalizeOptionalParentPhone('++14155552671')).toEqual({
      valid: false,
      reason: 'international_prefix_required',
    });
    expect(normalizeOptionalParentPhone('+1234567')).toEqual({ valid: false, reason: 'invalid_length' });
    expect(normalizeOptionalParentPhone('+1234567890123456')).toEqual({ valid: false, reason: 'invalid_length' });
    expect(normalizeOptionalParentPhone(`+1${' '.repeat(64)}`)).toEqual({ valid: false, reason: 'invalid_length' });
  });
});
