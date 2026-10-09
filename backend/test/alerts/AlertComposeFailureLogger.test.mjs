import assert from 'node:assert/strict';
import test from 'node:test';
import { alertComposeFailureMessage, CONSOLE_ALERT_COMPOSE_FAILURE_LOGGER } from '../../dist/alerts/AlertComposeFailureLogger.js';

test('alert failure categories never inspect or stringify sensitive exception content', () => {
  const privateText = 'PRIVATE NOTE / SQL PARAMETERS / CIPHERTEXT / SECRET KEY MATERIAL';
  let inspected = false;
  const hostile = {
    get message() { inspected = true; throw new Error(privateText); },
    toString() { inspected = true; throw new Error(privateText); },
    [Symbol.toPrimitive]() { inspected = true; throw new Error(privateText); },
  };
  for (const thrown of [new Error(privateText), privateText, hostile, null, undefined, 42]) {
    assert.equal(alertComposeFailureMessage(thrown), 'ALERT_DELIVERY_FAILED');
  }
  assert.equal(inspected, false);
});

test('console logger preserves structured operation metadata and bounded failure category', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = value => warnings.push(value);
  try {
    CONSOLE_ALERT_COMPOSE_FAILURE_LOGGER.warn('runtime_sync.protection_degraded_alert.compose_failed', {
      familyId: 'family', deviceId: 'device', trigger: 'PROTECTION_DEGRADED',
      error: alertComposeFailureMessage(new Error('SECRET SQL KEY MATERIAL')),
    });
  } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
  assert.deepEqual(JSON.parse(warnings[0]), {
    event: 'runtime_sync.protection_degraded_alert.compose_failed',
    familyId: 'family', deviceId: 'device', trigger: 'PROTECTION_DEGRADED', error: 'ALERT_DELIVERY_FAILED',
  });
  assert.doesNotMatch(warnings[0], /SECRET|SQL|KEY MATERIAL/);
});
