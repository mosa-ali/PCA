import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  canonicalFamilyEnvelopeAad,
  familyFdekHpkeInfo,
  openFamilyContent,
  openFdekForDevice,
  sealFamilyContent,
  sealFdekForDevice,
} from '../src/familyEnvelopeCryptoProfileV1.ts';

const vector = JSON.parse(await readFile(new URL('./vectors/pca-family-envelope-v1.json', import.meta.url), 'utf8'));
const hex = (value) => Uint8Array.from(value.match(/../gu).map((pair) => Number.parseInt(pair, 16)));
const toHex = (value) => Buffer.from(value).toString('hex');
const fdek = hex(vector.testOnly.fdekHex);
const wrapPayload = hex(vector.fdekWrap.payloadHex);
const contentPayload = hex(vector.content.payloadHex);
const privateJwk = vector.testOnly.recipientPrivateJwk;
const recipientPrivateKey = await crypto.subtle.importKey(
  'jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
);
const recipientPublicKey = await crypto.subtle.importKey(
  'jwk', { ...privateJwk, d: undefined, key_ops: ['deriveBits'] },
  { name: 'ECDH', namedCurve: 'P-256' }, true, [],
);
const recipientKeys = { privateKey: recipientPrivateKey, publicKey: recipientPublicKey };

test('golden FDEK wrap opens to the vector FDEK and has exact info/AAD bytes', async () => {
  assert.equal(toHex(familyFdekHpkeInfo(vector.fdekWrap.metadata)), vector.fdekWrap.infoHex);
  assert.equal(toHex(canonicalFamilyEnvelopeAad(vector.fdekWrap.metadata, 'FDEK_WRAP')), vector.fdekWrap.aadHex);
  assert.deepEqual(await openFdekForDevice(vector.fdekWrap.metadata, recipientKeys, wrapPayload), fdek);
});

test('golden content payload opens to the exact test plaintext and binds exact AAD', async () => {
  const fields = [
    Buffer.from(contentPayload.slice(11, 43)).toString('base64url'),
    Buffer.from(contentPayload.slice(43, 55)).toString('base64url'),
  ];
  assert.equal(toHex(canonicalFamilyEnvelopeAad(vector.content.metadata, 'CONTENT', fields)), vector.content.aadHex);
  const opened = await openFamilyContent(vector.content.metadata, fdek, contentPayload);
  assert.equal(new TextDecoder().decode(opened), vector.content.plaintext);
});

test('candidate seal/open works with non-exportable private DSK-independent recipient key', async () => {
  assert.equal(recipientPrivateKey.extractable, false);
  const wrapped = await sealFdekForDevice(vector.fdekWrap.metadata, recipientPublicKey, fdek);
  assert.deepEqual(await openFdekForDevice(vector.fdekWrap.metadata, recipientKeys, wrapped), fdek);
  const sealedContent = await sealFamilyContent(vector.content.metadata, fdek, new TextEncoder().encode(vector.content.plaintext));
  assert.equal(new TextDecoder().decode(await openFamilyContent(vector.content.metadata, fdek, sealedContent)), vector.content.plaintext);
});

test('FDEK wrap fails closed for changed family, device, recipient, or epochs', async () => {
  const variants = [
    { ...vector.fdekWrap.metadata, familyId: 'family-other' },
    { ...vector.fdekWrap.metadata, senderDeviceId: 'device-other' },
    { ...vector.fdekWrap.metadata, senderKeyId: 'dsk-other' },
    { ...vector.fdekWrap.metadata, recipient: { kind: 'DEVICE', recipientDeviceId: 'device-other' } },
    { ...vector.fdekWrap.metadata, keyEpoch: vector.fdekWrap.metadata.keyEpoch + 1 },
    { ...vector.fdekWrap.metadata, trustSetEpoch: vector.fdekWrap.metadata.trustSetEpoch + 1 },
  ];
  for (const metadata of variants) await assert.rejects(openFdekForDevice(metadata, recipientKeys, wrapPayload));
  const otherPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  await assert.rejects(openFdekForDevice(vector.fdekWrap.metadata, otherPair, wrapPayload));
});

test('wrong HPKE info and AAD, mutations, truncation, oversize, and downgrade fail closed', async () => {
  const { CipherSuite, DhkemP256HkdfSha256, HkdfSha256, Aes128Gcm } = await import('@hpke/core');
  const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });
  const enc = wrapPayload.slice(15, 80);
  const ct = wrapPayload.slice(80);
  await assert.rejects(suite.open({ recipientKey: recipientKeys, enc, info: new TextEncoder().encode('wrong info') }, ct, canonicalFamilyEnvelopeAad(vector.fdekWrap.metadata, 'FDEK_WRAP')));
  for (const index of [15, 40, 80, 127]) {
    const changed = wrapPayload.slice();
    changed[index] ^= 0x01;
    await assert.rejects(openFdekForDevice(vector.fdekWrap.metadata, recipientKeys, changed));
  }
  await assert.rejects(openFdekForDevice(vector.fdekWrap.metadata, recipientKeys, wrapPayload.slice(0, -1)));
  await assert.rejects(openFdekForDevice(vector.fdekWrap.metadata, recipientKeys, new Uint8Array(65537)));
  const downgraded = vector.fdekWrap.metadata;
  await assert.rejects(openFdekForDevice({ ...downgraded, protocolMinor: 1 }, recipientKeys, wrapPayload));

  const wrongMeta = { ...vector.content.metadata, familyId: 'family-other' };
  await assert.rejects(openFamilyContent(wrongMeta, fdek, contentPayload));
  const wrongFdek = crypto.getRandomValues(new Uint8Array(32));
  await assert.rejects(openFamilyContent(vector.content.metadata, wrongFdek, contentPayload));
  for (const index of [11, 43, 55, contentPayload.length - 1]) {
    const changed = contentPayload.slice();
    changed[index] ^= 0x01;
    await assert.rejects(openFamilyContent(vector.content.metadata, fdek, changed));
  }
  await assert.rejects(openFamilyContent(vector.content.metadata, fdek, contentPayload.slice(0, -1)));
});

test('concurrent independent FDEK seals produce fresh encapsulations', async () => {
  const results = await Promise.all(Array.from({ length: 16 }, () => sealFdekForDevice(vector.fdekWrap.metadata, recipientPublicKey, fdek)));
  const encapsulations = results.map((payload) => toHex(payload.slice(15, 80)));
  assert.equal(new Set(encapsulations).size, encapsulations.length);
});

test('@hpke/core one sender context serializes concurrent seal calls without nonce reuse', async () => {
  const { CipherSuite, DhkemP256HkdfSha256, HkdfSha256, Aes128Gcm } = await import('@hpke/core');
  const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });
  const info = new TextEncoder().encode('PCA_GHSA_73G8_REGRESSION_TEST');
  const aad = new TextEncoder().encode('single-context concurrency test');
  const sender = await suite.createSenderContext({ recipientPublicKey, info });
  const messages = Array.from({ length: 16 }, (_, index) => new TextEncoder().encode(`distinct message ${index}`));
  const ciphertexts = await Promise.all(messages.map((message) => sender.seal(message, aad)));
  const recipient = await suite.createRecipientContext({ recipientKey: recipientKeys, enc: sender.enc, info });
  for (let index = 0; index < messages.length; index++) {
    assert.deepEqual(new Uint8Array(await recipient.open(ciphertexts[index], aad)), messages[index]);
  }
});

test('rotation epoch N+1 is distinct; revoked-device authorization remains an outer gate', async () => {
  const next = { ...vector.fdekWrap.metadata, messageId: 'msg-vector-rotation-10', keyEpoch: 10 };
  const nextFdek = crypto.getRandomValues(new Uint8Array(32));
  const payload = await sealFdekForDevice(next, recipientPublicKey, nextFdek);
  assert.deepEqual(await openFdekForDevice(next, recipientKeys, payload), nextFdek);
  await assert.rejects(openFdekForDevice(vector.fdekWrap.metadata, recipientKeys, payload));
  // Revocation/Trust Set authorization is deliberately outside this primitive adapter.
  assert.equal(vector.securityBoundary.revokedDeviceDenialTestedHere, false);
});
