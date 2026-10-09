import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection as createSocket, createServer } from 'node:net';
import { lookup } from 'node:dns/promises';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import mysql from 'mysql2/promise';

const runtimeSource = process.env.PCA_DATABASE_URL;
const migrationSource = process.env.PCA_MIGRATION_DATABASE_URL ?? runtimeSource;
if (!runtimeSource) throw new Error('PCA_DATABASE_URL is required so disposable suites run as the runtime identity.');
if (!migrationSource) throw new Error('PCA_DATABASE_URL or PCA_MIGRATION_DATABASE_URL is required.');
const runtimeBaseUrl = new URL(runtimeSource);
const migrationBaseUrl = new URL(migrationSource);
const allowedHosts = ['127.0.0.1', 'localhost', '::1', 'mysql'];
if (![runtimeBaseUrl.hostname, migrationBaseUrl.hostname].every((host) => allowedHosts.includes(host))) {
  throw new Error('The owned disposable test database runner only accepts loopback or Compose MySQL hosts.');
}
const endpoint = (url) => `${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'mysql:' ? '3306' : '')}`;
if (endpoint(runtimeBaseUrl) !== endpoint(migrationBaseUrl)) {
  throw new Error('PCA_DATABASE_URL and PCA_MIGRATION_DATABASE_URL must target the same local/Compose MySQL endpoint.');
}

const databaseName = `pca_test_codex_${randomUUID().replaceAll('-', '')}`;
const requestedTarget = process.argv[2] ?? 'all';
const isParentMfaTarget = requestedTarget === 'parent-mfa-real-e2e';
const isParentAcceptanceTarget = requestedTarget === 'parent-owner-acceptance-real-e2e';
const isFullCertifiedTarget = requestedTarget === 'all-certified';
const isPlatformAdminPrivilegesTarget = requestedTarget === 'platform-admin-privileges';
const isFamilyIdentityTarget = requestedTarget === 'family-identity';
const targetScript = requestedTarget === 'all'
  ? 'test:db:inner'
  : requestedTarget === 'all-certified'
    ? 'test:db:inner'
  : requestedTarget === 'authority-diagnostics'
    ? 'test:db:authority-diagnostics:inner'
    : requestedTarget === 'enrollment-binding'
      ? 'test:db:enrollment-binding:inner'
    : requestedTarget === 'ordinary-trust-set'
      ? 'test:db:ordinary-trust-set:inner'
    : requestedTarget === 'parent-auth'
      ? 'test:db:parent-auth:inner'
    : isFamilyIdentityTarget
      ? 'test:db:family-identity:inner'
    : requestedTarget === 'platform-admin-auth'
      ? 'test:db:platform-admin-auth:inner'
    : isPlatformAdminPrivilegesTarget
      ? 'test:db:platform-admin-privileges:inner'
    : requestedTarget === 'refund-recovery'
      ? 'test:db:refund-recovery:inner'
    : requestedTarget === 'parent-route-audit'
      ? 'test:db:parent-route-audit:inner'
    : requestedTarget === 'parent-real-e2e'
      ? null
    : isParentAcceptanceTarget
      ? null
    : isParentMfaTarget
      ? null
      : null;
if (!['all', 'all-certified', 'authority-diagnostics', 'enrollment-binding', 'ordinary-trust-set', 'family-identity', 'parent-auth', 'platform-admin-auth', 'platform-admin-privileges', 'refund-recovery', 'parent-route-audit', 'parent-real-e2e', 'parent-mfa-real-e2e', 'parent-owner-acceptance-real-e2e'].includes(requestedTarget)) throw new Error('Supported disposable DB targets: all, all-certified, authority-diagnostics, enrollment-binding, ordinary-trust-set, family-identity, parent-auth, platform-admin-auth, platform-admin-privileges, refund-recovery, parent-route-audit, parent-real-e2e, parent-mfa-real-e2e, parent-owner-acceptance-real-e2e.');
if (requestedTarget === 'parent-route-audit' && !process.env.PCA_PARENT_ROUTE_SCENARIO_OUT) {
  throw new Error('parent-route-audit requires PCA_PARENT_ROUTE_SCENARIO_OUT so the campaign always produces its evidence report.');
}
const runtimeDatabaseUrl = new URL(runtimeBaseUrl);
runtimeDatabaseUrl.pathname = `/${databaseName}`;
const migrationDatabaseUrl = new URL(migrationBaseUrl);
migrationDatabaseUrl.pathname = `/${databaseName}`;
const serverUrl = new URL(migrationBaseUrl);
serverUrl.pathname = '/';
serverUrl.search = '';
let created = false;
let connection;
let creationAttempted = false;
let tempDirectory;
let mfaBackend;
let activeChild;
let interruptedSignal;

async function waitForOwnedChild(child, timeoutMs = 10000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolveExit, rejectExit) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) rejectExit(error);
      else resolveExit();
    };
    const onExit = () => finish();
    const onError = (error) => finish(error);
    const timer = setTimeout(() => finish(new Error('Timed out waiting for an owned process to exit.')), timeoutMs);
    child.once('exit', onExit);
    child.once('error', onError);
    if (child.exitCode !== null || child.signalCode !== null) finish();
  });
}

async function terminateOwnedTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    try {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      await waitForOwnedChild(killer, 10000);
    } catch {
      child.kill();
    }
  } else if (Number.isInteger(child.pid)) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') child.kill('SIGTERM');
    }
  } else {
    child.kill();
  }
  try {
    await waitForOwnedChild(child, 5000);
  } catch {
    if (process.platform === 'win32' && Number.isInteger(child.pid)) {
      try {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        await waitForOwnedChild(killer, 10000);
      } catch {
        child.kill();
      }
    } else if (Number.isInteger(child.pid)) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
    await waitForOwnedChild(child, 5000);
  }
}

function onInterrupt(signal) {
  if (interruptedSignal) return;
  interruptedSignal = signal;
  process.exitCode = 130;
  if (activeChild) void terminateOwnedTree(activeChild).catch(() => {});
  if (mfaBackend) void terminateOwnedTree(mfaBackend).catch(() => {});
}
process.on('SIGINT', () => onInterrupt('SIGINT'));
process.on('SIGTERM', () => onInterrupt('SIGTERM'));

function throwIfInterrupted() {
  if (interruptedSignal) throw new Error('Disposable database E2E interrupted by ' + interruptedSignal + '.');
}

function run(command, args, env, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    activeChild = child;
    const captured = [];
    let capturedBytes = 0;
    const forward = (stream, chunk) => {
      process[stream].write(chunk);
      captured.push(chunk);
      capturedBytes += chunk.length;
      while (capturedBytes > 2_000_000 && captured.length > 1) capturedBytes -= captured.shift().length;
    };
    child.stdout.on('data', (chunk) => forward('stdout', chunk));
    child.stderr.on('data', (chunk) => forward('stderr', chunk));
    child.on('error', (error) => {
      if (activeChild === child) activeChild = undefined;
      reject(error);
    });
    child.on('close', (code) => {
      if (activeChild === child) activeChild = undefined;
      if (code === 0) return resolve();
      const output = Buffer.concat(captured).toString('utf8');
      const lines = output.split(/\r?\n/);
      const failures = [];
      for (let i = 0; i < lines.length; i += 1) {
        if (/^not ok \d+ - /.test(lines[i])) failures.push(lines.slice(i, Math.min(i + 9, lines.length)).join('\n'));
      }
      if (failures.length) process.stderr.write(`\nMYSQL_FAILURE_DETAILS\n${failures.join('\n---\n')}\n`);
      reject(new Error(`Command failed with exit code ${code}: ${args[0]}`));
    });
  });
}

function runSensitive(command, args, env, cwd, redactions, allowFailure = false, suppressOutput = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    activeChild = child;
    const chunks = [];
    let bytes = 0;
    let overLimit = false;
    const collect = (chunk) => {
      if (bytes + chunk.length > 8000000) {
        overLimit = true;
        return;
      }
      chunks.push(chunk);
      bytes += chunk.length;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', (error) => {
      if (activeChild === child) activeChild = undefined;
      reject(new Error('Could not start private E2E command (' + (error.code ?? error.message) + ').'));
    });
    child.once('close', (code) => {
      if (activeChild === child) activeChild = undefined;
      if (overLimit) {
        reject(new Error('Private E2E command exceeded its output limit; output was suppressed.'));
        return;
      }
      let output = Buffer.concat(chunks).toString('utf8');
      for (const secret of [...new Set(redactions.filter((value) => typeof value === 'string' && value.length > 0))]
        .sort((left, right) => right.length - left.length)) {
        output = output.split(secret).join('[REDACTED]');
      }
      if (output && !suppressOutput) (code === 0 ? process.stdout : process.stderr).write(output);
      else if (output && suppressOutput && code !== 0) {
        const diagnostic = output
          .replace(/\b\d{6}\b/g, '[REDACTED_CODE]')
          .replace(/\b[A-Z2-7]{16,}={0,6}\b/g, '[REDACTED_TOTP_SECRET]')
          .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
          .slice(-6000);
        process.stderr.write(`\nREDACTED_PLAYWRIGHT_FAILURE_OUTPUT\n${diagnostic}\n`);
      }
      if (code === 0) resolve(0);
      else if (allowFailure) resolve(code ?? 1);
      else reject(new Error('Private E2E command failed with exit code ' + (code ?? 'unknown') + ' (' + (args[0] ?? command) + ').'));
    });
  });
}

async function assertLoopbackPortClosed(port, label) {
  let addresses;
  try {
    addresses = await lookup('localhost', { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve localhost for the ' + label + ' port safety preflight.');
  }
  const loopbacks = addresses.filter(({ address }) => address === '::1' || address === '127.0.0.1');
  if (loopbacks.length === 0) throw new Error('localhost did not resolve to a loopback address; refusing ' + label + ' startup.');
  for (const { address, family } of loopbacks) {
    await new Promise((resolveProbe, rejectProbe) => {
      const socket = createSocket({ host: address, family, port });
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) rejectProbe(error);
        else resolveProbe();
      };
      socket.once('connect', () => finish(new Error(label + ' is already accepting connections; refusing to reuse or disturb the existing server.')));
      socket.once('error', (error) => {
        if (error.code === 'ECONNREFUSED') finish();
        else finish(new Error('Could not prove ' + label + ' is closed (' + (error.code ?? 'socket error') + '); refusing startup.'));
      });
      socket.setTimeout(1000, () => finish(new Error('Timed out checking ' + label + '; refusing startup.')));
    });
  }
}

async function assertParentWebPortClosed() {
  await assertLoopbackPortClosed(4002, 'localhost:4002');
}

function parentWebRealE2eEnvironment(baseEnv, proxyTarget) {
  return {
    ...baseEnv,
    VITE_PCA_DEMO_MODE: 'false',
    VITE_PCA_API_BASE_URL: '/',
    VITE_E2E_REAL_PROXY_TARGET: proxyTarget,
  };
}

function assertLocalComposeMfaDatabase() {
  const baseUrls = [runtimeBaseUrl, migrationBaseUrl];
  const endpointAllowed = (url) => {
    const host = url.hostname;
    const port = url.port || (host === 'mysql' ? '3306' : '');
    return (['127.0.0.1', 'localhost'].includes(host) && port === '33061') || (host === 'mysql' && port === '3306');
  };
  if (!baseUrls.every((url) => endpointAllowed(url) && url.pathname === '/pca_test')) {
    throw new Error('Parent MFA E2E requires the repository local/Compose disposable database endpoint and database name pca_test.');
  }
  if (process.env.NODE_ENV !== 'test') throw new Error('Parent MFA E2E requires NODE_ENV=test; refusing any production or ambiguous runtime.');
}

async function createPrivateTempDirectory() {
  tempDirectory = await mkdtemp(join(tmpdir(), 'pca-parent-mfa-e2e-'));
  if (process.platform !== 'win32') {
    await chmod(tempDirectory, 0o700);
    return;
  }
  const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  if (identity.status !== 0) throw new Error('Could not identify the current Windows user for private E2E fixture storage.');
  const sid = identity.stdout.match(/S-\d-\d+(?:-\d+)+/i)?.[0];
  if (!sid) throw new Error('Could not obtain the current Windows user SID for private E2E fixture storage.');
  const secured = spawnSync('icacls.exe', [tempDirectory, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F'], { encoding: 'utf8', windowsHide: true });
  if (secured.status !== 0) throw new Error('Could not restrict the temporary E2E fixture directory to the current Windows user.');
}

async function getFreeLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => rejectPort(new Error('Could not reserve an ephemeral backend port.')));
        return;
      }
      const port = address.port;
      server.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

async function waitForMfaBackend(child, port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    throwIfInterrupted();
    if (child.startError) throw new Error('Could not start the disposable Parent backend (' + child.startError.code + ').');
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Disposable Parent backend exited before readiness (' + (child.exitCode ?? child.signalCode) + ').');
    }
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health/db', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Startup remains bounded below; response bodies are intentionally not logged.
    }
    await delay(500);
  }
  throw new Error('Disposable Parent backend did not become ready within 30 seconds.');
}

async function reportSafePlaywrightFailures(reportPath, redactions) {
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch {
    process.stderr.write('Playwright failed and its private JSON report could not be read.\n');
    return;
  }
  const summaries = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.title === 'string' && Array.isArray(value.results)) {
      for (const result of value.results) {
        if (result?.status !== 'failed' && result?.status !== 'timedOut' && result?.status !== 'interrupted') continue;
        const error = result.errors?.[0] ?? result.error ?? {};
        summaries.push({ title: value.title, message: error.message ?? error.value ?? 'No error message recorded.' });
      }
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(report.suites);
  if (summaries.length === 0) {
    process.stderr.write('Playwright reported a failing test, but the JSON report contained no failure detail.\n');
    return;
  }
  const secrets = [...new Set(redactions.filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((left, right) => right.length - left.length);
  for (const summary of summaries) {
    let message = String(summary.message).replace(/\s+/g, ' ').trim();
    for (const secret of secrets) message = message.split(secret).join('[REDACTED]');
    message = message.replace(/\b\d{6}\b/g, '[REDACTED_CODE]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
      .slice(0, 700);
    process.stderr.write(`Playwright failure: ${summary.title}\n  ${message}\n`);
  }
}

async function runParentMfaRealE2e(e2eEnv, { onlyAcceptanceFlow = false } = {}) {
  const manifestPath = join(tempDirectory, 'qa-e2e-manifest.json');
  await run(process.execPath, ['--env-file=test.env', '--env-file=test.db.env', 'scripts/provision-e2e-accounts.mjs'], {
    ...e2eEnv,
    QA_E2E_MANIFEST_PATH: manifestPath,
  }, process.cwd());
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const parent = manifest?.parent;
  const secondParent = manifest?.secondParent;
  const enrolledParent = manifest?.mfaParent;
  const lockParent = manifest?.mfaLockParent;
  const setupParent = manifest?.mfaSetupParent;
  const operator = manifest?.operator;
  const family = manifest?.family;
  if (!parent?.email || !parent?.password || !parent?.dailyLoginGrant
    || !secondParent?.email || !secondParent?.password || !secondParent?.dailyLoginGrant
    || !enrolledParent?.email || !enrolledParent?.password || !enrolledParent?.totpSecretBase32 || !enrolledParent?.familyId
    || !Number.isSafeInteger(enrolledParent?.totpEnrollmentCounter)
    || !lockParent?.email || !lockParent?.password || !lockParent?.totpSecretBase32 || !lockParent?.familyId
    || !Number.isSafeInteger(lockParent?.totpEnrollmentCounter)
    || !setupParent?.email || !setupParent?.password || !setupParent?.dailyLoginGrant || !setupParent?.familyId
    || !operator?.email || !operator?.password || !operator?.totpSecretBase32 || !family?.familyId) {
    throw new Error('The disposable fixture manifest is incomplete for the certified Parent E2E set.');
  }
  const fixtureEnvironment = {
    E2E_REAL_PARENT_EMAIL: parent.email,
    E2E_REAL_PARENT_PASSWORD: parent.password,
    E2E_REAL_PARENT_DAILY_GRANT: parent.dailyLoginGrant,
    E2E_REAL_SECOND_PARENT_EMAIL: secondParent.email,
    E2E_REAL_SECOND_PARENT_PASSWORD: secondParent.password,
    E2E_REAL_SECOND_PARENT_DAILY_GRANT: secondParent.dailyLoginGrant,
    E2E_REAL_MFA_SETUP_PARENT_EMAIL: setupParent.email,
    E2E_REAL_MFA_SETUP_PARENT_PASSWORD: setupParent.password,
    E2E_REAL_MFA_SETUP_PARENT_DAILY_GRANT: setupParent.dailyLoginGrant,
    E2E_REAL_MFA_PARENT_EMAIL: enrolledParent.email,
    E2E_REAL_MFA_PARENT_PASSWORD: enrolledParent.password,
    E2E_REAL_MFA_PARENT_TOTP_SECRET: enrolledParent.totpSecretBase32,
    E2E_REAL_MFA_PARENT_TOTP_ENROLLMENT_COUNTER: String(enrolledParent.totpEnrollmentCounter),
    E2E_REAL_TEST_FAMILY_ID: family.familyId,
    E2E_REAL_ADMIN_EMAIL: operator.email,
    E2E_REAL_ADMIN_PASSWORD: operator.password,
    E2E_REAL_ADMIN_TOTP_SECRET: operator.totpSecretBase32,
  };
  const redactions = [
    parent.email,
    parent.password,
    parent.dailyLoginGrant,
    secondParent.email,
    secondParent.password,
    secondParent.dailyLoginGrant,
    parent.familyId,
    secondParent.familyId,
    enrolledParent.email,
    enrolledParent.password,
    enrolledParent.totpSecretBase32,
    enrolledParent.familyId,
    lockParent.email,
    lockParent.password,
    lockParent.totpSecretBase32,
    lockParent.familyId,
    setupParent.email,
    setupParent.password,
    setupParent.dailyLoginGrant,
    setupParent.familyId,
    operator.email,
    operator.password,
    operator.totpSecretBase32,
    family.familyId,
    '482731',
    '482732',
    '517284',
  ];
  const suites = [
    {
      spec: 'parentMfa.spec.ts',
      label: 'parent-web real-browser Parent MFA E2E',
      report: 'parentMfa.playwright.json',
      evidence: 'parentMfa.evidence.json',
      fixture: {
        E2E_REAL_MFA_PARENT_EMAIL: enrolledParent.email,
        E2E_REAL_MFA_PARENT_PASSWORD: enrolledParent.password,
        E2E_REAL_MFA_PARENT_TOTP_SECRET: enrolledParent.totpSecretBase32,
        E2E_REAL_MFA_LOCK_PARENT_EMAIL: lockParent.email,
        E2E_REAL_MFA_LOCK_PARENT_PASSWORD: lockParent.password,
        E2E_REAL_MFA_LOCK_PARENT_TOTP_SECRET: lockParent.totpSecretBase32,
      },
    },
    {
      spec: 'optionalMfaSetup.spec.ts',
      label: 'parent-web real-browser optional Parent MFA setup E2E',
      report: 'optionalMfaSetup.playwright.json',
      evidence: 'optionalMfaSetup.evidence.json',
      fixture: {
        E2E_REAL_MFA_SETUP_PARENT_EMAIL: setupParent.email,
        E2E_REAL_MFA_SETUP_PARENT_PASSWORD: setupParent.password,
        E2E_REAL_MFA_SETUP_PARENT_DAILY_GRANT: setupParent.dailyLoginGrant,
      },
    },
    {
      spec: 'acceptance-flow.spec.ts',
      label: 'parent-web real-backend owner acceptance flow',
      report: 'acceptanceFlow.playwright.json',
      evidence: 'acceptanceFlow.evidence.json',
      fixture: {},
    },
  ];

  const selectedSuites = onlyAcceptanceFlow
    ? suites.filter((suite) => suite.spec === 'acceptance-flow.spec.ts')
    : suites.filter((suite) => suite.spec !== 'acceptance-flow.spec.ts');
  for (const suite of selectedSuites) {
    throwIfInterrupted();
    await assertParentWebPortClosed();
    const port = await getFreeLoopbackPort();
    await assertLoopbackPortClosed(port, 'disposable API port 127.0.0.1:' + port);
    const backendEnv = { ...e2eEnv, HOST: '127.0.0.1', PORT: String(port) };
    const backend = spawn(process.execPath, ['--env-file=test.env', '--env-file=test.db.env', 'dist/main.js'], {
      cwd: process.cwd(),
      env: backendEnv,
      stdio: 'ignore',
      windowsHide: true,
    });
    backend.once('error', (error) => { backend.startError = error; });
    mfaBackend = backend;
    try {
      await waitForMfaBackend(backend, port);
      await assertParentWebPortClosed();
      const reportPath = join(tempDirectory, suite.report);
      const evidencePath = join(tempDirectory, suite.evidence);
      const browserEnv = parentWebRealE2eEnvironment({
        ...backendEnv,
        ...fixtureEnvironment,
        ...suite.fixture,
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
      }, 'http://127.0.0.1:' + port);
      const playwrightCli = resolve(process.cwd(), '..', 'parent-web', 'node_modules', '@playwright', 'test', 'cli.js');
      const playwrightCode = await runSensitive(
        process.execPath,
        [
          playwrightCli,
          'test',
          '--config=playwright.real.config.ts',
          '--project=chromium',
          '--trace=off',
          '--timeout=120000',
          '--output',
          join(tempDirectory, suite.spec.replace('.spec.ts', '-playwright-output')),
          suite.spec,
        ],
        browserEnv,
        resolve(process.cwd(), '..', 'parent-web'),
        redactions,
        true,
        true,
      );
      throwIfInterrupted();
      if (playwrightCode !== 0) await reportSafePlaywrightFailures(reportPath, redactions);
      const resultGateCode = await runSensitive(
        process.execPath,
        [
          resolve(process.cwd(), '..', 'tooling', 'e2e-real', 'assertRealE2eResults.mjs'),
          reportPath,
          '--label', suite.label,
          '--manifest-out', evidencePath,
          '--source-sha', process.env.GITHUB_SHA ?? 'LOCAL_WORKING_TREE',
          '--workflow', process.env.GITHUB_WORKFLOW ?? 'local-disposable-parent-mfa-e2e',
        ],
        browserEnv,
        process.cwd(),
        redactions,
        true,
      );
      if (playwrightCode !== 0 || resultGateCode !== 0) {
        throw new Error('Playwright reported a failing ' + suite.spec + ' run (Playwright exit ' + playwrightCode + ', result gate exit ' + resultGateCode + ').');
      }
    } finally {
      await terminateOwnedTree(backend);
      if (mfaBackend === backend) mfaBackend = undefined;
    }
  }
}

try {
  if (isParentMfaTarget || isParentAcceptanceTarget) {
    if (isParentMfaTarget) assertLocalComposeMfaDatabase();
    if (process.env.NODE_ENV !== 'test') throw new Error('Certified Parent browser E2E requires NODE_ENV=test; refusing any production or ambiguous runtime.');
    // This Playwright config uses reuseExistingServer on fixed port 4002.
    // Refuse before building or touching MySQL if an owner server is present.
    await assertParentWebPortClosed();
    throwIfInterrupted();
    await run('npm', ['run', 'build'], process.env, process.cwd());
    await assertParentWebPortClosed();
    await createPrivateTempDirectory();
  } else if (requestedTarget === 'parent-real-e2e') {
    // Refuse before touching MySQL if either fixed loopback service port is
    // already owned. Playwright must launch this run's preview and API.
    await assertParentWebPortClosed();
    await assertLoopbackPortClosed(41831, 'disposable API port 127.0.0.1:41831');
  }
  throwIfInterrupted();
  connection = await mysql.createConnection({ uri: serverUrl.toString(), multipleStatements: false });
  throwIfInterrupted();
  if (isParentMfaTarget) creationAttempted = true;
  await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  created = true;
  throwIfInterrupted();
  console.log(`Owned disposable MySQL database created: ${databaseName}`);
  const migrationEnv = {
    ...process.env,
    PCA_DATABASE_URL: runtimeDatabaseUrl.toString(),
    PCA_MIGRATION_DATABASE_URL: migrationDatabaseUrl.toString(),
    PCA_DISPOSABLE_TEST_DATABASE_OWNER: 'with-disposable-db',
  };
  await run(process.execPath, ['--env-file=test.env', '--env-file=test.db.env', 'scripts/verify-mysql.mjs'], migrationEnv);
  if (process.env.PCA_PRINT_DISPOSABLE_SCHEMA_FINGERPRINT === '1') {
    const fingerprintDirectory = await mkdtemp(join(tmpdir(), 'pca-disposable-schema-fingerprint-'));
    const introspectionPath = join(fingerprintDirectory, 'schema.json');
    try {
      await run(process.execPath, ['scripts/introspect-schema.mjs'], {
        ...migrationEnv,
        PCA_SCHEMA_INTROSPECTION_URL: migrationDatabaseUrl.toString(),
        PCA_SCHEMA_INTROSPECTION_OUT: introspectionPath,
      });
      await run(process.execPath, ['scripts/schema-fingerprint.mjs', introspectionPath], migrationEnv);
    } finally {
      await rm(fingerprintDirectory, { recursive: true, force: true });
    }
  }
  // The migration credential is required for provisioning the isolated schema
  // and is retained for the one explicit runtime-privilege acceptance target.
  // Ordinary regression tests and the application use only the runtime role;
  // leaving the admin URL in their environment for them could activate
  // CREATE USER/GRANT checks unintentionally.
  const childEnv = { ...migrationEnv };
  if (!isPlatformAdminPrivilegesTarget) delete childEnv.PCA_MIGRATION_DATABASE_URL;
  throwIfInterrupted();
  // Optional certification of the same post-migration checks used by the
  // production bootstrap runbook, against this owned disposable database.
  if (process.env.PCA_RUN_DISPOSABLE_POST_VALIDATE === '1') {
    await run(process.execPath, ['scripts/post-validate.mjs'], childEnv);
  }
  if (isParentMfaTarget || isParentAcceptanceTarget) {
    await runParentMfaRealE2e({
      ...childEnv,
      NODE_ENV: 'test',
      PCA_PARENT_MFA_ENC_KEY: randomBytes(32).toString('hex'),
      PLATFORM_ADMIN_MFA_ENC_KEY: randomBytes(32).toString('hex'),
      ...(isParentAcceptanceTarget ? { PCA_TRUSTED_PROXY_CIDRS: '127.0.0.1' } : {}),
      HOST: '127.0.0.1',
    }, { onlyAcceptanceFlow: isParentAcceptanceTarget });
  } else if (isFullCertifiedTarget) {
    await run('npm', ['run', targetScript], childEnv);
    await run(process.execPath, ['--env-file=test.env', '--env-file=test.db.env', 'scripts/run-certified-production-paths.mjs'], migrationEnv);
  } else if (requestedTarget !== 'parent-real-e2e') {
    await run('npm', ['run', targetScript], childEnv);
  } else {
    const email = `codex-${randomUUID()}@pca-e2e.test`;
    const password = `PcaE2e-${randomUUID()}!`;
    const e2eEnv = {
      ...childEnv,
      NODE_ENV: 'test',
      PCA_PARENT_MFA_ENC_KEY: randomBytes(32).toString('hex'),
      E2E_REAL_PARENT_EMAIL: email,
      E2E_REAL_PARENT_PASSWORD: password,
      HOST: '127.0.0.1',
      PORT: '41831',
    };
    await run(process.execPath, ['--env-file=test.env', '--env-file=test.db.env', 'scripts/bootstrap-e2e-parent-account.mjs'], e2eEnv);

    const backend = spawn(process.execPath, ['--env-file=test.env', '--env-file=test.db.env', 'dist/main.js'], {
      cwd: process.cwd(),
      env: e2eEnv,
      stdio: 'inherit',
    });
    try {
      let healthy = false;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (backend.exitCode !== null) throw new Error(`Disposable Parent backend exited before readiness (${backend.exitCode}).`);
        try {
          const response = await fetch('http://127.0.0.1:41831/health/db');
          if (response.ok) {
            healthy = true;
            break;
          }
        } catch {
          // The server is still starting; retry within the bounded readiness window.
        }
        await delay(1000);
      }
      if (!healthy) throw new Error('Disposable Parent backend did not become ready within 60 seconds.');
      const browserEnv = parentWebRealE2eEnvironment(e2eEnv, 'http://127.0.0.1:41831');
      await run('pnpm', ['exec', 'playwright', 'test', '--config=playwright.real.config.ts', 'e2e-real/realBackend.spec.ts'], browserEnv, resolve(process.cwd(), '../parent-web'));
    } finally {
      if (backend.exitCode === null) backend.kill();
      await new Promise((resolve) => backend.once('exit', resolve));
    }
  }
} finally {
  if (isParentMfaTarget) {
    const cleanupErrors = [];
    if (activeChild) {
      try { await terminateOwnedTree(activeChild); } catch (error) { cleanupErrors.push(error); }
      activeChild = undefined;
    }
    if (mfaBackend) {
      try { await terminateOwnedTree(mfaBackend); } catch (error) { cleanupErrors.push(error); }
      mfaBackend = undefined;
    }
    if (tempDirectory) {
      try { await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); } catch (error) { cleanupErrors.push(error); }
      tempDirectory = undefined;
    }
    if (connection) {
      if (creationAttempted) {
        try {
          await connection.query('DROP DATABASE IF EXISTS ' + databaseName);
          console.log('Owned disposable MySQL database removed: ' + databaseName);
        } catch (error) {
          cleanupErrors.push(new Error('Failed to remove the owned disposable MySQL database ' + databaseName + '.', { cause: error }));
        }
      }
      try { await connection.end(); } catch (error) { cleanupErrors.push(error); }
      connection = undefined;
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Disposable Parent MFA E2E cleanup failed.');
  } else {
  if (mfaBackend && mfaBackend.exitCode === null && mfaBackend.signalCode === null) {
    mfaBackend.kill();
    await new Promise((resolveExit) => {
      if (mfaBackend.exitCode !== null || mfaBackend.signalCode !== null) resolveExit();
      else mfaBackend.once('exit', resolveExit);
    });
  }
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  if (connection) {
    if (created) {
      await connection.query(`DROP DATABASE \`${databaseName}\``);
      console.log(`Owned disposable MySQL database removed: ${databaseName}`);
    } else if (isParentMfaTarget && creationAttempted) {
      await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    }
    await connection.end();
  }
  }
}
