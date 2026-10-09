import assert from 'node:assert/strict';
import test from 'node:test';
import { BonusGrantLedger } from '../../dist/childrequests/BonusGrantLedger.js';

function grant(overrides = {}) {
  return {
    id: 'grant-1',
    appScope: 'ALL',
    extraMinutes: 30,
    grantedAtUtc: new Date('2026-01-07T09:00:00.000Z'),
    expiresAtUtc: new Date('2026-01-07T09:30:00.000Z'),
    ...overrides,
  };
}

test('listActive returns a grant only within [grantedAtUtc, expiresAtUtc)', () => {
  const ledger = new BonusGrantLedger();
  const g = grant();
  ledger.record('child-1', g, g.grantedAtUtc);

  assert.deepEqual(ledger.listActive('child-1', new Date('2026-01-07T08:59:00.000Z')), []);
  assert.deepEqual(ledger.listActive('child-1', new Date('2026-01-07T09:00:00.000Z')), [g]);
  assert.deepEqual(ledger.listActive('child-1', new Date('2026-01-07T09:15:00.000Z')), [g]);
  assert.deepEqual(ledger.listActive('child-1', new Date('2026-01-07T09:30:00.000Z')), []); // expiresAtUtc is exclusive
});

test('a new grant supersedes (does not stack with) a still-active prior grant for the SAME appScope', () => {
  const ledger = new BonusGrantLedger();
  const first = grant({ id: 'grant-1', extraMinutes: 30, expiresAtUtc: new Date('2026-01-07T09:30:00.000Z') });
  ledger.record('child-1', first, first.grantedAtUtc);

  const second = grant({
    id: 'grant-2',
    extraMinutes: 45,
    grantedAtUtc: new Date('2026-01-07T09:10:00.000Z'),
    expiresAtUtc: new Date('2026-01-07T09:55:00.000Z'),
  });
  ledger.record('child-1', second, second.grantedAtUtc);

  const activeAt915 = ledger.listActive('child-1', new Date('2026-01-07T09:15:00.000Z'));
  assert.equal(activeAt915.length, 1);
  assert.equal(activeAt915[0].id, 'grant-2');

  // The superseded grant's own history is preserved (capped, not deleted).
  const history = ledger.listAll('child-1');
  assert.equal(history.length, 2);
  const supersededFirst = history.find((g) => g.id === 'grant-1');
  assert.equal(supersededFirst.expiresAtUtc.getTime(), second.grantedAtUtc.getTime());
});

test('grants for DIFFERENT appScopes do not supersede each other', () => {
  const ledger = new BonusGrantLedger();
  const gameGrant = grant({ id: 'grant-game', appScope: { apps: ['game-app'] } });
  const videoGrant = grant({ id: 'grant-video', appScope: { apps: ['video-app'] }, grantedAtUtc: new Date('2026-01-07T09:10:00.000Z'), expiresAtUtc: new Date('2026-01-07T09:40:00.000Z') });
  ledger.record('child-1', gameGrant, gameGrant.grantedAtUtc);
  ledger.record('child-1', videoGrant, videoGrant.grantedAtUtc);

  const active = ledger.listActive('child-1', new Date('2026-01-07T09:15:00.000Z'));
  assert.equal(active.length, 2);
});

test('an ALL-scoped grant supersedes a narrower still-active grant, and vice versa', () => {
  const ledger = new BonusGrantLedger();
  const narrow = grant({ id: 'grant-narrow', appScope: { apps: ['game-app'] } });
  ledger.record('child-1', narrow, narrow.grantedAtUtc);
  const broad = grant({ id: 'grant-broad', appScope: 'ALL', grantedAtUtc: new Date('2026-01-07T09:10:00.000Z'), expiresAtUtc: new Date('2026-01-07T09:40:00.000Z') });
  ledger.record('child-1', broad, broad.grantedAtUtc);

  const active = ledger.listActive('child-1', new Date('2026-01-07T09:20:00.000Z'));
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'grant-broad');
});

test('a grant for a DIFFERENT child is never affected', () => {
  const ledger = new BonusGrantLedger();
  const g1 = grant({ id: 'grant-1' });
  ledger.record('child-1', g1, g1.grantedAtUtc);
  const g2 = grant({ id: 'grant-2', grantedAtUtc: new Date('2026-01-07T09:05:00.000Z'), expiresAtUtc: new Date('2026-01-07T09:45:00.000Z') });
  ledger.record('child-2', g2, g2.grantedAtUtc);

  assert.equal(ledger.listActive('child-1', new Date('2026-01-07T09:10:00.000Z'))[0].id, 'grant-1');
  assert.equal(ledger.listActive('child-2', new Date('2026-01-07T09:10:00.000Z'))[0].id, 'grant-2');
});

test('revoke shortens an active grant to expire immediately and it is idempotency-safe (repeat revoke is a no-op false)', () => {
  const ledger = new BonusGrantLedger();
  const g = grant({ expiresAtUtc: new Date('2026-01-07T09:30:00.000Z') });
  ledger.record('child-1', g, g.grantedAtUtc);

  const revokedAt = new Date('2026-01-07T09:10:00.000Z');
  const firstRevoke = ledger.revoke('child-1', 'grant-1', revokedAt, 'acct-parent');
  assert.equal(firstRevoke, true);
  assert.deepEqual(ledger.getRevocationMetadata('child-1', 'grant-1'), {
    grantId: 'grant-1',
    childProfileId: 'child-1',
    revokedAtUtc: revokedAt,
    revokedByParentAccountId: 'acct-parent',
  });
  const returnedMetadata = ledger.getRevocationMetadata('child-1', 'grant-1');
  returnedMetadata.revokedAtUtc.setTime(0);
  assert.equal(ledger.getRevocationMetadata('child-1', 'grant-1').revokedAtUtc.getTime(), revokedAt.getTime(), 'metadata reads must not expose the stored Date');
  assert.deepEqual(ledger.listActive('child-1', revokedAt), []); // exclusive upper bound: revoked-at instant itself is no longer active
  assert.deepEqual(ledger.listActive('child-1', new Date('2026-01-07T09:05:00.000Z')), [g].map((x) => ({ ...x, expiresAtUtc: revokedAt })));

  // Revoking an already-inactive grant again is a no-op, not an error and not a "re-revoke".
  const secondRevoke = ledger.revoke('child-1', 'grant-1', new Date('2026-01-07T09:20:00.000Z'), 'acct-other');
  assert.equal(secondRevoke, false);
  assert.equal(ledger.getRevocationMetadata('child-1', 'grant-1').revokedByParentAccountId, 'acct-parent', 'inactive retries must not replace successful actor attribution');
});

test('revoke never extends a grant that already expired earlier on its own', () => {
  const ledger = new BonusGrantLedger();
  const g = grant({ expiresAtUtc: new Date('2026-01-07T09:15:00.000Z') });
  ledger.record('child-1', g, g.grantedAtUtc);

  // "Revoking" after natural expiry must not resurrect/extend it.
  const result = ledger.revoke('child-1', 'grant-1', new Date('2026-01-07T09:20:00.000Z'), 'acct-parent');
  assert.equal(result, false);
  assert.equal(ledger.getRevocationMetadata('child-1', 'grant-1'), null, 'naturally expired grants receive no revoke attribution');
  const stored = ledger.listAll('child-1')[0];
  assert.equal(stored.expiresAtUtc.getTime(), new Date('2026-01-07T09:15:00.000Z').getTime());
});

test('recording the SAME grant id twice is idempotent and cannot overwrite or resurrect it', () => {
  const ledger = new BonusGrantLedger();
  const g = grant();
  ledger.record('child-1', g, g.grantedAtUtc);
  ledger.record('child-1', g, g.grantedAtUtc); // e.g. ChildRequestService.decide()'s own idempotent-replay path

  assert.equal(ledger.listAll('child-1').length, 1);
  assert.equal(ledger.listActive('child-1', new Date('2026-01-07T09:10:00.000Z')).length, 1);
  ledger.record('child-1', grant({ extraMinutes: 90, expiresAtUtc: new Date('2026-01-07T10:30:00.000Z') }), g.grantedAtUtc);
  assert.deepEqual(ledger.listAll('child-1'), [g], 'a reused grant id cannot replace the originally authorized content');

  assert.equal(ledger.revoke('child-1', 'grant-1', new Date('2026-01-07T09:05:00.000Z'), 'acct-parent'), true);
  const revocation = ledger.getRevocationMetadata('child-1', 'grant-1');
  ledger.record('child-1', g, g.grantedAtUtc);
  assert.deepEqual(ledger.listActive('child-1', new Date('2026-01-07T09:10:00.000Z')), [], 'replaying the old approval cannot reactivate a revoked grant');
  assert.deepEqual(ledger.getRevocationMetadata('child-1', 'grant-1'), revocation, 'an approval replay cannot erase revocation actor metadata');
  assert.equal(ledger.revoke('child-1', 'grant-1', new Date('2026-01-07T09:10:00.000Z'), 'acct-next'), false);
  assert.equal(ledger.getRevocationMetadata('child-1', 'grant-1').revokedByParentAccountId, 'acct-parent');
});

test('grant input and list results are detached, including app scope and date fields', () => {
  const ledger = new BonusGrantLedger();
  const grantStart = new Date('2026-01-07T09:00:00.000Z');
  const expiresAt = new Date('2026-01-07T09:30:00.000Z');
  const expectedGrantStartMs = grantStart.getTime();
  const expectedExpiresAtMs = expiresAt.getTime();
  const now = new Date(grantStart);
  const input = grant({
    id: 'snapshot-grant',
    appScope: { apps: ['game-app'] },
    grantedAtUtc: grantStart,
    expiresAtUtc: expiresAt,
  });
  ledger.record('child-1', input, now);

  input.appScope.apps.push('video-app');
  input.extraMinutes = 240;
  input.grantedAtUtc.setTime(0);
  input.expiresAtUtc.setTime(new Date('2026-01-08T00:00:00Z').getTime());
  now.setTime(new Date('2026-01-08T00:00:00Z').getTime());

  const fromHistory = ledger.listAll('child-1')[0];
  assert.deepEqual(fromHistory.appScope, { apps: ['game-app'] });
  assert.equal(fromHistory.extraMinutes, 30);
  assert.equal(fromHistory.grantedAtUtc.getTime(), expectedGrantStartMs);
  assert.equal(fromHistory.expiresAtUtc.getTime(), expectedExpiresAtMs);

  fromHistory.appScope.apps.push('mutated-app');
  fromHistory.grantedAtUtc.setTime(0);
  fromHistory.expiresAtUtc.setTime(0);
  const active = ledger.listActive('child-1', new Date('2026-01-07T09:15:00Z'))[0];
  assert.deepEqual(active.appScope, { apps: ['game-app'] });
  assert.equal(active.grantedAtUtc.getTime(), expectedGrantStartMs);
  assert.equal(active.expiresAtUtc.getTime(), expectedExpiresAtMs);
});

test('revoking an unknown grant id is a safe no-op', () => {
  const ledger = new BonusGrantLedger();
  assert.equal(ledger.revoke('child-1', 'does-not-exist', new Date(), 'acct-parent'), false);
  assert.equal(ledger.revoke('unknown-child', 'grant-1', new Date(), 'acct-parent'), false);
  assert.equal(ledger.getRevocationMetadata('child-1', 'does-not-exist'), null);
  assert.equal(ledger.getRevocationMetadata('unknown-child', 'grant-1'), null);
});
