// PCA-NFR-064 (Writer65): shared, pure computation of the third-party SDK
// disclosure list -- imported by BOTH generateSdkDisclosure.mjs (the
// generator that writes the committed
// backend/src/sdkDisclosure/thirdPartySdks.generated.ts source file) and
// the drift test (backend/test/security/sdkDisclosure.test.mjs), so the
// two can never silently diverge. Reads ONLY real, already-committed
// dependency manifests -- never a hand-maintained parallel list.
import { readFile } from 'node:fs/promises';

/** Dev/test-only npm package names this disclosure deliberately excludes -- these never ship in a running backend/admin-web build, so listing them as "in use" would be misleading to a reader of a production SDK disclosure. */
const DEV_ONLY_HINT_PATTERNS = [/^@types\//, /^eslint/, /^typescript$/, /^vite/, /^@vitejs\//, /^@testing-library\//, /^@playwright\//, /^vitest/, /^prettier/, /axe-core/, /^@typescript-eslint\//];

function classifyNpmPackage(name) {
  if (name === 'fastify') return 'HTTP server framework';
  if (name === 'mysql2') return 'database driver';
  if (name.startsWith('react')) return 'UI framework';
  if (name.startsWith('i18next')) return 'internationalization';
  return 'uncategorized';
}

function classifyGradleModule(module) {
  // Test-only modules first (a test-tooling artifact under the androidx.*
  // namespace, e.g. androidx.test.espresso:espresso-core, must not be
  // misclassified as a shipped Jetpack library just because of its group
  // prefix -- these never ship inside the actual installed app).
  if (
    module.startsWith('androidx.test') ||
    module.includes(':room-testing') ||
    module.includes('espresso') ||
    module.includes('coroutines-test') ||
    module.startsWith('org.robolectric') ||
    module.startsWith('junit:') ||
    module.startsWith('org.json:')
  ) {
    return 'test tooling';
  }
  if (module.startsWith('androidx.') || module.startsWith('com.google.android.material')) return 'Android Jetpack (first-party Google platform library)';
  if (module.startsWith('org.jetbrains.kotlinx')) return 'Kotlin standard library extension';
  return 'uncategorized';
}

async function readNpmProductionDeps(packageJsonPath) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  } catch {
    return [];
  }
  return Object.entries(pkg.dependencies ?? {})
    .filter(([name]) => !DEV_ONLY_HINT_PATTERNS.some((pattern) => pattern.test(name)))
    .map(([name, version]) => ({ name, version: String(version), category: classifyNpmPackage(name) }));
}

async function readGradleLibraries(libsVersionsTomlPath) {
  let text;
  try {
    text = await readFile(libsVersionsTomlPath, 'utf8');
  } catch {
    return [];
  }
  const moduleLinePattern = /module\s*=\s*"([^"]+)"/g;
  const found = [];
  let match;
  while ((match = moduleLinePattern.exec(text)) !== null) {
    found.push(match[1]);
  }
  return found
    .filter((module) => classifyGradleModule(module) !== 'test tooling')
    .map((module) => ({ name: module, version: 'see android/gradle/libs.versions.toml', category: classifyGradleModule(module) }));
}

/** repoRoot: absolute path to the monorepo root (parent of backend/, platform-admin-web/, android/). */
export async function computeSdkDisclosure(repoRoot) {
  const [backend, platformAdminWeb, android] = await Promise.all([
    readNpmProductionDeps(`${repoRoot}/backend/package.json`),
    readNpmProductionDeps(`${repoRoot}/platform-admin-web/package.json`),
    readGradleLibraries(`${repoRoot}/android/gradle/libs.versions.toml`),
  ]);
  return {
    disclosureVersion: 1,
    generatedFrom: 'backend/package.json, platform-admin-web/package.json, android/gradle/libs.versions.toml (production dependencies only)',
    surfaces: {
      backend: backend.sort((a, b) => a.name.localeCompare(b.name)),
      platformAdminWeb: platformAdminWeb.sort((a, b) => a.name.localeCompare(b.name)),
      android: android.sort((a, b) => a.name.localeCompare(b.name)),
      ios: [],
    },
  };
}
