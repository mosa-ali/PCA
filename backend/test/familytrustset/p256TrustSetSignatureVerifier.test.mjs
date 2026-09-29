import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import test from 'node:test';
import {
  canonicalizeP256Signature,
  P256_HALF_ORDER,
  P256_ORDER,
} from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { P256TrustSetSignatureVerifier } from '../../dist/familytrustset/P256TrustSetSignatureVerifier.js';

const verifier = new P256TrustSetSignatureVerifier();

function entry(overrides = {}) {
  return {
    deviceId: 'device-1',
    role: 'OWNER',
    dskKeyId: 'dsk-key-1',
    dskPublicKey: 'dsk-pub-1',
    dekKeyId: 'dek-key-1',
    dekPublicKey: 'dek-pub-1',
    status: 'ACTIVE',
    ...overrides,
  };
}

function epoch(overrides = {}) {
  return {
    familyId: 'family-1',
    trustSetEpoch: 3,
    keyEpoch: 2,
    entries: [entry()],
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    supersedesEpoch: 2,
    ...overrides,
  };
}

function canonicalMessage(value) {
  return canonicalizeTrustSetEpoch(value);
}

/** Fresh P-256 keypair with the public point in SEC1 uncompressed, unpadded-base64url form (65 bytes). */
function keyMaterial() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  assert.equal(point.length, 65);
  return { pair, publicKey: point.toString('base64url') };
}

function signMessage(message, pair, { highS = false } = {}) {
  const raw = cryptoSign('sha256', Buffer.from(message, 'utf8'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' });
  const lowS = canonicalizeP256Signature(raw);
  return (highS ? flipToHighS(lowS) : lowS).toString('base64url');
}

/** s' = n - s keeps the signature valid but moves it out of the low-S half (P-256 malleability). */
function flipToHighS(signature) {
  const r = BigInt(`0x${signature.subarray(0, 32).toString('hex')}`);
  const s = BigInt(`0x${signature.subarray(32, 64).toString('hex')}`);
  const highS = P256_ORDER - s;
  const output = Buffer.alloc(64);
  Buffer.from(r.toString(16).padStart(64, '0'), 'hex').copy(output, 0);
  Buffer.from(highS.toString(16).padStart(64, '0'), 'hex').copy(output, 32);
  return output;
}

test('accepts a valid low-S signature over the exact canonical epoch bytes', async () => {
  const { pair, publicKey } = keyMaterial();
  const message = canonicalMessage(epoch());
  const signature = signMessage(message, pair);
  assert.equal(await verifier.verify(publicKey, message, signature), true);
});

test('accepts a valid low-S signature over a multibyte canonical payload (UTF-8 byte semantics)', async () => {
  const { pair, publicKey } = keyMaterial();
  const message = canonicalMessage(
    epoch({ familyId: 'أسرة-الوالدين', entries: [entry({ deviceId: 'جهاز-الوالد' })] }),
  );
  // The signature covers the UTF-8 bytes; the payload must actually contain
  // multibyte content for this test to be meaningful.
  assert.ok(Buffer.byteLength(message, 'utf8') > message.length);
  const signature = signMessage(message, pair);
  assert.equal(await verifier.verify(publicKey, message, signature), true);
});

test('rejects a tampered or truncated message', async () => {
  const { pair, publicKey } = keyMaterial();
  const message = canonicalMessage(epoch());
  const signature = signMessage(message, pair);

  assert.equal(await verifier.verify(publicKey, `${message}!`, signature), false);
  assert.equal(await verifier.verify(publicKey, message.slice(0, -1), signature), false);

  const tampered = message.replace('family-1', 'family-2');
  assert.notEqual(tampered, message);
  assert.equal(await verifier.verify(publicKey, tampered, signature), false);
});

test('rejects signatures from the wrong key and shape-valid wrong points', async () => {
  const signer = keyMaterial();
  const other = keyMaterial();
  const message = canonicalMessage(epoch());
  const signature = signMessage(message, signer.pair);

  assert.equal(await verifier.verify(other.publicKey, message, signature), false);
  assert.equal(await verifier.verify(signer.publicKey, message, signMessage(message, other.pair)), false);

  // A remaining-shape-valid but different point must never verify the
  // signature (either off-curve, or a different key -- both false).
  const flipped = Buffer.from(signer.publicKey, 'base64url');
  flipped[64] ^= 0x01;
  assert.notEqual(flipped.toString('base64url'), signer.publicKey);
  assert.equal(await verifier.verify(flipped.toString('base64url'), message, signature), false);
});

test('rejects the high-S variant of an otherwise valid signature (low-S enforcement)', async () => {
  const { pair, publicKey } = keyMaterial();
  const message = canonicalMessage(epoch());
  const highSSignature = signMessage(message, pair, { highS: true });
  const highSBytes = Buffer.from(highSSignature, 'base64url');

  assert.equal(highSBytes.length, 64);
  const s = BigInt(`0x${highSBytes.subarray(32, 64).toString('hex')}`);
  assert.ok(s > P256_HALF_ORDER);

  // P-256 malleability: (r, n - s) still passes raw ECDSA verification, so
  // the rejection below proves the low-S gate rather than a broken
  // signature.
  assert.equal(
    cryptoVerify('sha256', Buffer.from(message, 'utf8'), { key: pair.publicKey, dsaEncoding: 'ieee-p1363' }, highSBytes),
    true,
  );
  assert.equal(await verifier.verify(publicKey, message, highSSignature), false);
});

test('rejects DER-encoded, padded, standard-base64, short, long, and zero-scalar signatures', async () => {
  const { pair, publicKey } = keyMaterial();
  const message = canonicalMessage(epoch());
  const signature = signMessage(message, pair);
  const signatureBytes = Buffer.from(signature, 'base64url');

  const der = cryptoSign('sha256', Buffer.from(message, 'utf8'), {
    key: pair.privateKey,
    dsaEncoding: 'der',
  }).toString('base64url');
  assert.notEqual(Buffer.from(der, 'base64url').length, 64);
  assert.equal(await verifier.verify(publicKey, message, der), false);

  assert.equal(await verifier.verify(publicKey, message, `${signature}=`), false);
  assert.equal(await verifier.verify(publicKey, message, signatureBytes.toString('base64')), false);
  assert.equal(await verifier.verify(publicKey, message, signatureBytes.subarray(0, 63).toString('base64url')), false);
  assert.equal(
    await verifier.verify(publicKey, message, Buffer.concat([signatureBytes, Buffer.from([0])]).toString('base64url')),
    false,
  );
  assert.equal(await verifier.verify(publicKey, message, Buffer.alloc(64).toString('base64url')), false);

  // Correct fixed shape and in-range scalars, but not a signature over the
  // message: the crypto verification itself must return false.
  const oneOne = Buffer.alloc(64);
  oneOne[31] = 1;
  oneOne[63] = 1;
  assert.equal(await verifier.verify(publicKey, message, oneOne.toString('base64url')), false);
});

test('rejects malformed public keys', async () => {
  const { pair, publicKey } = keyMaterial();
  const message = canonicalMessage(epoch());
  const signature = signMessage(message, pair);
  const point = Buffer.from(publicKey, 'base64url');

  const compressed = Buffer.concat([Buffer.from([0x02]), point.subarray(1, 33)]).toString('base64url');
  const badPrefix = Buffer.from(point);
  badPrefix[0] = 0x05;
  const truncated = point.subarray(0, 64).toString('base64url');

  for (const candidate of [compressed, badPrefix.toString('base64url'), truncated, 'not_base64url!', '%%%', '']) {
    assert.equal(await verifier.verify(candidate, message, signature), false);
  }
});

test('returns false (never throws) for empty signature bytes and hostile inputs', async () => {
  const { pair, publicKey } = keyMaterial();
  const message = canonicalMessage(epoch());

  assert.equal(await verifier.verify(publicKey, message, ''), false);
  assert.equal(await verifier.verify('', message, 'AA'), false);
  assert.equal(await verifier.verify('%%%', '%%%', '%%%'), false);
  assert.equal(await verifier.verify(publicKey, message, 'AA'), false);
});
