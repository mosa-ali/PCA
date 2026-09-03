// Guard for the design spec's date/time formatting rule.
//
// The observed bug was `expiresAtDate.toLocaleDateString(undefined, {...})` in
// the free-access banner, which rendered
//
//     ينتهي بتاريخ October 3, 2026
//
// to an Arabic parent: `undefined` is not "the app's language", it is "the
// host browser's locale". Three more call sites called `toLocaleString()` with
// no argument at all.
//
// Two separate contracts are asserted here, and they are deliberately not the
// same strictness:
//
//   A. NO NEW direct call site. `src/i18n/formatters.ts` is the one module
//      allowed to touch `toLocale*` / `new Intl.*`. Every existing call site is
//      pinned below by file path. The list may SHRINK freely as pages migrate
//      (that is the goal), but a file not on it fails immediately.
//
//   B. NO NEW call site that omits the locale entirely. This is the actual bug
//      class, and the four files that still have it are pinned separately and
//      named with their owner, so they are visible rather than forgotten.
//
// A subset assertion rather than an exact one, on purpose: an exact `toEqual`
// would turn every migration into a failing build for whoever did the fixing.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src');

/** The single module allowed to format dates, times and numbers. */
const FORMATTER_MODULE = 'i18n/formatters.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

function posix(file: string): string {
  return relative(SRC, file).split(sep).join('/');
}

/** `toLocaleDateString(`, `toLocaleTimeString(`, `toLocaleString(`, `new Intl.X(`. */
const DIRECT_CALL = /\.toLocale(?:Date|Time)?String\s*\(|new\s+Intl\.[A-Za-z]+\s*\(/g;

/**
 * The same call with no explicit locale: `toLocaleString()`,
 * `toLocaleDateString(undefined, ...)`, `new Intl.DateTimeFormat()`.
 *
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` is deliberately NOT
 * matched: it is a timezone lookup with no locale-dependent output, and it has
 * no `new`.
 */
const OMITS_LOCALE = /(?:\.toLocale(?:Date|Time)?String|new\s+Intl\.[A-Za-z]+)\s*\(\s*(?:\)|undefined\b)/g;

function filesMatching(pattern: RegExp): string[] {
  const hits = new Set<string>();
  for (const file of walk(SRC)) {
    const name = posix(file);
    if (name === FORMATTER_MODULE) continue;
    const source = readFileSync(file, 'utf8');
    pattern.lastIndex = 0;
    if (pattern.test(source)) hits.add(name);
  }
  return [...hits].sort();
}

// Every file that still formats on its own. All of these already thread
// `i18n.language` through by hand -- correct today, but the discipline is what
// decayed into the observed bug, so new ones are not accepted.
const KNOWN_DIRECT_CALLERS = new Set([
  'components/freeaccess/FreeAccessReminderBannerView.tsx',
  'domain/billing.ts',
  'pages/Dashboard.tsx',
  'pages/Notifications.tsx',
  'pages/Requests.tsx',
  'pages/Subscription.tsx',
  'pages/billing/DeviceIncreaseRequest.tsx',
  'pages/billing/InvoiceDetail.tsx',
  'pages/billing/Invoices.tsx',
  'pages/children/ActivityTimelinePage.tsx',
  'pages/children/EyeProtectionPage.tsx',
  'pages/children/LocationPage.tsx',
  'pages/family/DeviceEnrollmentPanel.tsx',
  'pages/family/Members.tsx',
  'pages/family/ProtectionAdministrationPanel.tsx',
  'pages/security/Audit.tsx',
  'pages/security/ProtectionAlertPanel.tsx',
]);

// The four sites that omit the locale outright -- the actual defect. Each is
// listed with the writer who owns that file, so this list is a work item and
// not a permanent exemption.
const KNOWN_LOCALE_OMISSIONS = new Set([
  // The observed `October 3, 2026` in Arabic. Owned by no PPR-2 writer; raised
  // to the coordinator rather than fixed from outside its owner.
  'components/freeaccess/FreeAccessReminderBannerView.tsx',
  'pages/family/DeviceEnrollmentPanel.tsx', // W-ENROLL
  'pages/family/Members.tsx', // W-ENROLL
  'pages/family/ProtectionAdministrationPanel.tsx', // W-ENROLL
]);

describe('date/time/number formatting goes through src/i18n/formatters.ts', () => {
  it('adds no new direct toLocale* / Intl.* call site', () => {
    const unexpected = filesMatching(DIRECT_CALL).filter((file) => !KNOWN_DIRECT_CALLERS.has(file));
    expect(unexpected).toEqual([]);
  });

  it('adds no new call site that omits the locale argument', () => {
    const unexpected = filesMatching(OMITS_LOCALE).filter((file) => !KNOWN_LOCALE_OMISSIONS.has(file));
    expect(unexpected).toEqual([]);
  });

  it('never grows either pinned list', () => {
    // Shrinking is the goal and must not fail the build; growing is the
    // regression this file exists to catch.
    expect(filesMatching(DIRECT_CALL).length).toBeLessThanOrEqual(KNOWN_DIRECT_CALLERS.size);
    expect(filesMatching(OMITS_LOCALE).length).toBeLessThanOrEqual(KNOWN_LOCALE_OMISSIONS.size);
  });

  it('keeps the formatter module itself as the one place that may call Intl', () => {
    const source = readFileSync(resolve(SRC, FORMATTER_MODULE), 'utf8');
    expect(source).toMatch(/new Intl\.DateTimeFormat/);
    expect(source).toMatch(/new Intl\.RelativeTimeFormat/);
    expect(source).toMatch(/new Intl\.NumberFormat/);
    // Every exported formatter takes an explicit `lng`; none may default it.
    for (const fn of ['formatDate', 'formatDateTime', 'formatTime', 'formatRelative', 'formatNumber', 'formatMinutes']) {
      expect(source, `${fn} must be exported`).toMatch(new RegExp(`export function ${fn}\\(`));
    }
    expect(source, 'no formatter may default its language argument').not.toMatch(/lng\s*[:=][^,)]*=\s*['"]/);
  });
});
