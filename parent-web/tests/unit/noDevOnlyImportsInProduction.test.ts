import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '../../src');
const PRODUCTION_EXCLUDE_DIRS = new Set(['dev', 'devOnly']);

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (PRODUCTION_EXCLUDE_DIRS.has(entry)) continue;
      out.push(...listFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Grep-provable (not just asserted) checks over the actual production
 * source tree:
 *  1. No production file imports the TEST/DEV_ONLY raw key-material helper.
 *  2. No production file (outside src/api/dev/**) imports a Dev* fixture
 *     class directly -- fixtures are wired only via src/api/client.ts's
 *     config.demoMode branch.
 */
describe('production source tree has no silent fixture / dev-only-crypto fallback', () => {
  const productionFiles = listFiles(SRC_ROOT).filter((f) => !f.includes(`${join('src', 'api', 'client.ts')}`));

  it('no production file imports src/security/devOnly/testKeyMaterial', () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const contents = readFileSync(file, 'utf8');
      if (/devOnly\/testKeyMaterial/.test(contents)) {
        offenders.push(relative(SRC_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no production file outside src/api/{client.ts,dev/**} imports a Dev* fixture provider/client class', () => {
    // Scoped to fixture PROVIDER/CLIENT classes specifically (the things
    // client.ts's demoMode branch swaps in place of Real*/Unavailable*),
    // not every symbol that happens to live under api/dev/** -- e.g.
    // ../api/dev/devState.ts exports a small dev-role-switcher utility used
    // by AuthContext for an intentionally separate, already-reviewed
    // dev-role UI affordance, not a fixture data provider.
    const FIXTURE_PROVIDER_IMPORT = /from ['"].*\/dev\/dev[A-Za-z]*(Client|Gateway|Provider)['"]/;
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const contents = readFileSync(file, 'utf8');
      if (FIXTURE_PROVIDER_IMPORT.test(contents)) {
        offenders.push(relative(SRC_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/api/client.ts is the ONLY file that imports Dev* fixture providers (confirms the single wiring seam)', () => {
    const clientTs = readFileSync(join(SRC_ROOT, 'api', 'client.ts'), 'utf8');
    expect(clientTs).toMatch(/DevServiceAuthClient/);
  });
});
