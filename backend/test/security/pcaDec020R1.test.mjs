import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import test from 'node:test';
import { canonicalizeP256Signature, P256DeviceSignatureVerifier } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { GenesisChallengeService } from '../../dist/parentaccount/GenesisChallengeService.js';
import { InMemoryGenesisChallengeRepository } from '../../dist/parentaccount/InMemoryGenesisChallengeRepository.js';
import { FamilyAuthorityRequestChallengeService } from '../../dist/familycommercial/authority/FamilyAuthorityRequestChallengeService.js';
import { InMemoryFamilyAuthorityRequestChallengeRepository } from '../../dist/familycommercial/authority/InMemoryFamilyAuthorityRequestChallengeRepository.js';
import { canonicalizeGenesisProof } from '../../dist/parentaccount/genesisProtocol.js';
import {
  canonicalizeFamilyAuthorityRequestProof,
  digestAuthorityRequestBody,
} from '../../dist/familycommercial/authority/requestProofProtocol.js';

const NORMATIVE_PUBLIC_KEY = 'BEZX-_tVwekTbTREjuRcOOfv9MJzNZglE_9ztv0iI4BbS0ld7O0WlPXkukSwvI6CIwnQ5o6Hmw5Ia1kQrBYlyiU';
const NORMATIVE_SIGNATURE = 'zzFWKExKoXm4kjhiHomSejcUNAcBiZGcWsl9reMg1mxrIW9OY11TiIFi33g3upj-6EzEbcTmF1M2aDmAv6mnSg';
const NORMATIVE_NONCE = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';
const NORMATIVE_HEX =
  '32373a5043415f46414d494c595f47454e455349535f50524f4f465f5631313a31373a47454e45534953373a616363742dceb1353a7376632d31353a66616d2d31353a6465762d31353a6b65792d3138373a42455a582d5f745677656b54625452456a7552634f4f6676394d4a7a4e5a676c455f397a747630694934426253306c64374f30576c50586b756b53777649364349776e51356f36486d77354961316b517242596c79695531313a6368616c6c656e67652d3134333a4d4445794d7a51314e6a63344f5441784d6a4d304e5459334f446b774d54497a4e4455324e7a67354d444532343a323032362d30312d30325430333a30343a30352e3637385a32343a323032362d30312d30325430333a30393a30352e3637385a';

function publicPointFromJwk(jwk) {
  const decode = (value) => Buffer.from(value, 'base64url');
  return Buffer.concat([Buffer.from([0x04]), decode(jwk.x), decode(jwk.y)]).toString('base64url');
}

function keyMaterial() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { pair, publicKey: publicPointFromJwk(pair.publicKey.export({ format: 'jwk' })) };
}

function proofInput(overrides = {}) {
  return {
    protocolVersion: 1,
    operation: 'GENESIS',
    accountId: 'acct-α',
    serviceAccountId: 'svc-1',
    familyId: 'fam-1',
    deviceId: 'dev-1',
    keyId: 'key-1',
    publicKey: NORMATIVE_PUBLIC_KEY,
    challengeId: 'challenge-1',
    nonce: NORMATIVE_NONCE,
    createdAt: new Date('2026-01-02T03:04:05.678Z'),
    expiresAt: new Date('2026-01-02T03:09:05.678Z'),
    ...overrides,
  };
}

test('R1 P-256 verifier accepts valid WebCrypto-compatible P1363 signatures and rejects malformed variants', async () => {
  const { pair, publicKey } = keyMaterial();
  const message = 'PCA_FAMILY_GENESIS_PROOF_V1';
  const signature = canonicalizeP256Signature(cryptoSign('sha256', Buffer.from(message), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' })).toString('base64url');
  const verifier = new P256DeviceSignatureVerifier();
  const other = keyMaterial();

  assert.equal(await verifier.verify(publicKey, message, signature), true);
  assert.equal(await verifier.verify(publicKey, `${message}!`, signature), false);
  assert.equal(await verifier.verify(other.publicKey, message, signature), false);
  assert.equal(await verifier.verify(publicKey, '%%%'), false);
  assert.equal(await verifier.verify(publicKey, signature.slice(0, -2)), false);
  assert.equal(await verifier.verify(publicKey, Buffer.from(signature, 'base64url').toString('base64')), false);
});

test('R1 canonical genesis proof is fixed-order, UTF-8, length-prefixed, and binds every field', () => {
  const base = canonicalizeGenesisProof(proofInput());
  assert.equal(Buffer.from(base, 'utf8').toString('hex'), NORMATIVE_HEX);
  assert.notEqual(canonicalizeGenesisProof(proofInput({ accountId: 'acct-2' })), base);
  assert.notEqual(canonicalizeGenesisProof(proofInput({ familyId: 'fam-2' })), base);
  assert.notEqual(canonicalizeGenesisProof(proofInput({ deviceId: 'dev-2' })), base);
  assert.notEqual(canonicalizeGenesisProof(proofInput({ keyId: 'key-2' })), base);
  assert.notEqual(canonicalizeGenesisProof(proofInput({ challengeId: 'challenge-2' })), base);
  assert.notEqual(canonicalizeGenesisProof(proofInput({ nonce: Buffer.from('01234567890123456789012345678902', 'utf8').toString('base64url') })), base);
  assert.notEqual(canonicalizeGenesisProof(proofInput({ expiresAt: new Date('2026-01-02T03:09:06.678Z') })), base);
});

test('R1 normative cross-client vector has a valid P-256 signature fixture', async () => {
  const message = canonicalizeGenesisProof(proofInput());
  const verifier = new P256DeviceSignatureVerifier();
  assert.equal(await verifier.verify(NORMATIVE_PUBLIC_KEY, message, NORMATIVE_SIGNATURE), true);
  assert.equal(await verifier.verify(NORMATIVE_PUBLIC_KEY, `${message}!`, NORMATIVE_SIGNATURE), false);
});

test('R1 genesis challenge is account/device/key bound and single-use', async () => {
  const { pair, publicKey } = keyMaterial();
  const repository = new InMemoryGenesisChallengeRepository();
  const now = new Date('2026-01-02T03:04:05.678Z');
  const service = new GenesisChallengeService(repository, new P256DeviceSignatureVerifier(), () => now);
  const challenge = await service.begin({ accountId: 'acct-1', serviceAccountId: 'svc-1', publicKey, genesisAuthorizationId: 'gen-auth-1' });
  const message = canonicalizeGenesisProof({
    protocolVersion: challenge.protocolVersion,
    operation: challenge.operation,
    accountId: challenge.accountId,
    serviceAccountId: challenge.serviceAccountId,
    familyId: challenge.familyId,
    deviceId: challenge.candidateDeviceId,
    keyId: challenge.candidateKeyId,
    publicKey: challenge.candidatePublicKey,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    createdAt: challenge.createdAt,
    expiresAt: challenge.expiresAt,
  });
  const signature = canonicalizeP256Signature(cryptoSign('sha256', Buffer.from(message), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' })).toString('base64url');
  const consumed = await service.complete(challenge.challengeId, signature);
  assert.equal(consumed.consumedAt?.toISOString(), now.toISOString());
  await assert.rejects(() => service.complete(challenge.challengeId, signature), /ALREADY_CONSUMED/);
});

test('R1 sensitive request challenge binds session, operation, request digest, and replay state', async () => {
  const { pair, publicKey } = keyMaterial();
  const repository = new InMemoryFamilyAuthorityRequestChallengeRepository();
  const now = new Date('2026-01-02T03:04:05.678Z');
  const service = new FamilyAuthorityRequestChallengeService(repository, () => now);
  const challenge = await service.issue({
    serviceAccountId: 'svc-1',
    familyId: 'fam-1',
    deviceId: 'dev-1',
    keyId: 'key-1',
    publicKey,
    operation: 'CHECKOUT_REQUEST',
    requestDigest: digestAuthorityRequestBody('{"targetLimit":10}'),
  });
  const { consumedAt, ...proofFields } = challenge;
  const message = canonicalizeFamilyAuthorityRequestProof(proofFields);
  const signature = canonicalizeP256Signature(cryptoSign('sha256', Buffer.from(message), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' })).toString('base64url');
  assert.equal(await new P256DeviceSignatureVerifier().verify(publicKey, message, signature), true);
  assert.equal(await service.consume({ ...proofFields, consumedAt: now }), true);
  assert.equal(await service.consume({ ...proofFields, consumedAt: now }), false);
  assert.equal(
    await service.consume({ ...proofFields, requestDigest: digestAuthorityRequestBody('{"targetLimit":11}'), consumedAt: now }),
    false,
  );
});
