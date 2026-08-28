import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reads the JSON manifest backend/scripts/seed-local.mjs writes after a
 * successful seed run (backend/qa-seed-manifest.json by default) --
 * dedicated per-test admin account emails/TOTP secrets, keyed by purpose,
 * so each Playwright test can look up ITS OWN account instead of reusing
 * one across many back-to-back logins for the same role (see
 * seed-local.mjs's own header: this repo's TOTP-counter replay protection
 * is real and correctly rejects a code claimed by an earlier unrelated
 * login for the same admin, so a shared account across many sequential
 * tests risks a false failure -- more distinct admins, not a weaker
 * control, is the fix).
 */
interface AdminAccountEntry {
  email: string;
  role: string;
  adminId: string;
  totpSecretBase32: string;
}

interface QaSeedManifest {
  seedPassword: string;
  adminAccounts: Record<string, AdminAccountEntry>;
}

const manifestPath = fileURLToPath(new URL('../../backend/qa-seed-manifest.json', import.meta.url));

let cached: QaSeedManifest | null = null;

export function loadQaManifest(): QaSeedManifest {
  if (cached) return cached;
  const raw = readFileSync(manifestPath, 'utf8');
  cached = JSON.parse(raw) as QaSeedManifest;
  return cached;
}

export function adminAccount(key: string): AdminAccountEntry {
  const manifest = loadQaManifest();
  const entry = manifest.adminAccounts[key];
  if (!entry) throw new Error(`No seeded admin account for key "${key}" -- run backend/scripts/seed-local.mjs first.`);
  return entry;
}

export function seedPassword(): string {
  return loadQaManifest().seedPassword;
}
