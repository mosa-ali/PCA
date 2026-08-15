// PCA-FR-123 (Writer65): proves backend/scripts/checkNoAdTrackingSdks.mjs
// actually fails CI when a known ad-tracking SDK is present, and actually
// passes on the real repository's current manifests -- not merely that
// the script parses. Runs the REAL script file as a subprocess (never a
// re-implementation), against a temp fixture tree built to mirror the
// script's own `../../` (backend/scripts/<file> -> repo root) relative
// path assumption.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const REAL_SCRIPT_PATH = fileURLToPath(new URL('../../scripts/checkNoAdTrackingSdks.mjs', import.meta.url));

async function buildFixtureRoot({ backendDeps = {}, platformAdminDeps = {}, gradleAppFile = '', gradleRootFile = '', libsVersions = '' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pca-noads-'));
  await mkdir(join(root, 'backend', 'scripts'), { recursive: true });
  await mkdir(join(root, 'platform-admin-web'), { recursive: true });
  await mkdir(join(root, 'android', 'app'), { recursive: true });
  await mkdir(join(root, 'android', 'gradle'), { recursive: true });
  await cp(REAL_SCRIPT_PATH, join(root, 'backend', 'scripts', 'checkNoAdTrackingSdks.mjs'));
  await writeFile(join(root, 'backend', 'package.json'), JSON.stringify({ name: 'backend-fixture', dependencies: backendDeps, devDependencies: {} }));
  await writeFile(join(root, 'platform-admin-web', 'package.json'), JSON.stringify({ name: 'paw-fixture', dependencies: platformAdminDeps, devDependencies: {} }));
  await writeFile(join(root, 'android', 'app', 'build.gradle.kts'), gradleAppFile);
  await writeFile(join(root, 'android', 'build.gradle.kts'), gradleRootFile);
  await writeFile(join(root, 'android', 'gradle', 'libs.versions.toml'), libsVersions);
  return root;
}

async function runScript(root) {
  try {
    const result = await execFileAsync(process.execPath, [join(root, 'backend', 'scripts', 'checkNoAdTrackingSdks.mjs')]);
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { exitCode: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('a clean fixture tree (no ad SDKs anywhere) exits 0', async () => {
  const root = await buildFixtureRoot({
    backendDeps: { fastify: '^4.0.0', mysql2: '^3.0.0' },
    platformAdminDeps: { react: '^18.0.0' },
    gradleAppFile: 'dependencies {\n    implementation(libs.androidx.core.ktx)\n}\n',
  });
  try {
    const result = await runScript(root);
    assert.equal(result.exitCode, 0, result.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a Google Mobile Ads SDK in android/app/build.gradle.kts fails the check', async () => {
  const root = await buildFixtureRoot({
    gradleAppFile: 'dependencies {\n    implementation("com.google.android.gms:play-services-ads:23.0.0")\n}\n',
  });
  try {
    const result = await runScript(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /play-services-ads/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an AppsFlyer install-attribution SDK in backend/package.json fails the check', async () => {
  const root = await buildFixtureRoot({
    backendDeps: { 'appsflyer-react-native-sdk': '^6.0.0' },
  });
  try {
    const result = await runScript(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /appsflyer/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a Meta Audience Network reference in android/gradle/libs.versions.toml fails the check', async () => {
  const root = await buildFixtureRoot({
    libsVersions: '[libraries]\naudience-network = { module = "com.facebook.android:audience-network-sdk", version = "6.16.0" }\n',
  });
  try {
    const result = await runScript(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /audience-network-sdk/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the REAL repository (backend/package.json, platform-admin-web/package.json, android/**) currently has NO ad-tracking SDK -- the actual gate script exits 0 as-is', async () => {
  const result = await execFileAsync(process.execPath, [REAL_SCRIPT_PATH]);
  assert.equal(result.stdout.includes('passed'), true, result.stdout);
});
