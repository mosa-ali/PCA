import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  GENESIS_VERIFIER_ENV,
  InvalidGenesisVerifierConfigError,
  resolveGenesisSignatureVerifier,
} from '../../dist/parentaccount/genesisVerifierComposition.js';
import { P256DeviceSignatureVerifier } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { RejectingDeviceSignatureVerifier } from '../../dist/runtime-sync/RejectingCryptoVerifiers.js';

function realSignedMessage() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  const message = 'genesis-composition-probe';
  let sig = sign('sha256', Buffer.from(message), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' });
  // low-S normalise, as the browser does
  const n = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
  const s = BigInt('0x' + sig.subarray(32).toString('hex'));
  if (s > n / 2n) sig = Buffer.concat([sig.subarray(0, 32), Buffer.from((n - s).toString(16).padStart(64, '0'), 'hex')]);
  return { publicKey, message, signature: sig.toString('base64url') };
}

test('default (unset) is FAIL-CLOSED: rejecting verifier, unavailable, a valid signature is still refused', async () => {
  const composed = resolveGenesisSignatureVerifier({});
  assert.equal(composed.mode, 'REJECTING');
  assert.equal(composed.available, false);
  assert.ok(composed.verifier instanceof RejectingDeviceSignatureVerifier);
  const probe = realSignedMessage();
  assert.equal(await composed.verifier.verify(probe.publicKey, probe.message, probe.signature), false);
});

test('empty string and explicit REJECTING are also fail-closed', () => {
  for (const value of ['', 'REJECTING']) {
    const composed = resolveGenesisSignatureVerifier({ [GENESIS_VERIFIER_ENV]: value });
    assert.equal(composed.available, false);
    assert.equal(composed.mode, 'REJECTING');
  }
});

test('P256 composes the real verifier: available, accepts a genuine signature, rejects a tampered one', async () => {
  const composed = resolveGenesisSignatureVerifier({ [GENESIS_VERIFIER_ENV]: 'P256' });
  assert.equal(composed.mode, 'P256');
  assert.equal(composed.available, true);
  assert.ok(composed.verifier instanceof P256DeviceSignatureVerifier);
  const probe = realSignedMessage();
  assert.equal(await composed.verifier.verify(probe.publicKey, probe.message, probe.signature), true);
  assert.equal(await composed.verifier.verify(probe.publicKey, `${probe.message}x`, probe.signature), false);
  const other = realSignedMessage();
  assert.equal(await composed.verifier.verify(other.publicKey, probe.message, probe.signature), false);
});

test('any other value fails boot rather than silently meaning enabled or disabled', () => {
  for (const value of ['p256', 'true', '1', 'P-256', 'ENABLED', ' P256']) {
    assert.throws(() => resolveGenesisSignatureVerifier({ [GENESIS_VERIFIER_ENV]: value }), InvalidGenesisVerifierConfigError);
  }
});
