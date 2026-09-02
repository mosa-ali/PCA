// Platform Administration security red team, all five roles, real HTTP.
//
// Each role signs in with its OWN dedicated seeded admin (the QA-B-004
// isolation discipline: reusing one admin across dense logins trips the real
// TOTP counter-claim anti-replay control and produces false failures), and
// logins are staggered across TOTP windows where a persona must sign in twice.
//
// Every probe asserts a boundary. Where a role IS entitled to an operation the
// probe asserts it is ALLOWED, so a blanket-deny regression cannot masquerade
// as a pass. No production control is modified.
process.env.PLATFORM_ADMIN_MFA_ENC_KEY ??= 'ab'.repeat(32);

import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const BACKEND = process.env.QA_BACKEND_URL ?? 'http://127.0.0.1:4011';
const M = JSON.parse(readFileSync(process.env.QA_SEED_MANIFEST_PATH, 'utf8'));

const findings = [];
const checks = [];
function record(name, passed, detail) {
  checks.push({ name, passed, detail });
  if (!passed) findings.push({ name, detail });
  console.log(`${passed ? 'PASS' : 'FINDING'}  ${name}\n        ${detail}`);
}

function b32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const v = A.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totpFor(secret, counterOffset = 0) {
  const ctr = Math.floor(Date.now() / 1000 / 30) + counterOffset;
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0); buf.writeUInt32BE(ctr >>> 0, 4);
  const h = createHmac('sha1', b32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h[o] & 0x7f) << 24 | (h[o + 1] & 0xff) << 16 | (h[o + 2] & 0xff) << 8 | (h[o + 3] & 0xff)) % 1000000).padStart(6, '0');
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Blocks until the NEXT 30-second TOTP window starts.
 *
 * verifyTotp claims a counter once per admin (TOTP-REPLAY-1), so a step-up
 * that reuses the window the login already consumed is correctly refused. That
 * is the control working -- waiting for a fresh window is the only honest way
 * to exercise step-up, never weakening the control to make a probe pass.
 */
async function nextTotpWindow() {
  const msIntoWindow = (Date.now() / 1000 % 30) * 1000;
  await sleep(30_000 - msIntoWindow + 1_500);
}

async function login(key) {
  const a = M.adminAccounts[key];
  if (!a) throw new Error(`no seeded admin ${key}`);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const r = await api('/platform-admin/auth/login', {
      method: 'POST',
      body: { email: a.email, password: M.seedPassword, totpCode: totpFor(a.totpSecretBase32) },
    });
    if (r.status === 200 && r.json?.sessionToken) return { token: r.json.sessionToken, email: a.email };
    // A claimed TOTP window is the anti-replay control working; wait it out.
    await sleep(31_000);
  }
  throw new Error(`admin login failed for ${key}`);
}

const ROLES = ['app_owner', 'platform_admin', 'finance_admin', 'support_admin', 'auditor_read_only'];
const sessions = {};
for (const r of ROLES) {
  sessions[r] = await login(`${r}_settings`);
  console.log(`signed in: ${r}`);
}

// helper: run one path across all roles and compare to the expected allow-set
async function matrix(name, path, { method = 'GET', body, allowed }) {
  const results = {};
  for (const r of ROLES) {
    const res = await api(path, { method, body, token: sessions[r].token });
    results[r] = res.status;
  }
  const violations = [];
  for (const r of ROLES) {
    const ok = results[r] >= 200 && results[r] < 300;
    const shouldAllow = allowed.includes(r);
    // A 4xx that is NOT 401/403 (e.g. 404/400 for a synthetic id) is not an
    // authorization grant, so it is treated as "denied" for boundary purposes.
    if (!shouldAllow && ok) violations.push(`${r} was ALLOWED (${results[r]}) but must be denied`);
    if (shouldAllow && (results[r] === 401 || results[r] === 403)) {
      violations.push(`${r} was DENIED (${results[r]}) but is entitled`);
    }
  }
  record(name, violations.length === 0,
    `${method} ${path} -> ${JSON.stringify(results)}${violations.length ? ' :: ' + violations.join('; ') : ''}`);
}

// Expectations below are NOT guesses: each route is pinned to the operation its
// handler actually calls (read from the route source) and the allowed roles are
// transcribed from rbacPolicy.ts's OPERATION_MATRIX.
//
//   /platform-admin/audit                       -> VIEW_AUDIT_LOG_OWN            A A A A A
//   /platform-admin/settings/free-starter (GET) -> VIEW_SUPPORT_ACCOUNT_METADATA A A A A A
//   /platform-admin/settings/free-starter (PUT) -> ADMINISTER_NONSENSITIVE_...   A A D D D
//   /platform-admin/admin-users (GET)           -> VIEW_ADMIN_ACCOUNTS           A D D D A
//   /platform-admin/settlement/account-health   -> VIEW_SETTLEMENT_RECORDS       A D A D A
//   /platform-admin/families/:id/entitlement/limit -> ADMINISTER_ENTITLEMENT_QUANTITY A A D D D
const ALL = ROLES;

// ------------------------------------------------------------- 1. audit visibility
await matrix('audit log visibility (VIEW_AUDIT_LOG_OWN: all roles)', '/platform-admin/audit',
  { allowed: ALL });

// ------------------------------------------------------------- 2. settings read gate
await matrix('settings read gate (VIEW_SUPPORT_ACCOUNT_METADATA: all roles)',
  '/platform-admin/settings/free-starter-defaults', { allowed: ALL });

// ------------------------------------------------------------- 3. settings write gate
await matrix('settings write gate (ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS: owner+platform)',
  '/platform-admin/settings/free-starter-defaults',
  { method: 'PUT', body: { parentMemberLimit: 1, managedDeviceLimit: 1 },
    allowed: ['app_owner', 'platform_admin'] });

// ------------------------------------------------------------- 4. admin-user directory
await matrix('admin-user directory read (VIEW_ADMIN_ACCOUNTS: owner+auditor)',
  '/platform-admin/admin-users', { allowed: ['app_owner', 'auditor_read_only'] });

// ------------------------------------------------------------- 5. settlement records
await matrix('settlement records read (VIEW_SETTLEMENT_RECORDS: owner+finance+auditor)',
  '/platform-admin/settlement/account-health',
  { allowed: ['app_owner', 'finance_admin', 'auditor_read_only'] });

// ------------------------------------------------------------- 6. suspend is step-up gated
{
  const familyId = Object.values(M.parentAccounts).find((p) => p.familyId)?.familyId;

  // 6a. Without a step-up grant, even an entitled role is refused.
  const noStepUp = await api(`/platform-admin/accounts/${familyId}/suspend`, {
    method: 'POST', body: { reason: 'redteam probe' }, token: sessions.app_owner.token,
  });
  record('family suspend is refused without a step-up grant',
    noStepUp.status >= 400, `APP_OWNER without stepUpId -> ${noStepUp.status}`);

  // 6b. With a real step-up, RBAC still decides: entitled roles proceed past
  //     authorization, non-entitled roles are refused even holding a step-up.
  const verdicts = {};
  for (const role of ROLES) {
    const acct = M.adminAccounts[`${role}_settings`];
    await nextTotpWindow();
    const su = await api('/platform-admin/auth/step-up', {
      method: 'POST', token: sessions[role].token,
      body: { totpCode: totpFor(acct.totpSecretBase32), scope: 'FAMILY_ACCOUNT_SUSPEND' },
    });
    if (su.status !== 200) { verdicts[role] = `stepUp:${su.status}`; continue; }
    const r = await api(`/platform-admin/accounts/${familyId}/suspend`, {
      method: 'POST', token: sessions[role].token,
      body: { reason: 'redteam probe', stepUpId: su.json.stepUpId },
    });
    verdicts[role] = r.status;
  }
  const entitled = ['app_owner', 'platform_admin'];
  const violations = [];
  for (const role of ROLES) {
    const v = verdicts[role];
    const allowedThrough = typeof v === 'number' && v >= 200 && v < 300;
    const hardDenied = v === 403 || (typeof v === 'string' && v.startsWith('stepUp:403'));
    if (!entitled.includes(role) && allowedThrough) violations.push(`${role} suspended a family but is DENY on SUSPEND_FAMILY_ACCOUNT`);
    if (entitled.includes(role) && hardDenied) violations.push(`${role} is ALLOW on SUSPEND_FAMILY_ACCOUNT but was denied (${v})`);
  }
  record('family suspend honours SUSPEND_FAMILY_ACCOUNT (owner+platform) even with a valid step-up',
    violations.length === 0,
    `${JSON.stringify(verdicts)}${violations.length ? ' :: ' + violations.join('; ') : ''}`);
}

// ------------------------------------------------------------- 6c. step-up is single-use and scope-bound
{
  const familyId = Object.values(M.parentAccounts).find((p) => p.familyId)?.familyId;
  const acct = M.adminAccounts.app_owner_settings;
  await nextTotpWindow();
  const su = await api('/platform-admin/auth/step-up', {
    method: 'POST', token: sessions.app_owner.token,
    body: { totpCode: totpFor(acct.totpSecretBase32), scope: 'FAMILY_ACCOUNT_SUSPEND' },
  });
  if (su.status === 200) {
    const first = await api(`/platform-admin/accounts/${familyId}/suspend`, {
      method: 'POST', token: sessions.app_owner.token,
      body: { reason: 'redteam single-use probe', stepUpId: su.json.stepUpId },
    });
    const replay = await api(`/platform-admin/accounts/${familyId}/suspend`, {
      method: 'POST', token: sessions.app_owner.token,
      body: { reason: 'redteam replay probe', stepUpId: su.json.stepUpId },
    });
    record('a step-up grant cannot be replayed',
      replay.status >= 400, `first=${first.status} replaySameStepUpId=${replay.status}`);
  } else {
    record('a step-up grant cannot be replayed', false,
      `UNPROVEN: step-up did not issue (${su.status}); single-use was not exercised`);
  }

  // A step-up minted for one scope must not authorize a different scope.
  await nextTotpWindow();
  const wrongScope = await api('/platform-admin/auth/step-up', {
    method: 'POST', token: sessions.app_owner.token,
    body: { totpCode: totpFor(acct.totpSecretBase32), scope: 'FAMILY_ACCOUNT_REACTIVATE' },
  });
  if (wrongScope.status === 200) {
    const r = await api(`/platform-admin/accounts/${familyId}/suspend`, {
      method: 'POST', token: sessions.app_owner.token,
      body: { reason: 'redteam scope probe', stepUpId: wrongScope.json.stepUpId },
    });
    record('a step-up grant is bound to the scope it was issued for',
      r.status >= 400, `REACTIVATE-scoped step-up used on suspend -> ${r.status}`);
  } else {
    record('a step-up grant is bound to the scope it was issued for', false,
      `UNPROVEN: step-up did not issue (${wrongScope.status})`);
  }

  // An invalid TOTP must never mint a step-up.
  const badTotp = await api('/platform-admin/auth/step-up', {
    method: 'POST', token: sessions.app_owner.token,
    body: { totpCode: '000000', scope: 'FAMILY_ACCOUNT_SUSPEND' },
  });
  record('step-up requires a valid TOTP', badTotp.status >= 400, `invalid TOTP -> ${badTotp.status}`);
}

// ------------------------------------------------------------- 7. auditor is read-only
{
  const violations = [];
  const writes = [
    ['POST', '/platform-admin/billing/plans', { planCode: `RT-${Date.now()}`, displayName: 'x' }],
    ['PUT', '/platform-admin/settings/free-starter-defaults', { parentMemberLimit: 9, managedDeviceLimit: 9 }],
  ];
  for (const [method, path, body] of writes) {
    const r = await api(path, { method, body, token: sessions.auditor_read_only.token });
    if (r.status >= 200 && r.status < 300) violations.push(`${method} ${path} -> ${r.status}`);
  }
  record('AUDITOR_READ_ONLY cannot perform any write', violations.length === 0,
    violations.length ? `ACCEPTED: ${violations.join(', ')}` : `all ${writes.length} writes refused`);
}

// ------------------------------------------------------------- 8. unauthenticated + forged token
{
  const anon = await api('/platform-admin/accounts');
  const forged = await api('/platform-admin/accounts', { token: 'a'.repeat(64) });
  const wrongRealm = await api('/platform-admin/accounts', { token: 'Bearer-nonsense' });
  record('platform-admin API refuses anonymous and forged bearer tokens',
    anon.status >= 400 && forged.status >= 400 && wrongRealm.status >= 400,
    `anonymous=${anon.status} forgedToken=${forged.status} malformed=${wrongRealm.status}`);
}

// ------------------------------------------------------------- 9. cross-realm: parent session must not work here
{
  const p = await fetch(`${BACKEND}/api/parent/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: M.parentAccounts['owner-a'].email, password: M.seedPassword }),
  });
  const pj = await p.json();
  const cookie = (p.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const res = await fetch(`${BACKEND}/platform-admin/accounts`, { headers: { cookie } });
  record('a parent session cannot authenticate the platform-admin realm',
    res.status >= 400, `parent cookie against /platform-admin/accounts -> ${res.status} (parent login was ${p.status}, family ${pj.familyId ? 'present' : 'absent'})`);
}

// ------------------------------------------------------------- 10. TOTP replay rejection
{
  const a = M.adminAccounts.app_owner_replay_test;
  const code = totpFor(a.totpSecretBase32);
  const first = await api('/platform-admin/auth/login', {
    method: 'POST', body: { email: a.email, password: M.seedPassword, totpCode: code },
  });
  const replay = await api('/platform-admin/auth/login', {
    method: 'POST', body: { email: a.email, password: M.seedPassword, totpCode: code },
  });
  record('a TOTP code cannot be claimed twice (anti-replay)',
    first.status === 200 && replay.status >= 400,
    `first=${first.status} replaySameCode=${replay.status}`);
}

// ------------------------------------------------------------- 11. wrong password / wrong TOTP
{
  const a = M.adminAccounts.app_owner_audit_route;
  const badPw = await api('/platform-admin/auth/login', {
    method: 'POST', body: { email: a.email, password: 'wrong-password', totpCode: totpFor(a.totpSecretBase32) },
  });
  const badTotp = await api('/platform-admin/auth/login', {
    method: 'POST', body: { email: a.email, password: M.seedPassword, totpCode: '000000' },
  });
  record('login refuses a wrong password and a wrong TOTP independently',
    badPw.status >= 400 && badTotp.status >= 400,
    `wrongPassword=${badPw.status} wrongTotp=${badTotp.status}`);
}

// ------------------------------------------------------------- 12. sensitive settings masking + category spoof
{
  const t = sessions.app_owner.token;
  const spoof = await api('/platform-admin/settings/category/NOT_A_REAL_CATEGORY', { token: t });
  const traversal = await api('/platform-admin/settings/category/..%2F..%2Fadmin-users', { token: t });
  record('settings category cannot be spoofed or traversed',
    spoof.status >= 400 && traversal.status >= 400,
    `unknownCategory=${spoof.status} traversalAttempt=${traversal.status}`);

  // Any readable sensitive setting must come back masked, never in cleartext.
  const sensitive = await api('/platform-admin/settings/category/PAYMENT_PROVIDER', { token: t });
  const raw = JSON.stringify(sensitive.json ?? {});
  const leaksSecret = /"(secret|apiKey|api_key|privateKey|password)"\s*:\s*"(?!\*)[^"]{6,}/i.test(raw);
  record('sensitive settings are not returned in cleartext',
    !leaksSecret, `status=${sensitive.status} bodyLooksMasked=${!leaksSecret}`);
}

// ------------------------------------------------------------- 13. step-up required for privileged mutation
{
  const t = sessions.app_owner.token;
  // A fresh session has no step-up grant; a step-up-gated mutation must not
  // proceed on the plain session alone.
  const anyAdmin = Object.values(M.adminAccounts)[1];
  const r = await api('/platform-admin/admin-users', {
    method: 'POST', token: t,
    body: { email: `redteam-${Date.now()}@pca-seed.test`, roles: ['SUPPORT_ADMIN'] },
  });
  record('privileged admin-user creation is not granted by a plain session alone',
    r.status !== 200 || r.json?.stepUpRequired === true,
    `POST /platform-admin/admin-users -> ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
}

// ------------------------------------------------------------- 14. session revocation
{
  const s = await login('app_owner_accounts_route');
  const before = await api('/platform-admin/auth/whoami', { token: s.token });
  const rev = await api('/platform-admin/auth/sessions/revoke-all', { method: 'POST', body: {}, token: s.token });
  const after = await api('/platform-admin/auth/whoami', { token: s.token });
  record('admin session revoke-all invalidates the token',
    before.status === 200 && after.status >= 400,
    `before=${before.status} revokeAll=${rev.status} after=${after.status}`);
}

console.log('');
console.log(`PA_SECURITY_CHECKS_RUN = ${checks.length}`);
console.log(`PA_SECURITY_FINDINGS_OPEN = ${findings.length}`);
for (const f of findings) console.log(`  - ${f.name}: ${f.detail}`);
if (findings.length) process.exitCode = 1;
