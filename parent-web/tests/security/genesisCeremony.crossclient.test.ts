import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildGenesisCompletion, createGenesisDeviceKey, persistGenesisDeviceKey } from '../../src/security/genesisCeremony';
import { createDeviceKeyCustody, DeviceKeyAlreadyCustodiedError, type DeviceKeyRecord } from '../../src/security/deviceKeyCustody';
import type { GenesisChallenge } from '../../src/api/interfaces';

// CROSS-CLIENT PROOF: the browser ceremony's real Web Crypto signatures must be
// accepted by the BACKEND's compiled verifier and canonicalizers -- the exact
// code the server runs -- and rejected for any altered statement. Requires the
// backend dist (../backend: `npm run build`).
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto as unknown as Crypto, configurable: true });
}
// A plain filesystem path: under jsdom the global URL is jsdom's, which
// createRequire does not accept.
const requireBackend = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend/dist/index.js'));
const { P256DeviceSignatureVerifier } = requireBackend('./deviceauth/P256DeviceSignatureVerifier.js');
const { canonicalizeGenesisProof } = requireBackend('./parentaccount/genesisProtocol.js');
const { canonicalizeGenesisAnchor, canonicalizeOwnerAttestation } = requireBackend('./familycommercial/authority/canonicalize.js');

function challengeFor(publicKey: string): GenesisChallenge {
  const createdAt = new Date();
  return {
    protocolVersion: 1,
    operation: 'GENESIS',
    accountId: 'acct-parent-a',
    serviceAccountId: 'svc-parent-a',
    familyId: '6f1c1f52-3a0e-4b8e-9c55-000000000001',
    deviceId: '6f1c1f52-3a0e-4b8e-9c55-000000000002',
    keyId: '6f1c1f52-3a0e-4b8e-9c55-000000000003',
    publicKey,
    platform: 'BROWSER',
    challengeId: '6f1c1f52-3a0e-4b8e-9c55-000000000004',
    nonce: Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 5 * 60 * 1000).toISOString(),
  };
}

function backendMessages(
  challenge: GenesisChallenge,
  completion: { trustSetEpoch: number; keyEpoch: number; issuedAt: string; expiresAt: string },
) {
  const proof = canonicalizeGenesisProof({
    protocolVersion: 1,
    operation: 'GENESIS',
    accountId: challenge.accountId,
    serviceAccountId: challenge.serviceAccountId,
    familyId: challenge.familyId,
    deviceId: challenge.deviceId,
    keyId: challenge.keyId,
    publicKey: challenge.publicKey,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    createdAt: new Date(challenge.createdAt),
    expiresAt: new Date(challenge.expiresAt),
  });
  const anchor = canonicalizeGenesisAnchor({
    familyId: challenge.familyId,
    genesisDeviceId: challenge.deviceId,
    genesisDskKeyId: challenge.keyId,
    genesisDskPublicKey: challenge.publicKey,
    protocolVersion: 1,
    createdAt: new Date(challenge.createdAt),
    signature: '',
  });
  const attestation = canonicalizeOwnerAttestation({
    familyId: challenge.familyId,
    purpose: 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1',
    attestationRevision: 1,
    ownerDeviceId: challenge.deviceId,
    ownerDskKeyId: challenge.keyId,
    ownerDskPublicKey: challenge.publicKey,
    trustSetEpoch: completion.trustSetEpoch,
    keyEpoch: completion.keyEpoch,
    issuedAt: new Date(completion.issuedAt),
    expiresAt: new Date(completion.expiresAt),
    previousAttestationId: null,
    signerDeviceId: challenge.deviceId,
    signerDskKeyId: challenge.keyId,
    signerDskPublicKey: challenge.publicKey,
    signature: '',
  });
  return { proof, anchor, attestation };
}

function memoryStore() {
  const slots = new Map<string, unknown>();
  return {
    async read(accountId: string) {
      return slots.get(accountId);
    },
    async write(record: DeviceKeyRecord, options: { replace: boolean }) {
      if (!options.replace && slots.has(record.binding.accountId)) throw new DeviceKeyAlreadyCustodiedError();
      slots.set(record.binding.accountId, record);
    },
    async remove(accountId: string) {
      slots.delete(accountId);
    },
  };
}

describe('genesis ceremony <-> backend verifier (cross-client)', () => {
  const verifier = new P256DeviceSignatureVerifier();
  let device: Awaited<ReturnType<typeof createGenesisDeviceKey>>;
  beforeAll(async () => {
    device = await createGenesisDeviceKey();
  });

  it('the device key is a non-extractable P-256 key whose SEC1 point is the protocol public key', async () => {
    expect(device.privateKey.extractable).toBe(false);
    expect(Buffer.from(device.publicKey, 'base64url')).toHaveLength(65);
    await expect(crypto.subtle.exportKey('pkcs8', device.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', device.privateKey)).rejects.toThrow();
  });

  it('all three browser signatures verify under the BACKEND verifier over the BACKEND canonical bytes', async () => {
    const challenge = challengeFor(device.publicKey);
    const completion = await buildGenesisCompletion(challenge, device);
    const messages = backendMessages(challenge, completion);
    expect(await verifier.verify(challenge.publicKey, messages.proof, completion.proofSignature)).toBe(true);
    expect(await verifier.verify(challenge.publicKey, messages.anchor, completion.anchorSignature)).toBe(true);
    expect(await verifier.verify(challenge.publicKey, messages.attestation, completion.attestationSignature)).toBe(true);
  });

  it('a signature does not verify for an altered account, a different key, or a swapped purpose', async () => {
    const challenge = challengeFor(device.publicKey);
    const completion = await buildGenesisCompletion(challenge, device);
    const altered = backendMessages({ ...challenge, accountId: 'acct-parent-b' }, completion);
    expect(await verifier.verify(challenge.publicKey, altered.proof, completion.proofSignature)).toBe(false);
    const other = await createGenesisDeviceKey();
    const genuine = backendMessages(challenge, completion);
    expect(await verifier.verify(other.publicKey, genuine.proof, completion.proofSignature)).toBe(false);
    expect(await verifier.verify(challenge.publicKey, genuine.anchor, completion.proofSignature)).toBe(false);
  });

  it('refuses to sign a challenge the server issued for a DIFFERENT public key', async () => {
    const other = await createGenesisDeviceKey();
    await expect(buildGenesisCompletion(challengeFor(other.publicKey), device)).rejects.toThrow('genesis_challenge_key_mismatch');
  });

  it('post-commit custody: the persisted key is identity-bound and still produces backend-verifiable signatures after a reload', async () => {
    const store = memoryStore();
    const challenge = challengeFor(device.publicKey);
    await persistGenesisDeviceKey(challenge, device, createDeviceKeyCustody(store));
    // A fresh custody instance over the same store models a page reload.
    const loaded = await createDeviceKeyCustody(store).load({
      accountId: challenge.accountId,
      familyId: challenge.familyId,
      deviceId: challenge.deviceId,
    });
    expect(loaded).not.toBeNull();
    expect(loaded!.binding.keyId).toBe(challenge.keyId);
    const later = challengeFor(device.publicKey);
    const completion = await buildGenesisCompletion(later, { ...device, privateKey: loaded!.privateKey });
    expect(await verifier.verify(later.publicKey, backendMessages(later, completion).proof, completion.proofSignature)).toBe(true);
    // Another account on the same browser gets nothing.
    expect(
      await createDeviceKeyCustody(store).load({ accountId: 'acct-parent-b', familyId: challenge.familyId, deviceId: challenge.deviceId }),
    ).toBeNull();
    // No silent replacement: a second genesis save for the same account is refused.
    await expect(
      persistGenesisDeviceKey(challenge, await createGenesisDeviceKey(), createDeviceKeyCustody(store)),
    ).rejects.toBeInstanceOf(DeviceKeyAlreadyCustodiedError);
  });
});
