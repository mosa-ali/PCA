// Durable custody for the Owner's browser signing key.
//
// WHY THIS EXISTS
// ---------------
// `trustedEndpointKeyStore.ts` holds its non-extractable P-256 key in a
// module-scope variable, so the handle dies with the tab. Genesis.tsx then does a
// FULL NAVIGATION on success, which discards that very handle at the end of the
// ceremony that created it. The result was that the Owner's signing key survived
// nothing -- not the redirect out of genesis, not a reload -- so the
// device-signed owner attestation could never be renewed, and the family lost
// resolvable commercial authority when the short-lived head expired.
//
// This module is the durable half. It is deliberately a SEPARATE, isolated
// interface rather than a change to `trustedEndpointKeyStore.ts`, because that
// module's tab-lifetime custody is a contract the P-256 pairing flow depends on;
// widening it in place would silently change pairing's security posture as a side
// effect. Owner-approved in principle; production real-crypto activation remains
// behind the existing external crypto/security-review gate.
//
// THE PRIVATE KEY IS NEVER SERIALIZED
// -----------------------------------
// The stored record holds live `CryptoKey` OBJECTS, handed to the platform's
// structured-clone algorithm and nothing else. There is no JWK, no raw bytes, no
// PKCS#8, no Base64, and no string form of the private key anywhere in this
// module -- on disk or in memory. A non-extractable CryptoKey cannot be exported
// (`crypto.subtle.exportKey` throws), and this module NEVER calls exportKey on a
// private key at any point, including on load. Web Storage (localStorage,
// sessionStorage), cookies, the backend, logs and telemetry are all untouched: the
// only sink is the injected record store.
//
// WHAT THIS DOES *NOT* PROTECT AGAINST -- stated plainly, because overclaiming
// here would be worse than the bug: non-extractability stops the key being READ
// OUT of the browser. It does NOT stop same-origin script from USING it while the
// page is open, and it is not hardware-backed -- there is no evidence any
// platform binding is in play, so none is claimed. IndexedDB is also clearable by
// the user or the browser, and that is device loss (see policy below), never
// permission to re-genesis.
//
// POLICY, ENFORCED HERE SO IT CANNOT BE FORGOTTEN BY A CALLER
// ----------------------------------------------------------
//  1. NON-EXTRACTABLE, ALWAYS. Asserted on save AND on load: a record holding an
//     extractable private key is treated as corrupt rather than adopted, because
//     silently accepting one would make this module the place a key becomes
//     readable.
//  2. NO SILENT REPLACEMENT. `save` REFUSES when a record already exists unless
//     the caller explicitly says to replace it. A failed or repeated genesis must
//     not overwrite the one working owner key.
//  3. FAIL CLOSED ON LOAD. A missing, unreadable, malformed, mismatched or
//     extractable record yields `null` -- never a freshly generated key, and
//     never a repaired record. The record is deliberately LEFT IN PLACE: a
//     corrupt record that gets silently deleted is one a later ceremony could
//     then overwrite.
//  4. BOUND, NOT JUST STORED. A record is only returned for the exact
//     account/family/device it was stored for. A key for another account,
//     family or device is unusable, not merely unexpected.
const SIGNING_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;

/**
 * Non-secret identity a custodied key is bound to. Safe to log or display.
 *
 * `accountId` is part of the binding (C-1): two parents of the same family who
 * share one browser profile share one IndexedDB, so a record bound only to
 * family + device would let the second parent load the first parent's owner
 * key. A record is usable ONLY by the account that created it.
 */
export interface DeviceKeyBinding {
  accountId: string;
  familyId: string;
  deviceId: string;
  keyId: string;
  /**
   * SHA-256 (hex) of the SEC1 uncompressed public point (0x04 || X || Y,
   * exactly 65 bytes) -- the canonical encoding the genesis protocol signs over
   * and the backend stores (C-2). Never a hash of JWK JSON, whose property order
   * and optional members vary between engines and browser versions.
   */
  publicKeyFingerprint: string;
}

export interface CustodiedDeviceKey {
  binding: DeviceKeyBinding;
  /** Non-extractable by construction; never exported. */
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

/**
 * The ONLY shape this module stores. Structured-cloneable live key handles plus
 * non-secret binding -- there is no field a private key could be serialized into.
 */
export interface DeviceKeyRecord {
  binding: DeviceKeyBinding;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

/** Raised by a store when a non-replacing write finds an existing record. */
export class DeviceKeyAlreadyCustodiedError extends Error {
  constructor() {
    super(
      'A device key is already in durable custody for this browser. Replacing it requires an explicit replaceExisting, ' +
        'because overwriting the sole working owner key would strand the family it signs for.',
    );
    this.name = 'DeviceKeyAlreadyCustodiedError';
  }
}

/**
 * The storage seam. Deliberately tiny: read/write/remove of one opaque record PER
 * ACCOUNT (two parents sharing a browser profile each own a separate slot, so
 * one parent's genesis can never collide with or overwrite the other's key), so
 * the security POLICY below is testable deterministically without IndexedDB, and
 * so the platform adapter stays thin enough to audit by eye.
 *
 * write() MUST be atomic with respect to `replace` (C-3): with replace=false it
 * must fail with DeviceKeyAlreadyCustodiedError when a record exists, in the same
 * storage operation as the insert (IndexedDB: IDBObjectStore.add), so two tabs
 * can never both "win" a check-then-write race. It must resolve only once the
 * write is durably committed.
 */
export interface DeviceKeyRecordStore {
  /** Reads the ONE slot owned by `accountId`. Other accounts' slots are never read. */
  read(accountId: string): Promise<unknown>;
  /** Writes the slot owned by `record.binding.accountId`. */
  write(record: DeviceKeyRecord, options: { replace: boolean }): Promise<void>;
  remove(accountId: string): Promise<void>;
}

export interface ExpectedDeviceKeyBinding {
  accountId: string;
  familyId: string;
  deviceId: string;
}

export interface DeviceKeyCustody {
  /** Returns the bound key, or null. NEVER generates or repairs anything. */
  load(expected: ExpectedDeviceKeyBinding): Promise<CustodiedDeviceKey | null>;
  /** Refuses to overwrite an existing record unless `replaceExisting` is set. */
  save(key: CustodiedDeviceKey, options?: { replaceExisting?: boolean }): Promise<void>;
  /** Removes this account's record. Device loss / explicit revocation only. */
  clear(accountId: string): Promise<void>;
}

async function sha256Hex(input: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SEC1 uncompressed public point bytes. Only ever called with a PUBLIC key. */
export async function exportPublicPointBytes(publicKey: CryptoKey): Promise<Uint8Array> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error('invalid_p256_public_point');
  return raw;
}

/** SEC1 uncompressed public point, unpadded base64url -- the protocol wire encoding. */
export async function publicPointBase64Url(publicKey: CryptoKey): Promise<string> {
  const bytes = await exportPublicPointBytes(publicKey);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Canonical SHA-256 fingerprint of a PUBLIC key over its SEC1 point. Stable for
 * a given key regardless of browser, engine or version. Exporting the private
 * key is never done by this module.
 */
export async function fingerprintPublicKey(publicKey: CryptoKey): Promise<string> {
  return sha256Hex(await exportPublicPointBytes(publicKey));
}

function sameUsages(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((usage) => actual.includes(usage));
}

/** C-4: the stored handles must be exactly the key kind custody issues. */
function isExpectedP256Pair(privateKey: CryptoKey, publicKey: CryptoKey): boolean {
  const privateAlgorithm = privateKey.algorithm as EcKeyAlgorithm;
  const publicAlgorithm = publicKey.algorithm as EcKeyAlgorithm;
  return (
    privateKey.type === 'private' &&
    publicKey.type === 'public' &&
    privateAlgorithm?.name === 'ECDSA' &&
    privateAlgorithm?.namedCurve === 'P-256' &&
    publicAlgorithm?.name === 'ECDSA' &&
    publicAlgorithm?.namedCurve === 'P-256' &&
    sameUsages(privateKey.usages, ['sign']) &&
    sameUsages(publicKey.usages, ['verify'])
  );
}

function isRecord(value: unknown): value is DeviceKeyRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DeviceKeyRecord>;
  const binding = candidate.binding as Partial<DeviceKeyBinding> | undefined;
  if (typeof binding !== 'object' || binding === null) return false;
  if (typeof binding.accountId !== 'string' || typeof binding.familyId !== 'string' || typeof binding.deviceId !== 'string') return false;
  if (typeof binding.keyId !== 'string' || typeof binding.publicKeyFingerprint !== 'string') return false;
  if (typeof CryptoKey !== 'undefined' && (!(candidate.privateKey instanceof CryptoKey) || !(candidate.publicKey instanceof CryptoKey))) return false;
  return typeof candidate.privateKey === 'object' && candidate.privateKey !== null && typeof candidate.publicKey === 'object' && candidate.publicKey !== null;
}

export function createDeviceKeyCustody(store: DeviceKeyRecordStore): DeviceKeyCustody {
  return {
    async load(expected) {
      let raw: unknown;
      try {
        raw = await store.read(expected.accountId);
      } catch {
        // An unreadable store is indistinguishable from having no usable key, and
        // neither may cause a new key: return null and let the caller decide
        // deliberately.
        return null;
      }
      // Missing is the normal first-run case, not an error.
      if (raw === undefined || raw === null) return null;

      // Malformed / wrong shape: fail closed and leave the record alone.
      if (!isRecord(raw)) return null;

      // Bound, not merely stored: account, family AND device must all match.
      if (
        raw.binding.accountId !== expected.accountId ||
        raw.binding.familyId !== expected.familyId ||
        raw.binding.deviceId !== expected.deviceId
      ) {
        return null;
      }

      // A stored private key that is extractable is corrupt by definition here.
      // Adopting it would make this module the place a key became readable.
      if (raw.privateKey.extractable !== false) return null;
      if (!isExpectedP256Pair(raw.privateKey, raw.publicKey)) return null;

      // The stored identity must still describe the stored key: a record whose
      // fingerprint does not match its own public key is internally inconsistent,
      // which is exactly the state a partial write or a tampered store produces.
      let actualFingerprint: string;
      try {
        actualFingerprint = await fingerprintPublicKey(raw.publicKey);
      } catch {
        return null;
      }
      if (actualFingerprint !== raw.binding.publicKeyFingerprint) return null;

      return { binding: raw.binding, privateKey: raw.privateKey, publicKey: raw.publicKey };
    },

    async save(key, options = {}) {
      if (key.privateKey.extractable !== false) {
        throw new Error(
          'Refusing to custody an extractable private key -- durable custody exists to keep the owner signing key non-exportable.',
        );
      }
      if (!isExpectedP256Pair(key.privateKey, key.publicKey)) {
        throw new Error('Refusing to custody a key that is not a non-extractable ECDSA P-256 signing pair.');
      }
      if ((await fingerprintPublicKey(key.publicKey)) !== key.binding.publicKeyFingerprint) {
        throw new Error('Refusing to custody a key whose binding fingerprint does not describe its own public key.');
      }
      // NO SILENT REPLACEMENT: the store enforces it atomically (add, not put).
      await store.write(
        { binding: key.binding, privateKey: key.privateKey, publicKey: key.publicKey },
        { replace: options.replaceExisting === true },
      );
    },

    async clear(accountId) {
      await store.remove(accountId);
    },
  };
}

/** Generates a non-extractable P-256 keypair for custody, with the same defensive assertion the in-memory store uses. */
export async function generateCustodyKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto (crypto.subtle) is unavailable -- a non-extractable device key cannot be generated here.');
  }
  const keyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, false, ['sign', 'verify']);
  if (keyPair.privateKey.extractable) {
    throw new Error('Generated private key was unexpectedly extractable -- refusing to hold it. This is a WebCrypto implementation bug, not a configuration requested here.');
  }
  return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey };
}
