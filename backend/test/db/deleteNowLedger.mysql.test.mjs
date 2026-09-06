// PCA-DW-W3-D -- real MySQL coverage for MySqlDeleteNowLedger: durable
// first-write-wins idempotency (mirroring applyDeleteNow's own contract),
// survives-a-"restart" semantics (a fresh repository instance still sees
// the same durable row), and concurrent-record-race safety.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MySqlDeleteNowLedger } from '../../dist/retention/MySqlDeleteNowLedger.js';
import { applyDeleteNow } from '../../dist/retention/deleteNow.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function uniqueActionId() {
  return `delete-now-${randomUUID()}`;
}

function record(overrides = {}) {
  return { entityClass: 'WEB_VISIT', id: 'r1', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z'), ...overrides };
}

test('MySQL: get() returns null when no row exists yet', async () => {
  const ledger = new MySqlDeleteNowLedger();
  assert.equal(await ledger.get(uniqueActionId()), null);
});

test('MySQL: record() durably persists a plan, readable back via get()', async () => {
  const ledger = new MySqlDeleteNowLedger();
  const actionId = uniqueActionId();
  const plan = { toDelete: [{ entityClass: 'WEB_VISIT', id: 'r1', reason: 'DELETE_NOW', reasonMessage: 'Deleted now.' }], retainedCount: 0 };
  const completedAt = new Date('2026-02-01T00:00:00.000Z');
  await ledger.record(actionId, plan, completedAt);

  const reread = await ledger.get(actionId);
  assert.deepEqual(reread.plan, plan);
  assert.equal(reread.actionId, actionId);
  assert.equal(reread.completedAtUtc.getTime(), completedAt.getTime());
});

test('MySQL: a durable row survives a fresh repository instance (simulates a process restart)', async () => {
  const actionId = uniqueActionId();
  const plan = { toDelete: [], retainedCount: 5 };
  await new MySqlDeleteNowLedger().record(actionId, plan, new Date());

  // A brand-new instance -- no shared in-process state -- still sees the row.
  const afterRestart = await new MySqlDeleteNowLedger().get(actionId);
  assert.deepEqual(afterRestart.plan, plan);
});

test('MySQL: a second record() call for the SAME actionId is a no-op -- the FIRST plan wins, never overwritten', async () => {
  const ledger = new MySqlDeleteNowLedger();
  const actionId = uniqueActionId();
  const firstPlan = { toDelete: [{ entityClass: 'WEB_VISIT', id: 'r1', reason: 'DELETE_NOW', reasonMessage: 'first' }], retainedCount: 0 };
  const secondPlan = { toDelete: [{ entityClass: 'WEB_VISIT', id: 'r2', reason: 'DELETE_NOW', reasonMessage: 'second' }], retainedCount: 0 };
  await ledger.record(actionId, firstPlan, new Date('2026-01-01T00:00:00.000Z'));
  await ledger.record(actionId, secondPlan, new Date('2026-01-02T00:00:00.000Z'));

  const stored = await ledger.get(actionId);
  assert.deepEqual(stored.plan, firstPlan, 'the second record() call must never overwrite the first');
});

test('CONCURRENCY: two concurrent record() calls for the SAME actionId never both "win" -- exactly one plan is durably stored', async () => {
  const ledgerA = new MySqlDeleteNowLedger();
  const ledgerB = new MySqlDeleteNowLedger();
  const actionId = uniqueActionId();
  const planA = { toDelete: [{ entityClass: 'WEB_VISIT', id: 'from-a', reason: 'DELETE_NOW', reasonMessage: 'a' }], retainedCount: 0 };
  const planB = { toDelete: [{ entityClass: 'WEB_VISIT', id: 'from-b', reason: 'DELETE_NOW', reasonMessage: 'b' }], retainedCount: 0 };

  await Promise.all([ledgerA.record(actionId, planA, new Date()), ledgerB.record(actionId, planB, new Date())]);

  const stored = await ledgerA.get(actionId);
  const storedIds = stored.plan.toDelete.map((e) => e.id);
  assert.ok(storedIds.length === 1 && (storedIds[0] === 'from-a' || storedIds[0] === 'from-b'), 'exactly one of the two concurrent plans must have won, never a mix, never neither');
});

// End-to-end through the real applyDeleteNow contract, against the real
// durable ledger -- proves the idempotency guarantee applyDeleteNow.ts
// documents actually holds with durable (not in-memory) storage.
test('MySQL: applyDeleteNow via the real durable ledger is idempotent across "restarts" and never expands to newer data', async () => {
  const actionId = uniqueActionId();
  const original = await applyDeleteNow(actionId, [record({ id: 'r1' })], new MySqlDeleteNowLedger(), new Date('2026-02-01T00:00:00.000Z'));
  assert.equal(original.idempotent, false);
  assert.deepEqual(original.plan.toDelete.map((e) => e.id), ['r1']);

  // Fresh ledger instance (simulated restart) + newer data ('r2') arrives.
  const replay = await applyDeleteNow(actionId, [record({ id: 'r1' }), record({ id: 'r2' })], new MySqlDeleteNowLedger(), new Date('2026-03-01T00:00:00.000Z'));
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.plan.toDelete.map((e) => e.id), ['r1'], 'must never expand to cover r2, even across a simulated restart');
});

test.after(async () => {
  await closePool();
});
