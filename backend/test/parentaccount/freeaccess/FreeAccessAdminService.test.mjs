// FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61) -- FreeAccessAdminService:
// RBAC-per-role matrix, step-up enforcement, existing-account
// extend/reduce/convert adjustment, audit-event shape (before/after/actor/
// reason), and the structural guarantee that a global-default read never
// touches an account's own snapshot.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FreeAccessAdminService, FreeAccessAdminError } from '../../../dist/parentaccount/freeaccess/FreeAccessAdminService.js';
import { MS_PER_DAY } from '../../../dist/parentaccount/freeaccess/deriveFreeAccessStatus.js';
import { PlatformAdminAuthError } from '../../../dist/platformadmin/auth/PlatformAdminAuthService.js';

const NOW = new Date('2026-08-01T00:00:00.000Z');
const STARTED_AT = new Date('2026-07-16T00:00:00.000Z');
const EXPIRES_AT = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
const ACCOUNT_ID = 'acct-1';

function baseSnapshot() {
  return { mode: 'TIME_LIMITED', durationDays: 30, startedAt: STARTED_AT, expiresAt: EXPIRES_AT, defaultParentMemberLimit: 4, defaultManagedDeviceLimit: 5 };
}

/** Deterministic in-memory fake -- never a real DB connection. */
function fakeRepository(initialSnapshot) {
  let snapshot = initialSnapshot;
  return {
    async findByAccountId(accountId) {
      if (accountId !== ACCOUNT_ID) return null;
      return { accountId, status: 'VERIFIED', disabledAt: null, freeAccess: snapshot };
    },
    async adjustFreeAccessWithinTransaction(_conn, accountId, action, now) {
      if (accountId !== ACCOUNT_ID || snapshot === null) return null;
      const before = snapshot;
      // Reuse the real pure computation via a tiny local re-implementation is
      // unnecessary here -- the real computeAdjustedSnapshot is exercised
      // directly in adjustment.test.mjs; this fake only needs to prove the
      // SERVICE calls through correctly, so a minimal stand-in suffices.
      const after = action.kind === 'CONVERT_TO_PERPETUAL' ? { ...before, mode: 'PERPETUAL', durationDays: null, expiresAt: null } : { ...before, expiresAt: new Date(before.expiresAt.getTime() + (action.additionalDays ?? 0) * MS_PER_DAY) };
      snapshot = after;
      return { before, after };
    },
    async adjustFreeAccess(accountId, action, now) {
      return this.adjustFreeAccessWithinTransaction(null, accountId, action, now);
    },
  };
}

function fakeAuthService({ stepUpShouldFail = false } = {}) {
  const consumed = [];
  return {
    consumed,
    async consumeStepUp(stepUpId, adminId, sessionId, scope) {
      consumed.push({ stepUpId, adminId, sessionId, scope });
      if (stepUpShouldFail) throw new PlatformAdminAuthError();
    },
  };
}

function passthroughTransaction() {
  return (fn) => fn(null);
}

function recordingAuditWriter() {
  const events = [];
  return { events, writer: async (_conn, event) => { events.push(event); } };
}

function buildService({ snapshot = baseSnapshot(), stepUpShouldFail = false } = {}) {
  const repository = fakeRepository(snapshot);
  const authService = fakeAuthService({ stepUpShouldFail });
  const { events, writer } = recordingAuditWriter();
  const service = new FreeAccessAdminService(authService, repository, () => NOW, passthroughTransaction(), writer);
  return { service, authService, auditEvents: events };
}

const ROLES = ['APP_OWNER', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR_READ_ONLY'];

function actorWith(roles) {
  return { adminId: 'admin-1', roles, sessionId: 'session-1' };
}

test('getGlobalDefaults: VIEW is ALLOW for all five roles', () => {
  const { service } = buildService();
  for (const role of ROLES) {
    assert.doesNotThrow(() => service.getGlobalDefaults(actorWith([role])));
  }
});

test('getGlobalDefaults: an admin with zero roles is FORBIDDEN', () => {
  const { service } = buildService();
  assert.throws(() => service.getGlobalDefaults(actorWith([])), (e) => e instanceof FreeAccessAdminError && e.code === 'FORBIDDEN');
});

test('getAccountStatus: NOT_FOUND for an unknown account, never a silent empty 200', async () => {
  const { service } = buildService();
  await assert.rejects(service.getAccountStatus(actorWith(['APP_OWNER']), 'unknown-account'), (e) => e instanceof FreeAccessAdminError && e.code === 'NOT_FOUND');
});

test('getAccountStatus: derives the correct status for a known account', async () => {
  const { service } = buildService();
  const status = await service.getAccountStatus(actorWith(['APP_OWNER']), ACCOUNT_ID);
  assert.equal(status.status, 'ACTIVE');
});

test('adjustAccount RBAC matrix: ALLOW only for APP_OWNER and PLATFORM_ADMIN (ADMINISTER_ENTITLEMENT_QUANTITY)', async () => {
  const expected = { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'ALLOW', FINANCE_ADMIN: 'DENY', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' };
  for (const role of ROLES) {
    const { service } = buildService();
    const attempt = service.adjustAccount(actorWith([role]), ACCOUNT_ID, { kind: 'CONVERT_TO_PERPETUAL' }, 'testing', 'step-up-1');
    if (expected[role] === 'ALLOW') {
      await assert.doesNotReject(attempt, `role ${role} should be allowed`);
    } else {
      await assert.rejects(attempt, (e) => e instanceof FreeAccessAdminError && e.code === 'FORBIDDEN', `role ${role} should be forbidden`);
    }
  }
});

test('adjustAccount: zero roles is FORBIDDEN', async () => {
  const { service } = buildService();
  await assert.rejects(service.adjustAccount(actorWith([]), ACCOUNT_ID, { kind: 'CONVERT_TO_PERPETUAL' }, 'testing', 'step-up-1'), (e) => e instanceof FreeAccessAdminError && e.code === 'FORBIDDEN');
});

test('adjustAccount: rejects an empty/missing reason code even for an authorized role, BEFORE consuming step-up', async () => {
  const { service, authService } = buildService();
  await assert.rejects(service.adjustAccount(actorWith(['APP_OWNER']), ACCOUNT_ID, { kind: 'CONVERT_TO_PERPETUAL' }, '', 'step-up-1'), (e) => e instanceof FreeAccessAdminError && e.code === 'INVALID_REQUEST');
  assert.equal(authService.consumed.length, 0, 'an invalid request must never consume a one-time step-up grant');
});

test('adjustAccount: a failed/invalid step-up is STEP_UP_REQUIRED, never a silent success', async () => {
  const { service } = buildService({ stepUpShouldFail: true });
  await assert.rejects(service.adjustAccount(actorWith(['APP_OWNER']), ACCOUNT_ID, { kind: 'CONVERT_TO_PERPETUAL' }, 'testing', 'bad-step-up'), (e) => e instanceof FreeAccessAdminError && e.code === 'STEP_UP_REQUIRED');
});

test('adjustAccount: consumes step-up with the ENTITLEMENT_LIMIT_OVERRIDE scope, bound to the actual actor/session', async () => {
  const { service, authService } = buildService();
  await service.adjustAccount(actorWith(['APP_OWNER']), ACCOUNT_ID, { kind: 'CONVERT_TO_PERPETUAL' }, 'testing', 'step-up-99');
  assert.equal(authService.consumed.length, 1);
  assert.deepEqual(authService.consumed[0], { stepUpId: 'step-up-99', adminId: 'admin-1', sessionId: 'session-1', scope: 'ENTITLEMENT_LIMIT_OVERRIDE' });
});

test('adjustAccount: NOT_FOUND for an unknown account (never silently succeeds)', async () => {
  const { service } = buildService();
  await assert.rejects(service.adjustAccount(actorWith(['APP_OWNER']), 'unknown', { kind: 'CONVERT_TO_PERPETUAL' }, 'testing', 'step-up-1'), (e) => e instanceof FreeAccessAdminError && e.code === 'NOT_FOUND');
});

test('adjustAccount: writes exactly one audit event with before/after/actor/reason, and returns the derived post-adjustment status', async () => {
  const { service, auditEvents } = buildService();
  const status = await service.adjustAccount(actorWith(['APP_OWNER']), ACCOUNT_ID, { kind: 'CONVERT_TO_PERPETUAL' }, 'promotional extension', 'step-up-1');
  assert.equal(status.status, 'PERPETUAL');

  assert.equal(auditEvents.length, 1);
  const event = auditEvents[0];
  assert.equal(event.eventType, 'SETTING_CHANGED');
  assert.equal(event.actorAdminId, 'admin-1');
  assert.equal(event.actorRole, 'APP_OWNER');
  assert.equal(event.targetRef, `parent_account_free_access:${ACCOUNT_ID}`);
  assert.equal(event.result, 'SUCCESS');
  assert.equal(event.metadata.domain, 'FREE_ACCESS_ACCOUNT_ADJUSTMENT');
  assert.equal(event.metadata.reasonCode, 'promotional extension');
  assert.equal(event.metadata.before.mode, 'TIME_LIMITED');
  assert.equal(event.metadata.after.mode, 'PERPETUAL');
});

test('a global-default read never touches, and is never triggered by reading, any specific account\'s own snapshot', async () => {
  const { service, auditEvents } = buildService();
  service.getGlobalDefaults(actorWith(['APP_OWNER']));
  assert.equal(auditEvents.length, 0, 'reading global defaults writes no audit event and mutates no account');
  const status = await service.getAccountStatus(actorWith(['APP_OWNER']), ACCOUNT_ID);
  assert.equal(status.status, 'ACTIVE', 'the account snapshot is unchanged by the prior global-defaults read');
});
