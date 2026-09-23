import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  decryptTotpSecret,
  decryptTotpSecretWithKeyring,
  encryptTotpSecret,
  generateTotpSecret,
  loadMfaEncryptionKeyring,
} from '../../dist/platformadmin/auth/totp.js';
import { repairMfaSecretCiphertext } from '../../dist/platformadmin/auth/mfaSecretReadRepair.js';

// Read repair is the half of key rotation that the key ring alone does not
// deliver: the ring lets a legacy-sealed secret still be READ, but until the row
// is re-sealed under the active key, the legacy key must stay configured forever
// or that admin breaks the day it is retired. These pin the properties that make
// the repair safe to run on the request path -- old-value CAS, no state change,
// and a lost race being benign rather than a false failure.

const ACTIVE_HEX = 'ab'.repeat(32);
const PREVIOUS_1_HEX = 'cd'.repeat(32);

function keyringWithLegacy() {
  return loadMfaEncryptionKeyring({
    PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: PREVIOUS_1_HEX,
  });
}

/** Seals a secret under the LEGACY generation, as a pre-rotation row would be. */
function legacySealedRow() {
  const secret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(secret, Buffer.from(PREVIOUS_1_HEX, 'hex'));
  return { secret, ciphertext, nonce };
}

/** In-memory stand-in for the guarded compare-and-swap UPDATE. */
function fakeRepository({ result = true, throws = false } = {}) {
  const calls = [];
  return {
    calls,
    async compareAndSwapMfaSecretCiphertext(input) {
      calls.push(input);
      if (throws) throw new Error('storage unavailable');
      return result;
    },
  };
}

test('read repair re-seals the SAME secret under the ACTIVE key, so the legacy key is no longer needed', async () => {
  const keyring = keyringWithLegacy();
  const { secret, ciphertext, nonce } = legacySealedRow();
  const repository = fakeRepository();

  const repaired = await repairMfaSecretCiphertext(repository, {
    adminId: 'admin-1',
    keyring,
    observedCiphertext: ciphertext,
    observedNonce: nonce,
    secret,
  });

  assert.equal(repaired, true);
  const written = repository.calls[0];
  // The replacement decrypts with the ACTIVE key alone...
  assert.deepEqual(decryptTotpSecret(written.ciphertext, written.nonce, keyring.active), secret);
  // ...and is a genuinely new ciphertext, not the legacy one copied forward.
  assert.notDeepEqual(written.ciphertext, ciphertext);
});

test('read repair guards on the OBSERVED OLD value, never on the replacement', async () => {
  const keyring = keyringWithLegacy();
  const { secret, ciphertext, nonce } = legacySealedRow();
  const repository = fakeRepository();

  await repairMfaSecretCiphertext(repository, {
    adminId: 'admin-1',
    keyring,
    observedCiphertext: ciphertext,
    observedNonce: nonce,
    secret,
  });

  const written = repository.calls[0];
  // These are the values this request actually decrypted. Had they been the NEW
  // values the guard could never match anything; had they been absent, two
  // concurrent repairs could both land and a newer secret could be clobbered.
  assert.deepEqual(written.expectedCiphertext, ciphertext);
  assert.deepEqual(written.expectedNonce, nonce);
  assert.equal(written.adminId, 'admin-1');
});

test('a LOST CAS RACE is benign: zero rows updated does not throw and is reported as not repaired', async () => {
  const keyring = keyringWithLegacy();
  const { secret, ciphertext, nonce } = legacySealedRow();
  const repository = fakeRepository({ result: false });

  const repaired = await repairMfaSecretCiphertext(repository, {
    adminId: 'admin-1',
    keyring,
    observedCiphertext: ciphertext,
    observedNonce: nonce,
    secret,
  });

  // Another writer repaired it first. The request that triggered this has still
  // succeeded on its own terms -- its code verified against the right secret --
  // so this must be reported as "already handled", never as a failure.
  assert.equal(repaired, false);
});

test('a storage fault during repair is swallowed, never propagated to the caller', async () => {
  const keyring = keyringWithLegacy();
  const { secret, ciphertext, nonce } = legacySealedRow();
  const repository = fakeRepository({ throws: true });

  // An unrepaired row is a slow key retirement, never a failed login.
  assert.equal(
    await repairMfaSecretCiphertext(repository, {
      adminId: 'admin-1',
      keyring,
      observedCiphertext: ciphertext,
      observedNonce: nonce,
      secret,
    }),
    false,
  );
});

test('repair completes the rotation property end to end: legacy decrypt, then active-only decrypt', async () => {
  const keyring = keyringWithLegacy();
  const { secret, ciphertext, nonce } = legacySealedRow();

  // 1. The legacy key decrypts the row and asks for repair.
  const before = decryptTotpSecretWithKeyring(ciphertext, nonce, keyring);
  assert.equal(before.keySource, 'PREVIOUS_1');
  assert.equal(before.requiresReadRepair, true);

  // 2. Repair re-seals under the active key.
  let stored = null;
  const repository = {
    async compareAndSwapMfaSecretCiphertext(input) {
      stored = input;
      return true;
    },
  };
  await repairMfaSecretCiphertext(repository, {
    adminId: 'admin-1',
    keyring,
    observedCiphertext: ciphertext,
    observedNonce: nonce,
    secret: before.secret,
  });

  // 3. The row now decrypts with an ACTIVE-ONLY key ring. THIS is what makes
  //    PREVIOUS_1 retirable -- without read repair it would be required forever.
  const activeOnly = loadMfaEncryptionKeyring({ PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX });
  const after = decryptTotpSecretWithKeyring(stored.ciphertext, stored.nonce, activeOnly);
  assert.equal(after.keySource, 'ACTIVE');
  assert.equal(after.requiresReadRepair, false);
  assert.deepEqual(after.secret, before.secret);
});

test('all four decryption sites repair, so neither the PENDING nor the ENROLLED case is left behind', () => {
  const files = [
    'PlatformAdminAccountService.ts',
    'PlatformAdminActivationService.ts',
    'PlatformAdminAuthService.ts',
  ];
  let calls = 0;
  for (const file of files) {
    const source = readFileSync(new URL(`../../src/platformadmin/auth/${file}`, import.meta.url), 'utf8');
    assert.match(source, /if \(requiresReadRepair\) \{/, `${file} must branch on requiresReadRepair`);
    calls += (source.match(/repairMfaSecretCiphertext\(/g) ?? []).length;
  }
  // AccountService.activateMfa (pending), ActivationService.complete (pending),
  // and BOTH AuthService sites -- login and step-up (already ENROLLED). Scoping
  // repair to pending only would leave an enrolled admin depending on the legacy
  // key permanently, which is the case this count exists to catch.
  assert.equal(calls, 4);
});

test('no decryption site silently ignores a legacy decrypt without repairing it', () => {
  for (const file of ['PlatformAdminAccountService.ts', 'PlatformAdminActivationService.ts', 'PlatformAdminAuthService.ts']) {
    const source = readFileSync(new URL(`../../src/platformadmin/auth/${file}`, import.meta.url), 'utf8');
    // Every decrypt must destructure requiresReadRepair: dropping it is exactly
    // how a future edit would quietly disable repair while still compiling.
    const decrypts = (source.match(/decryptTotpSecretWithKeyring\(/g) ?? []).length;
    const branches = (source.match(/requiresReadRepair/g) ?? []).length;
    assert.ok(branches >= decrypts, `${file}: ${decrypts} decrypt(s) but only ${branches} requiresReadRepair reference(s)`);
  }
});
