/**
 * Normalize an optional international phone number to E.164 syntax.
 *
 * This validates representation only. It does not guess a country code or
 * claim that the number is reachable or verified; the server owns those
 * decisions. National-format numbers are intentionally rejected because the
 * Parent account has no reliable default country to apply.
 */
export type OptionalPhoneNormalization =
  | { valid: true; value: string | null }
  | { valid: false; reason: 'invalid_characters' | 'international_prefix_required' | 'invalid_length' };

function asciiDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
    const code = digit.codePointAt(0)!;
    const start = code <= 0x0669 ? 0x0660 : 0x06f0;
    return String(code - start);
  });
}

export function normalizeOptionalParentPhone(input: unknown): OptionalPhoneNormalization {
  if (input === null || input === undefined) return { valid: true, value: null };
  if (typeof input !== 'string') return { valid: false, reason: 'invalid_characters' };
  if (input.length > 64) return { valid: false, reason: 'invalid_length' };

  const trimmed = asciiDigits(input.trim());
  if (!trimmed) return { valid: true, value: null };
  if (!/^[+\d\s().-]+$/.test(trimmed)) return { valid: false, reason: 'invalid_characters' };

  const compact = trimmed.replace(/[\s().-]/g, '');
  const international = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  if (!international.startsWith('+') || international.indexOf('+', 1) !== -1) {
    return { valid: false, reason: 'international_prefix_required' };
  }

  const digits = international.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(digits)) return { valid: false, reason: 'invalid_length' };
  return { valid: true, value: `+${digits}` };
}
