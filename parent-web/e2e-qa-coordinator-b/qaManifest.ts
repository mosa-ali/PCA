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
