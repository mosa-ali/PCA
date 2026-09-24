import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDeviceKeyCustody,
  DeviceKeyAlreadyCustodiedError,
  fingerprintPublicKey,
  publicPointBase64Url,
  type DeviceKeyRecord,
  type DeviceKeyRecordStore,
} from '../../src/security/deviceKeyCustody';

// jsdom does not implement crypto.subtle, so install Node's WebCrypto when the
// environment lacks it. The custody module reads the global `crypto` at call time,
// so shimming before the calls is sufficient.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto as unknown as Crypto, configurable: true });
}

const ACCOUNT_ID = 'acct-parent-a';
const FAMILY_ID = 'fam-1';
const DEVICE_ID = 'dev-genesis-owner';
const EXPECTED = { accountId: ACCOUNT_ID, familyId: FAMILY_ID, deviceId: DEVICE_ID };

/** In-memory stand-in for the IndexedDB adapter, so the POLICY below is tested deterministically. */
function memoryStore(initial?: unknown, initialAccount = ACCOUNT_ID) {
  const slots = new Map<string, unknown>();
  if (initial !== undefined) slots.set(initialAccount, initial);
  return {
    readCount: 0,
    async read(accountId: string) {
      this.readCount += 1;
      return slots.get(accountId);
    },
    // Mirrors the IndexedDB adapter's contract: add() when not replacing,
    // one slot per account.
    async write(record: DeviceKeyRecord, options: { replace: boolean }) {
      const slot = record.binding.accountId;
      if (!options.replace && slots.has(slot)) throw new DeviceKeyAlreadyCustodiedError();
      slots.set(slot, record);
    },
    async remove(accountId: string) {
      slots.delete(accountId);
    },
    peek: (accountId = ACCOUNT_ID) => slots.get(accountId),
  };
}

async function freshKeyPair(extractable = false) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, extractable, ['sign', 'verify']);
  return pair;
}

async function boundKey(overrides: Partial<{ accountId: string; familyId: string; deviceId: string }> = {}) {
  const pair = await freshKeyPair();
  const fingerprint = await fingerprintPublicKey(pair.publicKey);
  return {
    binding: {
      accountId: overrides.accountId ?? ACCOUNT_ID,
      familyId: overrides.familyId ?? FAMILY_ID,
      deviceId: overrides.deviceId ?? DEVICE_ID,
      keyId: 'key-1',
      publicKeyFingerprint: fingerprint,
    },
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
  };
}

describe('durable device-key custody', () => {
  // Precondition for every test here.
  beforeEach(() => {
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto as unknown as Crypto, configurable: true });
    }
  });

  it('round-trips a non-extractable key and preserves its signing identity across a reload', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    const key = await boundKey();

    await custody.save(key);
    // A SECOND custody instance over the same store models a fresh page load:
    // nothing is carried over in module memory.
    const loaded = await createDeviceKeyCustody(store).load(EXPECTED);

    expect(loaded).not.toBeNull();
    expect(loaded!.privateKey.extractable).toBe(false);
    expect(loaded!.binding).toEqual(key.binding);

    // Functional identity, not just object presence: the loaded key must be the
    // SAME key. Sign with the private half and verify with the public half.
    const payload = new TextEncoder().encode('owner-attestation-revision-2');
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, loaded!.privateKey, payload);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, loaded!.publicKey, signature, payload)).toBe(true);
  });

  it('the private key cannot be exported, which is the property that makes custody safe', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    await custody.save(await boundKey());
    const loaded = await custody.load(EXPECTED);

    await expect(crypto.subtle.exportKey('jwk', loaded!.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('pkcs8', loaded!.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('raw', loaded!.privateKey)).rejects.toThrow();
  });

  it('REFUSES to overwrite an existing key, so a failed or repeated ceremony cannot strand the family', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    const original = await boundKey();
    await custody.save(original);

    await expect(custody.save(await boundKey())).rejects.toBeInstanceOf(DeviceKeyAlreadyCustodiedError);
    // The original is untouched.
    const loaded = await custody.load(EXPECTED);
    expect(loaded!.binding.publicKeyFingerprint).toBe(original.binding.publicKeyFingerprint);
  });

  it('replaces an existing key only when the caller explicitly asks to', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    await custody.save(await boundKey());
    const replacement = await boundKey();

    await custody.save(replacement, { replaceExisting: true });
    const loaded = await custody.load(EXPECTED);
    expect(loaded!.binding.publicKeyFingerprint).toBe(replacement.binding.publicKeyFingerprint);
  });

  it('returns null when nothing is stored, and never generates a key of its own', async () => {
    const custody = createDeviceKeyCustody(memoryStore());
    expect(await custody.load(EXPECTED)).toBeNull();
  });

  it('fails closed when the stored record belongs to a different family or device', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    await custody.save(await boundKey());

    // Bound, not merely stored: another family's key is unusable, not just unexpected.
    expect(await custody.load({ ...EXPECTED, familyId: 'fam-other' })).toBeNull();
    expect(await custody.load({ ...EXPECTED, deviceId: 'dev-other' })).toBeNull();
  });

  it('treats an EXTRACTABLE stored private key as corrupt rather than adopting it', async () => {
    const pair = await freshKeyPair(true);
    const store = memoryStore({
      binding: { accountId: ACCOUNT_ID, familyId: FAMILY_ID, deviceId: DEVICE_ID, keyId: 'k', publicKeyFingerprint: await fingerprintPublicKey(pair.publicKey) },
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
    });
    // Adopting this would make custody the place a key became readable.
    expect(await createDeviceKeyCustody(store).load(EXPECTED)).toBeNull();
  });

  it('refuses to custody an extractable key in the first place', async () => {
    const pair = await freshKeyPair(true);
    const custody = createDeviceKeyCustody(memoryStore());
    await expect(
      custody.save({
        binding: { accountId: ACCOUNT_ID, familyId: FAMILY_ID, deviceId: DEVICE_ID, keyId: 'k', publicKeyFingerprint: 'x' },
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
      }),
    ).rejects.toThrow(/extractable/i);
  });

  it('fails closed on a record whose fingerprint does not match its own public key', async () => {
    // The state a partial write or tampered store produces: bound identity that
    // no longer describes the key beside it.
    const store = memoryStore({
      binding: { accountId: ACCOUNT_ID, familyId: FAMILY_ID, deviceId: DEVICE_ID, keyId: 'k', publicKeyFingerprint: 'not-the-real-fingerprint' },
      privateKey: (await freshKeyPair()).privateKey,
      publicKey: (await freshKeyPair()).publicKey,
    });
    expect(await createDeviceKeyCustody(store).load(EXPECTED)).toBeNull();
  });

  it('fails closed on a malformed record and LEAVES IT IN PLACE', async () => {
    const store = memoryStore({ nonsense: true });
    const custody = createDeviceKeyCustody(store);
    expect(await custody.load(EXPECTED)).toBeNull();
    // Not silently deleted: a corrupt record that disappears is one a later
    // ceremony could then overwrite, losing whatever the owner had.
    expect(store.peek()).toEqual({ nonsense: true });
  });

  it('fails closed when the store itself throws on read', async () => {
    const store: DeviceKeyRecordStore = {
      read: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      write: vi.fn(),
      remove: vi.fn(),
    };
    expect(await createDeviceKeyCustody(store).load(EXPECTED)).toBeNull();
  });

  it('C-1: a DIFFERENT ACCOUNT on the same browser, same family and device, cannot load the key', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    await custody.save(await boundKey());
    // Parent B signs into the same browser profile (same origin, same IndexedDB).
    expect(await custody.load({ ...EXPECTED, accountId: 'acct-parent-b' })).toBeNull();
    // Parent A still can.
    expect(await custody.load(EXPECTED)).not.toBeNull();
  });

  it('C-2: the fingerprint is the SHA-256 of the SEC1 point and is stable across a re-imported public key', async () => {
    const pair = await freshKeyPair();
    const point = await publicPointBase64Url(pair.publicKey);
    const raw = Uint8Array.from(atob(point.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (point.length % 4)) % 4)), (c) => c.charCodeAt(0));
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(0x04);
    const reimported = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    expect(await fingerprintPublicKey(reimported)).toBe(await fingerprintPublicKey(pair.publicKey));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
    expect(await fingerprintPublicKey(pair.publicKey)).toBe([...digest].map((b) => b.toString(16).padStart(2, '0')).join(''));
  });

  it('C-4: a stored non-ECDSA or wrong-curve key is rejected rather than adopted', async () => {
    const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const good = await freshKeyPair();
    const store = memoryStore({
      binding: { accountId: ACCOUNT_ID, familyId: FAMILY_ID, deviceId: DEVICE_ID, keyId: 'k', publicKeyFingerprint: await fingerprintPublicKey(good.publicKey) },
      privateKey: hmac,
      publicKey: good.publicKey,
    });
    expect(await createDeviceKeyCustody(store).load(EXPECTED)).toBeNull();
    const p384 = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, false, ['sign', 'verify']);
    await expect(
      createDeviceKeyCustody(memoryStore()).save({
        binding: { accountId: ACCOUNT_ID, familyId: FAMILY_ID, deviceId: DEVICE_ID, keyId: 'k', publicKeyFingerprint: 'x' },
        privateKey: p384.privateKey,
        publicKey: p384.publicKey,
      }),
    ).rejects.toThrow(/P-256/);
  });

  it('refuses to save a key whose binding fingerprint does not describe its own public key', async () => {
    const key = await boundKey();
    await expect(
      createDeviceKeyCustody(memoryStore()).save({ ...key, binding: { ...key.binding, publicKeyFingerprint: '00'.repeat(32) } }),
    ).rejects.toThrow(/fingerprint/);
  });

  it('two parents on the same browser each keep their OWN key; neither save collides with or overwrites the other', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    const parentA = await boundKey();
    const parentB = await boundKey({ accountId: 'acct-parent-b', familyId: 'fam-2', deviceId: 'dev-b' });
    await custody.save(parentA);
    await custody.save(parentB);
    const loadedA = await custody.load(EXPECTED);
    const loadedB = await custody.load({ accountId: 'acct-parent-b', familyId: 'fam-2', deviceId: 'dev-b' });
    expect(loadedA!.binding.publicKeyFingerprint).toBe(parentA.binding.publicKeyFingerprint);
    expect(loadedB!.binding.publicKeyFingerprint).toBe(parentB.binding.publicKeyFingerprint);
    // B's credentials never open A's slot, even naming A's family and device.
    expect(await custody.load({ accountId: 'acct-parent-b', familyId: FAMILY_ID, deviceId: DEVICE_ID })).toBeNull();
  });
});
