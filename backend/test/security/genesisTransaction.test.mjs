import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import test from 'node:test';
import { P256DeviceSignatureVerifier } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { GenesisChallengeService } from '../../dist/parentaccount/GenesisChallengeService.js';
import { InMemoryGenesisChallengeRepository } from '../../dist/parentaccount/InMemoryGenesisChallengeRepository.js';
import { InMemoryGenesisTransactionRepository } from '../../dist/parentaccount/InMemoryGenesisTransactionRepository.js';
import { ParentGenesisService } from '../../dist/parentaccount/ParentGenesisService.js';
import { canonicalizeGenesisProof } from '../../dist/parentaccount/genesisProtocol.js';
import { canonicalizeGenesisAnchor, canonicalizeOwnerAttestation } from '../../dist/familycommercial/authority/canonicalize.js';

const NOW = new Date('2026-01-02T03:04:05.678Z');

function keyMaterial() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  return { pair, publicKey };
}

function sign(privateKey, message) {
  return cryptoSign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}

async function ceremony(failurePoint) {
  const { pair, publicKey } = keyMaterial();
  const challengeRepository = new InMemoryGenesisChallengeRepository();
  const challengeService = new GenesisChallengeService(challengeRepository, new P256DeviceSignatureVerifier(), () => NOW);
  const transactionRepository = new InMemoryGenesisTransactionRepository(failurePoint);
  const service = new ParentGenesisService(challengeService, transactionRepository, new P256DeviceSignatureVerifier(), () => NOW);
  const challenge = await service.begin({ accountId: 'acct-1', serviceAccountId: 'svc-1', publicKey, platform: 'BROWSER' });
  const proof = {
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
  };
  const proofSignature = sign(pair.privateKey, canonicalizeGenesisProof(proof));
  const anchor = {
    familyId: challenge.familyId,
    genesisDeviceId: challenge.candidateDeviceId,
    genesisDskKeyId: challenge.candidateKeyId,
    genesisDskPublicKey: publicKey,
    protocolVersion: 1,
    createdAt: challenge.createdAt,
  };
  const anchorSignature = sign(pair.privateKey, canonicalizeGenesisAnchor(anchor));
  const attestation = {
    familyId: challenge.familyId,
    purpose: 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1',
    attestationRevision: 1,
    ownerDeviceId: challenge.candidateDeviceId,
    ownerDskKeyId: challenge.candidateKeyId,
    ownerDskPublicKey: publicKey,
    trustSetEpoch: 1,
    keyEpoch: 1,
    issuedAt: NOW,
    expiresAt: new Date('2026-01-02T04:04:05.678Z'),
    previousAttestationId: null,
    signerDeviceId: challenge.candidateDeviceId,
    signerDskKeyId: challenge.candidateKeyId,
    signerDskPublicKey: publicKey,
  };
  const attestationSignature = sign(pair.privateKey, canonicalizeOwnerAttestation(attestation));
  return {
    service,
    challengeRepository,
    transactionRepository,
    input: {
      challengeId: challenge.challengeId,
      proofSignature,
      anchorSignature,
      attestationSignature,
      trustSetEpoch: 1,
      keyEpoch: 1,
      issuedAt: attestation.issuedAt,
      expiresAt: attestation.expiresAt,
    },
  };
}

test('R1 genesis completion commits the full identity, scope, membership, and authority set atomically', async () => {
  const { service, transactionRepository, input } = await ceremony();
  const result = await service.complete(input, { accountId: 'acct-1', serviceAccountId: 'svc-1' });
  assert.equal(typeof result.familyId, 'string');
  assert.deepEqual(transactionRepository.snapshot(), {
    challengeConsumed: true,
    family: true,
    device: true,
    key: true,
    scope: true,
    membership: true,
    accountFamilyId: result.familyId,
    anchor: true,
    attestation: true,
    chainHead: true,
  });
});

test('R1 genesis rollback leaves no partial state at every transaction failure boundary', async () => {
  const failurePoints = [
    'AFTER_CHALLENGE_LOCK',
    'AFTER_CHALLENGE_CONSUME',
    'AFTER_FAMILY',
    'AFTER_DEVICE',
    'AFTER_KEY',
    'AFTER_SCOPE',
    'AFTER_MEMBERSHIP',
    'AFTER_ACCOUNT',
    'AFTER_ANCHOR',
    'AFTER_ATTESTATION',
  ];
  for (const failurePoint of failurePoints) {
    const { service, transactionRepository, input } = await ceremony(failurePoint);
    await assert.rejects(() => service.complete(input, { accountId: 'acct-1', serviceAccountId: 'svc-1' }), new RegExp(failurePoint));
    assert.deepEqual(transactionRepository.snapshot(), {
      challengeConsumed: false,
      family: false,
      device: false,
      key: false,
      scope: false,
      membership: false,
      accountFamilyId: null,
      anchor: false,
      attestation: false,
      chainHead: false,
    }, failurePoint);
  }
});

test('R1 genesis completion does not consume the challenge outside the atomic repository', async () => {
  const { service, challengeRepository, transactionRepository, input } = await ceremony('AFTER_ANCHOR');
  await assert.rejects(() => service.complete(input, { accountId: 'acct-1', serviceAccountId: 'svc-1' }));
  const challenge = await challengeRepository.findById(input.challengeId);
  assert.equal(challenge?.consumedAt, null);
  assert.equal(transactionRepository.snapshot().challengeConsumed, false);
});
