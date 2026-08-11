/**
 * doc 20 Section 3/6: "use bidi isolates ... around every LTR identifier, URL, email, code,
 * version, time-zone ID, number range, and technical error token in an Arabic sentence; never
 * use bidirectional overrides." Mirrors android/.../i18n/BidiUtils.kt -- same Unicode isolate
 * mechanism, same hostile-control-character sanitization contract, kept as two small platform-
 * native copies rather than a shared cross-language library, since there is no existing
 * TypeScript/Kotlin shared-code bridge in this repo to place one in.
 */
const FIRST_STRONG_ISOLATE = '⁦';
const POP_DIRECTIONAL_ISOLATE = '⁩';

const BIDI_CONTROL_CHARACTERS = new Set([
  '‎', // LEFT-TO-RIGHT MARK
  '‏', // RIGHT-TO-LEFT MARK
  '‪', // LEFT-TO-RIGHT EMBEDDING
  '‫', // RIGHT-TO-LEFT EMBEDDING
  '‬', // POP DIRECTIONAL FORMATTING
  '‭', // LEFT-TO-RIGHT OVERRIDE
  '‮', // RIGHT-TO-LEFT OVERRIDE
  '⁦', // LEFT-TO-RIGHT ISOLATE
  '⁧', // RIGHT-TO-LEFT ISOLATE
  '⁨', // FIRST STRONG ISOLATE
  '⁩', // POP DIRECTIONAL ISOLATE
]);

export function isolateLtr(token: string): string {
  return `${FIRST_STRONG_ISOLATE}${token}${POP_DIRECTIONAL_ISOLATE}`;
}

/** Strips every Unicode bidi control character from untrusted text before it is interpolated into a rendered/logged message -- a defensive removal, never an override of our own. */
export function sanitizeBidiControls(text: string): string {
  let result = '';
  for (const ch of text) {
    if (!BIDI_CONTROL_CHARACTERS.has(ch)) result += ch;
  }
  return result;
}
