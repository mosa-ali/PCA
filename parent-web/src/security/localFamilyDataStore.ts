// Local trusted family-data store -- where hypothetically-decrypted family
// content would live once a real EnvelopeDecryptor (see
// @pca/parent-sdk-browser-runtime's cryptoGate.ts) is approved and actually
// produces a value. Nothing in this repository slice ever calls put() with
// real data yet (the only decryptor shipped, NotReadyDecryptor, always
// throws) -- this module is the RECEIVING end of that future pipeline, not
// a source of data today.
//
// Deliberately in-memory only (module-scope, tab-lifetime): family content
// is at least as sensitive as the key material that would decrypt it, so it
// gets the same "never touches Web Storage" treatment as
// ../trustedEndpointKeyStore.ts. A page reload clears it, which is the safe
// default (consistent with re-pairing being required after reload -- see
// that module's PRODUCTION_NOTE).
export interface StoredFamilyRecord<T> {
  data: T;
  /** When the underlying envelope was actually decrypted client-side. */
  decryptedAtUtc: string;
  sourceEnvelopeId: string;
}

export interface FamilyDataFreshness {
  /** ISO timestamp of the most recent successful decrypt into this store, or null if the store has never held any data this session. */
  lastSyncUtc: string | null;
  /** True whenever the store holds no data at all (nothing decrypted yet this session). Distinct from "stale" -- a caller with no data should show an empty/not-ready state, not a stale-data warning. */
  isEmpty: boolean;
}

class LocalFamilyDataStore {
  private records = new Map<string, StoredFamilyRecord<unknown>>();
  private lastSyncUtc: string | null = null;

  put<T>(key: string, data: T, sourceEnvelopeId: string, decryptedAtUtc: string = new Date().toISOString()): void {
    this.records.set(key, { data, decryptedAtUtc, sourceEnvelopeId });
    if (this.lastSyncUtc === null || decryptedAtUtc > this.lastSyncUtc) {
      this.lastSyncUtc = decryptedAtUtc;
    }
  }

  get<T>(key: string): StoredFamilyRecord<T> | null {
    return (this.records.get(key) as StoredFamilyRecord<T> | undefined) ?? null;
  }

  has(key: string): boolean {
    return this.records.has(key);
  }

  getFreshness(): FamilyDataFreshness {
    return { lastSyncUtc: this.lastSyncUtc, isEmpty: this.records.size === 0 };
  }

  clear(): void {
    this.records.clear();
    this.lastSyncUtc = null;
  }
}

export const localFamilyDataStore = new LocalFamilyDataStore();

/** Test/story helper -- exported so tests can build an isolated store instance instead of sharing the module singleton. */
export function createLocalFamilyDataStore(): LocalFamilyDataStore {
  return new LocalFamilyDataStore();
}

export type { LocalFamilyDataStore };
