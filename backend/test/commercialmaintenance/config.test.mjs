// PCA-COMMERCIAL-RUNTIME-1: no DB -- loadCommercialMaintenanceConfig's
// bounds-validation and fail-safe (never-silently-clamp) behavior.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadCommercialMaintenanceConfig,
  CommercialMaintenanceConfigError,
  COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS,
  COMMERCIAL_MAINTENANCE_ENV_KEYS,
} from '../../dist/commercialmaintenance/config.js';

test('loadCommercialMaintenanceConfig returns the documented defaults when env is empty', () => {
  const config = loadCommercialMaintenanceConfig({});
  assert.deepEqual(config, COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS);
});

test('loadCommercialMaintenanceConfig accepts a valid in-bounds override for every knob', () => {
  const config = loadCommercialMaintenanceConfig({
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.intervalMs]: '60000',
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.quoteExpiryBatchSize]: '10',
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.notificationRetentionDays]: '30',
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.notificationPruneBatchSize]: '250',
  });
  assert.deepEqual(config, {
    intervalMs: 60000,
    quoteExpiryBatchSize: 10,
    notificationRetentionDays: 30,
    notificationPruneBatchSize: 250,
  });
});

for (const key of Object.values(COMMERCIAL_MAINTENANCE_ENV_KEYS)) {
  test(`loadCommercialMaintenanceConfig FAILS SAFE (throws, never clamps/no-ops) on a non-integer value for ${key}`, () => {
    assert.throws(() => loadCommercialMaintenanceConfig({ [key]: 'not-a-number' }), CommercialMaintenanceConfigError);
  });

  test(`loadCommercialMaintenanceConfig FAILS SAFE on a float value for ${key}`, () => {
    assert.throws(() => loadCommercialMaintenanceConfig({ [key]: '1.5' }), CommercialMaintenanceConfigError);
  });

  test(`loadCommercialMaintenanceConfig FAILS SAFE on a zero/negative value for ${key}`, () => {
    assert.throws(() => loadCommercialMaintenanceConfig({ [key]: '0' }), CommercialMaintenanceConfigError);
    assert.throws(() => loadCommercialMaintenanceConfig({ [key]: '-5' }), CommercialMaintenanceConfigError);
  });
}

test('loadCommercialMaintenanceConfig FAILS SAFE on an out-of-upper-bound intervalMs (> 24h)', () => {
  assert.throws(
    () => loadCommercialMaintenanceConfig({ [COMMERCIAL_MAINTENANCE_ENV_KEYS.intervalMs]: String(25 * 60 * 60 * 1000) }),
    CommercialMaintenanceConfigError,
  );
});

test('loadCommercialMaintenanceConfig FAILS SAFE on an out-of-upper-bound quoteExpiryBatchSize (> 10000)', () => {
  assert.throws(
    () => loadCommercialMaintenanceConfig({ [COMMERCIAL_MAINTENANCE_ENV_KEYS.quoteExpiryBatchSize]: '10001' }),
    CommercialMaintenanceConfigError,
  );
});

test('loadCommercialMaintenanceConfig accepts the exact boundary values (min and max)', () => {
  const atMin = loadCommercialMaintenanceConfig({
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.intervalMs]: '1000',
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.quoteExpiryBatchSize]: '1',
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.notificationRetentionDays]: '1',
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.notificationPruneBatchSize]: '1',
  });
  assert.deepEqual(atMin, { intervalMs: 1000, quoteExpiryBatchSize: 1, notificationRetentionDays: 1, notificationPruneBatchSize: 1 });

  const atMax = loadCommercialMaintenanceConfig({
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.intervalMs]: String(24 * 60 * 60 * 1000),
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.quoteExpiryBatchSize]: '10000',
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.notificationRetentionDays]: '3650',
    [COMMERCIAL_MAINTENANCE_ENV_KEYS.notificationPruneBatchSize]: '10000',
  });
  assert.deepEqual(atMax, {
    intervalMs: 24 * 60 * 60 * 1000,
    quoteExpiryBatchSize: 10000,
    notificationRetentionDays: 3650,
    notificationPruneBatchSize: 10000,
  });
});

test('loadCommercialMaintenanceConfig treats an empty string the same as absent (falls back to default)', () => {
  const config = loadCommercialMaintenanceConfig({ [COMMERCIAL_MAINTENANCE_ENV_KEYS.intervalMs]: '' });
  assert.equal(config.intervalMs, COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS.intervalMs);
});

test('loadCommercialMaintenanceConfig defaults to process.env when no argument is given', () => {
  const previous = process.env[COMMERCIAL_MAINTENANCE_ENV_KEYS.quoteExpiryBatchSize];
  process.env[COMMERCIAL_MAINTENANCE_ENV_KEYS.quoteExpiryBatchSize] = '77';
  try {
    const config = loadCommercialMaintenanceConfig();
    assert.equal(config.quoteExpiryBatchSize, 77);
  } finally {
    if (previous === undefined) delete process.env[COMMERCIAL_MAINTENANCE_ENV_KEYS.quoteExpiryBatchSize];
    else process.env[COMMERCIAL_MAINTENANCE_ENV_KEYS.quoteExpiryBatchSize] = previous;
  }
});
