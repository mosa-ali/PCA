// Constraint 25: ProviderEvent foundation idempotency primitive. Two
// connections attempt to insert the same (provider, providerEventId)
// concurrently -- exactly one must succeed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { ProviderEventService, ProviderEventRepository } from '../../dist/billing/providerEvent.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

test('MySQL CONCURRENCY: two connections racing to record the SAME (provider, providerEventId) -- exactly one succeeds', async () => {
  const service = new ProviderEventService(new ProviderEventRepository());
  const provider = 'TEST_PROVIDER';
  const providerEventId = `evt_${randomUUID()}`;

  const results = await Promise.all([
    service.record(provider, providerEventId, 'attempt:a'),
    service.record(provider, providerEventId, 'attempt:b'),
  ]);

  const recorded = results.filter((r) => r.outcome === 'RECORDED');
  const duplicate = results.filter((r) => r.outcome === 'DUPLICATE');
  assert.equal(recorded.length, 1, 'exactly one concurrent insert must be RECORDED');
  assert.equal(duplicate.length, 1, 'the other concurrent insert must observe DUPLICATE');

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_provider_events WHERE provider = ? AND provider_event_id = ?`, [provider, providerEventId]);
  assert.equal(Number(rows[0].n), 1, 'exactly one row must exist for this (provider, providerEventId) after the race');
});

test('MySQL: re-delivery of an already-recorded event id returns DUPLICATE, never a second row (idempotency, PCA-ADD-BILL-031)', async () => {
  const service = new ProviderEventService(new ProviderEventRepository());
  const provider = 'TEST_PROVIDER';
  const providerEventId = `evt_${randomUUID()}`;

  const first = await service.record(provider, providerEventId, null);
  assert.equal(first.outcome, 'RECORDED');
  const redelivered = await service.record(provider, providerEventId, null);
  assert.equal(redelivered.outcome, 'DUPLICATE');

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_provider_events WHERE provider = ? AND provider_event_id = ?`, [provider, providerEventId]);
  assert.equal(Number(rows[0].n), 1);
});

test('MySQL: the same providerEventId under a DIFFERENT provider is a distinct event (not collapsed by the unique key)', async () => {
  const service = new ProviderEventService(new ProviderEventRepository());
  const providerEventId = `evt_${randomUUID()}`;

  const a = await service.record('PROVIDER_A', providerEventId, null);
  const b = await service.record('PROVIDER_B', providerEventId, null);
  assert.equal(a.outcome, 'RECORDED');
  assert.equal(b.outcome, 'RECORDED');
});

test.after(async () => {
  await closePool();
});
