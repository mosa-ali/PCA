import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encryptTotpSecret,
  generateTotpSecret,
  loadMfaEncryptionKeyring,
} from '../../dist/platformadmin/auth/totp.js';
import {
  auditRow,
  exitCodeFor,
  isRetirementSafe,
  summarize,
} from '../../scripts/lib/mfaSecretDrainAudit.mjs';

// The drain audit is the evidence an operator needs before retiring a previous
// MFA key. Its value is entirely in two properties: it must tell the truth about
// whether a key is still load-bearing, and its output must be safe to paste into
// an incident channel. These tests pin both, DB-free, because the classification
// is deliberately separated from the query for exactly that reason.

const ACTIVE_HEX = 'ab'.repeat(32);
const PREVIOUS_1_HEX = 'cd'.repeat(32);
const UNKNOWN_HEX = '11'.repeat(32);

const keyring = loadMfaEncryptionKeyring({
  PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
  PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: PREVIOUS_1_HEX,
});

function sealedUnder(hex) {
  const secret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(secret, Buffer.from(hex, 'hex'));
  return { secret, ciphertext, nonce };
}

test('classifies an active-sealed row as ACTIVE', () => {
  const { ciphertext, nonce } = sealedUnder(ACTIVE_HEX);
  const result = auditRow({ ciphertext, nonce, keyring });
  assert.equal(result.outcome, 'ACTIVE');
  assert.equal(result.keySource, 'ACTIVE');
});

test('classifies a previous-key-sealed row as LEGACY and names only the generation', () => {
  const { secret, ciphertext, nonce } = sealedUnder(PREVIOUS_1_HEX);
  const result = auditRow({ ciphertext, nonce, keyring });
  assert.equal(result.outcome, 'LEGACY');
  assert.equal(result.keySource, 'PREVIOUS_1');
  // The secret is returned for re-sealing only; it is the caller's job to never
  // print it, and summarize() cannot.
  assert.deepEqual(result.secret, secret);
});

test('classifies a row no permitted key can open as UNDECRYPTABLE without throwing', () => {
  const { ciphertext, nonce } = sealedUnder(UNKNOWN_HEX);
  assert.equal(auditRow({ ciphertext, nonce, keyring }).outcome, 'UNDECRYPTABLE');
  // Missing material is a data-shape problem, not a key problem.
  assert.equal(auditRow({ ciphertext: null, nonce: null, keyring }).outcome, 'UNDECRYPTABLE');
});

test('the summary carries counts only -- no id, ciphertext, nonce, secret or key can reach it', () => {
  const legacy = sealedUnder(PREVIOUS_1_HEX);
  const active = sealedUnder(ACTIVE_HEX);
  const unknown = sealedUnder(UNKNOWN_HEX);
  const classifications = [
    auditRow({ ciphertext: legacy.ciphertext, nonce: legacy.nonce, keyring }),
    auditRow({ ciphertext: active.ciphertext, nonce: active.nonce, keyring }),
    auditRow({ ciphertext: unknown.ciphertext, nonce: unknown.nonce, keyring }),
  ];
  const summary = summarize(classifications);
  assert.deepEqual(summary, {
    total: 3,
    byKeySource: { PREVIOUS_1: 1, ACTIVE: 1 },
    legacy: 1,
    undecryptable: 1,
  });

  // The property that makes the output safe to paste anywhere.
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes(legacy.secret.toString('hex')));
  assert.ok(!serialized.includes(legacy.ciphertext.toString('hex')));
  assert.ok(!serialized.includes(legacy.nonce.toString('hex')));
  assert.ok(!serialized.includes(ACTIVE_HEX));
  assert.ok(!serialized.includes(PREVIOUS_1_HEX));
  assert.ok(!serialized.includes('admin'));
});

test('the exit contract refuses to be green while a key is still load-bearing', () => {
  const clean = { total: 2, byKeySource: { ACTIVE: 2 }, legacy: 0, undecryptable: 0 };
  const stillLegacy = { total: 2, byKeySource: { ACTIVE: 1, PREVIOUS_1: 1 }, legacy: 1, undecryptable: 0 };
  const unreadable = { total: 2, byKeySource: { ACTIVE: 1 }, legacy: 0, undecryptable: 1 };

  assert.equal(exitCodeFor(clean), 0);
  assert.equal(isRetirementSafe(clean), true);

  // Retiring PREVIOUS_1 here would lock out whoever owns the legacy row.
  assert.equal(exitCodeFor(stillLegacy), 3);
  assert.equal(isRetirementSafe(stillLegacy), false);

  // Unreadable data is the more serious case and must not be reported as the
  // benign one: a distinct, higher exit code keeps the two separable.
  assert.equal(exitCodeFor(unreadable), 2);
  assert.equal(isRetirementSafe(unreadable), false);
  assert.notEqual(exitCodeFor(unreadable), exitCodeFor(stillLegacy));
});

test('an INCOMPLETE sealed pair is UNDECRYPTABLE, never silently skipped', () => {
  const { ciphertext, nonce } = sealedUnder(ACTIVE_HEX);
  // The schema allows either column to be null independently with no pair
  // constraint, so a half-written row is reachable. It must be COUNTED rather
  // than excluded: excluding it is what would let the audit report
  // retirementSafe while a malformed sealed row still existed.
  assert.equal(auditRow({ ciphertext, nonce: null, keyring }).outcome, 'UNDECRYPTABLE');
  assert.equal(auditRow({ ciphertext: null, nonce, keyring }).outcome, 'UNDECRYPTABLE');

  const summary = summarize([
    auditRow({ ciphertext, nonce: null, keyring }),
    auditRow({ ciphertext, nonce, keyring }),
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.undecryptable, 1);
  assert.equal(summary.legacy, 0);
  // Unreadable data must block retirement, not be quietly tolerated.
  assert.equal(exitCodeFor(summary), 2);
});

test('an empty table is a clean, retirement-safe result', () => {
  const summary = summarize([]);
  assert.deepEqual(summary, { total: 0, byKeySource: {}, legacy: 0, undecryptable: 0 });
  assert.equal(exitCodeFor(summary), 0);
});
