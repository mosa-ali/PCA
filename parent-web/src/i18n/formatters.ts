// The ONE place this app formats a date, a time, a number or a duration.
//
// The bug that forced this module out of the page components: under Arabic the
// free-access banner rendered
//
//     ينتهي بتاريخ October 3, 2026
//
// -- an English month inside an Arabic sentence -- because the call site was
// `date.toLocaleDateString(undefined, { ... })`. `undefined` does not mean
// "the app's language"; it means "whatever locale the host browser happens to
// run in". Three more call sites called `toLocaleString()` with no argument at
// all. Every other call site in the app already threaded `i18n.language`
// through by hand, which is exactly the kind of discipline that decays.
//
// So: every function here takes an EXPLICIT `lng`. None of them has a default,
// none of them can silently fall back to the host locale, and
// tests/unit/noDirectLocaleFormatting.test.ts fails the build if a new call
// site starts formatting on its own.
//
// Null/invalid input returns a stable dash rather than the string
// "Invalid Date". Rendering "Invalid Date" to a parent is both ugly and a
// small lie: it looks like a value where there is none.
//
// Values embedded in a translated sentence must still be wrapped in
// `<bdi class="iso">` by the caller -- isolating a formatted run from the
// surrounding paragraph is a markup concern this module cannot do for you.

/** What every formatter returns when there is genuinely no value to show. */
export const NO_VALUE = '--';

/**
 * `Intl` throws a RangeError on a malformed language tag. Falling back to the
 * host locale there would reintroduce the exact bug this module exists to fix,
 * so the fallback is the app's own default language instead.
 */
const FALLBACK_LANGUAGE = 'en';

function resolveLanguage(lng: string): string {
  if (typeof lng !== 'string' || lng.trim() === '') return FALLBACK_LANGUAGE;
  try {
    // Throws for a structurally invalid tag; cheap and done once per call.
    Intl.NumberFormat.supportedLocalesOf([lng]);
    return lng;
  } catch {
    return FALLBACK_LANGUAGE;
  }
}

/** A valid Date, or null for null/empty/unparseable input. */
function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWith(iso: string | null | undefined, lng: string, options: Intl.DateTimeFormatOptions): string {
  const date = toDate(iso);
  if (!date) return NO_VALUE;
  try {
    return new Intl.DateTimeFormat(resolveLanguage(lng), options).format(date);
  } catch {
    return NO_VALUE;
  }
}

/** A full calendar date: "October 3, 2026" under `en`, "3 أكتوبر 2026" under `ar`. */
export function formatDate(iso: string | null | undefined, lng: string): string {
  return formatWith(iso, lng, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Date plus clock time -- the default for expiry timestamps and audit rows. */
export function formatDateTime(iso: string | null | undefined, lng: string): string {
  return formatWith(iso, lng, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Clock time only. */
export function formatTime(iso: string | null | undefined, lng: string): string {
  return formatWith(iso, lng, { timeStyle: 'short' });
}

/**
 * "12 minutes ago" / "قبل 12 دقيقة". Lifted verbatim from the dashboard, which
 * held the only correct relative-time implementation in the app, so every
 * surface now phrases "last sync" the same way.
 */
export function formatRelative(iso: string | null | undefined, lng: string): string {
  const date = toDate(iso);
  if (!date) return NO_VALUE;
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  try {
    const rtf = new Intl.RelativeTimeFormat(resolveLanguage(lng), { numeric: 'auto' });
    if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute');
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
    const days = Math.round(hours / 24);
    return rtf.format(-days, 'day');
  } catch {
    return NO_VALUE;
  }
}

/**
 * A plain count. Locale-aware so Arabic renders Arabic-Indic digits where the
 * locale calls for them, and so grouping separators are never hardcoded.
 */
export function formatNumber(value: number | null | undefined, lng: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE;
  try {
    return new Intl.NumberFormat(resolveLanguage(lng)).format(value);
  } catch {
    return NO_VALUE;
  }
}

/**
 * A duration in minutes, with its unit word in the caller's language.
 *
 * `style: 'unit'` is not available on every runtime this app can be opened in,
 * so a runtime without it degrades to the localized numeral alone rather than
 * to an English "minutes" glued onto an Arabic sentence.
 */
export function formatMinutes(value: number | null | undefined, lng: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE;
  const language = resolveLanguage(lng);
  try {
    return new Intl.NumberFormat(language, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(value);
  } catch {
    return formatNumber(value, language);
  }
}
