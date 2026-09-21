import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reads the JSON manifest backend/scripts/seed-local.mjs writes after a
 * successful seed run (backend/qa-seed-manifest.json by default) --
 * dedicated per-test account emails/familyIds/codes, keyed by purpose, so
 * each Playwright test can look up ITS OWN account instead of hardcoding
 * or reusing one across tests (see seed-local.mjs's own header for why:
 * shared accounts accumulate real rate-limit/anti-replay state across a
 * run).
 */
interface ParentAccountEntry {
  email: string;
  accountId?: string;
  familyId?: string;
  /**
   * A real, already-issued daily-login grant for this account (see
   * seed-local.mjs's registerAndVerifyFamily). Only its domain-separated hash is
   * persisted server-side; this raw token exists nowhere else. A browser spec
   * that logs in through /login MUST present it, because ParentAccountService
   * .login refuses to establish a session on a password alone -- it either sees
   * a valid grant for that exact browser or issues an emailed step-up code,
   * which a Playwright process can never receive.
   */
  dailyLoginGrant?: string;
}

interface QaSeedManifest {
  seedPassword: string;
  parentAccounts: Record<string, ParentAccountEntry>;
  adminAccounts: Record<string, { email: string; role: string; adminId: string; totpSecretBase32: string }>;
  codes: { pendingVerificationCode?: string; pendingResetCode?: string };
  invoices: Record<string, { paidInvoiceId: string; openInvoiceId: string; familyId: string }>;
}

const manifestPath = fileURLToPath(new URL('../../backend/qa-seed-manifest.json', import.meta.url));

let cached: QaSeedManifest | null = null;

export function loadQaManifest(): QaSeedManifest {
  if (cached) return cached;
  const raw = readFileSync(manifestPath, 'utf8');
  cached = JSON.parse(raw) as QaSeedManifest;
  return cached;
}

export function parentAccount(key: string): ParentAccountEntry {
  const manifest = loadQaManifest();
  const entry = manifest.parentAccounts[key];
  if (!entry) throw new Error(`No seeded parent account for key "${key}" -- run backend/scripts/seed-local.mjs first.`);
  return entry;
}

export function seedPassword(): string {
  return loadQaManifest().seedPassword;
}

/**
 * The daily-login grant seeded for `email`, looked up by address rather than by
 * purpose-key: acceptance-flow.spec.ts identifies its accounts by email (they
 * are named in the owner's acceptance script), and a second lookup table keyed
 * differently would be one more thing to keep in sync.
 *
 * Throws rather than returning undefined when the seed has not supplied one. A
 * missing grant is a provisioning fault, not a legitimate reason for a test to
 * pass vacuously -- and every spec that calls this runs under a suite whose
 * zero-skip guard fails the job anyway, so failing here loses nothing and
 * reports the real cause.
 */
export function parentDailyLoginGrantForEmail(email: string): string {
  const manifest = loadQaManifest();
  const entry = Object.values(manifest.parentAccounts).find((account) => account.email === email);
  if (!entry?.dailyLoginGrant) {
    throw new Error(`No seeded daily-login grant for ${email} -- run backend/scripts/seed-local.mjs against the disposable database first.`);
  }
  return entry.dailyLoginGrant;
}
